import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'events'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { OpenClawWatcher } from './openclawWatcher.js'
import type { OpenClawGateway } from './openclawGateway.js'
import type { PixelMessage } from '../logTranslator.js'

/**
 * Watcher tests — health-event-driven model (post YUE-93).
 *
 * Architecture under test:
 *   - On `open`, watcher calls `sessions.list` once to cache labels.
 *   - On every `health` event, watcher diffs payload against tracked state
 *     via translator helpers, calls `chat.history` for advanced/appeared,
 *     emits agentClosed for disappeared.
 *   - Tracking unit: 1 session ↔ 1 PixelAgent.
 *   - No subscribe RPCs exist on deployed gateway.
 */

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const FIXTURE_DIR = resolve(__dirname, '../../__fixtures__/openclaw')

interface HealthVariant {
  _variant: string
  agents?: unknown
  sessions?: unknown
}

interface SessionsListVariant {
  _variant: string
  sessions: Array<{ key: string; label?: string; updatedAt?: number }>
}

const healthFixtures = JSON.parse(
  readFileSync(resolve(FIXTURE_DIR, 'health-payload.json'), 'utf8'),
) as HealthVariant[]
const sessionsListFixtures = JSON.parse(
  readFileSync(resolve(FIXTURE_DIR, 'sessions-list-response.json'), 'utf8'),
) as SessionsListVariant[]

function getHealth(name: string): { agents?: unknown; sessions?: unknown } {
  const v = healthFixtures.find((h) => h._variant === name)
  if (!v) throw new Error(`fixture variant not found: ${name}`)
  // Strip `_variant` and return rest as the health payload.
  const { _variant: _v, ...payload } = v
  return payload
}
function getSessionsList(name: string): { sessions: SessionsListVariant['sessions'] } {
  const v = sessionsListFixtures.find((s) => s._variant === name)
  if (!v) throw new Error(`sessions-list variant not found: ${name}`)
  return { sessions: v.sessions }
}

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

  async call<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    return this.request<T>(method, params)
  }

  simulateClose(wasOpen = true) {
    this._connected = false
    this.emit('close', { code: 1006, reason: 'simulated', wasOpen })
  }

  simulateReconnect() {
    this._connected = true
    this.emit('open', { protocolVersion: 3 })
    this.emit('reconnected', { protocolVersion: 3 })
  }

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

/** Default routes for the health-driven model. */
function installDefaultRoutes(
  gw: FakeGateway,
  sessionsList: { sessions: unknown[] } = { sessions: [] },
) {
  gw.router['sessions.list'] = () => sessionsList
  gw.router['chat.history'] = () => ({ messages: [] })
}

const tick = () => new Promise((r) => setTimeout(r, 10))

// ─── tests ────────────────────────────────────────────────────────────────

test('start calls sessions.list once for label bootstrap, no subscribe RPCs', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, getSessionsList('with-labels'))

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 1000 })
  await w.start()
  await tick()

  const methods = gw.calls.map((c) => c.method)
  assert.deepEqual(methods, ['sessions.list'], 'only sessions.list, no subscribe')
  assert.equal(w.agentCount(), 0, 'no agents tracked until first health')
  await w.stop()
})

test('first health event creates one tracked session per record + emits agentCreated/agentInfo', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, getSessionsList('with-labels'))

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 1000 })
  const events = collect(w)
  await w.start()
  await tick()

  gw.emitEvent('health', getHealth('single-agent-three-sessions-mixed'))
  await tick()

  const created = events.filter((e) => e.type === 'agentCreated')
  // single-agent-three-sessions-mixed: 1 agent, 3 sessions
  assert.equal(created.length, 3, `expected 3 agentCreated, got ${created.length}`)
  const info = events.filter((e) => e.type === 'agentInfo')
  assert.equal(info.length, created.length, 'agentInfo emitted for every created agent')
  // chat.history called for each new session (appeared)
  const histCalls = gw.calls.filter((c) => c.method === 'chat.history')
  assert.equal(histCalls.length, created.length, 'one chat.history per appeared session')
  await w.stop()
})

