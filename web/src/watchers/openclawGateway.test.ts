/**
 * Unit tests for OpenClawGateway (protocol v3).
 *
 * Spins up a real `ws` server on an ephemeral port. The fake gateway implements
 * the real protocol shape from plans/B-v3/spec.md:
 *
 *   1. On WS connection, send `{type:"event", event:"connect.challenge", ...}`.
 *   2. Expect `{type:"req", id, method:"connect", params:{auth:{token}, ...}}`.
 *   3. Reply `{type:"res", id, ok:true, payload:{type:"hello-ok", ...}}` (or error).
 *   4. RPC: `{type:"req", id, method, params}` → `{type:"res", id, ok, payload|error}`.
 *   5. Push: `{type:"event", event, payload, seq?, stateVersion?}`.
 *
 * Coverage:
 *   - happy path: connect → challenge → connect req → hello-ok → 'open' fires
 *   - request: req/res round-trip
 *   - request error: server replies ok:false → call rejects with GatewayRequestError
 *   - request timeout: no response → rejects with timeout error
 *   - event push: 'event' frame → 'event' listener fires (excluding tick/connect.challenge)
 *   - tick keepalive: tick events do NOT surface to listeners
 *   - reconnect: drop socket, gateway auto-reconnects, 'reconnected' fires
 *   - auth-failed: AUTH_TOKEN_MISMATCH stops reconnect loop, 'auth-failed' fires
 *   - stop(): no leaked sockets, pending RPCs reject
 *   - challenge timeout: server never sends challenge → 'error' fires
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WebSocketServer, WebSocket } from 'ws'
import {
  OpenClawGateway,
  GATEWAY_CLIENT_IDS,
  GatewayRequestError,
  type AuthFailure,
  type GatewayEvent,
  type HelloOk,
} from './openclawGateway.js'

interface ConnectReq {
  type: 'req'
  id: string
  method: 'connect'
  params: {
    minProtocol: number
    maxProtocol: number
    client: { id: string; instanceId: string; version: string; [k: string]: unknown }
    role: string
    scopes: string[]
    auth: { token: string }
    [k: string]: unknown
  }
}

interface RpcReq {
  type: 'req'
  id: string
  method: string
  params?: unknown
}

interface ServerHandler {
  /** Called when a connect req arrives. Default: reply ok with a stock hello-ok. */
  onConnect?: (req: ConnectReq, ws: WebSocket) => void
  /** Called when a non-connect req arrives. Default: ignore (forces caller timeout). */
  onRequest?: (req: RpcReq, ws: WebSocket) => void
  /** If true, server does NOT send the connect.challenge event on connect. */
  skipChallenge?: boolean
}

interface FakeServer {
  port: number
  url: string
  close: () => Promise<void>
  pushEvent: (event: string, payload: unknown, extra?: { seq?: number; stateVersion?: number }) => void
  pushTick: () => void
  dropAll: () => void
  setHandler: (h: ServerHandler) => void
  connections: () => number
}

const STOCK_HELLO_OK: HelloOk = {
  type: 'hello-ok',
  protocol: 3,
  server: { version: '1.0.0', connId: 'test-conn' },
  features: { methods: ['ping'], events: ['session.message', 'tick'] },
  policy: { maxPayload: 1_000_000, maxBufferedBytes: 4_000_000, tickIntervalMs: 5_000 },
  auth: { role: 'operator', scopes: ['operator.read'] },
}

function startFakeGateway(handler: ServerHandler = {}): Promise<FakeServer> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 })
    let h: ServerHandler = handler
    const sockets = new Set<WebSocket>()

    wss.on('connection', (ws) => {
      sockets.add(ws)
      ws.on('close', () => sockets.delete(ws))
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw))
        if (msg.type === 'req' && msg.method === 'connect') {
          if (h.onConnect) {
            h.onConnect(msg as ConnectReq, ws)
          } else {
            ws.send(JSON.stringify({
              type: 'res',
              id: msg.id,
              ok: true,
              payload: STOCK_HELLO_OK,
            }))
          }
        } else if (msg.type === 'req') {
          h.onRequest?.(msg as RpcReq, ws)
        }
      })

      // Server initiates the protocol: send connect.challenge first.
      if (!h.skipChallenge) {
        ws.send(JSON.stringify({
          type: 'event',
          event: 'connect.challenge',
          payload: { protocol: 3, nonce: 'test-nonce' },
        }))
      }
    })

    wss.on('listening', () => {
      const addr = wss.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        port,
        url: `ws://localhost:${port}`,
        close: () => new Promise((res) => wss.close(() => res())),
        pushEvent: (event, payload, extra) => {
          for (const s of sockets) {
            if (s.readyState === s.OPEN) {
              s.send(JSON.stringify({ type: 'event', event, payload, ...(extra ?? {}) }))
            }
          }
        },
        pushTick: () => {
          for (const s of sockets) {
            if (s.readyState === s.OPEN) {
              s.send(JSON.stringify({ type: 'event', event: 'tick' }))
            }
          }
        },
        dropAll: () => {
          for (const s of sockets) s.terminate()
        },
        setHandler: (newH) => { h = newH },
        connections: () => sockets.size,
      })
    })
  })
}

