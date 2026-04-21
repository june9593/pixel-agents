import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createOpenClawTranslationState,
  parseChatHistoryResponse,
  translateNewOpenClawMessages,
  translateHealthSessions,
  diffSessionActivity,
  buildSessionDisplayName,
} from './openclawTranslator.js'
import type { PixelMessage } from '../logTranslator.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FIX_DIR = path.resolve(__dirname, '../../__fixtures__/openclaw')

function loadFixture(name: string) {
  return JSON.parse(readFileSync(path.join(FIX_DIR, name), 'utf-8'))
}

const types = (msgs: PixelMessage[]) => msgs.map((m) => m.type)

test('parseChatHistoryResponse: extracts messages array', () => {
  const fix = loadFixture('text-only.json')
  const msgs = parseChatHistoryResponse(fix)
  assert.equal(msgs.length, 2)
  assert.equal(msgs[0].role, 'user')
  assert.equal(msgs[1].role, 'assistant')
})

test('parseChatHistoryResponse: tolerates malformed input', () => {
  assert.deepEqual(parseChatHistoryResponse(null), [])
  assert.deepEqual(parseChatHistoryResponse({}), [])
  assert.deepEqual(parseChatHistoryResponse({ messages: 'nope' }), [])
  assert.deepEqual(parseChatHistoryResponse({ messages: [{ role: 'user' }] }), [])
})

test('text-only assistant turn → status active + textResponse + waiting', () => {
  const history = parseChatHistoryResponse(loadFixture('text-only.json'))
  const state = createOpenClawTranslationState()
  const out = translateNewOpenClawMessages(1, history, state)
  // user resets waiting=false silently → assistant text → final 'waiting'
  // Note: 'active' status only fires when transitioning OUT of waiting, and
  // the user message already did that, so the assistant text only emits
  // textResponse + the trailing 'waiting' for turn-end.
  assert.deepEqual(types(out), ['agentTextResponse', 'agentStatus'])
  const statuses = out.filter((m) => m.type === 'agentStatus').map((m) => m.status)
  assert.deepEqual(statuses, ['waiting'])
  assert.equal(state.processedCount, 2)
})

test('tool_use block emits agentToolStart and tracks active id', () => {
  const history = parseChatHistoryResponse(loadFixture('tool-use.json'))
  const state = createOpenClawTranslationState()
  const out = translateNewOpenClawMessages(7, history, state)
  // user (silent reset) → assistant(text + tool_use): only toolStart
  assert.deepEqual(types(out), ['agentToolStart'])
  const start = out.find((m) => m.type === 'agentToolStart')!
  assert.equal(start.id, 7)
  assert.equal(start.toolId, 'toolu_01ABCxyz')
  assert.match(String(start.status), /Read/)
  assert.match(String(start.status), /README\.md/)
  assert.ok(state.activeToolIds.has('toolu_01ABCxyz'))
  assert.equal(state.isWaiting, false)
})

test('tool_result completes the matching tool_use → toolDone', () => {
  const history = parseChatHistoryResponse(loadFixture('tool-result.json'))
  const state = createOpenClawTranslationState()
  const out = translateNewOpenClawMessages(3, history, state)
  // user → assistant(tool_use) → user(tool_result) → assistant(text)
  assert.deepEqual(types(out), [
    'agentToolStart',     // assistant tool_use
    'agentToolDone',      // tool_result
    'agentTextResponse',  // final assistant text
    'agentStatus',        // waiting (turn end)
  ])
  const done = out.find((m) => m.type === 'agentToolDone')!
  assert.equal(done.toolId, 'toolu_01READ001')
  assert.equal(state.activeToolIds.size, 0)
  assert.equal(state.isWaiting, true)
})

test('multi-block assistant message emits one toolStart per tool_use', () => {
  const history = parseChatHistoryResponse(loadFixture('multi-block.json'))
  const state = createOpenClawTranslationState()
  const out = translateNewOpenClawMessages(2, history, state)
  const starts = out.filter((m) => m.type === 'agentToolStart')
  assert.equal(starts.length, 2)
  assert.deepEqual(
    starts.map((s) => s.toolId),
    ['toolu_LIST_01', 'toolu_STAT_02'],
  )
  // No agentStatus expected — user already cleared waiting state
  assert.equal(out.filter((m) => m.type === 'agentStatus').length, 0)
})

