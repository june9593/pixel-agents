# Plan A — Current State: Kosmos Branch vs upstream/main

Generated: 2026-04-20. Base: `upstream/main` (HEAD `ef9fe9e`). Branch: `origin/pixel-kosmos-game` (38 commits ahead).

---

## Kosmos branch commits

### Web / npm packaging (6 commits)
- `feat: V1 web version of pixel-agents for kosmos-app` — new `web/` directory, Express server serving office as standalone web app
- `feat: V2 optimizations - smart wander, CSS fix, npm packaging`
- `chore: prepare npm package pixel-kosmos v1.0.0`
- `fix: npm package paths work in global install mode`
- `feat: cross-platform support for Windows and Linux`
- `fix: Windows import() requires file:// URL, use pathToFileURL`

### Game interaction system (7 commits)
- `feat: game interaction system - coins, actions, profiles, achievements` — GameHud, mood, coin economy, rank system
- `feat: zone visits, sleepy Zzz, idle interactions, walk completion fix`
- `feat: pixel office life - contextual movement, day-night cycle, sparkle effects`
- `feat: floating emoji reactions for game actions + fix sendCharacterToZone public`
- `feat: fix party, idle-only actions, zone lingering 8-15s`
- `fix: menus mutually exclusive + record TODO for idle-only interactions`
- `fix: broadcast gameUpdate after tool calls for real-time profile refresh`

### Agent name labels & status UI (6 commits)
- `feat: agent name labels + hide X button in web mode`
- `feat: toggleable name labels via Settings + React overlay with emoji`
- `style: improve name label rendering`
- `fix: name labels not showing - apply displayName after character creation`
- `feat: notification-style status bubbles with auto-dismiss`
- `feat: show activity status for all active agents in web mode`

### i18n (1 commit)
- `feat: i18n zh/en, fix export/import layout, fix dark theme text color`

### Stale / interrupted detection (3 commits)
- `fix: stale detection uses isWaiting flag instead of activeToolIds`
- `fix: detect interrupted conversations and force idle after 15s stale`
- `fix: stale/interrupted conversation detection - force waiting after 10s`

### Hover & idle behavior (3 commits)
- `feat: hover face-user, name sync, idle chat pairs`
- `fix: bash at desk, sleepy 15s, hover face-user, seat priority, idle stay`
- `fix: agents start idle, stagger initial stand-up 2-8s`

### Misc fixes (7 commits — trivial)
- GameHud polling selectedAgentId, stabilize useCallback, i18n ranks/toolbar dedup, mood decay fix, text-only responses as tasks, status bubble visibility (×2), `fix: revert bookshelf/turn-end + add agent close/sync`

### Reverts + re-adds (5 commits)
- Smart bookshelf navigation and turn-end detection were added, reverted, then re-added in cleaned form

---

## Files changed

### webview-ui/src/ — core webview (heavy modification)

**New files:**
- `components/GameHud.tsx` (+316) — HUD overlay: coins, rank, action menus, achievements, mood display
- `components/AgentLabels.tsx` (+134) — React overlay for toggleable name labels + emoji status
- `i18n.ts` (+147) — zh/en translation strings, `t()` helper, locale detection

**Major rewrites (>200 line diff):**
- `App.tsx` (±754) — wired GameHud, AgentLabels, i18n, game state callbacks
- `hooks/useExtensionMessages.ts` (±720) — added game events, mood, profile, zone messages
- `hooks/useEditorActions.ts` (±899) — layout editor changes (upstream Tailwind v4 conflict likely here)
- `office/engine/officeState.ts` (±1033) — zone system, mood, sparkle, idle chat, bookshelf nav
- `office/engine/renderer.ts` (±810) — day-night cycle tint, sparkle effects, emoji floats
- `office/components/OfficeCanvas.tsx` (±815) — web-mode hit-testing, label clicks
- `office/components/ToolOverlay.tsx` (±342) — extended status display
- `office/editor/EditorToolbar.tsx` (±537) — toolbar changes (Tailwind v4 conflict likely)
- `office/sprites/spriteData.ts` (±1109) — new character/furniture sprite data
- `office/layout/furnitureCatalog.ts` (±407) — catalog changes
- `office/layout/layoutSerializer.ts` (±368) — serializer updates
- `components/SettingsModal.tsx` (±358) — sound + label toggles, i18n
- `office/engine/characters.ts` (±412) — zone visits, sleepy state, idle chat FSM states
- `constants.ts` (±225) — new game constants (mood, coins, zones, day-night)

**Removed (upstream components not present in fork):**
- `components/ui/Button.tsx`, `Checkbox.tsx`, `ColorPicker.tsx`, `Dropdown.tsx`, `ItemSelect.tsx`, `MenuItem.tsx`, `Modal.tsx`, `types.ts` — upstream Tailwind v4 UI kit, deleted in fork
- `components/ChangelogModal.tsx`, `VersionIndicator.tsx`, `MigrationNotice.tsx`, `Tooltip.tsx`, `EditActionBar.tsx`
- `changelogData.ts`, `browserMock.ts`, `runtime.ts`
- `office/sprites/bubble-permission.json`, `bubble-waiting.json` — bubble data (inlined?)
- `test/dev-assets.test.ts`

