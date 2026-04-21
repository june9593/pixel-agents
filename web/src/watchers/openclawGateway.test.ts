/**
 * Unit tests for OpenClawGateway.
 *
 * Spins up a real `ws` server on an ephemeral port and exercises:
 *   - happy path: connect → hello → ack → 'open' fires
 *   - RPC: request/response round-trip
 *   - RPC error: server replies with error → call rejects
 *   - RPC timeout: no response → call rejects with timeout
 *   - event push: 'event' frame → 'event' listener fires
 *   - reconnect: drop socket, gateway auto-reconnects
 *   - stop(): no leaked sockets, pending RPCs reject
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WebSocketServer, WebSocket } from 'ws'
import { OpenClawGateway } from './openclawGateway.js'

interface ServerHandler {
  onHello?: (msg: { token: string; role: string; scopes: string[] }, ws: WebSocket) => void
  onRequest?: (msg: { id: number | string; method: string; params: unknown }, ws: WebSocket) => void
}

interface FakeServer {
  port: number
  url: string
  close: () => Promise<void>
  pushEvent: (event: string, payload: unknown) => void
  dropAll: () => void
  setHandler: (h: ServerHandler) => void
  connections: () => number
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
        if (msg.type === 'hello') {
          h.onHello?.(msg, ws)
          // Default behaviour: ack immediately.
          if (!h.onHello) ws.send(JSON.stringify({ type: 'ack' }))
        } else if (msg.type === 'request') {
          h.onRequest?.(msg, ws)
        }
      })
    })

    wss.on('listening', () => {
      const addr = wss.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        port,
        url: `ws://localhost:${port}`,
        close: () => new Promise((res) => wss.close(() => res())),
        pushEvent: (event, payload) => {
          for (const s of sockets) {
            if (s.readyState === s.OPEN) {
              s.send(JSON.stringify({ type: 'event', event, payload }))
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

function waitForEvent<T>(emitter: { once: (ev: string, fn: (v: T) => void) => void }, ev: string, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${ev}`)), timeoutMs)
    emitter.once(ev, (v: T) => {
      clearTimeout(timer)
      resolve(v)
    })
  })
}

test('connect → hello → ack fires open', async () => {
  const server = await startFakeGateway({
    onHello: (msg, ws) => {
      assert.equal(msg.token, 'tok-123')
      assert.equal(msg.role, 'operator')
      assert.deepEqual(msg.scopes, ['operator.read'])
      ws.send(JSON.stringify({ type: 'ack' }))
    },
  })
  const gw = new OpenClawGateway({ url: server.url, token: 'tok-123' })
  gw.start()
  await waitForEvent(gw, 'open')
  assert.equal(gw.connected, true)
  gw.stop()
  await server.close()
})

test('RPC round-trip', async () => {
  const server = await startFakeGateway({
    onRequest: (msg, ws) => {
      assert.equal(msg.method, 'sessions.list')
      ws.send(JSON.stringify({ type: 'response', id: msg.id, result: { sessions: ['a', 'b'] } }))
    },
  })
  const gw = new OpenClawGateway({ url: server.url, token: 't' })
  gw.start()
  await waitForEvent(gw, 'open')
  const result = await gw.call<{ sessions: string[] }>('sessions.list', {})
  assert.deepEqual(result, { sessions: ['a', 'b'] })
  gw.stop()
  await server.close()
})

test('RPC error rejects', async () => {
  const server = await startFakeGateway({
    onRequest: (msg, ws) => {
      ws.send(JSON.stringify({ type: 'response', id: msg.id, error: { message: 'forbidden' } }))
    },
  })
  const gw = new OpenClawGateway({ url: server.url, token: 't' })
  gw.start()
  await waitForEvent(gw, 'open')
  await assert.rejects(gw.call('do.thing'), /forbidden/)
  gw.stop()
  await server.close()
})

test('RPC timeout rejects', async () => {
  const server = await startFakeGateway({
    onRequest: () => { /* never reply */ },
  })
  const gw = new OpenClawGateway({ url: server.url, token: 't', rpcTimeoutMs: 150 })
  gw.start()
  await waitForEvent(gw, 'open')
  await assert.rejects(gw.call('slow.op'), /timeout/i)
  gw.stop()
  await server.close()
})

test('event push reaches listener', async () => {
  const server = await startFakeGateway()
  const gw = new OpenClawGateway({ url: server.url, token: 't' })
  gw.start()
  await waitForEvent(gw, 'open')
  const eventP = waitForEvent<{ event: string; payload: unknown }>(gw, 'event')
  server.pushEvent('session.message', { sessionKey: 'abc', text: 'hi' })
  const got = await eventP
  assert.equal(got.event, 'session.message')
  assert.deepEqual(got.payload, { sessionKey: 'abc', text: 'hi' })
  gw.stop()
  await server.close()
})

test('auto-reconnect after socket drop', async () => {
  const server = await startFakeGateway()
  const gw = new OpenClawGateway({ url: server.url, token: 't', reconnectMinMs: 50, reconnectMaxMs: 200 })
  gw.start()
  await waitForEvent(gw, 'open')
  assert.equal(server.connections(), 1)

  // Drop the connection
  const reopenP = waitForEvent(gw, 'open', 3000)
  server.dropAll()
  await reopenP
  assert.equal(gw.connected, true)

  gw.stop()
  await server.close()
})

test('stop() cancels pending RPCs and prevents reconnect', async () => {
  const server = await startFakeGateway({
    onRequest: () => { /* never reply */ },
  })
  const gw = new OpenClawGateway({ url: server.url, token: 't', rpcTimeoutMs: 5000, reconnectMinMs: 50 })
  gw.start()
  await waitForEvent(gw, 'open')

  const pendingP = gw.call('hangs.forever')
  // Give the call a tick to register
  await new Promise((r) => setTimeout(r, 20))
  gw.stop()
  await assert.rejects(pendingP, /Gateway stopped/)

  // Wait long enough that a reconnect would have fired if not stopped.
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(gw.connected, false)

  await server.close()
})
