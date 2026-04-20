# Plan A — Rebase Strategy: Kosmos onto upstream/main

---

## Branch setup

```sh
# Fetch latest upstream
git fetch upstream

# Create a clean integration branch from upstream/main
git checkout -b integrate/kosmos-onto-main upstream/main

# Confirm base
git log --oneline -1   # should show ef9fe9e or newer upstream HEAD
git log --oneline upstream/main..origin/pixel-kosmos-game | wc -l  # expect ~38
```

---

## Cherry-pick vs rebase decision

**Recommendation: cherry-pick in logical groups**, not a straight rebase.

**Why not rebase:**
- `pixel-kosmos-game` deleted entire directories that exist on upstream (`server/`, `e2e/`, `.github/`, shared UI components). A rebase will re-apply those deletions onto upstream/main, forcing you to re-resolve the same "deleted vs modified" conflicts on every commit that touches those paths. With 38 commits, that compounds quickly.
- The fork also committed `web/node_modules/` — rebasing carries that bulk through every subsequent commit.

**Why cherry-pick works better:**
- You can skip or squash the 5 reverts + re-adds into their final form before picking.
- You can skip the `web/node_modules/` commit and re-add `web/` cleanly with a `.gitignore` fix first.
- Logical grouping (below) lets you verify each feature compiles before picking the next group.

**Logical pick order:**
1. `src/` stale/interrupted detection (3 commits — self-contained, low conflict risk)
2. `src/` agent name/displayName wiring (part of agentManager/fileWatcher)
3. `webview-ui/src/` name labels + status bubbles (AgentLabels, ToolOverlay, SettingsModal)
4. `webview-ui/src/` i18n (i18n.ts + consumers)
5. `webview-ui/src/` game interaction system (GameHud, officeState, characters, renderer)
6. `web/` server — add `.gitignore` entry for `web/node_modules/` first, then pick web commits
7. npm packaging + cross-platform fixes last

---

## Conflict-prone files

High risk — upstream has active changes here and Kosmos rewrote them heavily:

| File | Risk | Reason |
|---|---|---|
| `webview-ui/src/hooks/useEditorActions.ts` | **Critical** | ±899 lines in fork; upstream added Tailwind v4 UI kit that Kosmos deleted. Slider/modal components referenced here no longer exist in fork. |
| `webview-ui/src/office/editor/EditorToolbar.tsx` | **Critical** | ±537 lines; same Tailwind v4 component imports deleted by fork. |
| `webview-ui/src/App.tsx` | **High** | ±754 lines; upstream added ChangelogModal, VersionIndicator, MigrationNotice — all deleted in fork. Kosmos added GameHud, AgentLabels, i18n. |
| `webview-ui/src/hooks/useExtensionMessages.ts` | **High** | ±720 lines; upstream added hook-based session messages (from `server/`), fork deleted `server/` entirely. |
| `webview-ui/src/office/engine/officeState.ts` | **High** | ±1033 lines; largest single-file rewrite. Any upstream bugfixes here will three-way conflict with zone/mood/sparkle additions. |
| `webview-ui/src/office/engine/renderer.ts` | **High** | ±810 lines; day-night tint + sparkle effects touch core render loop upstream also modifies. |
| `src/fileWatcher.ts` | **High** | ±1561 lines (largest extension diff); stale detection added deep inside the partial-line buffering logic upstream also touches. |
| `src/agentManager.ts` | **Medium** | ±874 lines; displayName + profile sync fields added to AgentState; upstream may have added different fields. |
| `webview-ui/src/constants.ts` | **Medium** | ±225 lines; both sides add constants to the same file — likely clean with careful merge but dense. |
| `package.json` / `package-lock.json` | **Medium** | Dependencies diverged (Express, ws, chokidar added; upstream added different deps). Resolve by accepting both then deduplicating. |
| `webview-ui/vite.config.ts` | **Low-Medium** | Fork added web-mode build targets; upstream may have updated plugin versions. |
| `esbuild.js` | **Low** | ±142 lines; mostly additive on both sides. |
| `src/types.ts` | **Low** | ±91 lines; Kosmos added game fields (mood, coins, zone); check upstream for new fields on AgentState. |

Files safe to accept-ours wholesale (upstream deleted them, fork keeps them):
- `web/**` — entirely new in fork, not on upstream
- `scripts/**` — entirely new in fork

Files safe to accept-theirs wholesale (fork deleted them, upstream keeps them):
- `server/**`, `e2e/**`, `.github/**` — fork intentionally removed these; just skip re-adding

---

## Verification steps

After each cherry-pick group:

```sh
# 1. Type-check extension backend
npx tsc --noEmit -p tsconfig.json

# 2. Type-check webview
cd webview-ui && npx tsc --noEmit -p tsconfig.app.json && cd ..

# 3. Full build (catches esbuild + vite errors)
npm run build

# 4. Smoke-test in Extension Dev Host (F5)
#    - Open a workspace, confirm webview loads without console errors
#    - "+ Agent" creates a character
#    - Layout editor opens/saves
```

After all groups picked:

```sh
# 5. Confirm web/ server starts (if web/ included)
cd web && node bin/cli.js --help && cd ..

# 6. Diff against kosmos branch to confirm nothing dropped
git diff origin/pixel-kosmos-game -- 'src/' 'webview-ui/src/' 'web/'
# Review any unexpected hunks

# 7. Confirm web/node_modules is not staged
git status web/node_modules  # should show nothing (gitignored)
```
