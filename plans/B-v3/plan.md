# B-v3 Implementation Plan — Re-implement OpenClawWatcher

Companion to `plans/B-v3/spec.md`. Decomposes the rewrite into 4 sub-tasks, one per Multica issue.

---

## B-v3-1 — Rewrite handshake + framing (`openclawGateway.ts`)

**Files touched:**
- `web/src/watchers/openclawGateway.ts` (full rewrite)
- `web/src/watchers/openclawGateway.test.ts` (full rewrite — mock WS server)
- `web/src/watchers/types.ts` (minor: ensure `ConnectParams` type matches spec §3)

**Deliverables:**
1. `OpenClawGateway` class with public API:
   - `constructor(opts: { url: string; token: string; clientId?: string; instanceId?: string })`
   - `async connect(): Promise<HelloOk>` — opens WS, waits for `connect.challenge`, sends `connect` req, returns parsed `hello-ok` payload. Throws `OpenClawAuthError` on auth failures.
   - `async request<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>` — sends `req`, awaits matching `res` by `id`, returns `payload` or throws.
   - `on(event: string, handler: (payload: unknown) => void): () => void` — subscribe to `event` frames; returns unsubscribe.
   - `close(code?: number, reason?: string): void`
2. Request/response correlation by `id` (UUID or monotonic counter).
3. Tick keepalive: track last frame received; if `Date.now() - lastFrameAt > policy.tickIntervalMs * 2`, close with code 4000 and signal reconnect.
4. Reconnect with exponential backoff (1s → 30s, jitter). Stop reconnect loop on `AUTH_TOKEN_MISMATCH` or `recommendedNextStep` ∈ {`update_auth_*`, `review_auth_configuration`}.
5. Constants in module top (PROTOCOL_VERSION=3, REQUEST_TIMEOUT_MS=30000, CONNECT_CHALLENGE_TIMEOUT_MS=10000, INITIAL_BACKOFF_MS=1000, MAX_BACKOFF_MS=30000).

**Acceptance criteria:**
- `cd web && npm test -- openclawGateway` passes (≥10 unit tests covering: challenge wait, connect req shape, hello-ok parse, request/response by id, error response, event dispatch, tick timeout, reconnect, auth error stops loop, close).
- Mock WS server in tests asserts the EXACT frame shapes from spec §3 (no `call` type, no separate `connect.auth`).
- `npx tsgo --noEmit` clean.

**Reference:** `/tmp/openclaw-src/scripts/dev/gateway-smoke.ts` is the golden client.

---

## B-v3-2 — Subscribe + event handling (`openclawWatcher.ts`)

**Depends on:** B-v3-1 done.

**Files touched:**
- `web/src/watchers/openclawWatcher.ts` (full rewrite)
- `web/src/watchers/openclawWatcher.test.ts` (full rewrite)

**Deliverables:**
1. `OpenClawWatcher` implements existing `Watcher` interface in `web/src/watchers/types.ts`.
2. On start:
   - `await gateway.connect()`
   - `await gateway.request("health")` — sanity
   - `await gateway.request("sessions.subscribe")` — get sessions.changed events
   - `const sessions = await gateway.request("sessions.list")`
   - For each session: `await gateway.request("sessions.messages.subscribe", { sessionKey })`
3. Wire event handlers:
   - `gateway.on("session.message", payload => translator.handleMessage(payload))`
   - `gateway.on("sessions.changed", () => this.refreshSessions())` — diff and subscribe to new sessions, unsubscribe from removed ones
   - `gateway.on("tick", () => {})` — already handled by gateway internally
4. On stop: unsubscribe all + `gateway.close()`.
5. Reconnect: gateway handles transport-level reconnect; watcher must re-subscribe on `hello-ok` (gateway emits a `reconnected` event on its own EventEmitter).

**Acceptance criteria:**
- `cd web && npm test -- openclawWatcher` passes (≥6 tests: full subscribe sequence, sessions.changed diff handling, re-subscribe on reconnect, stop unsubscribes, error from sessions.list propagates, missing session unsubscribe).
- Tests use a stubbed gateway (don't depend on B-v3-1 internals) — inject via constructor.

---

## B-v3-3 — Translator rewrite with REAL fixtures (`openclawTranslator.ts`)

**Depends on:** Live capture done by June (see §Live Capture below).

**Files touched:**
- `web/src/watchers/openclawTranslator.ts` (full rewrite)
- `web/src/watchers/openclawTranslator.test.ts` (full rewrite)
- `web/__fixtures__/openclaw/*.json` (DELETE all 5 existing files, replace with captures)
- `web/__fixtures__/openclaw/README.md` (document where each capture came from)

**Deliverables:**
1. Translator function: `translateSessionMessage(payload: SessionMessageEvent): PixelMessage | null` — return `null` for messages we should skip (system/silent rows).
2. Read real schema from `/tmp/openclaw-src/src/gateway/protocol/schema/sessions.ts` to get authoritative `SessionMessageEvent` type. Mirror it in our types.
3. Map message roles: `user` / `assistant` / `tool` / `system` to our existing `PixelMessage` shape.
4. Handle the display-normalization the server already does: don't re-strip `<tool_call>` etc.

**Live Capture (prerequisite, June does this manually):**
1. Establish tunnel: `ssh -L 18799:127.0.0.1:18789 -N korea-vm` (background)
2. Run `web/scripts/capture-openclaw.ts` (NEW small script — write as part of this issue) that:
   - Connects via the new B-v3-1 gateway
   - Calls `chat.history` for each active session, dumps to `web/__fixtures__/openclaw/chat-history-<sessionKey>.json`
   - Subscribes to `sessions.messages.subscribe`, captures next 10 events to `web/__fixtures__/openclaw/event-<n>.json`
3. Sanitize captures (redact secrets/PII) and commit.

**Acceptance criteria:**
- `cd web && npm test -- openclawTranslator` passes (≥1 test per fixture, asserting `PixelMessage` shape).
- All fixtures are real captures, not synthesized.
- README.md in fixtures dir documents capture source + sanitization.

---

## B-v3-4 — End-to-end verification (June only — no code)

**Depends on:** B-v3-1, B-v3-2, B-v3-3 all merged.

**Files touched:** `plans/B-v3/verify.md` (new — capture results)

**Deliverables:**
1. June establishes SSH tunnel to korea-vm.
2. `cd web && npm run build && npm pack` — produces `pixel-kosmos-1.x.x.tgz`.
3. Install: `npm i -g ./pixel-kosmos-1.x.x.tgz`.
4. Run: `pixel-kosmos --openclaw-url ws://127.0.0.1:18799 --openclaw-token "1q23l*yc45j*" --kosmos-dir ""` (suppress kosmos source).
5. Open browser, verify pixel characters render and animate based on live OpenClaw session activity.
6. Test reconnect: kill SSH tunnel for 30s, restore, verify watcher reconnects.
7. Test auth failure: run with wrong token, verify clear error message and no infinite reconnect loop.

**Acceptance criteria:**
- All 7 verification steps documented in `plans/B-v3/verify.md` with screenshots and notes.
- Issue closed only by June after manual verification.

---

## Sequencing

- B-v3-1 → B-v3-2 (sequential — watcher depends on gateway)
- B-v3-3 can start in parallel with B-v3-2 once June captures fixtures
- B-v3-4 last (waits on all 3)

## Open questions for implementer

- Exact `SessionMessageEvent` type — extract from `protocol/schema/sessions.ts` at implementation time
- Whether `sessions.list` returns paginated or full index — read schema
- Whether we need `chat.history` at all for the watcher (might just consume `session.message` events going forward) — decision in B-v3-2
