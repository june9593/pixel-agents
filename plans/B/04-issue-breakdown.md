# Plan B v3 — OpenClaw Support via Gateway WebSocket

> **Major revision**: Original plan assumed a custom RPC/file-watcher approach. After inspecting `~/tmp_openclaw/` and `~/tmp_star_office/`, the right answer is to use **OpenClaw's Gateway WebSocket protocol** directly. This gives us:
>
> - **Remote-friendly by design** (Tailscale Serve / SSH tunnel — pixel-agents on laptop, OpenClaw on cloud)
> - **Tool-level granularity preserved** (no degradation to 8 coarse states like Star-Office-UI)
> - **Zero intrusion into OpenClaw agent prompts** (no SOUL.md edits required)
> - **Typed protocol** (`src/gateway/protocol/schema/sessions.ts`), versioned and stable
>
> Reference repo `ringhyacinth/Star-Office-UI` does it via a polled `state.json` file written by the OpenClaw agent on each task — works for a desktop-pet but loses tool-level animation and forces agent prompt changes.

## Verified facts (from `~/tmp_openclaw/`)

| Fact | Source |
|---|---|
| Default port | `18789` | `docs/gateway/remote.md` |
| Transport | WebSocket, JSON frames | `docs/gateway/protocol.md` |
| Handshake method | `connect` with `role: "operator"`, `scopes: ["operator.read"]`, `auth.token` | `docs/gateway/protocol.md` |
| List sessions | `sessions.list` | `docs/gateway/protocol.md:360` |
| Subscribe to session lifecycle | `sessions.subscribe` → `sessions.changed` event | `docs/gateway/protocol.md:361`, `src/gateway/server-session-events.ts` |
| Subscribe to per-session messages | `sessions.messages.subscribe` → `session.message` event | `docs/gateway/protocol.md:363`, `src/gateway/session-message-events.test.ts` |
| `session.message` payload shape | `{ sessionKey, message, messageId?, messageSeq?, ...sessionSnapshot }`. `message` = transcript message (contains `tool_use` etc., wrapped via `attachOpenClawTranscriptMeta`). | `src/gateway/server-session-events.ts:111-127` |
| Auth modes | `none / token / password / trusted-proxy`; env `OPENCLAW_GATEWAY_TOKEN` | `docs/gateway/tailscale.md` |
| Remote access | SSH tunnel forwards `127.0.0.1:18789`; Tailscale Serve gives HTTPS + identity headers | `docs/gateway/remote.md` |

## Open questions to resolve during implementation

1. **Exact `message` payload schema** — Claude JSONL has `tool_use / tool_result / system{subtype:"turn_duration"}`. Need one real `session.message` capture to confirm OpenClaw uses identical or wrapped shape. Approach: spin up OpenClaw locally, run a session, log first 3-5 events.
2. **`bash_progress` / `mcp_progress` equivalents** — pixel-agents uses these to restart permission timers. May not exist in OpenClaw; if so, fall back to plain `tool_use` only.
3. **Per-session `displayName`** — Does `sessions.list` return a human label? If not, derive from `agentId` or `channelId`.

These are flagged as `// TODO: verify against live gateway` in code, not blockers.

---

## Issue list (PR-sized, in merge order)

### 1. Adapter abstraction types + `PersistedAgent` extension

Introduce `src/agentAdapter.ts` with the shared interface; extend `PersistedAgent` with a `source` discriminator.

**Scope**: Add `AgentEvent`, `AgentAdapter`, `AgentAdapterFactory`, and `Disposable` types to `src/agentAdapter.ts` (no implementations). Add `source: 'claude' | 'openclaw'` (default `'claude'`) plus optional `openclawSessionKey?: string` to `PersistedAgent` in `src/types.ts`. No behaviour change; pure type scaffolding.

**Files**: `src/agentAdapter.ts` (new), `src/types.ts`

**Acceptance**:
- [ ] `npx tsc --noEmit -p tsconfig.json` passes
- [ ] `PersistedAgent` round-trips through `workspaceState`; existing agents without `source` field default to `'claude'`
- [ ] No runtime code changed

---

### 2. Claude adapter — wrap existing file-watch + parse logic

Move `fileWatcher.ts` + `transcriptParser.ts` logic into `ClaudeAdapter` implementing `AgentAdapter`.

