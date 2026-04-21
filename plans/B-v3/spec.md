# OpenClaw Gateway WebSocket Protocol — Implementation Spec

**Status:** Authoritative for B-v3 rewrite.
**Sources:**
- `/tmp/openclaw-src/docs/gateway/protocol.md` (663 lines, OpenClaw repo)
- `/tmp/openclaw-src/scripts/dev/gateway-smoke.ts` (canonical reference client)
- `/tmp/openclaw-src/src/gateway/protocol/schema/*.ts` (TypeBox schemas)

**Critical:** Our prior B-epic implementation in `web/src/watchers/openclawGateway.ts` is fundamentally wrong. It uses a fake `{type:"call", method:"connect.auth", params:{token, nonce}}` shape. The real protocol uses `req`/`res`/`event` envelopes and a SINGLE `connect` request (no separate `connect.auth` step).

---

## 1. Transport

- WebSocket, **text frames** with JSON payloads.
- Default URL: `ws://127.0.0.1:18789` (loopback) or `wss://host:port` (TLS).
- `MAX_PAYLOAD_BYTES` = 25 MB (server enforces; advertised in `hello-ok.payload.policy.maxPayload`).
- First server frame is **always** `connect.challenge` (event). Client waits for it before sending anything.

## 2. Frame envelopes

Three frame types. Discriminate on `type`.

```ts
// Request: client → server
type ReqFrame = {
  type: "req";
  id: string;          // client-generated correlation id (use uuid or counter)
  method: string;      // e.g. "connect", "health", "chat.history"
  params?: unknown;    // method-specific
};

// Response: server → client (always paired to a req by id)
type ResFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;   // present when ok=true
  error?: {
    code?: string;
    message?: string;
    details?: {
      code?: string;             // DEVICE_AUTH_*, AUTH_TOKEN_MISMATCH, etc.
      reason?: string;
      canRetryWithDeviceToken?: boolean;
      recommendedNextStep?: "retry_with_device_token" | "update_auth_configuration"
                          | "update_auth_credentials" | "wait_then_retry"
                          | "review_auth_configuration";
    };
  };
};

// Event: server → client (unsolicited, broadcast)
type EventFrame = {
  type: "event";
  event: string;        // e.g. "connect.challenge", "session.message", "tick"
  payload?: unknown;
  seq?: number;
  stateVersion?: number;
};
```

## 3. Handshake (the part we got wrong)

### Step 1: Server sends challenge (immediately on WS open)

```json
{
  "type": "event",
  "event": "connect.challenge",
  "payload": { "nonce": "abc123…", "ts": 1737264000000 }
}
```

Client just records the nonce (used for `device.signature` if device identity is sent — see §4).

### Step 2: Client sends ONE `connect` request

For our use case (read-only operator on loopback, no device pairing):

```json
{
  "type": "req",
  "id": "1",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "client": {
      "id": "pixel-kosmos",
      "displayName": "pixel-kosmos OpenClaw watcher",
      "version": "1.0.0",
      "platform": "node",
      "mode": "ui",
      "instanceId": "pixel-kosmos-<uuid>"
    },
    "role": "operator",
    "scopes": ["operator.read"],
    "caps": [],
    "auth": { "token": "<USER_TOKEN>" },
    "locale": "en-US",
    "userAgent": "pixel-kosmos/1.0.0"
  }
}
```

**Notes:**
- `minProtocol` / `maxProtocol` MUST both be `3`. Server rejects mismatches.
- `scopes`: read-only watcher needs only `operator.read`. Do NOT request `operator.write` / `operator.admin` we don't use.
- `auth.token` is the user's gateway shared-secret (custom password they set in `~/.openclaw/openclaw.json`). Accepts arbitrary characters including `*`.
- **Omit `device` entirely** for loopback / `gateway.controlUi.allowInsecureAuth=true`. The `gateway-smoke.ts` reference client does this and works against a default install.
- Alternative auth field: `auth.password` — used when the gateway is configured with `auth.mode: "password"`. We default to `token`; only switch if the server rejects with `AUTH_*` error.

### Step 3: Server responds with `hello-ok`

```json
{
  "type": "res",
  "id": "1",
  "ok": true,
  "payload": {
    "type": "hello-ok",
    "protocol": 3,
    "server": { "version": "0.x.x", "connId": "…" },
    "features": { "methods": ["health", "sessions.list", …], "events": ["session.message", …] },
    "snapshot": { "…": "…" },
    "policy": {
      "maxPayload": 26214400,
      "maxBufferedBytes": 52428800,
      "tickIntervalMs": 15000
    },
    "auth": {
      "role": "operator",
      "scopes": ["operator.read"]
    }
  }
}
```

**Required client behavior after hello-ok:**
- Honor `policy.tickIntervalMs` for keepalive expectations: if no server frame arrives within `2 * tickIntervalMs`, server will close with code `4000`. Client should also close + reconnect on that condition.
- Persist `payload.auth.deviceToken` if present (for paired flows; not needed for our shared-secret use case).

### Common connect errors

