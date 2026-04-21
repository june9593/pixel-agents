import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'events'

import { OpenClawWatcher } from './openclawWatcher.js'
import type { OpenClawGateway } from './openclawGateway.js'
import type { PixelMessage } from '../logTranslator.js'

/**
 * Fake gateway with the surface OpenClawWatcher uses (protocol v3):
 *   - extends EventEmitter
 *   - request(method, params?, timeoutMs?) routed via this.router
 *   - get connected — controlled via this._connected
 *   - start()/stop() — start emits 'open' on next microtask
 *   - test helpers: simulateClose(), simulateReconnect(), emitEvent()
 */
class FakeGateway extends EventEmitter {
  router: Record<string, (params: unknown) => unknown> = {}
  calls: Array<{ method: string; params: unknown }> = []
  started = false
  private _connected = false

  get connected(): boolean {
    return this._connected
  }

  async start() {
    this.started = true
    queueMicrotask(() => {
      this._connected = true
      this.emit('open', { protocolVersion: 3 })
    })
  }

  async stop() {
    this.started = false
    this._connected = false
  }

  async request<T = unknown>(method: string, params: unknown = {}, _timeoutMs?: number): Promise<T> {
    this.calls.push({ method, params })
    const handler = this.router[method]
    if (!handler) throw new Error(`unhandled method: ${method}`)
    return handler(params) as T
  }

  // Back-compat alias used by some unit tests.
  async call<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    return this.request<T>(method, params)
  }

  /** Drop the connection as if the server hung up. wasOpen=true mimics a real disconnect. */
  simulateClose(wasOpen = true) {
    this._connected = false
    this.emit('close', { code: 1006, reason: 'simulated', wasOpen })
  }

  /** Simulate a successful reconnect: emit 'open' (and optionally 'reconnected'). */
  simulateReconnect() {
    this._connected = true
    this.emit('open', { protocolVersion: 3 })
    this.emit('reconnected', { protocolVersion: 3 })
  }

  /** Emit an event frame. */
  emitEvent(event: string, payload: unknown) {
    this.emit('event', { event, payload })
  }
}

function asWatcherGateway(g: FakeGateway): OpenClawGateway {
  return g as unknown as OpenClawGateway
}

function collect(w: OpenClawWatcher): PixelMessage[] {
  const acc: PixelMessage[] = []
  w.on('message', (m: PixelMessage) => acc.push(m))
  return acc
}

/** Default routes for the v3 subscribe sequence. */
function installDefaultRoutes(gw: FakeGateway, sessions: Array<{ sessionKey: string; title?: string }> = []) {
  gw.router['sessions.subscribe'] = () => ({ subscribed: true })
  gw.router['sessions.unsubscribe'] = () => ({ subscribed: false })
  gw.router['sessions.list'] = () => ({ sessions })
  gw.router['sessions.messages.subscribe'] = (params: unknown) => {
    const key = (params as { key?: string }).key ?? ''
    return { subscribed: true, key }
  }
  gw.router['sessions.messages.unsubscribe'] = (params: unknown) => {
    const key = (params as { key?: string }).key ?? ''
    return { subscribed: false, key }
  }
  gw.router['chat.history'] = () => ({ messages: [] })
}

test('start runs sessions.subscribe + sessions.list + per-session sessions.messages.subscribe + chat.history', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, [
    { sessionKey: 'agent:qa:main', title: 'QA agent' },
    { sessionKey: 'agent:dev:main', title: 'Dev agent' },
  ])

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 1000 })
  const events = collect(w)
  await w.start()
  await new Promise((r) => setTimeout(r, 10))

  // Expected RPC sequence:
  //   sessions.subscribe (no params)
  //   sessions.list
  //   sessions.messages.subscribe { key: 'agent:qa:main' }
  //   chat.history { sessionKey: 'agent:qa:main', limit }
  //   sessions.messages.subscribe { key: 'agent:dev:main' }
  //   chat.history { sessionKey: 'agent:dev:main', limit }
  const methods = gw.calls.map((c) => c.method)
  assert.deepEqual(methods, [
    'sessions.subscribe',
    'sessions.list',
    'sessions.messages.subscribe',
    'chat.history',
    'sessions.messages.subscribe',
    'chat.history',
  ])
  // Critical: per-session subscribe uses `key` (not `sessionKey`).
  const subscribeParams = gw.calls.filter((c) => c.method === 'sessions.messages.subscribe').map((c) => c.params)
  assert.deepEqual(subscribeParams, [{ key: 'agent:qa:main' }, { key: 'agent:dev:main' }])

  const created = events.filter((e) => e.type === 'agentCreated')
  assert.equal(created.length, 2)
  assert.deepEqual(
    created.map((e) => e.id),
    [1000, 1001],
  )
  assert.equal(w.agentCount(), 2)
  await w.stop()
})