**Scope**: Create `src/claudeAdapter.ts` with `ClaudeAdapter` and `ClaudeAdapterFactory`. `ClaudeAdapter.start()` calls existing `startFileWatch()` / `transcriptParser` and translates outputs to `AgentEvent`. Keep `fileWatcher.ts` and `transcriptParser.ts` intact as internal helpers (do not delete yet). Wire `agentManager.ts` to store `adapter: AgentAdapter | null` per agent, calling `adapter.start()` on create and `adapter.dispose()` on close.

**Depends on**: #1.
**Note**: If Plan A's refactors (#8 colorize dedup, #9 wall bitmask) have landed, rebase on top; no conflicts expected.

**Files**: `src/claudeAdapter.ts` (new), `src/agentManager.ts`

**Acceptance**:
- [ ] `npx tsc --noEmit` passes
- [ ] Smoke-test: new Claude agent spawns, animates tools, idles — identical to pre-refactor
- [ ] No webview message changes

---

### 3. Delete old file-watch/parse files; wire factory array

Remove `fileWatcher.ts` and `transcriptParser.ts`; route agent creation through an `adapterFactories` array.

**Scope**: Delete `src/fileWatcher.ts` and `src/transcriptParser.ts`. Replace direct `ClaudeAdapter` instantiation in `agentManager.ts` with an `adapterFactories: AgentAdapterFactory[]` array — first factory returning non-null wins. Register `ClaudeAdapterFactory` as the sole entry. Claude behaviour unchanged.

**Depends on**: #2.

**Files**: `src/fileWatcher.ts` (deleted), `src/transcriptParser.ts` (deleted), `src/agentManager.ts`

**Acceptance**:
- [ ] `npx tsc --noEmit` passes; no dead imports
- [ ] `npm run build` passes
- [ ] Existing Claude flow unchanged (smoke-test in Extension Dev Host)

---

### 4. Gateway WS client + VS Code settings

Add `src/openclawGateway.ts` with a typed WebSocket client that handles connect/handshake/auth and exposes typed RPC + event subscription helpers. No agent rendering yet.

**Scope**: Implement `OpenClawGatewayClient` class:
- Connect to `ws://<host>:<port>` (default `localhost:18789`).
- Send `connect` request frame with `role: "operator"`, `scopes: ["operator.read"]`, `auth.token` from settings.
- Validate `hello-ok` response; surface `connect.error` details to UI.
- Generic `request(method, params)` returning typed `res` payload.
- Generic `subscribe(event, handler)` registering for server-pushed `event` frames.
- Auto-reconnect with backoff; emit `connectionStateChanged` events.
- Typed wrappers: `listSessions()`, `subscribeSessions()`, `subscribeSessionMessages(sessionKey)`.

Add VS Code settings:
- `pixelAgents.openclaw.gatewayUrl` (string, default empty = disabled)
- `pixelAgents.openclaw.token` (string, secret)
- `pixelAgents.openclaw.enabled` (boolean, default false)

Add to `src/constants.ts`: `OPENCLAW_DEFAULT_PORT = 18789`, `OPENCLAW_RECONNECT_INITIAL_MS`, `OPENCLAW_RECONNECT_MAX_MS`.

**Depends on**: #1 (for shared types only).

**Files**: `src/openclawGateway.ts` (new), `src/constants.ts`, `package.json` (settings contribution + `ws` dep)

**Acceptance**:
- [ ] With a running OpenClaw gateway (local or via SSH tunnel): `connect` succeeds, `listSessions()` returns array
- [ ] With wrong token: `connect.error` surfaced as VS Code error notification with actionable message
- [ ] With unreachable host: reconnect loop fires; status visible in extension log
- [ ] `npx tsc --noEmit` passes

---

### 5. Schema sniffing + `session.message` → `AgentEvent` mapping

Capture real `session.message` payloads and write the parser that converts them to pixel-agents events.

**Scope**:
1. Run a 5-minute manual capture: connect, subscribe, dump first 20 events to `~/.pixel-agents/openclaw-capture.jsonl` for offline analysis.
2. Document observed shape in `src/openclawTranscriptParser.ts` header comment.
3. Implement `parseOpenClawMessage(message): AgentEvent[]` mapping:
   - `tool_use` start → `toolStart`
   - `tool_use` result → `toolDone`
   - turn-end signal (likely `turn_duration` or equivalent) → `turnEnd`
   - thinking/text → ignored (matches Claude behaviour)
4. Unit-test with captured fixtures committed to `src/__fixtures__/openclaw-events.jsonl`.

**Depends on**: #4 (gateway client to capture with).

