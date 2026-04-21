/**
 * OpenClawWatcher — implements AgentWatcher over the OpenClaw Gateway (protocol v3).
 *
 * Health-event-driven model (deployed gateway v2026.3.3 has NO subscribe methods):
 *
 *   1. Connect once via existing `OpenClawGateway` (handshake done in YUE-92).
 *   2. On `'open'` (initial + every reconnect): call `sessions.list` once to
 *      cache richer per-session metadata (label) for display names. The result
 *      is best-effort — failures are logged, not fatal.
 *   3. On every `'health'` event (~14s cadence — server-pushed pseudo-poll):
 *        a. translateHealthSessions(payload) → flat per-session records
 *        b. diffSessionActivity(prev, next) → { appeared, advanced, disappeared }
 *        c. For appeared/advanced sessions: refresh `chat.history` and emit
 *           translated PixelMessages (delta only, via OpenClawTranslator state)
 *        d. For disappeared sessions: emit agentClosed and drop tracking
 *   4. Decision (locked 2026-04-21): 1 OpenClaw session ↔ 1 PixelAgent. Each
 *      session gets a unique numeric agent id. Sessions belonging to the same
 *      OpenClaw agent share emoji + agent base name but get distinct display
 *      names (label preferred, otherwise `<base> · <suffix>`).
 *   5. Per-session in-flight coalescing: at most one `chat.history` call per
 *      sessionKey at any time; additional triggers chain after the in-flight one.
 *   6. Ignored events: `tick`, `connect.challenge`, anything not `'health'`.
 *   7. `'auth-failed'`: error-logged, watcher remains quiescent (gateway won't
 *      reconnect on auth failure).
 *   8. `'close'` then `'open'` again: re-bootstrap from `sessions.list`. No
 *      server-side subscription state to restore (none exists).
 */

import { EventEmitter } from 'events'
import type { OpenClawGateway, GatewayEvent, AuthFailure, HelloOk } from './openclawGateway.js'
import {
  createOpenClawTranslationState,
  parseChatHistoryResponse,
  translateNewOpenClawMessages,
  translateHealthSessions,
  diffSessionActivity,
  buildSessionDisplayName,
  type OpenClawTranslationState,
  type AnthMessage,
  type ChatHistoryResponse,
  type HealthSessionRecord,
} from './openclawTranslator.js'
import type { PixelMessage } from '../logTranslator.js'
import type { AgentInfo, AgentSource, AgentWatcher } from './types.js'

// ─── Wire types (sessions.list response — used only for label cache) ──────

interface SessionsListEntry {
  key?: string
  sessionKey?: string
  label?: string
  displayName?: string
}
interface SessionsListResponse {
  sessions?: SessionsListEntry[]
}

// ─── Internal tracking ────────────────────────────────────────────────────

interface TrackedSession {
  agentId: number
  sessionKey: string
  /** OpenClaw `agentId` (string) — owning agent. */
  openClawAgentId: string
  /** Emoji-stripped agent name from `health.agents[].name`. */
  agentBaseName: string
  /** Leading emoji extracted from agent name, or default. */
  emoji: string
  /** Cached label from `sessions.list` (if any). */
  label?: string
  /** Last seen `updatedAt` from `health` — used for diff. */
  updatedAt: number
  /** Translator state for `chat.history` diffing. */
  state: OpenClawTranslationState
}

export interface OpenClawWatcherOptions {
  gateway: OpenClawGateway
  /** First numeric agent id to allocate. Subsequent agents get base+1, base+2, … */
  idBase?: number
  /** Logger override (defaults to console). */
  logger?: { log: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void }
  /** Max history rows to request per chat.history call. */
  historyLimit?: number
  /** Max sessions to fetch in the bootstrap sessions.list call. */
  sessionsListLimit?: number
}

// ─── Watcher ──────────────────────────────────────────────────────────────

export class OpenClawWatcher extends EventEmitter implements AgentWatcher {
  readonly source: AgentSource = 'openclaw'

  private readonly gateway: OpenClawGateway
  private readonly logger: NonNullable<OpenClawWatcherOptions['logger']>
  private readonly historyLimit: number
  private readonly sessionsListLimit: number
  private readonly idBase: number

  private readonly bySessionKey = new Map<string, TrackedSession>()
  private readonly byAgentId = new Map<number, TrackedSession>()
  /** Cached labels from the most recent `sessions.list` call. */
  private readonly labelCache = new Map<string, string>()
  private nextAgentId: number
  private started = false
  /** in-flight chat.history promise per sessionKey (coalescing). */
  private inFlight = new Map<string, Promise<void>>()