test('health with advanced updatedAt re-fetches chat.history and emits delta', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, getSessionsList('with-labels'))

  let history: unknown[] = []
  gw.router['chat.history'] = () => ({ messages: history })

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 500 })
  const events = collect(w)
  await w.start()
  await tick()

  // initial health → 1 session, no history yet
  const baseHealth = {
    agents: [
      { agentId: 'a1', name: '🤖 Demo', sessions: { recent: [{ key: 'agent:demo:s1', updatedAt: 1000 }] } },
    ],
  }
  gw.emitEvent('health', baseHealth)
  await tick()
  assert.equal(w.agentCount(), 1)
  const histBefore = gw.calls.filter((c) => c.method === 'chat.history').length

  // advance updatedAt + add new history rows
  history = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
  ]
  const advancedHealth = {
    agents: [
      { agentId: 'a1', name: '🤖 Demo', sessions: { recent: [{ key: 'agent:demo:s1', updatedAt: 2000 }] } },
    ],
  }
  gw.emitEvent('health', advancedHealth)
  await tick()

  const histAfter = gw.calls.filter((c) => c.method === 'chat.history').length
  assert.equal(histAfter, histBefore + 1, 'chat.history called once more on advance')
  assert.ok(events.some((e) => e.type === 'agentTextResponse'))
  await w.stop()
})

test('health where session disappears emits agentClosed and drops tracking', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, getSessionsList('with-labels'))

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 200 })
  const events = collect(w)
  await w.start()
  await tick()

  const h1 = {
    agents: [
      {
        agentId: 'a1',
        name: '🤖 Demo',
        sessions: {
          recent: [
            { key: 's1', updatedAt: 1000 },
            { key: 's2', updatedAt: 1000 },
          ],
        },
      },
    ],
  }
  gw.emitEvent('health', h1)
  await tick()
  assert.equal(w.agentCount(), 2)

  const h2 = {
    agents: [
      { agentId: 'a1', name: '🤖 Demo', sessions: { recent: [{ key: 's1', updatedAt: 1000 }] } },
    ],
  }
  gw.emitEvent('health', h2)
  await tick()

  assert.equal(w.agentCount(), 1)
  assert.ok(events.some((e) => e.type === 'agentClosed' && e.id === 201), 'agentClosed for s2')
  await w.stop()
})

test('sessions.list label is preferred for display name; fallback uses sessionKey suffix', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, {
    sessions: [
      { key: 'agent:demo:withlabel', label: 'Morning standup', updatedAt: 1 },
    ],
  })

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 300 })
  const events = collect(w)
  await w.start()
  await tick()

  gw.emitEvent('health', {
    agents: [
      {
        agentId: 'a1',
        name: '🤖 Demo',
        sessions: {
          recent: [
            { key: 'agent:demo:withlabel', updatedAt: 1 },
            { key: 'agent:demo:nolabel', updatedAt: 1 },
          ],
        },
      },
    ],
  })
  await tick()

  const infos = events.filter((e) => e.type === 'agentInfo') as Array<PixelMessage & { name: string }>
  assert.ok(infos.some((i) => i.name === 'Morning standup'), 'label used as-is')
  assert.ok(infos.some((i) => i.name.includes('nolabel')), 'fallback uses sessionKey suffix')
  await w.stop()
})

