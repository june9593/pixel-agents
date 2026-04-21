## What OpenClaw is

OpenClaw (`package.json` name: `openclaw`, v2026.x) is a local-first personal AI assistant gateway written in TypeScript/Node.js (≥22.14). It runs as a long-lived daemon on the user's machine and bridges any number of messaging channels (WhatsApp, Telegram, Discord, Slack, Signal, iMessage, IRC, and 20+ others) to one or more AI agents. The gateway is the single control plane: it manages agent sessions, routes inbound messages to the right agent, handles tool execution, optional Docker sandboxing, and fan-out delivery of responses back to the originating channel. Everything is npm-installable (`npm install -g openclaw`) and controlled via the `openclaw` CLI.

## Agent runtime (sub-agent spawning, ACP details)

OpenClaw supports two sub-agent runtimes:

**ACP (Agent Client Protocol)** — the primary inter-agent mechanism. Uses `@agentclientprotocol/sdk` v0.19.0 (`package.json` dep). Sub-agents are created by calling `spawnAcpDirect()` in `src/agents/acp-spawn.ts`. The process:

1. A unique session key is minted: `agent:<agentId>:acp:<uuid>` (`acp-spawn.ts:1022`).
2. `callGateway({ method: "sessions.patch", ... })` registers the session in the gateway store.
3. `initializeAcpSpawnRuntime()` → `getAcpSessionManager().initializeSession()` connects to the configured ACP backend (`cfg.acp.backend`) via `src/acp/control-plane/manager.ts`. The manager returns a runtime `handle` + `close()` method.
4. The task is dispatched via `callGateway({ method: "agent", ... })` which enqueues a run.

Two spawn modes (`src/agents/acp-spawn.ts:82`): `run` (oneshot — session closes when task ends) and `session` (persistent — session stays alive for follow-ups, requires `thread=true` so it stays bound to a messaging thread). ACP sessions run on the host; sandboxed sessions cannot spawn them.

The ACP control plane manages sessions in `src/acp/control-plane/manager.ts` and caches runtime state in `src/acp/control-plane/runtime-cache.ts`. Session identity, metadata, and per-session actor queues live in `src/acp/control-plane/`.

**CLI backends** — an alternative runtime where the agent is a CLI process (Claude Code, Codex, Gemini CLI). Defined in `src/agents/cli-backends.ts` / `src/plugins/cli-backends.runtime.ts`.

## Process model (CLI invocation, IPC, stdout/stderr)

The `openclaw` bin is `openclaw.mjs` (ESM). Scripts under `scripts/` drive it: `run-node.mjs` for direct invocation and `watch-node.mjs` for the dev loop (rebuilds on change).

Key process modes:
- **Gateway daemon**: `openclaw gateway --port 18789` — long-lived HTTP+WebSocket server. Installed as a launchd/systemd user service via `--install-daemon`.
- **Agent (interactive)**: `openclaw agent --message "..."` — sends a task to the gateway and streams the response.
- **RPC mode**: `openclaw agent --mode rpc --json` (also `pnpm openclaw:rpc`) — JSON-lines on stdout, used programmatically (e.g. by pixel-agents or other callers). Stderr gets log output.
- **Onboarding**: `openclaw onboard` — interactive setup wizard.

IPC between Gateway and callers is handled by `src/gateway/call.ts` (`callGateway()`), which communicates over a local socket/HTTP endpoint. Companion apps (macOS menu bar, iOS/Android nodes) connect over the Gateway WebSocket protocol defined in `dist/protocol.schema.json`.

## Transcript / state output (JSONL, location, format)

Each agent session's conversation is persisted as a **JSONL transcript file** managed by `SessionManager` from `@mariozechner/pi-coding-agent`.

**Location** (`src/config/sessions/paths.ts`):
```
~/.openclaw/state/agents/<agentId>/sessions/<sessionId>.jsonl
~/.openclaw/state/agents/<agentId>/sessions/sessions.json   ← session store (key→entry map)
```
The store path is resolved by `resolveDefaultSessionStorePath(agentId)` (`paths.ts:34`). The session store JSON maps session keys (e.g. `agent:main:acp:<uuid>`) to `SessionEntry` objects containing `sessionId`, `sessionFile`, and delivery metadata.

**Transcript JSONL format** (`src/config/sessions/transcript.ts`):
- Line 1 — session header:
  ```json
  {"type":"session","version":<n>,"id":"<uuid>","timestamp":"<ISO>","cwd":"/path"}
  ```
- Subsequent lines — message records, appended by `SessionManager.appendMessage()`:
  ```json
  {"id":"<msgId>","message":{"role":"assistant","content":[...],"api":"openai-responses","provider":"<name>","model":"<id>","usage":{...},"stopReason":"stop","timestamp":<ms>}}
  ```
  Fields: `role` (assistant/user), `content` (array of `{type, text}` blocks), `api`, `provider`, `model`, `usage` (token counts + cost), `stopReason`, `timestamp` (epoch ms). Optional `idempotencyKey` for dedup.

Transcript writes are coordinated by `appendExactAssistantMessageToSessionTranscript()` / `appendAssistantMessageToSessionTranscript()` in `src/config/sessions/transcript.ts`. After each write, `emitSessionTranscriptUpdate()` (`src/sessions/transcript-events.ts`) fires so consumers (e.g. ACP streaming relay in `src/agents/acp-spawn-parent-stream.ts`) can react to new content.
