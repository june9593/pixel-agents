/**
 * OpenClawWatcher — implements AgentWatcher over the OpenClaw Gateway (protocol v3).
 *
 * Subscription model (verified against /tmp/openclaw-src/src/gateway/server-methods/sessions.ts):
 *
 *   1. Connect via `OpenClawGateway` (handshake + hello-ok handled internally).
 *   2. `sessions.subscribe`              → subscribes this conn to `sessions.changed` events
 *      (no params).
 *   3. `sessions.list`                   → returns the current set of sessions.
 *   4. For every session: `sessions.messages.subscribe { key }` → subscribes to
 *      per-session `session.message` events. The server canonicalises and returns
 *      `{ subscribed: true, key: canonicalKey }` — we use the canonical key going
 *      forward (it's what the events carry in `payload.sessionKey`).
 *   5. On each `session.message` event { sessionKey }: re-fetch `chat.history`,
 *      diff against the per-session translator state, emit `PixelMessage`s.
 *   6. On `sessions.changed` events: re-list sessions, subscribe to new ones,
 *      unsubscribe from removed ones (drop their tracked state + emit agentClosed).
 *
 * Reconnect: handled by the gateway. On every `'open'` (first connect) and
 *   `'reconnected'` event, we re-run the subscribe sequence — server-side
 *   subscriptions are bound to `connId`, which changes after a reconnect, so
 *   we MUST re-subscribe (no state preserved across handshakes).
 *
 * Auth-failed: surfaced via the gateway's `'auth-failed'` event. The watcher
 *   logs it and stays in a quiescent state (the gateway will not reconnect).
 *
 * Agent ids: allocated as a contiguous integer range starting at `idBase`. The
 *   server passes a base (e.g. 1000) so kosmos and openclaw never collide.
 */

import { EventEmitter } from 'events'
import type { OpenClawGateway, GatewayEvent, AuthFailure, HelloOk } from './openclawGateway.js'
import {
  createOpenClawTranslationState,
  parseChatHistoryResponse,
  translateNewOpenClawMessages,
  type OpenClawTranslationState,
  type AnthMessage,
  type ChatHistoryResponse,
} from './openclawTranslator.js'
import type { PixelMessage } from '../logTranslator.js'
import type { AgentInfo, AgentSource, AgentWatcher } from './types.js'

// ─── Wire types (mirrored from OpenClaw schema) ───────────────────────────

/** Entry returned by `sessions.list` — server may use either `key` or `sessionKey`. */
interface OpenClawSessionListEntry {
  key?: string
  sessionKey?: string
  title?: string
  agentId?: string
  lastMessage?: { role?: string; content?: unknown } | null
}

interface SessionsListResponse {
  sessions?: OpenClawSessionListEntry[]
}

interface SessionsMessagesSubscribeResponse {
  subscribed: boolean
  /** Server-canonicalised session key — use this going forward. */
  key: string
}

interface SessionMessageEventPayload {
  sessionKey?: string
}

// ─── Internal tracking ────────────────────────────────────────────────────

interface TrackedSession {
  agentId: number
  /** Canonical session key as returned by `sessions.messages.subscribe`. */
  sessionKey: string
  title: string
  state: OpenClawTranslationState
  /** True once we've successfully called `sessions.messages.subscribe` for this key. */
  subscribed: boolean
}

export interface OpenClawWatcherOptions {
  gateway: OpenClawGateway
  /** First numeric agent id to allocate. Subsequent agents get base+1, base+2, … */
  idBase?: number
  /** Logger override (defaults to console). */
  logger?: { log: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void }
  /** Max history rows to request per chat.history call. */
  historyLimit?: number
  /** Max sessions to fetch in the initial sessions.list call. */
  sessionsListLimit?: number
  /** Default agent emoji + name template. */
  agentName?: (sessionKey: string, title: string) => string
  agentEmoji?: () => string
}

// ─── Watcher ──────────────────────────────────────────────────────────────

export class OpenClawWatcher extends EventEmitter implements AgentWatcher {
  readonly source: AgentSource = 'openclaw'

  private readonly gateway: OpenClawGateway
  private readonly logger: NonNullable<OpenClawWatcherOptions['logger']>
  private readonly historyLimit: number
  private readonly sessionsListLimit: number
  private readonly idBase: number
  private readonly nameOf: NonNullable<OpenClawWatcherOptions['agentName']>
  private readonly emojiOf: NonNullable<OpenClawWatcherOptions['agentEmoji']>

