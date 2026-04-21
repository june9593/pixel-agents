/**
 * OpenClawGateway — typed WebSocket client for the real OpenClaw Gateway protocol v3.
 *
 * Protocol reference: plans/B-v3/spec.md (extracted from
 * /tmp/openclaw-src/docs/gateway/protocol.md and gateway-smoke.ts).
 *
 * Wire shape (the part the previous B-epic implementation got wrong):
 *   - Frames are typed envelopes:
 *       req:   { type: "req",   id, method, params? }    client → server
 *       res:   { type: "res",   id, ok, payload?, error? } server → client
 *       event: { type: "event", event, payload?, seq?, stateVersion? } server → client
 *   - On WS open the SERVER sends `connect.challenge` (event) first.
 *   - Client then sends ONE `connect` request with auth.token INLINE in params
 *     (no separate `connect.auth` step; that was the bug).
 *   - Server replies with `hello-ok` payload containing protocol/policy/features.
 *
 * Auto-reconnect with exponential backoff (1s → 30s).
 * Tick-keepalive: if no frame arrives within `policy.tickIntervalMs * 2` after
 *   handshake, we close with code 4000 and let reconnect happen.
 * Pending RPCs reject on disconnect, timeout, or stop().
 *
 * Public API:
 *   - start() / stop()
 *   - request<T>(method, params?, timeoutMs?) — req/res by id
 *   - on('open' | 'close' | 'error' | 'event' | 'auth-failed' | 'reconnected', ...)
 *
 * Auth-failure stop conditions (per spec §3): once any of these arrive in
 * `error.details`, we stop the reconnect loop and emit 'auth-failed':
 *   - code: AUTH_TOKEN_MISMATCH (and other AUTH_*)
 *   - recommendedNextStep: update_auth_configuration | update_auth_credentials |
 *                          review_auth_configuration
 */

import { EventEmitter } from 'events'
import WebSocket from 'ws'
import { randomUUID } from 'crypto'

// ─── Constants from spec §6 ───────────────────────────────────────────────

export const PROTOCOL_VERSION = 3
export const REQUEST_TIMEOUT_MS = 30_000
export const CONNECT_CHALLENGE_TIMEOUT_MS = 10_000
export const INITIAL_BACKOFF_MS = 1_000
export const MAX_BACKOFF_MS = 30_000
/** Pre-handshake silence threshold (server may not have advertised tickIntervalMs yet). */
export const PRE_HANDSHAKE_TICK_MS = 30_000
/** Server closes idle conns with code 4000 after silence > tickIntervalMs * 2. */
export const TICK_TIMEOUT_CLOSE_CODE = 4000

// ─── Public types ─────────────────────────────────────────────────────────

export interface OpenClawGatewayOptions {
  url: string
  token: string
  /** Override client.id sent in connect req. Default 'pixel-kosmos'. */
  clientId?: string
  /** Override client.instanceId. Default random uuid. */
  instanceId?: string
  /** Override client.version. Default '1.0.0'. */
  clientVersion?: string
  /** Scopes requested in connect. Default ['operator.read']. */
  scopes?: string[]
  /** Per-request timeout in ms. Default 30s. */
  requestTimeoutMs?: number
  /** Connect-challenge wait timeout in ms. Default 10s. */
  challengeTimeoutMs?: number
  /** Initial reconnect delay in ms. Default 1000. */
  reconnectMinMs?: number
  /** Max reconnect delay in ms. Default 30000. */
  reconnectMaxMs?: number
  /** WebSocket constructor override (for tests). */
  WebSocketImpl?: typeof WebSocket
}

/** Parsed `hello-ok` payload (the subset we use). */
export interface HelloOk {
  type: 'hello-ok'
  protocol: number
  server?: { version?: string; connId?: string }
  features?: { methods?: string[]; events?: string[] }
  policy?: {
    maxPayload?: number
    maxBufferedBytes?: number
    tickIntervalMs?: number
  }
  auth?: { role?: string; scopes?: string[]; deviceToken?: string }
  /** Anything else the server includes (e.g. snapshot). */
  [key: string]: unknown
}

/** Server-pushed event frame. */
export interface GatewayEvent {
  event: string
  payload: unknown
  seq?: number
  stateVersion?: number
}

/** Auth-failure detail surfaced to caller. */
export interface AuthFailure {
  code?: string
  message?: string
  details?: {
    code?: string
    reason?: string
    canRetryWithDeviceToken?: boolean
    recommendedNextStep?: string
  }
}