test('reconnect re-bootstraps from sessions.list, no duplicate agentCreated', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, getSessionsList('with-labels'))

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 100 })
  const events = collect(w)
  await w.start()
  await tick()
  gw.emitEvent('health', {
    agents: [
      { agentId: 'a1', name: '🤖 Demo', sessions: { recent: [{ key: 's1', updatedAt: 1 }] } },
    ],
  })
  await tick()
  const createdBefore = events.filter((e) => e.type === 'agentCreated').length
  assert.equal(createdBefore, 1)

  gw.simulateClose(true)
  await tick()
  gw.simulateReconnect()
  await tick()

  // sessions.list should be re-issued on reconnect
  const listCalls = gw.calls.filter((c) => c.method === 'sessions.list').length
  assert.ok(listCalls >= 2, 'sessions.list re-issued on reconnect')

  // Same health again must not create duplicate agents
  gw.emitEvent('health', {
    agents: [
      { agentId: 'a1', name: '🤖 Demo', sessions: { recent: [{ key: 's1', updatedAt: 1 }] } },
    ],
  })
  await tick()
  const createdAfter = events.filter((e) => e.type === 'agentCreated').length
  assert.equal(createdAfter, 1, 'no duplicate agentCreated after reconnect')
  await w.stop()
})

test('tick and unknown events are ignored without errors', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, { sessions: [] })

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 1 })
  await w.start()
  await tick()

  const callsBefore = gw.calls.length
  gw.emitEvent('tick', { ts: 1234567890 })
  gw.emitEvent('connect.challenge', { nonce: 'x', ts: 1 })
  gw.emitEvent('totally.unknown', { foo: 'bar' })
  await tick()

  assert.equal(gw.calls.length, callsBefore, 'no RPCs triggered by ignored events')
  await w.stop()
})

test('auth-failed is logged at error level + watcher remains quiescent', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, { sessions: [] })
  const errors: string[] = []
  const logger = {
    log: () => {},
    warn: () => {},
    error: (...a: unknown[]) => errors.push(a.map(String).join(' ')),
  }

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), logger })
  await w.start()
  await tick()

  gw.emit('auth-failed', { message: 'bad token', details: { code: 'AUTH_TOKEN_MISMATCH' } })
  await tick()

  assert.ok(errors.some((e) => e.includes('auth failed')))
  await w.stop()
})

test('rapid back-to-back health for same session does not double-fire chat.history', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, { sessions: [] })
  let resolveHist: ((v: unknown) => void) | null = null
  gw.router['chat.history'] = () =>
    new Promise<unknown>((res) => {
      resolveHist = res as (v: unknown) => void
    })

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 1 })
  await w.start()
  await tick()

  const h = {
    agents: [
      { agentId: 'a1', name: 'Demo', sessions: { recent: [{ key: 's1', updatedAt: 100 }] } },
    ],
  }
  gw.emitEvent('health', h)
  await tick()
  // second health with advanced updatedAt while first chat.history still pending
  gw.emitEvent('health', {
    agents: [
      { agentId: 'a1', name: 'Demo', sessions: { recent: [{ key: 's1', updatedAt: 200 }] } },
    ],
  })
  await tick()

  // Only one in-flight chat.history despite 2 triggers (initial appeared + advance during pending)
  const inflight = gw.calls.filter((c) => c.method === 'chat.history').length
  assert.equal(inflight, 1, 'second trigger coalesced while first pending')

  // Resolve and let queued one fire
  const r = resolveHist as ((v: unknown) => void) | null
  r?.({ messages: [] })
  await tick()
  await tick()
  const after = gw.calls.filter((c) => c.method === 'chat.history').length
  assert.equal(after, 2, 'queued second fetch fires after first resolves')
  await w.stop()
})

test('chat.history failure is logged + does not crash', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, { sessions: [] })
  gw.router['chat.history'] = () => {
    throw new Error('upstream offline')
  }
  const warnings: string[] = []
  const logger = { log: () => {}, warn: (...a: unknown[]) => warnings.push(a.map(String).join(' ')), error: () => {} }

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), logger })
  const events = collect(w)
  await w.start()
  await tick()

  gw.emitEvent('health', {
    agents: [
      { agentId: 'a1', name: 'Demo', sessions: { recent: [{ key: 's1', updatedAt: 1 }] } },
    ],
  })
  await tick()

  assert.ok(events.find((e) => e.type === 'agentCreated'))
  assert.ok(warnings.some((w) => w.includes('chat.history failed')))
  await w.stop()
})