**Files**: `src/openclawTranscriptParser.ts` (new), `src/__fixtures__/openclaw-events.jsonl` (new), `src/openclawTranscriptParser.test.ts` (new)

**Acceptance**:
- [ ] Captured fixture committed; parser produces expected `AgentEvent[]`
- [ ] Unit tests pass for tool_use start/done and turn-end
- [ ] Header comment documents which fields are required vs optional
- [ ] `npx tsc --noEmit` passes

---

### 6. OpenClaw adapter + factory registration

Add `OpenClawAdapter` and register the factory in the `agentManager.ts` array.

**Scope**: Implement `OpenClawAdapter` and `OpenClawAdapterFactory` in `src/openclawAdapter.ts`:
- On `start()`: receive `(sessionKey, gatewayClient)` and call `gatewayClient.subscribeSessionMessages(sessionKey, parseOpenClawMessage → emit AgentEvent)`.
- On `dispose()`: unsubscribe.

Wire `agentManager.ts`:
- On extension activate, if `pixelAgents.openclaw.enabled`, instantiate one shared `OpenClawGatewayClient`.
- On `sessions.changed` event with `phase: "started"`: create agent record with `source: 'openclaw'`, `openclawSessionKey`, instantiate `OpenClawAdapter`.
- On `sessions.changed` with `phase: "ended"`: dispose adapter, despawn character.
- Register `OpenClawAdapterFactory` after `ClaudeAdapterFactory` in factory array.

**Depends on**: #4 + #5.

**Files**: `src/openclawAdapter.ts` (new), `src/agentManager.ts`, `src/extension.ts`

**Acceptance**:
- [ ] With OpenClaw running and a live session: character spawns, tool animations fire on `session.message` events, idles on turn end
- [ ] Session end removes character (despawn effect)
- [ ] Claude agents unaffected
- [ ] `npx tsc --noEmit` passes

---

### 7. UI: connection status + "+ OpenClaw" button + source labels

Surface the gateway connection state and let users explicitly bind characters to OpenClaw sessions.

**Scope**:
1. Send `openclawState` message from extension → webview: `{ enabled, connected, sessionCount }`.
2. In `BottomToolbar.tsx`: show a small status pill ("OpenClaw: 3 sessions" / "OpenClaw: connecting..." / hidden when disabled). Clicking it opens a list of unbound sessions to manually adopt as characters.
3. In `ToolOverlay.tsx`: append a small "openclaw" badge for OpenClaw-source agents to distinguish from Claude.
4. Settings modal: add a "Configure OpenClaw" button that opens VS Code settings filtered to `pixelAgents.openclaw.*`.

**Depends on**: #6.

**Files**: `webview-ui/src/components/BottomToolbar.tsx`, `webview-ui/src/office/components/ToolOverlay.tsx`, `webview-ui/src/components/SettingsModal.tsx`, `webview-ui/src/hooks/useExtensionMessages.ts`, `src/PixelAgentsViewProvider.ts`

**Acceptance**:
- [ ] Status pill reflects real connection state
- [ ] No UI changes when `pixelAgents.openclaw.enabled = false`
- [ ] Source badge clearly distinguishes Claude vs OpenClaw agents
- [ ] `npx tsc --noEmit -p webview-ui/tsconfig.app.json` passes

---

### 8. Docs — three deployment modes

Add a "OpenClaw Integration" section to `README.md` covering local, SSH tunnel, and Tailscale Serve setups.

**Scope**: Document:
- Prerequisites (`openclaw` ≥ vX.Y, gateway running with `gateway.auth.mode: token` recommended)
- **Mode 1 — same machine**: set `pixelAgents.openclaw.gatewayUrl = ws://localhost:18789` + token
- **Mode 2 — remote via SSH tunnel**: `ssh -N -L 18789:localhost:18789 user@host`, point pixel-agents at `ws://localhost:18789`
- **Mode 3 — Tailscale Serve**: enable `tailscale.mode: serve` on gateway side, point pixel-agents at `wss://gateway.tailnet.ts.net`
- Troubleshooting: connect.error codes, where to find token (`~/.openclaw/auth/...`)
- Known limitations from #5 schema sniffing (e.g., no `bash_progress` equivalent if confirmed)

**Depends on**: #7 (feature complete).

**Files**: `README.md`

**Acceptance**:
- [ ] All three modes documented with verified command snippets
- [ ] At least one team member follows docs end-to-end and connects successfully (manual sign-off)