| `error.details.code` | Meaning | Action |
|---|---|---|
| `AUTH_TOKEN_MISMATCH` | Wrong token | Surface to user, stop reconnect |
| `DEVICE_AUTH_NONCE_REQUIRED` | Sent device without nonce | Don't send device on loopback |
| `DEVICE_AUTH_SIGNATURE_INVALID` | Bad device signature | Same |
| `INVALID_REQUEST` | Frame shape wrong | Check minProtocol/maxProtocol=3 |

If `recommendedNextStep == "wait_then_retry"`, backoff and retry. Anything else with `canRetryWithDeviceToken=false` should stop the reconnect loop.

## 4. Methods we use

All sent as `req` frames. Response in `res.payload`.

### `health`
```json
{ "type":"req", "id":"2", "method":"health" }
```
Response: `{ payload: { ok: true, ... } }`. Use as post-connect sanity check.

### `sessions.list`
```json
{ "type":"req", "id":"3", "method":"sessions.list" }
```
Response payload is the session index. Schema in `/tmp/openclaw-src/src/gateway/protocol/schema/sessions.ts` — read this file at implementation time for exact field names. Each entry has at minimum: `sessionKey: string`, `agentId: string`, plus metadata like `lastActivityAt`.

### `sessions.subscribe` / `sessions.unsubscribe`
```json
{ "type":"req", "id":"4", "method":"sessions.subscribe" }
```
Toggles `sessions.changed` events for this connection.

### `sessions.messages.subscribe` / `sessions.messages.unsubscribe`
```json
{ "type":"req", "id":"5", "method":"sessions.messages.subscribe", "params":{ "sessionKey": "main" } }
```
Toggles `session.message` events for ONE session. Subscribe per-session for each session we care about.

### `chat.history`
```json
{ "type":"req", "id":"6", "method":"chat.history", "params":{ "sessionKey":"main" } }
```
Returns full transcript. **Display-normalized** by server: tool-call XML stripped, `NO_REPLY` rows omitted, oversized rows replaced with placeholders. Request timeout = 15s recommended (smoke client uses 15000).

## 5. Events we listen for

### `session.message`
Incremental transcript update for a subscribed session. Payload schema in `/tmp/openclaw-src/src/gateway/protocol/schema/sessions.ts` (look for `SessionMessageEvent` or similar). **ASSUMPTION** (verify in B-v3-3 with real captures): payload includes `sessionKey`, `message: { role, content, ts }`. Our existing `__fixtures__/openclaw/*.json` files do NOT match this shape — they were guessed and must be replaced.

### `sessions.changed`
Session index updated (new session created, status changed, etc.). Re-fetch `sessions.list` if we care.

### `tick`
Server keepalive. Client should reset its silence timer on receipt.

## 6. Client behavior constants (from OpenClaw reference client)

| Constant | Default | Source |
|---|---|---|
| `PROTOCOL_VERSION` | 3 | `protocol-schemas.ts` |
| Per-RPC request timeout | 30,000 ms | `client.ts` |
| Connect-challenge timeout | 10,000 ms | `handshake-timeouts.ts` |
| Initial reconnect backoff | 1,000 ms | `client.ts` |
| Max reconnect backoff | 30,000 ms | `client.ts` |
| Default tick interval (pre `hello-ok`) | 30,000 ms | `client.ts` |
| Tick-timeout close code | 4000 | server emits when silent > tickIntervalMs * 2 |

After `hello-ok`, switch silence threshold to `policy.tickIntervalMs * 2`.

## 7. What our current code gets wrong (delete and rewrite)

`web/src/watchers/openclawGateway.ts`:
- ❌ Uses `{type:"call", method:"connect.auth", params:{token, nonce}}` — frame type `call` doesn't exist
- ❌ Treats `connect.auth` as a separate step — it's not; auth is inline in `connect`
- ❌ Doesn't wait for `connect.challenge`
- ❌ Doesn't honor `tickIntervalMs` for keepalive
- ❌ No request/response correlation by `id`

`web/src/watchers/openclawTranslator.ts`:
- ❌ Assumes Anthropic-style `content: [{type:"text"|"tool_use"|"tool_result", ...}]` blocks — gateway returns its own normalized shape
- ❌ Fixtures in `web/__fixtures__/openclaw/*.json` are all guessed; must be regenerated from live `chat.history` + `session.message` captures

`web/src/watchers/registry.ts`, `web/src/watchers/types.ts`:
- ✅ OK — protocol-independent

## 8. Testing strategy

- **Unit tests**: mock WebSocket server (e.g., `ws` package's `Server`) that emits real frame shapes — challenge, hello-ok, session.message events. Assert client sends correct envelope shapes.
- **Live capture for fixtures**: NOT NEEDED. Fixtures are synthesized from protocol-schema shape with anonymous IDs (project is open source — no real user data may enter the repo). Developer may ad-hoc dump real payloads locally for spot-checking shape, but those captures stay outside the repo.
- **End-to-end**: B-v3-4. Run `pixel-kosmos --openclaw-url ws://127.0.0.1:18789 --openclaw-token <token>` against the live tunnel and verify pixel characters animate from real session activity.
