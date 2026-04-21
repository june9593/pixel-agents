# pixel-agents — Architecture Reference

Web-only fork of [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents). Standalone Node server + Canvas-based pixel renderer that visualizes AI agents as characters in a tile-based office.

## Layout

```
web/                              — npm-publishable CLI server (pixel-kosmos)
  bin/cli.js                      — Entrypoint; flag parsing, kosmos-app dir detection
  src/server.ts                   — Express HTTP + JSON APIs
  src/agentDiscovery.ts           — Reads kosmos-app profile dir, builds agent list
  src/webAssetLoader.ts           — Loads sprite PNGs from webview-ui/public/assets
  package.json                    — Published as "pixel-kosmos" on npm

webview-ui/                       — React + Canvas viewer
  src/main.tsx                    — Mount point
  src/App.tsx                     — Top-level UI shell
  src/constants.ts                — Tile size, animation timings, colors, sentinels
  src/office/
    types.ts                      — TileType, FloorColor, FurnitureInstance, etc.
    colorize.ts                   — HSL colorize/adjust pipeline (shared helpers:
                                    hslToHex, applyContrastBrightness)
    wallTiles.ts                  — Auto-tiling walls (buildWallBitmask + sprite lookup)
    components/OfficeCanvas.tsx   — Canvas wrapper; render-loop entry
    engine/gameLoop.ts            — Per-frame tick
    engine/renderer.ts            — Draws tiles, furniture, characters
    layout/                       — Layout persistence + furniture catalog
    editor/                       — Tile/furniture editing tools

plans/PLAN_V2.md                  — Active roadmap (Epic A web-only, Epic B OpenClaw)
```

## Data flow (web mode, kosmos)

```
kosmos-app writes JSON to ~/Library/Application Support/kosmos-app/profiles/<profile>/
        │
        ▼
agentDiscovery.ts polls/reads profile dir
        │
        ▼
server.ts exposes:
   GET /api/agents   — agent list
   GET /api/health   — { status, agents, coins }
   GET /api/game     — game state
   GET /             — serves webview build from web/dist/webview/
        │
        ▼
React webview (Canvas) animates characters based on agent state
```

## Build

```bash
cd webview-ui && npm run build      # produces dist/webview/
cd ../web && npm run build           # bundles server + copies webview to web/dist/webview/
```

`web/scripts/copy-assets` (npm postbuild) handles the webview copy.

## OpenClaw track (in progress)

Epic B introduces a `Watcher` interface in `web/src/` so multiple agent sources can coexist:

- `KosmosWatcher` — current file-poll behavior
- `OpenClawWatcher` — WebSocket client for OpenClaw Gateway. Architecture is **`health`-event driven** (deployed gateway v2026.3.3 does not implement `sessions.subscribe` / `sessions.messages.subscribe`):
  - On `'open'`: one `sessions.list` call to refresh label cache (best-effort)
  - On every `'health'` event: diff against tracked state via `translateHealthSessions` + `diffSessionActivity`, then per-session `chat.history` for appeared/advanced sessions (with in-flight coalescing)
  - **1 OpenClaw session ↔ 1 PixelAgent** (decision locked 2026-04-21)
  - Gateway requires `clientId: GATEWAY_CLIENT_IDS.GATEWAY_CLIENT` and `token`; emits `auth-failed` with no reconnect on bad creds
  - Deployed port = `18799` on user's `korea-vm` (upstream default = `18789`)

UI shows a small source badge (kosmos / openclaw) per character.

## Conventions

- ESM with `.js` import extensions
- No bare numeric sentinels — use named constants in `constants.ts` (e.g. `GHOST_BORDER_DISABLED`)
- Shared helpers (e.g. `hslToHex`, `applyContrastBrightness`) live in `colorize.ts`; do not re-implement
- Wall bitmask construction goes through `buildWallBitmask` — do not inline the N=1/E=2/S=4/W=8 math