### webview-ui/ root
- `vite.config.ts` (±106) — web-mode build targets added
- `tsconfig.app.json` (−1) — minor
- `tsconfig.node.json` (±7)

### web/ — entirely new (Kosmos standalone web server)
- `web/src/server.ts` (+464) — Express HTTP + WebSocket server, serves office app
- `web/src/kosmosWatcher.ts` (+366) — JSONL file watching for web (no VS Code API)
- `web/src/gameState.ts` (+317) — server-side game state management
- `web/src/logTranslator.ts` (+317) — JSONL → game events translation layer
- `web/src/agentDiscovery.ts` (+146) — auto-discovers Claude sessions from filesystem
- `web/src/webAssetLoader.ts` (+290) — asset loading without VS Code extension APIs
- `web/bin/cli.js` (+86) — `pixel-kosmos` CLI entrypoint
- `web/README.md` (+70)
- `web/node_modules/` — committed (Express, chokidar, ws, pngjs, etc.)

### src/ — extension backend (all files modified, not rewritten)
- `src/PixelAgentsViewProvider.ts` (±1291) — game state message routing added
- `src/agentManager.ts` (±874) — stale detection, displayName, profile sync
- `src/fileWatcher.ts` (±1561) — largest diff; stale timeout, interrupted detection
- `src/transcriptParser.ts` (±900) — game event emission
- `src/layoutPersistence.ts` (±311)
- `src/assetLoader.ts` (±673)
- `src/timerManager.ts` (±224)
- `src/types.ts` (±91) — new game-related fields on AgentState
- `src/constants.ts` (±35)
- `src/extension.ts` (±34)
- `src/configPersistence.ts` (−50) — deleted

### scripts/ — asset pipeline (all new)
- `scripts/0-import-tileset.ts` (+425), `1-detect-assets.ts` (+254), `2-asset-editor.html` (+921), `3-vision-inspect.ts` (+280), `4-review-metadata.html` (+509), `5-export-assets.ts` (+275)
- `scripts/export-characters.ts` (+120), `scripts/generate-walls.js` (+253)
- `scripts/asset-manager.html` (±2823) — major enhancement
- `scripts/.tileset-working/` — working JSON blobs (+~9551 lines, should be gitignored)

### Removed entirely (upstream features absent from fork)
- `server/` — upstream's hook-based session server (#187 / #214): `hookEventHandler.ts` (834 lines), `providers/hook/claude/`, tests, `package.json`
- `e2e/` — upstream's Playwright e2e test suite
- `shared/assets/` — upstream's shared asset build utilities
- `.github/workflows/` — all CI (ci.yml 314 lines, publish-extension.yml, etc.)
- `.husky/`, `.prettierrc.json`, `.gitleaks.toml`, `knip.json`, `.nvmrc`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/external-assets.md`

### assets/ and root config
- `package.json` (±45), `package-lock.json` (±6577) — dependencies changed
- `esbuild.js` (±142) — build config updated
- `tsconfig.json` (±14), `eslint.config.mjs` (±54)
- `.gitignore` (±32)
- PNG assets: large number of furniture PNGs added (bulk of the 1186-file count)

---

## Key custom features

**1. Kosmos web server (`web/`)**: A standalone Express + WebSocket server (`web/src/server.ts`, 464 lines) that exposes the pixel office as a web app outside VS Code. `kosmosWatcher.ts` tails JSONL transcripts directly from the filesystem (no VS Code API), `logTranslator.ts` maps JSONL records to game events, and `gameState.ts` maintains server-side character/mood state. Packaged as `pixel-kosmos` npm CLI (`web/bin/cli.js`).

**2. GameHud + i18n (`GameHud.tsx`, `i18n.ts`)**: A 316-line React HUD overlay adding a coin economy, rank/XP progression, per-agent action menus (greet, cheer, challenge, party), mood tracking with decay, achievement popups, and floating emoji reactions. `i18n.ts` (147 lines) provides zh/en translations via a `t()` helper with locale auto-detection; used throughout GameHud and toolbar.

**3. Agent name labels (`AgentLabels.tsx`)**: React overlay (134 lines) rendering clickable name tags with emoji status indicators above each character; toggle via Settings. Separate from the canvas renderer to support DOM-level text.

**4. Rich character lifecycle (`officeState.ts`, `characters.ts`)**: New FSM states for zone visits (kitchen, lounge, bookshelf), sleepy Zzz idle, idle chat pair interactions, day-night tint cycle, sparkle effects on active work, and staggered startup (2–8 s random delay). `officeState.ts` grew by ~1033 lines vs upstream.

**5. Stale/interrupted detection (`fileWatcher.ts`, `agentManager.ts`)**: Two-layer timeout system: 10 s with no JSONL data forces `isWaiting`, 15 s forces hard idle. Intended to handle Claude sessions that crash or get interrupted without emitting `turn_duration`.