test('thinking blocks are ignored; only text/tool_use drive events', () => {
  const history = parseChatHistoryResponse(loadFixture('mixed-with-thinking.json'))
  const state = createOpenClawTranslationState()
  const out = translateNewOpenClawMessages(9, history, state)
  // Same as text-only.json: thinking-only block skipped, then text emits textResponse + waiting
  assert.deepEqual(types(out), ['agentTextResponse', 'agentStatus'])
})

test('cold-start (no preceding user) emits agentStatus(active) on first assistant turn', () => {
  // History begins with assistant — replays the "active" transition out of the
  // initial isWaiting=true state. Important for replay-on-reconnect scenarios.
  const history = [
    { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
  ] as const
  const state = createOpenClawTranslationState()
  const out = translateNewOpenClawMessages(5, history as never, state)
  assert.deepEqual(types(out), ['agentStatus', 'agentTextResponse', 'agentStatus'])
  const statuses = out.filter((m) => m.type === 'agentStatus').map((m) => m.status)
  assert.deepEqual(statuses, ['active', 'waiting'])
})

test('idempotent on repeat calls with the same history', () => {
  const history = parseChatHistoryResponse(loadFixture('tool-result.json'))
  const state = createOpenClawTranslationState()
  const first = translateNewOpenClawMessages(1, history, state)
  const second = translateNewOpenClawMessages(1, history, state)
  assert.equal(second.length, 0, 'second call must emit nothing')
  assert.ok(first.length > 0)
})

test('incremental: appending a new message only emits the delta', () => {
  const history = parseChatHistoryResponse(loadFixture('text-only.json'))
  const state = createOpenClawTranslationState()
  translateNewOpenClawMessages(1, history, state)
  // Append a follow-up user message
  history.push({ role: 'user', content: 'And now what?' })
  const delta = translateNewOpenClawMessages(1, history, state)
  // New user message after a 'waiting' assistant: no active tools to clear,
  // just resets isWaiting=false silently.
  assert.deepEqual(delta, [])
  assert.equal(state.isWaiting, false)
  assert.equal(state.processedCount, 3)
})

// ────────────────────────────────────────────────────────────────────────
// YUE-94 helpers — translateHealthSessions / diffSessionActivity / buildSessionDisplayName
// ────────────────────────────────────────────────────────────────────────

const HEALTH = loadFixture('health-payload.json') as Array<Record<string, unknown>>
const SESSIONS_LIST = loadFixture('sessions-list-response.json') as Array<Record<string, unknown>>

test('translateHealthSessions: single agent + single session yields 1 record', () => {
  const out = translateHealthSessions(HEALTH[0])
  assert.equal(out.length, 1)
  assert.equal(out[0].sessionKey, 'agent:demo:direct:owner')
  assert.equal(out[0].agentId, 'demo')
  assert.equal(out[0].agentName, 'Demo Agent')
  assert.equal(out[0].emoji, '🌟')
  assert.equal(out[0].updatedAt, 1714000000000)
})

test('translateHealthSessions: multi-session agent flattens to one record per session', () => {
  const out = translateHealthSessions(HEALTH[1])
  assert.equal(out.length, 3)
  const keys = out.map((r) => r.sessionKey).sort()
  assert.deepEqual(keys, [
    'agent:demo:cron:abc1',
    'agent:demo:cron:abc2',
    'agent:demo:direct:owner',
  ])
  for (const r of out) {
    assert.equal(r.agentId, 'demo')
    assert.equal(r.emoji, '🌟')
    assert.equal(r.agentName, 'Demo Agent')
  }
})

test('translateHealthSessions: two agents — empty-recent agent contributes nothing; non-emoji name uses default emoji', () => {
  const out = translateHealthSessions(HEALTH[2])
  assert.equal(out.length, 2, 'beta has empty recent[]')
  for (const r of out) assert.equal(r.agentId, 'alpha')
  // alpha had emoji
  assert.equal(out[0].emoji, '🤖')
  assert.equal(out[0].agentName, 'Alpha Bot')
})

test('translateHealthSessions: empty agent name is skipped with warn; valid agent still emits', () => {
  const warnings: string[] = []
  const origWarn = console.warn
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '))
  }
  try {
    const out = translateHealthSessions(HEALTH[3])
    assert.equal(out.length, 1, 'only "valid" agent contributes')
    assert.equal(out[0].agentId, 'valid')
    assert.equal(out[0].emoji, '✨')
    assert.ok(
      warnings.some((w) => w.includes('ghost')),
      `expected a warning mentioning the skipped agentId "ghost"; got: ${JSON.stringify(warnings)}`,
    )
  } finally {
    console.warn = origWarn
  }
})