test('session.message event triggers chat.history fetch + emits translated PixelMessages', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, [])

  let history: unknown[] = []
  gw.router['chat.history'] = () => ({ messages: history })

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 500 })
  const events = collect(w)
  await w.start()
  await new Promise((r) => setTimeout(r, 5))

  history = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
  ]
  gw.emitEvent('session.message', { sessionKey: 'agent:new:1' })
  await new Promise((r) => setTimeout(r, 5))

  const created = events.find((e) => e.type === 'agentCreated')
  assert.ok(created, 'agentCreated emitted on first session.message')
  assert.equal(created!.id, 500)
  assert.ok(events.some((e) => e.type === 'agentTextResponse'))
  assert.ok(events.some((e) => e.type === 'agentStatus' && e.status === 'waiting'))
  // Brand-new session should also be subscribed to.
  assert.ok(
    gw.calls.some(
      (c) => c.method === 'sessions.messages.subscribe' && (c.params as { key: string }).key === 'agent:new:1',
    ),
    'auto-subscribes to brand-new sessions seen via session.message',
  )
  await w.stop()
})

test('sessions.changed event re-lists sessions and subscribes to NEW sessions only', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, [{ sessionKey: 's1' }])

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 100 })
  const events = collect(w)
  await w.start()
  await new Promise((r) => setTimeout(r, 5))

  const subscribesBefore = gw.calls.filter((c) => c.method === 'sessions.messages.subscribe').length
  assert.equal(subscribesBefore, 1)

  // Now the server reports a new session
  gw.router['sessions.list'] = () => ({ sessions: [{ sessionKey: 's1' }, { sessionKey: 's2', title: 'New' }] })
  gw.emitEvent('sessions.changed', { sessionKey: 's2' })
  await new Promise((r) => setTimeout(r, 10))

  const subscribesAfter = gw.calls.filter((c) => c.method === 'sessions.messages.subscribe')
  // Should have ONE additional subscribe for s2, not re-subscribe to s1
  assert.equal(subscribesAfter.length, 2)
  assert.equal((subscribesAfter[1].params as { key: string }).key, 's2')
  // s2 must produce an agentCreated event
  assert.ok(events.some((e) => e.type === 'agentCreated' && e.id === 101))
  await w.stop()
})

test('sessions.changed drops sessions no longer in the list (emits agentClosed)', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, [{ sessionKey: 's1' }, { sessionKey: 's2' }])

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 200 })
  const events = collect(w)
  await w.start()
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(w.agentCount(), 2)

  // Server now only reports s1
  gw.router['sessions.list'] = () => ({ sessions: [{ sessionKey: 's1' }] })
  gw.emitEvent('sessions.changed', {})
  await new Promise((r) => setTimeout(r, 10))

  assert.equal(w.agentCount(), 1)
  assert.ok(events.some((e) => e.type === 'agentClosed' && e.id === 201), 'agentClosed for s2')
})

test('reconnect re-runs the full subscribe sequence (sessions.changed bindings are per-conn)', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, [{ sessionKey: 's1' }])

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 300 })
  await w.start()
  await new Promise((r) => setTimeout(r, 5))

  const callsBefore = gw.calls.length
  // Disconnect then reconnect
  gw.simulateClose(true)
  await new Promise((r) => setTimeout(r, 1))
  gw.simulateReconnect()
  await new Promise((r) => setTimeout(r, 10))

  const newCalls = gw.calls.slice(callsBefore).map((c) => c.method)
  // After reconnect we expect the full subscribe sequence again, since the
  // server forgets subscriptions on disconnect.
  assert.ok(newCalls.includes('sessions.subscribe'), 'sessions.subscribe re-issued')
  assert.ok(
    newCalls.filter((m) => m === 'sessions.messages.subscribe').length === 1,
    'sessions.messages.subscribe re-issued for tracked session',
  )
  await w.stop()
})

test('per-session canonical key from server is used going forward', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, [{ sessionKey: 'short-key' }])
  // Server canonicalises to a different form
  gw.router['sessions.messages.subscribe'] = () => ({ subscribed: true, key: 'agent:canonical:short-key' })

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 400 })
  await w.start()
  await new Promise((r) => setTimeout(r, 5))

  const info = w.getAgentInfo()
  assert.equal(info.length, 1)
  assert.equal(info[0].externalId, 'agent:canonical:short-key', 'tracking re-keyed to canonical')
  // chat.history should have been called with the canonical key
  const historyCall = gw.calls.find((c) => c.method === 'chat.history')
  assert.equal((historyCall?.params as { sessionKey: string }).sessionKey, 'agent:canonical:short-key')
  await w.stop()
})

