# Plan A — Issue Breakdown

PR-sized issues in merge order. Each is independently mergeable into `integrate/kosmos-onto-main`.

---

### 1. Branch setup + gitignore fix

Create the integration branch from `upstream/main` and add `web/node_modules/` to `.gitignore` before any cherry-picks land.

**Scope**: Create `integrate/kosmos-onto-main` from `upstream/main`. Add `web/node_modules/` to `.gitignore` so it is never staged in subsequent commits. Confirm baseline build passes.

**Files**:
- `.gitignore`

**Acceptance**:
- [ ] `git log --oneline upstream/main..HEAD` shows exactly 1 commit
- [ ] `npm run build` passes from clean checkout
- [ ] `web/node_modules/` not tracked by git

---

### 2. Stale / interrupted detection (`src/`)

Cherry-pick the three stale-detection commits from `origin/pixel-kosmos-game` into the integration branch.

**Scope**: Bring over the two-layer timeout system (10 s → `isWaiting`, 15 s → hard idle) in `fileWatcher.ts` and `agentManager.ts`. Resolve any three-way conflicts caused by upstream changes to partial-line buffering logic.

**Files**:
- `src/fileWatcher.ts`
- `src/agentManager.ts`
- `src/types.ts`
- `src/constants.ts`

**Acceptance**:
- [ ] `npx tsc --noEmit -p tsconfig.json` passes
- [ ] Agent with a crashed session forces idle after ≤15 s (manual smoke-test)
- [ ] No inline numeric literals for the timeout values — constants used throughout

---

### 3. Agent name labels + status bubbles (webview)

Cherry-pick `AgentLabels.tsx`, the notification-style status bubble changes, and the `displayName` wiring from `agentManager.ts`.

**Scope**: Add the React overlay for toggleable name tags with emoji status, extend `ToolOverlay.tsx` for richer status display, and wire `displayName` propagation from the extension backend. Resolve conflicts in `App.tsx` caused by upstream's `ChangelogModal`/`VersionIndicator` additions (accept-ours for those deletions).

**Files**:
- `webview-ui/src/components/AgentLabels.tsx` (new)
- `webview-ui/src/office/components/ToolOverlay.tsx`
- `webview-ui/src/App.tsx`
- `webview-ui/src/hooks/useExtensionMessages.ts`
- `src/agentManager.ts`
- `src/PixelAgentsViewProvider.ts`

**Acceptance**:
- [ ] Name labels appear above characters and toggle via Settings modal
- [ ] `npx tsc --noEmit` passes for both `tsconfig.json` and `webview-ui/tsconfig.app.json`
- [ ] No upstream UI-kit imports (`ChangelogModal`, `VersionIndicator`) reintroduced

---

### 4. i18n (zh/en translations)

Cherry-pick the single i18n commit and wire `t()` through its consumers.

**Scope**: Add `i18n.ts` with zh/en strings and locale auto-detection. Apply translations to `SettingsModal.tsx`, `EditorToolbar.tsx`, and toolbar button labels. Resolve `useEditorActions.ts` / `EditorToolbar.tsx` conflicts from upstream's Tailwind v4 UI kit removal (accept-ours).

**Files**:
- `webview-ui/src/i18n.ts` (new)
- `webview-ui/src/components/SettingsModal.tsx`
- `webview-ui/src/office/editor/EditorToolbar.tsx`
- `webview-ui/src/hooks/useEditorActions.ts`

**Acceptance**:
- [ ] Switching OS locale to `zh` shows Chinese strings in toolbar and Settings
- [ ] `npx tsc --noEmit -p webview-ui/tsconfig.app.json` passes
- [ ] No Tailwind v4 component imports present after merge

---

### 5. Game interaction system (GameHud + character lifecycle)

Cherry-pick the seven game-interaction commits, squashing the 5 reverts + re-adds into their final form first.

**Scope**: Add `GameHud.tsx` (coin economy, rank, action menus, mood, achievements, floating emoji), extend `officeState.ts` with zone visits / sleepy / idle-chat FSM states, add day-night tint and sparkle to `renderer.ts`, and wire game events through `useExtensionMessages.ts`. Conflicts in `officeState.ts` and `renderer.ts` are high-risk — resolve manually hunk by hunk.

**Files**:
- `webview-ui/src/components/GameHud.tsx` (new)
- `webview-ui/src/office/engine/officeState.ts`
- `webview-ui/src/office/engine/renderer.ts`
- `webview-ui/src/office/engine/characters.ts`
- `webview-ui/src/hooks/useExtensionMessages.ts`
- `webview-ui/src/App.tsx`
- `webview-ui/src/constants.ts`
- `src/transcriptParser.ts`
- `src/PixelAgentsViewProvider.ts`

