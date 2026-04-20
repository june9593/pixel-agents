/**
 * OpenClawWatcher — implements AgentWatcher over the OpenClaw Gateway.
 *
 * Strategy (matches the OpenClaw control UI, see ~/tmp_openclaw/ui/src/ui/app-gateway.ts):
 *   1. Connect via OpenClawGateway (WS + JSON-RPC).
 *   2. Call `sessions.list` once → discover existing sessions, allocate agent ids.
 *   3. Subscribe via `sessions.messages.subscribe`.
 *   4. On each `session.message` event {sessionKey}: re-fetch `chat.history`,
 *      diff against the per-session translator state, emit `PixelMessage`s.
 *   5. On `sessions.changed` events: re-list sessions, allocate ids for new ones.
 *
 * Agent ids: allocated as a contiguous integer range starting at `idBase`. The
 * server passes a base (e.g. 1000) so kosmos and openclaw never collide.
 */

import { EventEmitter } from 'events'
import { OpenClawGateway } from './openclawGateway.js'
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

interface OpenClawSessionListEntry {
  key?: string
  sessionKey?: string
  title?: string
  agentId?: string
  lastMessage?: { role?: string; content?: unknown } | null
}

interface TrackedSession {
  agentId: number
  sessionKey: string
  title: string
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
  /** Default agent emoji + name template. */
  agentName?: (sessionKey: string, title: string) => string
  agentEmoji?: () => string
}

export class OpenClawWatcher extends EventEmitter implements AgentWatcher {
  readonly source: AgentSource = 'openclaw'

  private readonly gateway: OpenClawGateway
  private readonly logger: NonNullable<OpenClawWatcherOptions['logger']>
  private readonly historyLimit: number
  private readonly idBase: number
  private readonly nameOf: NonNullable<OpenClawWatcherOptions['agentName']>
  private readonly emojiOf: NonNullable<OpenClawWatcherOptions['agentEmoji']>

  private readonly bySessionKey = new Map<string, TrackedSession>()
  private readonly byAgentId = new Map<number, TrackedSession>()
  private nextAgentId: number
  private started = false
  private inFlight = new Map<string, Promise<void>>()

  constructor(opts: OpenClawWatcherOptions) {
    super()
    this.gateway = opts.gateway
    this.idBase = opts.idBase ?? 1000
    this.nextAgentId = this.idBase
    this.logger = opts.logger ?? console
    this.historyLimit = opts.historyLimit ?? 200
    this.nameOf = opts.agentName ?? ((_k, t) => t || 'OpenClaw agent')
    this.emojiOf = opts.agentEmoji ?? (() => '🦾')
  }

  // ── AgentWatcher contract ─────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.started) return
    this.started = true

    this.gateway.on('event', (env) => {
      this.handleEvent(env).catch((err) =>
        this.logger.warn('[openclaw] event handling failed:', err),
      )
    })
    this.gateway.on('open', () => {
      // (Re)subscribe and resync on every (re)connect.
      this.subscribeAndSync().catch((err) =>
        this.logger.warn('[openclaw] resync after open failed:', err),
      )
    })

    await this.gateway.start()
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false
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
    this.emit('message', { type: 'agentClosed', id: agentId })
    return true
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async subscribeAndSync(): Promise<void> {
    try {
      await this.gateway.call('sessions.messages.subscribe', {})
    } catch (err) {
      this.logger.warn('[openclaw] sessions.messages.subscribe failed:', err)
    }
    try {
      const list = await this.gateway.call<{ sessions?: OpenClawSessionListEntry[] }>(
        'sessions.list',
        { limit: 50, includeLastMessage: false },
      )
      const entries = Array.isArray(list?.sessions) ? list.sessions : []
      for (const entry of entries) {
        const key = entry.sessionKey || entry.key
        if (!key) continue
        this.ensureTracked(key, entry.title || '')
        // Eagerly fetch & emit current state so the webview shows context.
        await this.refreshSession(key)
      }
    } catch (err) {
      this.logger.warn('[openclaw] sessions.list failed:', err)
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

  private async handleEvent(env: { event: string; payload?: unknown }): Promise<void> {
    if (env.event === 'session.message') {
      const sessionKey = (env.payload as { sessionKey?: string } | undefined)?.sessionKey
      if (!sessionKey) return
      this.ensureTracked(sessionKey, '')
      await this.refreshSession(sessionKey)
      return
    }
    if (env.event === 'sessions.changed') {
      // Re-list to pick up new sessions / drop stale ones.
      await this.subscribeAndSync()
      return
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
      // Chain a follow-up so we re-fetch once after the in-flight call settles.
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
      res = await this.gateway.call<ChatHistoryResponse>('chat.history', {
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
