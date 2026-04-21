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

// ── YUE-94: health event + session-activity helpers ────────────────────
//
// These helpers translate the deployed OpenClaw Gateway's `health` event
// (and the on-demand `sessions.list` RPC) into structures consumed by the
// watcher. They are pure (no I/O, no side effects beyond an idempotent
// console.warn for malformed agents) so the watcher can be tested with
// fixture-driven assertions.

/** One entry from `health.payload.agents[]`. */
export interface HealthAgent {
  agentId: string
  name: string
  isDefault?: boolean
  sessions?: { recent?: SessionRecent[] }
}

/** One entry from either `health.payload.sessions.recent[]` or
 *  `health.payload.agents[i].sessions.recent[]`. */
export interface SessionRecent {
  key: string
  updatedAt: number
  age?: number
}

/** Flattened per-session record — one PixelAgent will be created per record. */
export interface HealthSessionRecord {
  sessionKey: string
  agentId: string
  /** Owning agent's name with leading emoji (if any) stripped + trimmed. */
  agentName: string
  /** Leading emoji codepoint extracted from agent.name, or DEFAULT_AGENT_EMOJI. */
  emoji: string
  updatedAt: number
}

const DEFAULT_AGENT_EMOJI = '🦾'
// Match a single Extended_Pictographic codepoint at the very start, optionally
// followed by skin-tone modifiers / variation selectors / ZWJ sequences. We
// keep this conservative — a single base + optional modifiers, no full grapheme
// cluster parsing. Sufficient for typical agent names like "🌟 Demo" / "🤖 Bot".
const LEADING_EMOJI_RE = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s*/u

function splitEmojiAndName(rawName: string): { emoji: string; name: string } {
  const m = rawName.match(LEADING_EMOJI_RE)
  if (m) {
    const emoji = m[1]
    const rest = rawName.slice(m[0].length).trim()
    return { emoji, name: rest.length > 0 ? rest : rawName.trim() }
  }
  return { emoji: DEFAULT_AGENT_EMOJI, name: rawName.trim() }
}

/**
 * Flatten `health.agents[].sessions.recent[]` into one record per session.
 *
 * Decision (locked 2026-04-21): 1 OpenClaw session ↔ 1 PixelAgent. Each
 * session inherits its owning agent's name + emoji. Agents with empty/
 * whitespace-only `name` are skipped + warned (they cannot be displayed
 * meaningfully — the watcher should bootstrap such agents from
 * `agents.list` instead).
 */
export function translateHealthSessions(
  health: { agents?: HealthAgent[] } | null | undefined,
): HealthSessionRecord[] {
  const out: HealthSessionRecord[] = []
  if (!health || typeof health !== 'object') return out
  const agents = Array.isArray(health.agents) ? health.agents : []
  for (const agent of agents) {
    if (!agent || typeof agent !== 'object') continue
    if (typeof agent.agentId !== 'string' || agent.agentId.length === 0) continue
    const rawName = typeof agent.name === 'string' ? agent.name : ''
    if (rawName.trim().length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[openclawTranslator] skipping agent with empty name (agentId=${agent.agentId})`,
      )
      continue
    }
    const { emoji, name: agentName } = splitEmojiAndName(rawName)
    const recent = agent.sessions?.recent
    if (!Array.isArray(recent)) continue
    for (const sess of recent) {
      if (!sess || typeof sess !== 'object') continue
      if (typeof sess.key !== 'string' || sess.key.length === 0) continue
      if (typeof sess.updatedAt !== 'number' || !Number.isFinite(sess.updatedAt)) continue
      out.push({
        sessionKey: sess.key,
        agentId: agent.agentId,
        agentName,
        emoji,
        updatedAt: sess.updatedAt,
      })
    }
  }
  return out
}

/**
 * Pure diff between two snapshots of session activity.
 *
 *   appeared    — keys in `next` but not in `prev`
 *   disappeared — keys in `prev` but not in `next`
 *   advanced    — keys in both, where `next.updatedAt > prev.updatedAt`
 *                 (equal updatedAt is NOT advanced; lower updatedAt is NOT
 *                 advanced — server clock regressions are ignored.)
 */
export function diffSessionActivity(
  prev: ReadonlyMap<string, number>,
  next: ReadonlyArray<{ key: string; updatedAt: number }>,
): { appeared: string[]; disappeared: string[]; advanced: string[] } {
  const appeared: string[] = []
  const advanced: string[] = []
  const seen = new Set<string>()
  for (const entry of next) {
    if (!entry || typeof entry.key !== 'string') continue
    seen.add(entry.key)
    const prior = prev.get(entry.key)
    if (prior === undefined) {
      appeared.push(entry.key)
    } else if (entry.updatedAt > prior) {
      advanced.push(entry.key)
    }
  }
  const disappeared: string[] = []
  for (const key of prev.keys()) {
    if (!seen.has(key)) disappeared.push(key)
  }
  return { appeared, disappeared, advanced }
}

/**
 * Build a session's display name.
 *
 * Priority:
 *   1. Non-empty `label` (from `sessions.list[].label`) — return as-is.
 *   2. `<agentBaseName> · <last segment of sessionKey>`. The "last segment"
 *      is the substring after the final `:`; if there is no `:`, the whole
 *      sessionKey is used.
 */
export function buildSessionDisplayName(
  agentBaseName: string,
  sessionKey: string,
  label?: string,
): string {
  if (typeof label === 'string' && label.trim().length > 0) return label
  const idx = sessionKey.lastIndexOf(':')
  const suffix = idx >= 0 ? sessionKey.slice(idx + 1) : sessionKey
  return `${agentBaseName} · ${suffix}`
}