/** Error thrown by request() when the server replies with `ok:false`. */
export class GatewayRequestError extends Error {
  readonly method: string
  readonly serverError: unknown
  constructor(method: string, serverError: unknown, message: string) {
    super(message)
    this.name = 'GatewayRequestError'
    this.method = method
    this.serverError = serverError
  }
}

// ─── Internal types ───────────────────────────────────────────────────────

interface PendingCall {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
  method: string
}

type RawFrame = {
  type?: string
  id?: string
  method?: string
  params?: unknown
  ok?: boolean
  payload?: unknown
  error?: AuthFailure | { message?: string } | string
  event?: string
  seq?: number
  stateVersion?: number
}

const STOP_RECONNECT_NEXT_STEPS = new Set([
  'update_auth_configuration',
  'update_auth_credentials',
  'review_auth_configuration',
])

// ─── Implementation ───────────────────────────────────────────────────────

/**
 * Lifecycle events:
 *   'open'           — connect.challenge received, hello-ok parsed, ready for RPCs
 *                      payload: HelloOk
 *   'reconnected'    — same as 'open' but fired after a reconnect (vs first connect)
 *   'close'          — socket dropped (will auto-reconnect unless stopped or auth-failed)
 *                      payload: { code, reason, wasOpen }
 *   'error'          — transport error or unexpected frame
 *                      payload: Error
 *   'event'          — server-pushed event (excluding connect.challenge which is internal)
 *                      payload: GatewayEvent
 *   'auth-failed'    — stop reconnecting; surface to user
 *                      payload: AuthFailure
 */