test('repeated session.message events with identical history do not re-emit', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, [])
  const history = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
  ]
  gw.router['chat.history'] = () => ({ messages: history })

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 700 })
  const events = collect(w)
  await w.start()
  await new Promise((r) => setTimeout(r, 5))

  gw.emitEvent('session.message', { sessionKey: 's1' })
  await new Promise((r) => setTimeout(r, 5))
  const countAfterFirst = events.length

  gw.emitEvent('session.message', { sessionKey: 's1' })
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(events.length, countAfterFirst, 'no duplicate events emitted')
  await w.stop()
})

test('chat.history failure is logged and does not crash the watcher', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, [])
  gw.router['chat.history'] = () => {
    throw new Error('upstream offline')
  }
  const warnings: string[] = []
  const logger = {
    log: () => {},
    warn: (...a: unknown[]) => warnings.push(a.map(String).join(' ')),
    error: () => {},
  }

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), logger })
  const events = collect(w)
  await w.start()
  await new Promise((r) => setTimeout(r, 5))

  gw.emitEvent('session.message', { sessionKey: 'broken' })
  await new Promise((r) => setTimeout(r, 5))

  assert.ok(events.find((e) => e.type === 'agentCreated'))
  assert.ok(warnings.some((w) => w.includes('chat.history failed')))
  await w.stop()
})

test('sessions.list failure during start is logged and does not crash', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, [])
  gw.router['sessions.list'] = () => {
    throw new Error('list-fail')
  }
  const warnings: string[] = []
  const logger = { log: () => {}, warn: (...a: unknown[]) => warnings.push(a.map(String).join(' ')), error: () => {} }

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), logger })
  await w.start()
  await new Promise((r) => setTimeout(r, 5))

  assert.ok(warnings.some((w) => w.includes('sessions.list failed')))
  assert.equal(w.agentCount(), 0)
  await w.stop()
})

test('removeAgentById emits agentClosed, drops tracking, and unsubscribes server-side', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, [{ sessionKey: 'a', title: 'A' }])

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 42 })
  const events = collect(w)
  await w.start()
  await new Promise((r) => setTimeout(r, 5))

  assert.equal(w.removeAgentById(42), true)
  await new Promise((r) => setTimeout(r, 1))
  assert.equal(w.agentCount(), 0)
  assert.ok(events.some((e) => e.type === 'agentClosed' && e.id === 42))
  assert.ok(
    gw.calls.some(
      (c) =>
        c.method === 'sessions.messages.unsubscribe' &&
        (c.params as { key: string }).key === 'a',
    ),
    'server-side unsubscribe issued',
  )
  assert.equal(w.removeAgentById(42), false)
  await w.stop()
})

test('stop() unsubscribes all sessions and detaches gateway listeners', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, [{ sessionKey: 's1' }, { sessionKey: 's2' }])

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 1 })
  await w.start()
  await new Promise((r) => setTimeout(r, 5))

  const callsBefore = gw.calls.length
  await w.stop()

  const teardown = gw.calls.slice(callsBefore).map((c) => `${c.method}:${(c.params as { key?: string }).key ?? ''}`)
  assert.ok(teardown.includes('sessions.unsubscribe:'))
  assert.ok(teardown.includes('sessions.messages.unsubscribe:s1'))
  assert.ok(teardown.includes('sessions.messages.unsubscribe:s2'))

  // After stop, gateway events must not produce more activity.
  const callsAfterStop = gw.calls.length
  gw.emit('open', {}) // would have triggered subscribeAndSync if still attached
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(gw.calls.length, callsAfterStop, 'no calls after stop')
})

test('auth-failed is logged at error level and watcher remains quiescent', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, [])
  const errors: string[] = []
  const logger = {
    log: () => {},
    warn: () => {},
    error: (...a: unknown[]) => errors.push(a.map(String).join(' ')),
  }

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), logger })
  await w.start()
  await new Promise((r) => setTimeout(r, 5))

  gw.emit('auth-failed', { message: 'bad token', details: { code: 'AUTH_TOKEN_MISMATCH' } })
  await new Promise((r) => setTimeout(r, 5))
  assert.ok(errors.some((e) => e.includes('auth failed')))
  await w.stop()
})

test('source identifier is "openclaw" + generateExistingAgentsMessage shape', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, [{ sessionKey: 'k1' }, { sessionKey: 'k2' }])

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 10 })
  await w.start()
  await new Promise((r) => setTimeout(r, 5))

  assert.equal(w.source, 'openclaw')
  const existing = w.generateExistingAgentsMessage()
  assert.equal(existing.type, 'existingAgents')
  assert.deepEqual(existing.agents, [10, 11])
  assert.deepEqual(existing.agentMeta, {})
  await w.stop()
})
