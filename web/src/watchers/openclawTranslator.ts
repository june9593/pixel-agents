/**
 * OpenClawTranslator — translate Anthropic-style transcript messages
 * (as returned by the OpenClaw Gateway `chat.history` RPC) into the
 * `PixelMessage` event stream consumed by the webview.
 *
 * Wire format reference (verified against ~/tmp_openclaw):
 *   - chat.history → { messages: AnthMessage[], thinkingLevel?: string }
 *   - AnthMessage = { role: 'user'|'assistant', content: string | ContentBlock[] }
 *   - ContentBlock kinds we care about:
 *       { type: 'text', text }
 *       { type: 'tool_use', id, name, input }
 *       { type: 'tool_result', tool_use_id, content }
 *       { type: 'thinking', thinking }       ← ignored (matches kosmos parity)
 *
 * Mapping mirrors logTranslator.ts exactly so the webview cannot tell
 * a kosmos-sourced agent apart from an OpenClaw-sourced one:
 *   user message                 → agentToolsClear (if active tools)   + isWaiting=false
 *   assistant text-only          → agentStatus(active) + agentTextResponse + waiting
 *   assistant with tool_use(s)   → agentStatus(active) + agentToolStart per block
 *   user with tool_result(s)     → agentToolDone per matching tool_use_id
 *
 * State is per-agent (per sessionKey). Repeated calls with the *same* full
 * history are idempotent: the translator records `processedCount` and only
 * emits events for newly-appended messages, which is exactly the access
 * pattern the watcher uses (`session.message` notification → re-fetch full
 * history → re-translate).
 */

import type { PixelMessage } from '../logTranslator.js'

// ── Wire types ─────────────────────────────────────────────────────────

export interface AnthTextBlock {
  type: 'text'
  text: string
}

export interface AnthToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input?: unknown
}

export interface AnthToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content?: unknown
  is_error?: boolean
}

export interface AnthThinkingBlock {
  type: 'thinking'
  thinking?: string
}

export type AnthContentBlock =
  | AnthTextBlock
  | AnthToolUseBlock
  | AnthToolResultBlock
  | AnthThinkingBlock
  | { type: string; [k: string]: unknown }

export interface AnthMessage {
  role: 'user' | 'assistant' | string
  content: string | AnthContentBlock[]
}

export interface ChatHistoryResponse {
  messages?: unknown
  thinkingLevel?: string | null
}

// ── State ──────────────────────────────────────────────────────────────

export interface OpenClawTranslationState {
  /** How many top-level messages from history have already been emitted. */
  processedCount: number
  /** Currently-active tool_use ids awaiting a tool_result. */
  activeToolIds: Set<string>
  isWaiting: boolean
}