export class OpenClawGateway extends EventEmitter {
  private opts: Required<Omit<OpenClawGatewayOptions, 'WebSocketImpl' | 'instanceId'>> & {
    WebSocketImpl: typeof WebSocket
    instanceId: string
  }
  private ws: WebSocket | null = null
  private pending = new Map<string, PendingCall>()
  private nextIdCounter = 1
  private stopped = false
  private authFailed = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private currentBackoffMs: number
  private isOpen = false
  private hasOpenedOnce = false
  private helloOk: HelloOk | null = null
  /** Timer for connect.challenge wait. */
  private challengeTimer: ReturnType<typeof setTimeout> | null = null
  /** Timer that closes the conn after silence. Reset on every received frame. */
  private silenceTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: OpenClawGatewayOptions) {
    super()
    this.opts = {
      url: options.url,
      token: options.token,
      clientId: options.clientId ?? 'pixel-kosmos',
      instanceId: options.instanceId ?? `pixel-kosmos-${randomUUID()}`,
      clientVersion: options.clientVersion ?? '1.0.0',
      scopes: options.scopes ?? ['operator.read'],
      requestTimeoutMs: options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
      challengeTimeoutMs: options.challengeTimeoutMs ?? CONNECT_CHALLENGE_TIMEOUT_MS,
      reconnectMinMs: options.reconnectMinMs ?? INITIAL_BACKOFF_MS,
      reconnectMaxMs: options.reconnectMaxMs ?? MAX_BACKOFF_MS,
      WebSocketImpl: options.WebSocketImpl ?? WebSocket,
    }
    this.currentBackoffMs = this.opts.reconnectMinMs
  }

  /** Begin connecting. Idempotent; clears any prior auth-failed state. */
  start(): void {
    this.stopped = false
    this.authFailed = false
    if (this.ws) return
    this.connect()
  }

  /** Tear down: cancel reconnects, reject pending calls, close socket. */
  stop(): void {
    this.stopped = true
    this.clearReconnectTimer()
    this.clearChallengeTimer()
    this.clearSilenceTimer()
    this.failAllPending(new Error('Gateway stopped'))
    this.tearDownSocket()
    this.isOpen = false
  }

  /** True once handshake (`hello-ok`) has been received. */
  get connected(): boolean {
    return this.isOpen
  }

  /** Last successful hello-ok payload, or null if not yet connected. */
  get lastHelloOk(): HelloOk | null {
    return this.helloOk
  }

  /**
   * @deprecated Use {@link request} instead. Kept as a thin alias so YUE-84
   * (watcher rewrite) can land independently of YUE-83. Will be removed once
   * the watcher migrates to `request()`.
   */
  call<T = unknown>(method: string, params?: unknown): Promise<T> {
    return this.request<T>(method, params)
  }

  /**
   * Send a typed `req` frame and await the matching `res`.
   * Rejects on timeout, transport drop, or `ok:false` server reply.
   */
  request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.isOpen || !this.ws) {
        reject(new Error(`Gateway not connected (request=${method})`))
        return
      }
      const id = String(this.nextIdCounter++)
      const effectiveTimeout = timeoutMs ?? this.opts.requestTimeoutMs
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Request timeout after ${effectiveTimeout}ms (method=${method})`))
      }, effectiveTimeout)
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
        method,
      })
      const frame: Record<string, unknown> = { type: 'req', id, method }
      if (params !== undefined) frame.params = params
      try {
        this.ws.send(JSON.stringify(frame))
      } catch (err) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  // ─── Internal: connection lifecycle ────────────────────────────────────

  private connect(): void {
    if (this.stopped || this.authFailed) return
    this.helloOk = null
    this.isOpen = false

    const ws = new this.opts.WebSocketImpl(this.opts.url)
    this.ws = ws as unknown as WebSocket

    // Wait up to challengeTimeoutMs for the server's first connect.challenge.
    this.challengeTimer = setTimeout(() => {
      this.emit('error', new Error(
        `connect.challenge not received within ${this.opts.challengeTimeoutMs}ms`,
      ))
      try { ws.close() } catch { /* ignore */ }
    }, this.opts.challengeTimeoutMs)

    // Silence detector starts conservatively; reset on every recv.
    this.armSilenceTimer(PRE_HANDSHAKE_TICK_MS)

    ws.on('open', () => {
      // Per protocol: do NOTHING here. Wait for server's connect.challenge.
    })

    ws.on('message', (raw: WebSocket.RawData) => {
      this.armSilenceTimer(this.currentTickMs())
      this.onMessage(String(raw))
    })

    ws.on('close', (code: number, reason: Buffer) => {
      const wasOpen = this.isOpen
      this.isOpen = false
      this.clearChallengeTimer()
      this.clearSilenceTimer()
      this.failAllPending(new Error(
        `Gateway closed (code=${code} reason=${reason.toString() || '(none)'})`,
      ))
      this.ws = null
      this.emit('close', { code, reason: reason.toString(), wasOpen })
      if (!this.stopped && !this.authFailed) {
        this.scheduleReconnect()
      }
    })

    ws.on('error', (err: Error) => {
      // Don't tear down here — 'close' will follow.
      this.emit('error', err)
    })
  }

  private onMessage(raw: string): void {
    let msg: RawFrame
    try {
      msg = JSON.parse(raw)
    } catch {
      this.emit('error', new Error(`Invalid JSON from gateway: ${raw.slice(0, 120)}`))
      return
    }

    // Event frame
    if (msg.type === 'event' && typeof msg.event === 'string') {
      if (msg.event === 'connect.challenge') {
        this.handleConnectChallenge()
        return
      }
      // Don't surface internal events upward.
      const evt: GatewayEvent = {
        event: msg.event,
        payload: msg.payload,
        seq: msg.seq,
        stateVersion: msg.stateVersion,
      }
      // 'tick' is a keepalive — silence timer was already reset above; just no-op.
      if (msg.event === 'tick') return
      this.emit('event', evt)
      return
    }

    // Response frame
    if (msg.type === 'res' && typeof msg.id === 'string') {
      const pending = this.pending.get(msg.id)

      // Special case: response to our own `connect` req (id='connect-handshake').
      if (msg.id === 'connect-handshake') {
        this.handleConnectResponse(msg)
        return
      }

      if (!pending) return
      this.pending.delete(msg.id)
      clearTimeout(pending.timer)

      if (msg.ok === true) {
        pending.resolve(msg.payload)
      } else {
        const errMsg = formatServerError(msg.error) || `Request failed (method=${pending.method})`
        pending.reject(new GatewayRequestError(pending.method, msg.error, errMsg))
      }
      return
    }

    // Unknown frame type — log and ignore.
    this.emit('error', new Error(`Unknown frame type from gateway: ${String(msg.type)}`))
  }

  private handleConnectChallenge(): void {
    // We received the challenge — clear the wait timer.
    this.clearChallengeTimer()

    if (!this.ws) return

    // Send the single `connect` req. We use a fixed id so handleConnectResponse can match.
    const frame = {
      type: 'req',
      id: 'connect-handshake',
      method: 'connect',
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: this.opts.clientId,
          displayName: 'pixel-kosmos OpenClaw watcher',
          version: this.opts.clientVersion,
          platform: 'node',
          mode: 'ui',
          instanceId: this.opts.instanceId,
        },
        role: 'operator',
        scopes: this.opts.scopes,
        caps: [],
        auth: { token: this.opts.token },
        locale: 'en-US',
        userAgent: `pixel-kosmos/${this.opts.clientVersion}`,
      },
    }
    try {
      this.ws.send(JSON.stringify(frame))
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
    }
  }

  private handleConnectResponse(msg: RawFrame): void {
    if (msg.ok === true && isHelloOkPayload(msg.payload)) {
      this.helloOk = msg.payload
      this.isOpen = true
      this.currentBackoffMs = this.opts.reconnectMinMs
      // Re-arm silence with the server-advertised interval.
      this.armSilenceTimer(this.currentTickMs())
      const wasReconnect = this.hasOpenedOnce
      this.hasOpenedOnce = true
      this.emit('open', this.helloOk)
      if (wasReconnect) this.emit('reconnected', this.helloOk)
      return
    }

    // Auth/handshake failure path.
    const failure: AuthFailure = (typeof msg.error === 'object' && msg.error !== null)
      ? (msg.error as AuthFailure)
      : { message: typeof msg.error === 'string' ? msg.error : 'connect failed' }

    if (shouldStopReconnect(failure)) {
      this.authFailed = true
      this.emit('auth-failed', failure)
    } else {
      this.emit('error', new Error(`connect failed: ${formatServerError(failure)}`))
    }
    // Close — reconnect will or won't happen based on authFailed flag.
    try { this.ws?.close() } catch { /* ignore */ }
  }

  // ─── Timers / housekeeping ─────────────────────────────────────────────

  private currentTickMs(): number {
    const policyTick = this.helloOk?.policy?.tickIntervalMs
    if (typeof policyTick === 'number' && policyTick > 0) return policyTick * 2
    return PRE_HANDSHAKE_TICK_MS
  }

  private armSilenceTimer(ms: number): void {
    this.clearSilenceTimer()
    this.silenceTimer = setTimeout(() => {
      // No frame received in `ms`. Close with the spec's tick-timeout code.
      try { this.ws?.close(TICK_TIMEOUT_CLOSE_CODE, 'tick-timeout') } catch { /* ignore */ }
    }, ms)
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer)
      this.silenceTimer = null
    }
  }

  private clearChallengeTimer(): void {
    if (this.challengeTimer) {
      clearTimeout(this.challengeTimer)
      this.challengeTimer = null
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private failAllPending(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }

  private tearDownSocket(): void {
    if (this.ws) {
      try {
        this.ws.removeAllListeners()
        this.ws.close()
      } catch {
        // ignore
      }
      this.ws = null
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.authFailed) return
    const delay = this.currentBackoffMs
    this.currentBackoffMs = Math.min(delay * 2, this.opts.reconnectMaxMs)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function isHelloOkPayload(p: unknown): p is HelloOk {
  return typeof p === 'object' && p !== null
    && (p as { type?: unknown }).type === 'hello-ok'
}

function formatServerError(err: unknown): string {
  if (!err) return ''
  if (typeof err === 'string') return err
  if (typeof err === 'object') {
    const e = err as { message?: unknown; code?: unknown; details?: { code?: unknown; reason?: unknown } }
    const parts: string[] = []
    if (typeof e.code === 'string') parts.push(`code=${e.code}`)
    if (e.details && typeof e.details === 'object') {
      const d = e.details as { code?: unknown; reason?: unknown }
      if (typeof d.code === 'string') parts.push(`details.code=${d.code}`)
      if (typeof d.reason === 'string') parts.push(`details.reason=${d.reason}`)
    }
    if (typeof e.message === 'string') parts.push(e.message)
    return parts.join(' ')
  }
  return String(err)
}

function shouldStopReconnect(failure: AuthFailure): boolean {
  const code = failure.details?.code ?? failure.code
  if (typeof code === 'string') {
    if (code.startsWith('AUTH_') || code.startsWith('DEVICE_AUTH_')) return true
  }
  const next = failure.details?.recommendedNextStep
  if (typeof next === 'string' && STOP_RECONNECT_NEXT_STEPS.has(next)) return true
  return false
}
