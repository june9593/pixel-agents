# Plan B — Adapter Design

## Interface

```typescript
// src/agentAdapter.ts

/** Events emitted by any adapter — map 1:1 to existing webview messages */
export type AgentEvent =
  | { type: 'toolStart';   toolId: string; toolName: string; isSubagent: boolean }
  | { type: 'toolDone';    toolId: string; delayed?: boolean }
  | { type: 'turnEnd' }
  | { type: 'waiting' }       // permission bubble
  | { type: 'bashProgress' }  // long-running tool still alive → restart timer
  | { type: 'subagentCreated'; subId: string; parentId: string }
  | { type: 'subagentClosed';  subId: string }

export interface AgentAdapter {
  /** Unique agent key (session UUID for Claude, agentId for OpenClaw) */
  readonly agentId: string

  /** Start watching — returns a disposable */
  start(onEvent: (e: AgentEvent) => void): Disposable

  /** Called when the agent's terminal / session is closed */
  dispose(): void
}

export interface AgentAdapterFactory {
  /** Return null if this factory doesn't handle the given source */
  create(state: PersistedAgent): AgentAdapter | null
}

interface Disposable { dispose(): void }
```

`agentManager.ts` holds an `AgentAdapter | null` per agent and calls `start()` right after the agent is registered. All event handling currently inlined in `fileWatcher.ts` + `transcriptParser.ts` moves into the Claude adapter.

---

## Claude Adapter

**File**: `src/claudeAdapter.ts`  
**Wraps**: existing `fileWatcher.ts` + `transcriptParser.ts` logic — no behaviour change.

```typescript
export class ClaudeAdapter implements AgentAdapter {
  readonly agentId: string          // session UUID
  private watcher: ReturnType<typeof startFileWatch> | null = null

  constructor(private state: PersistedAgent) {
    this.agentId = state.id
  }

  start(onEvent: (e: AgentEvent) => void): Disposable {
    // resolveJsonlPath(): ~/.claude/projects/<hash>/<uuid>.jsonl
    // startFileWatch() polls until file exists, then watches + parses
    // JSONL record → AgentEvent translation stays exactly as today
    this.watcher = startFileWatch(this.state, onEvent)
    return { dispose: () => this.dispose() }
  }

  dispose() { this.watcher?.stop() }
}

export class ClaudeAdapterFactory implements AgentAdapterFactory {
  create(state: PersistedAgent) {
    return state.source === 'claude' ? new ClaudeAdapter(state) : null
  }
}
```

Translation table (unchanged from today):

| JSONL record | AgentEvent |
|---|---|
| `assistant { tool_use }` | `toolStart` |
| `user { tool_result }` | `toolDone` (300ms delay) |
| `system { turn_duration }` | `turnEnd` |
| `progress { bash_progress }` | `bashProgress` |
| 5s text-only silence | `waiting` |
| `progress { agent_progress }` | `subagentCreated` / `toolStart` |

---

## OpenClaw Adapter

**File**: `src/openclawAdapter.ts`  
**Primary source**: ACP event stream (`openclaw acp` bridge per session).  
**Discovery**: Gateway RPC on port 18789 (`sessions.list`, `session_created`/`session_closed`).

```typescript
export class OpenClawAdapter implements AgentAdapter {
  readonly agentId: string          // OpenClaw agentId
  private sessionId: string
  private acpClient: AcpClient | null = null

  constructor(private state: PersistedAgent) {
    this.agentId  = state.openclawAgentId!
    this.sessionId = state.openclawSessionId!
  }

  start(onEvent: (e: AgentEvent) => void): Disposable {
    // 1. Connect to ACP socket for this (agentId, sessionId) pair
    // 2. Map ACP events → AgentEvent:
    //      tool_use_start → toolStart
    //      tool_use_end   → toolDone
    //      turn_end       → turnEnd
    //      session_end    → dispose (caller removes character)
    //      (no bash_progress equivalent — omit for now)
    this.acpClient = connectAcp(this.agentId, this.sessionId, onEvent)
    return { dispose: () => this.dispose() }
  }

  dispose() { this.acpClient?.close() }
}

export class OpenClawAdapterFactory implements AgentAdapterFactory {
  create(state: PersistedAgent) {
    return state.source === 'openclaw' ? new OpenClawAdapter(state) : null
  }
}
```

**Session discovery** lives in a new `openclawGateway.ts`:
- On extension activate (if OpenClaw detected): call `sessions.list` → create agents for each running session.
- Subscribe to `session_created` / `session_closed` → `agentManager.createAgent()` / `removeAgent()`.
- `PersistedAgent` gains optional `openclawAgentId?: string` and `openclawSessionId?: string`.

Sub-agents: OpenClaw sub-agents get their own sessions. Gateway `session_created` with a `parentAgentId` field → `subagentCreated` event to parent.

---

## Migration Path

### Phase 1 — Abstract (no behaviour change)
1. Add `src/agentAdapter.ts` with the `AgentAdapter` / `AgentAdapterFactory` / `AgentEvent` types.
2. Add `source: 'claude' | 'openclaw'` to `PersistedAgent` (default `'claude'`).
3. Create `src/claudeAdapter.ts`: move file-watch + parse logic from `fileWatcher.ts` + `transcriptParser.ts` into `ClaudeAdapter.start()`. Keep old files as thin re-exports during transition.
4. `agentManager.ts`: store `adapter: AgentAdapter | null` per agent; call `adapter.start()` on create, `adapter.dispose()` on close.
5. All tests pass; no webview changes.

### Phase 2 — Port Claude (delete old files)
1. Remove `fileWatcher.ts` and `transcriptParser.ts` (logic now in `ClaudeAdapter`).
2. Wire `ClaudeAdapterFactory` through an `adapterFactories: AgentAdapterFactory[]` array in `agentManager.ts` — first factory that returns non-null wins.
3. Ship; Claude behaviour unchanged.

### Phase 3 — Add OpenClaw
1. Add `openclawGateway.ts` (Gateway RPC client for session discovery).
2. Add `openclawAdapter.ts` (`OpenClawAdapter` + `OpenClawAdapterFactory`).
3. On extension activate: detect OpenClaw (check `~/.openclaw/` or gateway ping); if present, register `OpenClawAdapterFactory`.
4. Extend `PersistedAgent` with `openclawAgentId?` / `openclawSessionId?`.
5. `BottomToolbar` gains an "+ OpenClaw Agent" button (or auto-spawns when gateway reports a new session).
6. No webview message protocol changes needed.
