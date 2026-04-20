# Plan B — Epic Acceptance Criteria & Manual Test Scenarios

## Epic Acceptance Criteria

### Functional
- [ ] OpenClaw sessions auto-appear as characters when the gateway is running on port 18789
- [ ] Characters animate with correct tool states (typing/reading) driven by ACP events
- [ ] Characters idle and despawn cleanly on `turn_end` / `session_end`
- [ ] Extension activates normally (no crash, no delay) when gateway is absent
- [ ] Existing Claude agent behaviour is byte-for-byte identical to pre-Plan-B main
- [ ] Layout, seats, and persistence work identically for OpenClaw agents

### Non-functional
- [ ] `npm run build` passes clean (type-check + lint + esbuild + vite)
- [ ] No new inline magic numbers — constants in `src/constants.ts`
- [ ] `PersistedAgent` round-trips through `workspaceState` without data loss

---

## Manual Test Scenarios

### A. No gateway running (baseline regression)

1. Ensure no process is listening on port 18789.
2. Open VS Code with pixel-agents installed; activate the panel.
3. **Expect**: Panel loads, no errors in Output channel, no "+ OpenClaw" button visible.
4. Spawn a Claude agent via "+ Agent".
5. Run a tool (e.g. `ls`) in the terminal.
6. **Expect**: Character animates (typing), returns to idle — identical to pre-Plan-B.

---

### B. Gateway running, session already active at startup

1. Start OpenClaw gateway (`openclaw gateway`).
2. Start an OpenClaw session so at least one session is live.
3. Open VS Code / reload the extension.
4. **Expect**: OpenClaw character appears automatically (matrix spawn effect).
5. **Expect**: "+ OpenClaw" button visible in bottom toolbar.
6. Check ToolOverlay on hover: label includes `"openclaw"` suffix.

---

### C. Trigger tool — see status update

1. With an OpenClaw session character visible (from Scenario B):
2. In the OpenClaw session, start a long-running tool (e.g. a bash command).
3. **Expect**: Character switches to typing/reading animation matching the tool type.
4. **Expect**: ToolOverlay shows the tool name above the character.
5. Wait for the tool to finish.
6. **Expect**: Character returns to idle; ToolOverlay clears.

---

### D. Session ends — character despawns

1. With character visible, end the OpenClaw session (Ctrl+C / session timeout).
2. **Expect**: Character plays matrix despawn animation and is removed from the canvas.
3. **Expect**: No crash or dangling state in the Output channel.

---

### E. "+ OpenClaw" button — no new sessions

1. All current OpenClaw sessions already have characters on screen.
2. Click "+ OpenClaw".
3. **Expect**: No crash; tooltip or no-op (no duplicate characters).

---

### F. New session starts after extension loads

1. Extension already loaded, no OpenClaw sessions running.
2. Start a new OpenClaw session.
3. **Expect**: Gateway WebSocket event triggers character spawn within ~1s.