  private readonly bySessionKey = new Map<string, TrackedSession>()
  private readonly byAgentId = new Map<number, TrackedSession>()
  private nextAgentId: number
  private started = false
  private inFlight = new Map<string, Promise<void>>()

  // Bound listener refs so stop() can detach them.
  //
  // Note on reconnect: the gateway emits BOTH 'open' (every connect) AND
  // 'reconnected' (reconnects only). We listen to 'open' alone — it's fired on
  // initial connect and on every reconnect. We use the prior 'close' event to
  // invalidate per-session `subscribed` flags so subscribeAndSync re-issues
  // the per-session subscribe RPCs after a reconnect.
  private readonly onGatewayOpen = (_hello: HelloOk) => {
    this.subscribeAndSync().catch((err) =>
      this.logger.warn('[openclaw] subscribeAndSync after open failed:', err),
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
    if (info?.wasOpen) {
      // Server-side subscriptions are bound to connId; after the next reconnect
      // we MUST re-subscribe. Invalidate flags now so the next 'open' handler
      // re-issues sessions.messages.subscribe for each tracked session.
      for (const tracked of this.bySessionKey.values()) tracked.subscribed = false
    }
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
    this.nameOf = opts.agentName ?? ((_k, t) => t || 'OpenClaw agent')
    this.emojiOf = opts.agentEmoji ?? (() => '🦾')
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

    // Best-effort: tell the server to drop our subscriptions. Don't block on
    // failures — we're tearing down anyway.
    if (this.gateway.connected) {
      const keys = Array.from(this.bySessionKey.keys())
      await Promise.allSettled([
        this.gateway.request('sessions.unsubscribe').catch(() => undefined),
        ...keys.map((key) =>
          this.gateway
            .request('sessions.messages.unsubscribe', { key })
            .catch(() => undefined),
        ),
      ])
    }

    // Detach listeners BEFORE stopping the gateway so its 'close' fired during
    // teardown doesn't trigger our reconnect-resync handler.
    this.gateway.off('event', this.onGatewayEvent)
    this.gateway.off('error', this.onGatewayError)
    this.gateway.off('close', this.onGatewayClose)
    this.gateway.off('open', this.onGatewayOpen)
    this.gateway.off('auth-failed', this.onGatewayAuthFailed)

    await this.gateway.stop()
    this.bySessionKey.clear()
    this.byAgentId.clear()
    this.inFlight.clear()
  }

  agentCount(): number {
    return this.bySessionKey.size
  }

  getAgentInfo(): AgentInfo[] {
    const out: AgentInfo[] = []
    for (const tracked of this.bySessionKey.values()) {
      out.push({
        id: tracked.agentId,
        name: this.nameOf(tracked.sessionKey, tracked.title),
        emoji: this.emojiOf(),
        externalId: tracked.sessionKey,
        sessionTitle: tracked.title || 'OpenClaw session',
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
    // Best-effort server-side unsubscribe; ignore failures.
    if (this.gateway.connected) {
      this.gateway
        .request('sessions.messages.unsubscribe', { key: tracked.sessionKey })
        .catch(() => undefined)
    }
    this.emit('message', { type: 'agentClosed', id: agentId })
    return true
  }

  // ── Internals ─────────────────────────────────────────────────────────

  /**
   * Run the full subscribe sequence:
   *   1. sessions.subscribe (broad sessions.changed channel)
   *   2. sessions.list (current snapshot)
   *   3. sessions.messages.subscribe { key } per session
   *   4. chat.history per session to backfill the transcript
   *
   * Idempotent: per-session subscribe is gated on `tracked.subscribed`, and
   * concurrent chat.history calls per session are coalesced via inFlight.
   */
  private async subscribeAndSync(): Promise<void> {
    // (1) Broad subscribe — for sessions.changed
    try {
      await this.gateway.request('sessions.subscribe')
    } catch (err) {
      this.logger.warn('[openclaw] sessions.subscribe failed:', err)
    }

    // (2) Snapshot of current sessions
    let entries: OpenClawSessionListEntry[] = []
    try {
      const list = await this.gateway.request<SessionsListResponse>('sessions.list', {
        limit: this.sessionsListLimit,
        includeLastMessage: false,
      })
      entries = Array.isArray(list?.sessions) ? list.sessions : []
    } catch (err) {
      this.logger.warn('[openclaw] sessions.list failed:', err)
      return
    }

    // (3,4) Subscribe per-session, then backfill transcript
    for (const entry of entries) {
      const rawKey = entry.sessionKey || entry.key
      if (!rawKey) continue
      const tracked = this.ensureTracked(rawKey, entry.title || '')
      await this.subscribeToSession(tracked)
      // Eagerly fetch & emit current state so the webview shows context.
      await this.refreshSession(tracked.sessionKey)
    }
  }

  /**
   * Per-session subscribe. Uses the server-canonicalised key in the response,
   * which may differ from the input key (the server normalises). Re-keys our
   * tracking maps if so.
   */
  private async subscribeToSession(tracked: TrackedSession): Promise<void> {
    if (tracked.subscribed) return
    try {
      const resp = await this.gateway.request<SessionsMessagesSubscribeResponse>(
        'sessions.messages.subscribe',
        { key: tracked.sessionKey },
      )
      const canonical = typeof resp?.key === 'string' && resp.key.length > 0
        ? resp.key
        : tracked.sessionKey
      if (canonical !== tracked.sessionKey) {
        // Re-key our maps to the canonical form.
        this.bySessionKey.delete(tracked.sessionKey)
        tracked.sessionKey = canonical
        this.bySessionKey.set(canonical, tracked)
      }
      tracked.subscribed = resp?.subscribed === true
    } catch (err) {
      this.logger.warn(
        `[openclaw] sessions.messages.subscribe failed for ${tracked.sessionKey}:`,
        err,
      )
    }
  }

  private ensureTracked(sessionKey: string, title: string): TrackedSession {
    let tracked = this.bySessionKey.get(sessionKey)
    if (tracked) {
      if (title && tracked.title !== title) tracked.title = title
      return tracked
    }
    const agentId = this.nextAgentId++
    tracked = {
      agentId,
      sessionKey,
      title,
      state: createOpenClawTranslationState(),
      subscribed: false,
    }
    this.bySessionKey.set(sessionKey, tracked)
    this.byAgentId.set(agentId, tracked)

    this.emit('message', { type: 'agentCreated', id: agentId })
    this.emit('message', {
      type: 'agentInfo',
      id: agentId,
      name: this.nameOf(sessionKey, title),
      emoji: this.emojiOf(),
    })
    return tracked
  }

  private async handleEvent(env: GatewayEvent): Promise<void> {
    if (env.event === 'session.message') {
      const sessionKey = (env.payload as SessionMessageEventPayload | undefined)?.sessionKey
      if (!sessionKey) return
      // If this is a session we don't know about yet (e.g. brand-new and we
      // haven't seen sessions.changed yet), track it eagerly + subscribe.
      const tracked = this.ensureTracked(sessionKey, '')
      if (!tracked.subscribed) await this.subscribeToSession(tracked)
      await this.refreshSession(tracked.sessionKey)
      return
    }
    if (env.event === 'sessions.changed') {
      // Re-list to pick up new sessions; diff to drop stale ones.
      await this.refreshSessions()
      return
    }
  }

  /**
   * Re-list sessions and reconcile against tracked state:
   *   - new keys: ensureTracked + subscribe + backfill
   *   - stale keys (in tracked but not in list): drop + emit agentClosed
   */
  private async refreshSessions(): Promise<void> {
    let entries: OpenClawSessionListEntry[] = []
    try {
      const list = await this.gateway.request<SessionsListResponse>('sessions.list', {
        limit: this.sessionsListLimit,
        includeLastMessage: false,
      })
      entries = Array.isArray(list?.sessions) ? list.sessions : []
    } catch (err) {
      this.logger.warn('[openclaw] sessions.list (refresh) failed:', err)
      return
    }

    const liveKeys = new Set<string>()
    for (const entry of entries) {
      const key = entry.sessionKey || entry.key
      if (!key) continue
      liveKeys.add(key)
      const tracked = this.ensureTracked(key, entry.title || '')
      if (!tracked.subscribed) {
        await this.subscribeToSession(tracked)
        await this.refreshSession(tracked.sessionKey)
      }
    }

    // Drop sessions the server no longer reports. We don't iterate
    // bySessionKey directly because removeAgentById mutates it.
    const trackedKeys = Array.from(this.bySessionKey.keys())
    for (const key of trackedKeys) {
      if (liveKeys.has(key)) continue
      // Also check the post-canonicalisation key may not match raw entry.key
      // already; we only drop keys that are definitely missing.
      const tracked = this.bySessionKey.get(key)
      if (!tracked) continue
      this.removeAgentById(tracked.agentId)
    }
  }

  /**
   * Refresh one session's transcript and emit the delta.
   * Coalesces concurrent calls per sessionKey: while one fetch is in flight,
   * additional triggers chain onto the existing promise so we never overlap
   * RPCs for the same session.
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