export function createOpenClawTranslationState(): OpenClawTranslationState {
  return {
    processedCount: 0,
    activeToolIds: new Set(),
    isWaiting: true,
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function asArray(content: AnthMessage['content']): AnthContentBlock[] {
  if (typeof content === 'string') {
    // Treat plain string as a single text block.
    return content.length > 0 ? [{ type: 'text', text: content }] : []
  }
  return Array.isArray(content) ? content : []
}

function formatToolStatus(name: string, input: unknown): string {
  // Best-effort one-liner. Mirrors the spirit of kosmos' formatToolStatus
  // without claiming to know every tool. The webview tolerates any string.
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>
    if (typeof obj.path === 'string') return `${name}(${obj.path})`
    if (typeof obj.file_path === 'string') return `${name}(${obj.file_path})`
    if (typeof obj.command === 'string') {
      const cmd = obj.command.length > 60 ? `${obj.command.slice(0, 57)}...` : obj.command
      return `${name}: ${cmd}`
    }
  }
  return name
}

// ── Per-message translation ────────────────────────────────────────────

function translateOne(
  agentId: number,
  msg: AnthMessage,
  state: OpenClawTranslationState,
): PixelMessage[] {
  const out: PixelMessage[] = []
  const blocks = asArray(msg.content)

  if (msg.role === 'user') {
    // Detect tool_result blocks first; pure-text user messages start a new turn.
    const toolResults = blocks.filter(
      (b): b is AnthToolResultBlock => b.type === 'tool_result',
    )

    if (toolResults.length === 0) {
      // Genuine new user prompt → clear any active tools, exit waiting.
      if (state.activeToolIds.size > 0) {
        state.activeToolIds.clear()
        out.push({ type: 'agentToolsClear', id: agentId })
      }
      state.isWaiting = false
      return out
    }

    // tool_result-only synthetic user message: emit toolDone per matching id.
    for (const tr of toolResults) {
      const tid = tr.tool_use_id
      if (tid && state.activeToolIds.has(tid)) {
        state.activeToolIds.delete(tid)
        out.push({ type: 'agentToolDone', id: agentId, toolId: tid })
      }
    }
    return out
  }

  if (msg.role === 'assistant') {
    const toolUses = blocks.filter(
      (b): b is AnthToolUseBlock => b.type === 'tool_use',
    )
    const hasText = blocks.some(
      (b) => b.type === 'text' && typeof (b as AnthTextBlock).text === 'string' && (b as AnthTextBlock).text.length > 0,
    )

    if (toolUses.length > 0) {
      if (state.isWaiting) {
        state.isWaiting = false
        out.push({ type: 'agentStatus', id: agentId, status: 'active' })
      }
      for (const tu of toolUses) {
        state.activeToolIds.add(tu.id)
        out.push({
          type: 'agentToolStart',
          id: agentId,
          toolId: tu.id,
          status: formatToolStatus(tu.name, tu.input),
        })
      }
      return out
    }

    if (hasText) {
      if (state.isWaiting) {
        state.isWaiting = false
        out.push({ type: 'agentStatus', id: agentId, status: 'active' })
      } else {
        state.isWaiting = false
      }
      out.push({ type: 'agentTextResponse', id: agentId })
      return out
    }

    // Thinking-only or empty assistant message: ignore (parity with kosmos).
    return out
  }

  return out
}

// ── Public translation entry points ────────────────────────────────────

/**
 * Translate any newly-appended messages in `history`. Mutates `state`.
 * Caller must pass the FULL chat history each time (matches OpenClaw RPC
 * shape — no incremental delta is exposed by the gateway).
 */
export function translateNewOpenClawMessages(
  agentId: number,
  history: AnthMessage[],
  state: OpenClawTranslationState,
): PixelMessage[] {
  const out: PixelMessage[] = []
  if (state.processedCount >= history.length) {
    return out
  }
  for (let i = state.processedCount; i < history.length; i++) {
    out.push(...translateOne(agentId, history[i], state))
    state.processedCount = i + 1
  }

  // After processing, if no tools are active and the last assistant turn
  // ended with text (no tool_uses), surface a single `waiting` event.
  const last = history[history.length - 1]
  if (
    last &&
    last.role === 'assistant' &&
    state.activeToolIds.size === 0 &&
    asArray(last.content).every((b) => b.type !== 'tool_use')
  ) {
    if (!state.isWaiting) {
      state.isWaiting = true
      out.push({ type: 'agentStatus', id: agentId, status: 'waiting' })
    }
  }

  return out
}

/**
 * Parse a raw `chat.history` RPC response into an array of typed messages.
 * Returns [] for malformed payloads.
 */
export function parseChatHistoryResponse(res: ChatHistoryResponse | unknown): AnthMessage[] {
  if (!res || typeof res !== 'object') return []
  const msgs = (res as ChatHistoryResponse).messages
  if (!Array.isArray(msgs)) return []
  const out: AnthMessage[] = []
  for (const m of msgs) {
    if (!m || typeof m !== 'object') continue
    const r = (m as { role?: unknown }).role
    const c = (m as { content?: unknown }).content
    if (typeof r !== 'string') continue
    if (typeof c !== 'string' && !Array.isArray(c)) continue
    out.push({ role: r, content: c as AnthMessage['content'] })
  }
  return out
}
