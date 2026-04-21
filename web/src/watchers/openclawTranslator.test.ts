import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createOpenClawTranslationState,
  parseChatHistoryResponse,
  translateNewOpenClawMessages,
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
