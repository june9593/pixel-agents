import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'events'

import { OpenClawWatcher } from './openclawWatcher.js'
import type { OpenClawGateway } from './openclawGateway.js'
import type { PixelMessage } from '../logTranslator.js'

/**
 * Minimal duck-typed fake gateway exposing the surface OpenClawWatcher uses:
 *   - extends EventEmitter
 *   - call(method, params) that we control via a router
 *   - start()/stop() that emit 'open'
 */
class FakeGateway extends EventEmitter {
  router: Record<string, (params: unknown) => unknown> = {}
  started = false

  async start() {
    this.started = true
    // Defer the open event to the next tick to mimic real WS handshake.
    queueMicrotask(() => this.emit('open'))
  }

  async stop() {
    this.started = false
  }

  async call<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    const handler = this.router[method]
    if (!handler) throw new Error(`unhandled method: ${method}`)
    return handler(params) as T
  }
}

function asWatcherGateway(g: FakeGateway): OpenClawGateway {
  // Tests treat the fake as the real gateway via duck typing.
  return g as unknown as OpenClawGateway
}

function collect(w: OpenClawWatcher): PixelMessage[] {
  const acc: PixelMessage[] = []
  w.on('message', (m: PixelMessage) => acc.push(m))
  return acc
}

test('discovers existing sessions on start: emits agentCreated + agentInfo', async () => {
  const gw = new FakeGateway()
  gw.router['sessions.messages.subscribe'] = () => ({ ok: true })
  gw.router['sessions.list'] = () => ({
    sessions: [
      { sessionKey: 'agent:qa:main', title: 'QA agent' },
      { sessionKey: 'agent:dev:main', title: 'Dev agent' },
    ],
  })
  gw.router['chat.history'] = () => ({ messages: [] })

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 1000 })
  const events = collect(w)
  await w.start()
  // Wait one macro-tick so subscribeAndSync resolves
  await new Promise((r) => setTimeout(r, 10))

  const created = events.filter((e) => e.type === 'agentCreated')
  assert.equal(created.length, 2)
  assert.deepEqual(
    created.map((e) => e.id),
    [1000, 1001],
  )
  const info = w.getAgentInfo()
  assert.equal(info.length, 2)
  assert.equal(info[0].externalId, 'agent:qa:main')
  assert.equal(info[0].sessionTitle, 'QA agent')
  assert.equal(w.agentCount(), 2)
  await w.stop()
})

test('session.message event triggers chat.history fetch + emits translated PixelMessages', async () => {
  const gw = new FakeGateway()
  gw.router['sessions.messages.subscribe'] = () => ({ ok: true })
  gw.router['sessions.list'] = () => ({ sessions: [] })

  let historyCalls = 0
  let history: unknown[] = []
  gw.router['chat.history'] = () => {
    historyCalls++
    return { messages: history }
  }

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 500 })
  const events = collect(w)
  await w.start()
  await new Promise((r) => setTimeout(r, 5))

  // First push: a fresh session with a single user → assistant text turn
  history = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
  ]
  gw.emit('event', { event: 'session.message', payload: { sessionKey: 'agent:new:1' } })
  await new Promise((r) => setTimeout(r, 5))

  const created = events.find((e) => e.type === 'agentCreated')
  assert.ok(created, 'agentCreated emitted on first session.message')
  assert.equal(created!.id, 500)
  assert.ok(events.some((e) => e.type === 'agentTextResponse'))
  assert.ok(events.some((e) => e.type === 'agentStatus' && e.status === 'waiting'))
  assert.ok(historyCalls >= 1)
  await w.stop()
})

test('repeated session.message events with identical history do not re-emit', async () => {
  const gw = new FakeGateway()
  gw.router['sessions.messages.subscribe'] = () => ({ ok: true })
  gw.router['sessions.list'] = () => ({ sessions: [] })
  const history = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
  ]
  gw.router['chat.history'] = () => ({ messages: history })

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 700 })
  const events = collect(w)
  await w.start()
  await new Promise((r) => setTimeout(r, 5))

  gw.emit('event', { event: 'session.message', payload: { sessionKey: 's1' } })
  await new Promise((r) => setTimeout(r, 5))
  const countAfterFirst = events.length

  gw.emit('event', { event: 'session.message', payload: { sessionKey: 's1' } })
  await new Promise((r) => setTimeout(r, 5))
  const countAfterSecond = events.length

  // Second event must be a no-op (no new transcript rows)
  assert.equal(countAfterSecond, countAfterFirst, 'no duplicate events emitted')
  await w.stop()
})

test('chat.history failure is logged and does not crash the watcher', async () => {
  const gw = new FakeGateway()
  gw.router['sessions.messages.subscribe'] = () => ({ ok: true })
  gw.router['sessions.list'] = () => ({ sessions: [] })
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

  gw.emit('event', { event: 'session.message', payload: { sessionKey: 'broken' } })
  await new Promise((r) => setTimeout(r, 5))

  assert.ok(events.find((e) => e.type === 'agentCreated'))
  assert.ok(warnings.some((w) => w.includes('chat.history failed')))
  await w.stop()
})

test('removeAgentById emits agentClosed and forgets the session', async () => {
  const gw = new FakeGateway()
  gw.router['sessions.messages.subscribe'] = () => ({ ok: true })
  gw.router['sessions.list'] = () => ({ sessions: [{ sessionKey: 'a', title: 'A' }] })
  gw.router['chat.history'] = () => ({ messages: [] })

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 42 })
  const events = collect(w)
  await w.start()
  await new Promise((r) => setTimeout(r, 5))

  assert.equal(w.removeAgentById(42), true)
  assert.equal(w.agentCount(), 0)
  assert.ok(events.some((e) => e.type === 'agentClosed' && e.id === 42))
  assert.equal(w.removeAgentById(42), false)
  await w.stop()
})

test('source identifier is "openclaw" + generateExistingAgentsMessage shape', async () => {
  const gw = new FakeGateway()
  gw.router['sessions.messages.subscribe'] = () => ({ ok: true })
  gw.router['sessions.list'] = () => ({
    sessions: [{ sessionKey: 'k1' }, { sessionKey: 'k2' }],
  })
  gw.router['chat.history'] = () => ({ messages: [] })

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