function waitForEvent<T>(
  emitter: { once: (ev: string, fn: (v: T) => void) => void },
  ev: string,
  timeoutMs = 2000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for '${ev}'`)), timeoutMs)
    emitter.once(ev, (v: T) => {
      clearTimeout(timer)
      resolve(v)
    })
  })
}

function makeGateway(url: string, overrides: Partial<ConstructorParameters<typeof OpenClawGateway>[0]> = {}) {
  return new OpenClawGateway({
    url,
    token: 'test-token',
    clientId: GATEWAY_CLIENT_IDS.TEST,
    requestTimeoutMs: 500,
    challengeTimeoutMs: 500,
    reconnectMinMs: 50,
    reconnectMaxMs: 200,
    ...overrides,
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────

test('happy path: challenge → connect → hello-ok → open', async () => {
  let receivedConnect: ConnectReq | null = null
  const server = await startFakeGateway({
    onConnect: (req, ws) => {
      receivedConnect = req
      ws.send(JSON.stringify({ type: 'res', id: req.id, ok: true, payload: STOCK_HELLO_OK }))
    },
  })
  const gw = makeGateway(server.url)
  try {
    const opened = waitForEvent<HelloOk>(gw, 'open')
    gw.start()
    const hello = await opened

    assert.equal(hello.type, 'hello-ok')
    assert.equal(hello.protocol, 3)
    assert.equal(gw.connected, true)
    assert.deepEqual(gw.lastHelloOk?.policy?.tickIntervalMs, 5000)

    // Verify the connect req shape we sent matches the spec.
    assert.ok(receivedConnect, 'server should have received a connect req')
    const req = receivedConnect as unknown as ConnectReq
    assert.equal(req.type, 'req')
    assert.equal(req.method, 'connect')
    assert.equal(req.params.minProtocol, 3)
    assert.equal(req.params.maxProtocol, 3)
    assert.equal(req.params.role, 'operator')
    assert.deepEqual(req.params.scopes, ['operator.read'])
    assert.equal(req.params.auth.token, 'test-token')
    assert.equal(req.params.client.id, 'test')
    assert.ok(req.params.client.instanceId.length > 0)
  } finally {
    gw.stop()
    await server.close()
  }
})

test('connect req: configured clientId is forwarded into client.id', async () => {
  // Regression for YUE-87: previously the gateway defaulted clientId to
  // 'pixel-kosmos', which is NOT in OpenClaw's GATEWAY_CLIENT_IDS enum and
  // would be rejected by a real gateway. clientId is now a required typed
  // option; this test pins that whatever the caller passes is what hits
  // the wire.
  let receivedConnect: ConnectReq | null = null
  const server = await startFakeGateway({
    onConnect: (req, ws) => {
      receivedConnect = req
      ws.send(JSON.stringify({ type: 'res', id: req.id, ok: true, payload: STOCK_HELLO_OK }))
    },
  })
  const gw = makeGateway(server.url, { clientId: GATEWAY_CLIENT_IDS.GATEWAY_CLIENT })
  try {
    gw.start()
    await waitForEvent(gw, 'open')
    assert.ok(receivedConnect)
    const req: ConnectReq = receivedConnect
    assert.equal(req.params.client.id, 'gateway-client')
  } finally {
    gw.stop()
    await server.close()
  }
})

test('request: round-trip ok payload', async () => {
  const server = await startFakeGateway({
    onRequest: (req, ws) => {
      ws.send(JSON.stringify({ type: 'res', id: req.id, ok: true, payload: { pong: true, method: req.method } }))
    },
  })
  const gw = makeGateway(server.url)
  try {
    gw.start()
    await waitForEvent(gw, 'open')
    const result = await gw.request<{ pong: boolean; method: string }>('ping', { x: 1 })
    assert.deepEqual(result, { pong: true, method: 'ping' })
  } finally {
    gw.stop()
    await server.close()
  }
})

test('request: server ok:false rejects with GatewayRequestError', async () => {
  const server = await startFakeGateway({
    onRequest: (req, ws) => {
      ws.send(JSON.stringify({
        type: 'res',
        id: req.id,
        ok: false,
        error: { code: 'NOT_FOUND', message: 'no such session' },
      }))
    },
  })
  const gw = makeGateway(server.url)
  try {
    gw.start()
    await waitForEvent(gw, 'open')
    await assert.rejects(
      gw.request('sessions.get', { id: 'x' }),
      (err: Error) => {
        assert.ok(err instanceof GatewayRequestError)
        assert.equal((err as GatewayRequestError).method, 'sessions.get')
        assert.match(err.message, /no such session/)
        return true
      },
    )
  } finally {
    gw.stop()
    await server.close()
  }
})

test('request: timeout when no response', async () => {
  const server = await startFakeGateway({
    onRequest: () => { /* black hole */ },
  })
  const gw = makeGateway(server.url, { requestTimeoutMs: 100 })
  try {
    gw.start()
    await waitForEvent(gw, 'open')
    await assert.rejects(
      gw.request('slow.method'),
      /timeout after 100ms/,
    )
  } finally {
    gw.stop()
    await server.close()
  }
})

test('event push: surfaces non-internal events to listener', async () => {
  const server = await startFakeGateway()
  const gw = makeGateway(server.url)
  try {
    gw.start()
    await waitForEvent(gw, 'open')
    const evtP = waitForEvent<GatewayEvent>(gw, 'event')
    server.pushEvent('session.message', { sessionId: 's1', text: 'hello' }, { seq: 7, stateVersion: 42 })
    const evt = await evtP
    assert.equal(evt.event, 'session.message')
    assert.deepEqual(evt.payload, { sessionId: 's1', text: 'hello' })
    assert.equal(evt.seq, 7)
    assert.equal(evt.stateVersion, 42)
  } finally {
    gw.stop()
    await server.close()
  }
})

test('tick events are NOT surfaced to listener', async () => {
  const server = await startFakeGateway()
  const gw = makeGateway(server.url)
  try {
    gw.start()
    await waitForEvent(gw, 'open')
    let count = 0
    gw.on('event', () => { count++ })
    server.pushTick()
    server.pushTick()
    // Give events a chance to arrive.
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(count, 0, 'tick events should not surface as user events')
  } finally {
    gw.stop()
    await server.close()
  }
})

test('reconnect: dropAll triggers reconnect → reconnected event', async () => {
  const server = await startFakeGateway()
  const gw = makeGateway(server.url, { reconnectMinMs: 20, reconnectMaxMs: 100 })
  try {
    gw.start()
    await waitForEvent(gw, 'open')
    const reconnected = waitForEvent(gw, 'reconnected', 3000)
    server.dropAll()
    await reconnected
    assert.equal(gw.connected, true)
  } finally {
    gw.stop()
    await server.close()
  }
})

test('auth-failed: AUTH_TOKEN_MISMATCH stops reconnect loop', async () => {
  const failure: AuthFailure = {
    code: 'UNAUTHORIZED',
    message: 'token mismatch',
    details: {
      code: 'AUTH_TOKEN_MISMATCH',
      reason: 'token-mismatch',
      canRetryWithDeviceToken: false,
      recommendedNextStep: 'update_auth_credentials',
    },
  }
  let connectAttempts = 0
  const server = await startFakeGateway({
    onConnect: (req, ws) => {
      connectAttempts++
      ws.send(JSON.stringify({ type: 'res', id: req.id, ok: false, error: failure }))
      ws.close()
    },
  })
  const gw = makeGateway(server.url, { reconnectMinMs: 20, reconnectMaxMs: 100 })
  try {
    const authFailed = waitForEvent<AuthFailure>(gw, 'auth-failed')
    gw.start()
    const f = await authFailed
    assert.equal(f.details?.code, 'AUTH_TOKEN_MISMATCH')

    // Wait long enough that a reconnect WOULD fire if reconnect were enabled.
    await new Promise((r) => setTimeout(r, 250))
    assert.equal(connectAttempts, 1, 'should not retry after auth-failed')
  } finally {
    gw.stop()
    await server.close()
  }
})

test('stop(): pending requests reject and no leaked sockets', async () => {
  const server = await startFakeGateway({
    onRequest: () => { /* never reply */ },
  })
  const gw = makeGateway(server.url)
  try {
    gw.start()
    await waitForEvent(gw, 'open')
    const pending = gw.request('hang')
    gw.stop()
    await assert.rejects(pending, /Gateway stopped/)
    // Give the server a moment to drop the conn.
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(server.connections(), 0)
  } finally {
    await server.close()
  }
})

test('challenge timeout: server never sends challenge → error fires', async () => {
  const server = await startFakeGateway({ skipChallenge: true })
  const gw = makeGateway(server.url, { challengeTimeoutMs: 80 })
  try {
    const errP = waitForEvent<Error>(gw, 'error', 1000)
    gw.start()
    const err = await errP
    assert.match(err.message, /connect\.challenge not received/)
  } finally {
    gw.stop()
    await server.close()
  }
})