  // ── Bound listeners (so stop() can detach) ────────────────────────────
  private readonly onGatewayOpen = (_hello: HelloOk) => {
    this.bootstrapFromSessionsList().catch((err) =>
      this.logger.warn('[openclaw] bootstrap failed:', err),
    )
  }
  private readonly onGatewayEvent = (env: GatewayEvent) => {
    this.handleEvent(env).catch((err) =>
      this.logger.warn('[openclaw] event handling failed:', err),
    )
  }
  private readonly onGatewayError = (err: Error) => {
    this.logger.warn('[openclaw] gateway error (will retry):', err?.message ?? err)
  }
  private readonly onGatewayClose = (info: { code?: number; reason?: string; wasOpen?: boolean } | undefined) => {
    this.logger.warn('[openclaw] gateway closed:', info)
    // No per-session subscribe state to invalidate — server has none.
  }
  private readonly onGatewayAuthFailed = (failure: AuthFailure) => {
    this.logger.error(
      '[openclaw] gateway auth failed — reconnect halted:',
      failure?.details?.code ?? failure?.code ?? failure?.message ?? failure,
    )
  }

  constructor(opts: OpenClawWatcherOptions) {
    super()
    this.gateway = opts.gateway
    this.idBase = opts.idBase ?? 1000
    this.nextAgentId = this.idBase
    this.logger = opts.logger ?? console
    this.historyLimit = opts.historyLimit ?? 200
    this.sessionsListLimit = opts.sessionsListLimit ?? 50
  }

  // ── AgentWatcher contract ─────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.started) return
    this.started = true

    this.gateway.on('event', this.onGatewayEvent)
    this.gateway.on('error', this.onGatewayError)
    this.gateway.on('close', this.onGatewayClose)
    this.gateway.on('open', this.onGatewayOpen)
    this.gateway.on('auth-failed', this.onGatewayAuthFailed)

    await this.gateway.start()
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false

    // Detach BEFORE stopping the gateway so its 'close' fired during teardown
    // doesn't trigger our handlers.
    this.gateway.off('event', this.onGatewayEvent)
    this.gateway.off('error', this.onGatewayError)
    this.gateway.off('close', this.onGatewayClose)
    this.gateway.off('open', this.onGatewayOpen)
    this.gateway.off('auth-failed', this.onGatewayAuthFailed)