**Acceptance**:
- [ ] `npm run build` passes end-to-end
- [ ] GameHud renders coins and mood; action menu opens on character click
- [ ] Zone-visit FSM (kitchen, lounge, bookshelf) exercises without console errors in Extension Dev Host

---

### 6. Web server (`web/`) — clean add

Add the standalone Express + WebSocket server without committed `node_modules`.

**Scope**: Copy `web/src/` and `web/bin/` from the kosmos branch. Do NOT cherry-pick the original commit (it contains `node_modules/`). Instead, manually add only source files, add a `web/package.json`, run `npm install` inside `web/`, and commit the lockfile only.

**Files**:
- `web/src/server.ts` (new)
- `web/src/kosmosWatcher.ts` (new)
- `web/src/gameState.ts` (new)
- `web/src/logTranslator.ts` (new)
- `web/src/agentDiscovery.ts` (new)
- `web/src/webAssetLoader.ts` (new)
- `web/bin/cli.js` (new)
- `web/package.json` (new)
- `web/package-lock.json` (new)
- `web/README.md` (new)
- `.gitignore` (`web/node_modules/` already present from issue 1)

**Acceptance**:
- [ ] `git status web/node_modules` shows nothing (gitignored)
- [ ] `cd web && node bin/cli.js --help` exits 0
- [ ] `npm run build` at repo root still passes

---

### 7. npm packaging + cross-platform fixes

Cherry-pick the four packaging commits (prepare v1.0.0, fix global install paths, Windows/Linux support, `pathToFileURL` fix).

**Scope**: Add `pixel-kosmos` package metadata to `web/package.json`, fix asset path resolution for global npm installs, and add Windows `file://` URL handling in `webAssetLoader.ts`. These commits are low-conflict and self-contained.

**Files**:
- `web/package.json`
- `web/bin/cli.js`
- `web/src/webAssetLoader.ts`
- `web/src/server.ts`

**Acceptance**:
- [ ] `npm pack web/` produces a tarball with correct `bin` entry
- [ ] `node bin/cli.js --help` works from a temp directory simulating a global install
- [ ] `npx tsc --noEmit` passes for the web source (if a `web/tsconfig.json` is present)

---

### 8. Colorize deduplication refactor

Extract the two shared helpers identified in `03-refactor-targets.md` and fix the inline constant in `transcriptParser.ts`.

**Scope**: Export `hslToHex` from `colorize.ts` and delete the copy in `wallTiles.ts`. Extract `applyContrastBrightness` and call it from all three sites. Replace the inline `300` in `transcriptParser.ts` with `TOOL_DONE_DELAY_MS`.

**Files**:
- `webview-ui/src/office/layout/colorize.ts`
- `webview-ui/src/office/layout/wallTiles.ts`
- `src/transcriptParser.ts`
- `src/constants.ts`

**Acceptance**:
- [ ] `hslToHex` is exported once and imported once — no duplicate implementation
- [ ] `applyContrastBrightness` called from all three colorize sites
- [ ] `npm run build` passes; no change in visual output

---

### 9. Wall bitmask + sentinel constant cleanup

Extract `buildWallBitmask` helper and name the `-999` ghost-border sentinel.

**Scope**: Extract the duplicated 4-bit neighbor mask construction in `wallTiles.ts` into a shared `buildWallBitmask(row, col, tileMap)` function. Add `GHOST_BORDER_DISABLED = -999` to `webview-ui/src/constants.ts` and replace both sentinel usages in `OfficeCanvas.tsx`.

**Files**:
- `webview-ui/src/office/layout/wallTiles.ts`
- `webview-ui/src/office/components/OfficeCanvas.tsx`
- `webview-ui/src/constants.ts`

**Acceptance**:
- [ ] `buildWallBitmask` called from both `getWallSprite` and `getColorizedWallSprite`
- [ ] No bare `-999` literals remain in `OfficeCanvas.tsx`
- [ ] `npx tsc --noEmit -p webview-ui/tsconfig.app.json` passes

---

### 10. Final diff verification + scripts gitignore

Confirm nothing was dropped vs. the original kosmos branch and clean up committed working blobs.

**Scope**: Run `git diff origin/pixel-kosmos-game -- src/ webview-ui/src/ web/` and review unexpected hunks. Add `scripts/.tileset-working/` to `.gitignore` to stop tracking the ~9551-line JSON working blobs.

**Files**:
- `.gitignore`

**Acceptance**:
- [ ] `scripts/.tileset-working/` no longer tracked by git
- [ ] Diff against `origin/pixel-kosmos-game` shows no unintentional omissions in `src/`, `webview-ui/src/`, or `web/`
- [ ] `npm run build` passes from a clean checkout of the integration branch