test('sessions.list failure is logged + does not crash; health still works', async () => {
  const gw = new FakeGateway()
  gw.router['sessions.list'] = () => {
    throw new Error('list-fail')
  }
  gw.router['chat.history'] = () => ({ messages: [] })
  const warnings: string[] = []
  const logger = { log: () => {}, warn: (...a: unknown[]) => warnings.push(a.map(String).join(' ')), error: () => {} }

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), logger })
  await w.start()
  await tick()

  assert.ok(warnings.some((w) => w.includes('sessions.list failed')))

  // Health should still work, just without label cache
  gw.emitEvent('health', {
    agents: [
      { agentId: 'a1', name: 'Demo', sessions: { recent: [{ key: 's1', updatedAt: 1 }] } },
    ],
  })
  await tick()
  assert.equal(w.agentCount(), 1)
  await w.stop()
})

test('removeAgentById emits agentClosed + drops tracking (no server unsubscribe — none exists)', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, { sessions: [] })

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 42 })
  const events = collect(w)
  await w.start()
  await tick()

  gw.emitEvent('health', {
    agents: [
      { agentId: 'a1', name: 'Demo', sessions: { recent: [{ key: 's1', updatedAt: 1 }] } },
    ],
  })
  await tick()
  assert.equal(w.agentCount(), 1)

  assert.equal(w.removeAgentById(42), true)
  assert.equal(w.agentCount(), 0)
  assert.ok(events.some((e) => e.type === 'agentClosed' && e.id === 42))
  // No subscribe RPC should ever be in the call list (none of them exist)
  assert.equal(
    gw.calls.filter((c) => c.method.includes('subscribe')).length,
    0,
    'no subscribe/unsubscribe RPCs ever issued',
  )
  assert.equal(w.removeAgentById(42), false)
  await w.stop()
})

test('stop() detaches gateway listeners; subsequent events are ignored', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, { sessions: [] })

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 1 })
  await w.start()
  await tick()

  await w.stop()
  const callsAfterStop = gw.calls.length
  gw.emit('open', {})
  gw.emitEvent('health', {
    agents: [
      { agentId: 'a1', name: 'Demo', sessions: { recent: [{ key: 's1', updatedAt: 1 }] } },
    ],
  })
  await tick()
  assert.equal(gw.calls.length, callsAfterStop, 'no calls after stop')
})

test('source identifier is "openclaw" + generateExistingAgentsMessage shape', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, { sessions: [] })

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 10 })
  await w.start()
  await tick()
  gw.emitEvent('health', {
    agents: [
      {
        agentId: 'a1',
        name: 'Demo',
        sessions: { recent: [{ key: 'k1', updatedAt: 1 }, { key: 'k2', updatedAt: 1 }] },
      },
    ],
  })
  await tick()

  assert.equal(w.source, 'openclaw')
  const existing = w.generateExistingAgentsMessage() as { type: string; agents: number[]; agentMeta: Record<string, unknown> }
  assert.equal(existing.type, 'existingAgents')
  assert.deepEqual([...existing.agents].sort((a, b) => a - b), [10, 11])
  assert.deepEqual(existing.agentMeta, {})
  await w.stop()
})

test('agent without name is skipped (translator warns) but sibling agents still render', async () => {
  const gw = new FakeGateway()
  installDefaultRoutes(gw, { sessions: [] })

  const w = new OpenClawWatcher({ gateway: asWatcherGateway(gw), idBase: 1 })
  await w.start()
  await tick()

  gw.emitEvent('health', {
    agents: [
      { agentId: 'bad', name: '', sessions: { recent: [{ key: 's-bad', updatedAt: 1 }] } },
      { agentId: 'good', name: '🦊 Good', sessions: { recent: [{ key: 's-good', updatedAt: 1 }] } },
    ],
  })
  await tick()

  assert.equal(w.agentCount(), 1, 'only the well-named agent\'s session is tracked')
  const info = w.getAgentInfo()
  assert.equal(info[0].externalId, 's-good')
  await w.stop()
})