    await this.gateway.stop()
    this.bySessionKey.clear()
    this.byAgentId.clear()
    this.labelCache.clear()
    this.inFlight.clear()
  }

  agentCount(): number {
    return this.bySessionKey.size
  }

  getAgentInfo(): AgentInfo[] {
    const out: AgentInfo[] = []
    for (const t of this.bySessionKey.values()) {
      out.push({
        id: t.agentId,
        name: buildSessionDisplayName(t.agentBaseName, t.sessionKey, t.label),
        emoji: t.emoji,
        externalId: t.sessionKey,
        sessionTitle: t.label || t.sessionKey,
      })
    }
    return out
  }

  generateExistingAgentsMessage(): PixelMessage {
    return {
      type: 'existingAgents',
      agents: Array.from(this.byAgentId.keys()),
      agentMeta: {},
    }
  }

  removeAgentById(agentId: number): boolean {
    const tracked = this.byAgentId.get(agentId)
    if (!tracked) return false
    this.byAgentId.delete(agentId)
    this.bySessionKey.delete(tracked.sessionKey)
    this.emit('message', { type: 'agentClosed', id: agentId })
    return true
  }

  // ── Internals ─────────────────────────────────────────────────────────

  /**
   * Fetch `sessions.list` to refresh the label cache. Best-effort: failures
   * are logged but don't prevent `health`-driven discovery from working.
   * Called on every `'open'` (initial + reconnect).
   */
  private async bootstrapFromSessionsList(): Promise<void> {
    let entries: SessionsListEntry[] = []
    try {
      const res = await this.gateway.request<SessionsListResponse>('sessions.list', {
        limit: this.sessionsListLimit,
        includeLastMessage: false,
      })
      entries = Array.isArray(res?.sessions) ? res.sessions : []
    } catch (err) {
      this.logger.warn('[openclaw] sessions.list failed:', err)
      return
    }

    // Refresh label cache. Don't drop existing entries that aren't in this
    // response — the next `sessions.list` will replace them; in the meantime
    // we'd rather show a stale label than fall back to the suffix.
    for (const entry of entries) {
      const key = entry.sessionKey || entry.key
      if (!key) continue
      const label = entry.label || entry.displayName
      if (typeof label === 'string' && label.trim().length > 0) {
        this.labelCache.set(key, label)
      }
    }

    // Update display names of any already-tracked sessions whose label
    // changed.
    for (const t of this.bySessionKey.values()) {
      const newLabel = this.labelCache.get(t.sessionKey)
      if (newLabel && newLabel !== t.label) {
        t.label = newLabel
        this.emit('message', {
          type: 'agentInfo',
          id: t.agentId,
          name: buildSessionDisplayName(t.agentBaseName, t.sessionKey, t.label),
          emoji: t.emoji,
        })
      }
    }
  }

  private async handleEvent(env: GatewayEvent): Promise<void> {
    if (env.event !== 'health') return
    await this.handleHealth(env.payload)
  }

  /**
   * Process one `health` event:
   *   1. Translate to flat session records.
   *   2. Diff against tracked state.
   *   3. For appeared sessions: ensure tracked + refresh history.
   *   4. For advanced sessions: refresh history.
   *   5. For disappeared sessions: drop + emit agentClosed.
   */
  private async handleHealth(payload: unknown): Promise<void> {
    const records = translateHealthSessions(payload as Parameters<typeof translateHealthSessions>[0])
    // Diff against current tracked state (snapshot of updatedAt by sessionKey).
    const prev = new Map<string, number>()
    for (const t of this.bySessionKey.values()) prev.set(t.sessionKey, t.updatedAt)
    const diffInput = records.map((r) => ({ key: r.sessionKey, updatedAt: r.updatedAt }))
    const diff = diffSessionActivity(prev, diffInput)

    // Index records for quick lookup during apply.
    const byKey = new Map<string, HealthSessionRecord>()
    for (const r of records) byKey.set(r.sessionKey, r)

    // Disappeared first (so re-allocated agentIds don't collide with closed ones).
    for (const key of diff.disappeared) {
      const t = this.bySessionKey.get(key)
      if (!t) continue
      this.removeAgentById(t.agentId)
    }

    // Appeared: ensureTracked emits agentCreated/agentInfo + queue history fetch.
    for (const key of diff.appeared) {
      const r = byKey.get(key)
      if (!r) continue
      this.ensureTracked(r)
      this.refreshSession(key).catch((err) =>
        this.logger.warn(`[openclaw] refreshSession (appeared ${key}) failed:`, err),
      )
    }

    // Advanced: bump updatedAt + queue history fetch.
    for (const key of diff.advanced) {
      const t = this.bySessionKey.get(key)
      const r = byKey.get(key)
      if (!t || !r) continue
      t.updatedAt = r.updatedAt
      this.refreshSession(key).catch((err) =>
        this.logger.warn(`[openclaw] refreshSession (advanced ${key}) failed:`, err),
      )
    }
  }

  private ensureTracked(r: HealthSessionRecord): TrackedSession {
    const existing = this.bySessionKey.get(r.sessionKey)
    if (existing) {
      // Update mutable fields from latest health (name/emoji could change).
      existing.agentBaseName = r.agentName
      existing.emoji = r.emoji
      existing.openClawAgentId = r.agentId
      existing.updatedAt = r.updatedAt
      return existing
    }
    const agentId = this.nextAgentId++
    const label = this.labelCache.get(r.sessionKey)
    const tracked: TrackedSession = {
      agentId,
      sessionKey: r.sessionKey,
      openClawAgentId: r.agentId,
      agentBaseName: r.agentName,
      emoji: r.emoji,
      label,
      updatedAt: r.updatedAt,
      state: createOpenClawTranslationState(),
    }
    this.bySessionKey.set(r.sessionKey, tracked)
    this.byAgentId.set(agentId, tracked)

    this.emit('message', { type: 'agentCreated', id: agentId })
    this.emit('message', {
      type: 'agentInfo',
      id: agentId,
      name: buildSessionDisplayName(tracked.agentBaseName, tracked.sessionKey, tracked.label),
      emoji: tracked.emoji,
    })
    return tracked
  }

  /**
   * Refresh one session's transcript and emit the delta.
   * Coalesces concurrent calls per sessionKey.
   */
  private async refreshSession(sessionKey: string): Promise<void> {
    const existing = this.inFlight.get(sessionKey)
    if (existing) {
      const next = existing
        .catch(() => undefined)
        .then(() => this.doRefresh(sessionKey))
      this.inFlight.set(sessionKey, next)
      try {
        await next
      } finally {
        if (this.inFlight.get(sessionKey) === next) this.inFlight.delete(sessionKey)
      }
      return
    }
    const p = this.doRefresh(sessionKey)
    this.inFlight.set(sessionKey, p)
    try {
      await p
    } finally {
      if (this.inFlight.get(sessionKey) === p) this.inFlight.delete(sessionKey)
    }
  }

  private async doRefresh(sessionKey: string): Promise<void> {
    const tracked = this.bySessionKey.get(sessionKey)
    if (!tracked) return
    let res: ChatHistoryResponse
    try {
      res = await this.gateway.request<ChatHistoryResponse>('chat.history', {
        sessionKey,
        limit: this.historyLimit,
      })
    } catch (err) {
      this.logger.warn(`[openclaw] chat.history failed for ${sessionKey}:`, err)
      return
    }
    const history: AnthMessage[] = parseChatHistoryResponse(res)
    const out = translateNewOpenClawMessages(tracked.agentId, history, tracked.state)
    for (const msg of out) {
      this.emit('message', msg)
    }
  }
}
