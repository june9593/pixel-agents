/**
 * OpenClawGateway — typed WebSocket client for OpenClaw's operator gateway.
 *
 * Verified against ~/tmp_openclaw protocol:
 *   - Default port: 18789
 *   - On connect, send: {type: "hello", role, scopes, token}
 *   - Server replies with ack (or error)
 *   - RPC: {type: "request", id, method, params} → {type: "response", id, result | error}
 *   - Events: {type: "event", event, payload}
 *
 * This module is the transport + RPC layer ONLY. B3 builds the
 * session.message → PixelMessage mapper on top of `on('event', ...)`.
 *
 * Auto-reconnect with exponential backoff (1s → 30s).
 * Pending RPCs reject on disconnect or timeout.
 */

import { EventEmitter } from 'events'
import WebSocket from 'ws'

export interface OpenClawGatewayOptions {
  url: string
  token: string
  role?: 'operator' | 'agent' | 'observer'
  scopes?: string[]
  /** RPC timeout in ms. Default 10s. */
  rpcTimeoutMs?: number
  /** Initial reconnect delay in ms. Default 1000. */
  reconnectMinMs?: number
  /** Max reconnect delay in ms. Default 30000. */
  reconnectMaxMs?: number
  /** WebSocket constructor override (for tests). */
  WebSocketImpl?: typeof WebSocket
}

interface PendingCall {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
  method: string
}

export interface GatewayEvent {
  event: string
  payload: unknown
}

/**
 * Connection lifecycle events:
 *   'open'        — handshake acked, ready for RPCs
 *   'close'       — socket dropped (will auto-reconnect unless stopped)
 *   'error'       — transport error or handshake rejected
 *   'event'       — server-pushed event (GatewayEvent shape)
 */
export class OpenClawGateway extends EventEmitter {
  private opts: Required<Omit<OpenClawGatewayOptions, 'WebSocketImpl'>> & { WebSocketImpl: typeof WebSocket }
  private ws: WebSocket | null = null
  private pending = new Map<string | number, PendingCall>()
  private nextId = 1
  private stopped = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private currentBackoffMs: number
  private isOpen = false

  constructor(options: OpenClawGatewayOptions) {
    super()
    this.opts = {
      url: options.url,
      token: options.token,
      role: options.role ?? 'operator',
      scopes: options.scopes ?? ['operator.read'],
      rpcTimeoutMs: options.rpcTimeoutMs ?? 10000,
      reconnectMinMs: options.reconnectMinMs ?? 1000,
      reconnectMaxMs: options.reconnectMaxMs ?? 30000,
      WebSocketImpl: options.WebSocketImpl ?? WebSocket,
    }
    this.currentBackoffMs = this.opts.reconnectMinMs
  }

  /** Begin connecting. Idempotent. */
  start(): void {
    if (this.stopped) {
      this.stopped = false
    }
    if (this.ws) return
    this.connect()
  }

  /** Tear down: cancel reconnects, reject pending calls, close socket. */
  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.failAllPending(new Error('Gateway stopped'))
    if (this.ws) {
      try {
        this.ws.removeAllListeners()
        this.ws.close()
      } catch {
        // ignore
      }
      this.ws = null
    }
    this.isOpen = false
  }

  /** True once handshake has been acked. */
  get connected(): boolean {
    return this.isOpen
  }

  /**
   * Send a JSON-RPC-style call and await the result.
   * Rejects on timeout, transport error, or server error.
   */
  call<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.isOpen || !this.ws) {
        reject(new Error(`Gateway not connected (call=${method})`))
        return
      }
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC timeout after ${this.opts.rpcTimeoutMs}ms (call=${method})`))
      }, this.opts.rpcTimeoutMs)
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
        method,
      })
      this.ws.send(JSON.stringify({ type: 'request', id, method, params }))
    })
  }

  // ─── internal ────────────────────────────────────────────────────────

  private connect(): void {
    if (this.stopped) return
    const ws = new this.opts.WebSocketImpl(this.opts.url)
    this.ws = ws as unknown as WebSocket

    ws.on('open', () => {
      // Send hello immediately. Don't mark isOpen until ack.
      ws.send(JSON.stringify({
        type: 'hello',
        role: this.opts.role,
        scopes: this.opts.scopes,
        token: this.opts.token,
      }))
    })

    ws.on('message', (raw: WebSocket.RawData) => this.onMessage(String(raw)))

    ws.on('close', (code: number, reason: Buffer) => {
      const wasOpen = this.isOpen
      this.isOpen = false
      this.failAllPending(new Error(`Gateway closed (code=${code} reason=${reason.toString()})`))
      this.ws = null
      this.emit('close', { code, reason: reason.toString(), wasOpen })
      this.scheduleReconnect()
    })

    ws.on('error', (err: Error) => {
      // Don't tear down here — 'close' will follow.
      this.emit('error', err)
    })
  }

  private onMessage(raw: string): void {
    let msg: { type?: string; id?: string | number; result?: unknown; error?: { message?: string } | string; event?: string; payload?: unknown }
    try {
      msg = JSON.parse(raw)
    } catch {
      this.emit('error', new Error(`Invalid JSON from gateway: ${raw.slice(0, 120)}`))
      return
    }

    if (msg.type === 'ack' || msg.type === 'hello.ack') {
      // Handshake complete.
      this.isOpen = true
      this.currentBackoffMs = this.opts.reconnectMinMs
      this.emit('open')
      return
    }

    if (msg.type === 'error' && !msg.id) {
      // Server-level error (often handshake rejection).
      const err = new Error(typeof msg.error === 'string' ? msg.error : msg.error?.message ?? 'Gateway error')
      this.emit('error', err)
      return
    }

    if (msg.type === 'response' && msg.id !== undefined) {
      const pending = this.pending.get(msg.id)
      if (!pending) return
      this.pending.delete(msg.id)
      clearTimeout(pending.timer)
      if (msg.error) {
        const errMsg = typeof msg.error === 'string' ? msg.error : msg.error.message ?? 'RPC error'
        pending.reject(new Error(`${pending.method}: ${errMsg}`))
      } else {
        pending.resolve(msg.result)
      }
      return
    }

    if (msg.type === 'event' && msg.event) {
      this.emit('event', { event: msg.event, payload: msg.payload } as GatewayEvent)
      return
    }
  }

  private failAllPending(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    const delay = this.currentBackoffMs
    this.currentBackoffMs = Math.min(delay * 2, this.opts.reconnectMaxMs)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }
}