test('translateHealthSessions: no-emoji name keeps full name + default 🦾', () => {
  // Build a synthetic on the fly to isolate this behaviour.
  const out = translateHealthSessions({
    agents: [
      {
        agentId: 'plain',
        name: 'Plain Name Agent',
        sessions: { recent: [{ key: 'agent:plain:direct:x', updatedAt: 1, age: 0 }] },
      },
    ],
  })
  assert.equal(out.length, 1)
  assert.equal(out[0].emoji, '🦾')
  assert.equal(out[0].agentName, 'Plain Name Agent')
})

test('translateHealthSessions: missing/empty agents array → []', () => {
  assert.deepEqual(translateHealthSessions({}), [])
  assert.deepEqual(translateHealthSessions({ agents: [] }), [])
})

// ── diffSessionActivity ─────────────────────────────────────────────────

test('diffSessionActivity: empty prev → all entries appeared', () => {
  const next = [
    { key: 'a', updatedAt: 1 },
    { key: 'b', updatedAt: 2 },
  ]
  const d = diffSessionActivity(new Map(), next)
  assert.deepEqual(d.appeared.sort(), ['a', 'b'])
  assert.deepEqual(d.disappeared, [])
  assert.deepEqual(d.advanced, [])
})

test('diffSessionActivity: all gone → all disappeared', () => {
  const prev = new Map([
    ['a', 1],
    ['b', 2],
  ])
  const d = diffSessionActivity(prev, [])
  assert.deepEqual(d.appeared, [])
  assert.deepEqual(d.disappeared.sort(), ['a', 'b'])
  assert.deepEqual(d.advanced, [])
})

test('diffSessionActivity: mixed — advanced + unchanged + appeared + disappeared', () => {
  const prev = new Map<string, number>([
    ['stable', 100],
    ['gone', 200],
    ['advancing', 300],
  ])
  const next = [
    { key: 'stable', updatedAt: 100 }, // unchanged
    { key: 'advancing', updatedAt: 350 }, // advanced
    { key: 'fresh', updatedAt: 400 }, // appeared
  ]
  const d = diffSessionActivity(prev, next)
  assert.deepEqual(d.appeared, ['fresh'])
  assert.deepEqual(d.disappeared, ['gone'])
  assert.deepEqual(d.advanced, ['advancing'])
})

test('diffSessionActivity: same updatedAt is NOT advanced; lower updatedAt is NOT advanced', () => {
  const prev = new Map<string, number>([
    ['same', 100],
    ['regress', 100],
  ])
  const next = [
    { key: 'same', updatedAt: 100 },
    { key: 'regress', updatedAt: 50 },
  ]
  const d = diffSessionActivity(prev, next)
  assert.deepEqual(d.advanced, [])
})

// ── buildSessionDisplayName ────────────────────────────────────────────

test('buildSessionDisplayName: non-empty label wins', () => {
  assert.equal(
    buildSessionDisplayName('Demo Agent', 'agent:demo:cron:abc1', 'Hourly digest'),
    'Hourly digest',
  )
})

test('buildSessionDisplayName: no label → "<agent> · <last segment>"', () => {
  assert.equal(
    buildSessionDisplayName('Demo Agent', 'agent:demo:cron:abc1'),
    'Demo Agent · abc1',
  )
})

test('buildSessionDisplayName: empty/whitespace label falls back', () => {
  assert.equal(
    buildSessionDisplayName('Demo Agent', 'agent:demo:cron:abc1', ''),
    'Demo Agent · abc1',
  )
  assert.equal(
    buildSessionDisplayName('Demo Agent', 'agent:demo:cron:abc1', '   '),
    'Demo Agent · abc1',
  )
})

test('buildSessionDisplayName: sessionKey without ":" — uses whole key as suffix', () => {
  assert.equal(
    buildSessionDisplayName('Demo Agent', 'rawkey'),
    'Demo Agent · rawkey',
  )
})

test('buildSessionDisplayName: sessions-list fixture shape integrates', () => {
  const withLabels = SESSIONS_LIST[0] as { sessions: Array<{ key: string; label?: string }> }
  const sess = withLabels.sessions[0]
  assert.equal(buildSessionDisplayName('Demo', sess.key, sess.label), 'Morning standup')
})
