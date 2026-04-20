# Pixel-Agents Planning Brief — Apr 2026

The user (june9593, fork at https://github.com/june9593/pixel-agents) wants to revive
this project. Two epic-sized features will be planned separately:

- **Epic A**: Rebase + re-apply Kosmos work + refactor (issues #1.x-#3.x)
- **Epic B**: OpenClaw agent visualization support (issues #4.x)

Project root assumption: this repo at ~/code/pixel-agents (you are running here).
Upstream: https://github.com/pablodelucca/pixel-agents (already added as `upstream` remote).
User fork: https://github.com/june9593/pixel-agents (`origin`).

---

## 1. Repo state (verified `git log` Apr 20, 2026)

- `origin/main` — IDENTICAL to one of upstream's older commits (no fork-only commits).
  Last commit: `13d2c17 Add getting started guidance and tweak office assets wording`.
- `origin/pixel-kosmos-game` — **THIS IS THE BRANCH** with the user's Kosmos work.
  - 38 commits ahead of upstream/main.
  - Big diff: ~1186 files changed, mostly furniture PNG additions + ~30 webview-ui TS/TSX files modified.
  - Key new files visible in diff: `webview-ui/src/components/GameHud.tsx` (316 lines new),
    `webview-ui/src/i18n.ts` (147 lines new), `webview-ui/src/components/AgentLabels.tsx`.
  - Major commits include: i18n zh/en, npm packaging as `pixel-kosmos`, V1/V2 web versions for kosmos-app,
    game interaction system (coins, actions, profiles, achievements), zone visits, idle interactions,
    agent name labels, status bubbles, cross-platform Windows/Linux fixes.
- `origin/pixel-kosmos`, `origin/pixel-kosmos-life` — older Kosmos branches, less complete.
- Upstream is **30+ commits ahead** of where the fork branched. Notable upstream features the fork is missing:
  - `feat: add Agent Teams visualization (#218)`
  - `feat: hooks-first session management with dual-mode architecture (#214)`
  - `feat: claude code hooks for instant agent status detection (#187)`
  - `refactor: migrate webview-ui to Tailwind CSS v4 (#204)`
  - `feat: add support for external asset packs 🎨 (#169)`
  - `feat: load custom characters from assets directory (#208)`
  - `feat: preview pixel agents in web browser (#143)`

## 2. Existing architecture (from repo CLAUDE.md)

VS Code extension + React webview. Current Claude observability:
- **JSONL transcript tail**: `~/.claude/projects/<project-hash>/<session-id>.jsonl`
- Hybrid `fs.watch` + 2s polling, partial-line buffering
- Record types: `assistant` (tool_use), `user` (tool_result), `system{subtype:turn_duration}`,
  `progress{type:agent_progress|bash_progress|mcp_progress}`
- Per-agent state: `id, terminalRef, projectDir, jsonlFile, fileOffset, lineBuffer,
  activeToolIds, activeToolStatuses, activeSubagentToolNames, isWaiting`
- Backend modules: `fileWatcher.ts` (watching), `transcriptParser.ts` (JSONL→messages),
  `agentManager.ts` (terminal lifecycle), `timerManager.ts` (waiting/permission timers)

The Kosmos branch already added significant webview gameplay layers
(GameHud, idle interactions, zones, mood, coins) and i18n. The Kosmos backend
adapter is presumably also there but should be inspected by you.

## 3. OpenClaw — verified Apr 20, 2026

**OpenClaw is real** — https://github.com/openclaw/openclaw — TypeScript "personal AI assistant"
gateway. Cloned and inspected at `~/tmp_openclaw`. Key facts:

- **Install**: `npm install -g openclaw@latest && openclaw onboard --install-daemon`
- **Architecture**: Gateway daemon (launchd/systemd) + plugin/extension system + channel adapters
  (WhatsApp, Telegram, Slack, Discord, iMessage, ...) + provider adapters
- **Agent runtime**: Uses `@mariozechner/pi-coding-agent` (the "Pi" embedded coding agent)
- **Critical for us — supports ACP (Agent Client Protocol)**: OpenClaw spawns external coding harnesses
  through ACP, including Claude Code, Codex, Cursor, Gemini CLI, and OpenCode.
  - Doc: `docs/tools/acp-agents.md`
  - Code: `src/plugin-sdk/acp-runtime.ts`, `src/plugin-sdk/acpx.ts`
  - Spawn syntax: `/acp spawn codex`, `/acp spawn claude`, `sessions_spawn({ runtime: "acp" })`
  - **`openclaw acp` CLI** exposes an OpenClaw session AS an ACP server (bridge mode for IDEs)
- **Session storage**: Has session-store + hooks system. Files of interest:
  - `src/channels/session.ts`, `src/channels/session.types.ts`, `src/channels/session-envelope.ts`
  - `src/hooks/internal-hooks.ts` (internal hook listeners on session patches)
  - `src/gateway/server-methods/sessions.ts` (REST/RPC: sessions_compact, sessions_abort, ...)
  - `src/cron/isolated-agent/run.ts`, `src/cron/isolated-agent/session.ts`
- **Integration insight (IMPORTANT for the OpenClaw plan)**:
  Two viable taps for pixel-agents:
  - **(Path 1) ACP client**: Pixel-agents acts as an ACP client connecting to `openclaw acp`,
    receiving structured turn/tool events directly via the protocol. Cleanest, one integration
    covers all harnesses OpenClaw spawns (Claude Code via ACP, Codex via ACP, Pi, etc.).
  - **(Path 2) Gateway HTTP/RPC**: Use `openclaw gateway --port 18789` JSON-RPC `sessions.*`
    methods + the internal hooks system. Heavier but exposes full session metadata.
  - Path 1 is recommended unless the user needs to also visualize non-coding chat sessions.

You should evaluate both during planning and pick one (or design a thin abstraction supporting both).

---

## 4. What the planning task is

Two SEPARATE plans, written as two separate markdown files.

### Plan A: `PLAN_A_kosmos_rebase_refactor.md`

Covers issues 1+2+3 from the user's brief:
1. New branch off `upstream/main` (HEAD = `ef9fe9e feat: add Agent Teams visualization`).
   Suggested branch name: `feat/kosmos-on-latest` (confirm with brainstorming what's idiomatic).
2. Re-apply the user's Kosmos work from `origin/pixel-kosmos-game` onto the new branch.
   Strategy options to evaluate (cherry-pick range vs squash-merge vs structured re-port).
   The CRITICAL question: does the Kosmos work conflict with the new upstream features
   (Agent Teams #218, hooks-first session #214, Tailwind v4 #204, external asset packs #169)?
   Recommend an approach that minimizes conflict pain.
3. **Refactor pass**: dead code removal, module reorganization, type tightening.
   Identify the actual dead code by inspecting the branch — don't speculate.
   Preserve all working features.

### Plan B: `PLAN_B_openclaw_support.md`

Covers issue 4: Add OpenClaw agent visualization.
- Should be designed as a clean second adapter sitting alongside the existing Claude adapter.
- The overall code refactor in Plan A should leave a clean abstraction seam for this.
- Decide ACP vs Gateway-RPC integration path with concrete reasoning.
- Define what OpenClaw events map to existing pixel-agents webview messages
  (agentCreated, agentToolStart/Done/Clear, agentStatus, etc.).
- Identify what new webview messages are needed (if any).
- Plan agent identity / character spawning when the underlying agent is a sub-harness
  (e.g., "Claude Code spawned by OpenClaw via ACP" — does this show as 1 character or 2?).
- Spec the install/auth onboarding flow for OpenClaw users.

---

## 5. Planning style

Use the **superpowers:brainstorming** skill first to explore each plan's design space,
then **superpowers:writing-plans** to produce the structured plan markdown.

Each plan must include:
- Goals & non-goals
- Open questions to confirm with the user (call these out explicitly — do NOT just assume)
- Phased breakdown into ~3-7 sub-tasks per plan, each suitable for a single PR
- For each sub-task: acceptance criteria, files touched, test strategy, risk
- Concrete diff/commit estimates where reasonable
- Dependencies between sub-tasks (what must land first)

KEEP THE PLANS GROUNDED IN REAL CODE. You have the cloned repo at ~/code/pixel-agents
and OpenClaw at ~/tmp_openclaw. INSPECT files before writing. Quote real symbol names.
