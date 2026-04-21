# Plan A — Epic Acceptance Criteria

## Definition of Done

The integration branch `integrate/kosmos-onto-main` is ready to merge when all of the following pass.

### Build & Type Safety

- [ ] `npm run build` succeeds from a clean checkout (no cached `node_modules`)
- [ ] `npx tsc --noEmit -p tsconfig.json` passes (extension backend)
- [ ] `npx tsc --noEmit -p webview-ui/tsconfig.app.json` passes (webview)
- [ ] No inline numeric literals for timing constants (all in `src/constants.ts` or `webview-ui/src/constants.ts`)
- [ ] No Tailwind v4 / upstream UI-kit imports (`ChangelogModal`, `VersionIndicator`) present

### Kosmos Features

- [ ] Stale/interrupted detection: agent with crashed session goes idle within 15 s
- [ ] Agent name labels render above characters; toggle in Settings modal works
- [ ] i18n: OS locale `zh` shows Chinese strings in toolbar and Settings; `en` shows English
- [ ] GameHud renders: coin balance, mood indicator, action menu opens on character click
- [ ] Zone-visit FSM (kitchen, lounge, bookshelf) runs without console errors in Extension Dev Host
- [ ] `web/` server: `cd web && node bin/cli.js --help` exits 0
- [ ] `npm pack web/` produces a tarball with correct `bin` entry pointing to `bin/cli.js`

### Refactors (no regressions)

- [ ] `hslToHex` exported once from `colorize.ts`; duplicate in `wallTiles.ts` removed
- [ ] `applyContrastBrightness` called from all three colorize sites
- [ ] `buildWallBitmask` called from both `getWallSprite` and `getColorizedWallSprite`
- [ ] No bare `-999` literals in `OfficeCanvas.tsx`
- [ ] `TOOL_DONE_DELAY_MS` constant used in `transcriptParser.ts` (no inline `300`)

### Cleanliness

- [ ] `web/node_modules/` not tracked by git
- [ ] `scripts/.tileset-working/` not tracked by git
- [ ] `git diff origin/pixel-kosmos-game -- src/ webview-ui/src/ web/` shows no unintentional omissions

---

## Test Plan

### Automated (run before every merge)

1. `npm run build` — catches compile errors and bundler failures in one shot.
2. `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p webview-ui/tsconfig.app.json` — full type-check both packages.

### Manual smoke-tests (Extension Dev Host, F5)

| # | Scenario | Pass condition |
|---|----------|----------------|
| 1 | Launch extension, open office | Canvas renders, no console errors |
| 2 | Click `+ Agent` | Character spawns with matrix effect; terminal opens |
| 3 | Let agent sit idle / kill terminal | Character goes idle within 15 s |
| 4 | Hover character | Name label visible; ToolOverlay shows status |
| 5 | Open Settings → toggle Labels | Labels appear / disappear |
| 6 | Open Settings → switch locale to zh | All UI strings switch to Chinese |
| 7 | Click character → action menu | GameHud action menu opens; coins/mood display |
| 8 | Agent visits kitchen/lounge/bookshelf zone | No console errors; FSM state changes logged |
| 9 | `cd web && node bin/cli.js --help` | Exits 0, prints usage |
| 10 | Edit layout, save, reload window | Layout persists; no visual regressions in tiles/walls |

### Regression check

Run smoke-tests 1–2 and 10 on the `main` branch tip before opening the PR to establish a baseline; re-run after merge to confirm no regressions.
