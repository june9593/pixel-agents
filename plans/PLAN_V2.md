# Plan v2 — Pixel-Agents revival as web-only `pixel-kosmos`

> **Major revision (2026-04-20)**. User decision after auditing all 37 kosmos commits: ship web-only, drop the VS Code extension entirely.

## Why the rewrite

Bucketed every commit on `origin/pixel-kosmos-game` not in `upstream/main` by which top-level directory it touches:

| Bucket | Commits |
|---|---|
| `webview-ui/` only | 15 |
| `web/` + `webview-ui/` | 11 |
| `web/` only | 10 |
| Root + `web/` (V1 base `a2709cb`) | 1 |
| Extension `src/` | **0** |

Conclusion: the kosmos divergence is a pure web-mode build. The original Plan A (cherry-pick into extension) and Plan B (extension adapter abstraction) were based on wrong assumptions and have been cancelled.

## Target shape

```
pixel-agents/
├── web/                  ← pixel-kosmos npm package (standalone Express + WS server)
│   ├── bin/cli.js        ← `npx pixel-kosmos --open`
│   ├── src/server.ts     ← HTTP + WebSocket
│   ├── src/kosmosWatcher.ts  ← currently watches kosmos-app, will host adapter abstraction
│   ├── src/agentDiscovery.ts
│   ├── src/gameState.ts
│   ├── src/logTranslator.ts
│   └── src/webAssetLoader.ts
├── webview-ui/           ← shared React renderer (consumed by web/ at build time)
├── assets/               ← sprites + tilesets
└── scripts/              ← asset extraction pipeline (kept — it's the toolchain for sprites)

DELETED:
- src/                    ← extension backend (not needed for web mode)
- server/                 ← extension hook server (not needed for web mode)
- esbuild.js              ← extension bundle config
- package.json            ← root extension manifest (replaced by web/package.json as canonical)
```

`webview-ui/` stays — both the (deleted) extension and the (kept) web mode use it. We don't need the upstream-only changes to webview (hooks API, InfoModal, external-asset directories) because we're not running the extension. **We freely overwrite `webview-ui/` with the kosmos branch's version** — it's the version that knows about GameHud, name labels, i18n, day-night cycle, etc.

## Strategy: copy, not cherry-pick

Cherry-picking 37 commits in order would force us to re-resolve 37 conflicts against an upstream `webview-ui/` that has diverged in directions we don't need. Instead:

1. From `integrate/kosmos-onto-main` (already at `upstream/main` + 1 gitignore commit), **delete extension-only directories**.
2. **Replace `web/` and `webview-ui/`** with the file-tree from `origin/pixel-kosmos-game`. Single commit.
3. **Restore the `pixel-kosmos` build pipeline** at the repo root (root `package.json` becomes a workspace pointer to `web/`, or we just keep `web/package.json` as canonical).
4. Verify `cd web && npm install && npm run build && node bin/cli.js --help` works.

Result: history is clean (3 commits on top of upstream), no rebase scars, full kosmos features intact.

## Plan A v2 — Issue list

| # | Title | Scope |
|---|---|---|
| A1 | ✅ DONE — Branch setup + gitignore | (already merged into integration branch, commit `ffab610`) |
| A2-v2 | Delete extension code | `git rm -r src/ server/ esbuild.js .vscode-test.mjs` + drop extension-only dependencies from root `package.json` |
| A3-v2 | Restore `web/` + `webview-ui/` from kosmos branch | `git checkout origin/pixel-kosmos-game -- web/ webview-ui/`; commit |
| A4-v2 | Root build orchestration cleanup | Decide: workspace `package.json` at root, or just delete root `package.json` and document `cd web` as the entrypoint. Prefer the latter — simpler |
| A5-v2 | Re-establish CI / smoke tests | `cd web && npm install`; `npm run build`; `node bin/cli.js --help`; commit `web/package-lock.json`; ensure `web/node_modules/` ignored |
| A6-v2 | Refactor — colorize dedup + wall bitmask + sentinel constant | The two refactor wins from old Plan A §8/§9 — they apply to `webview-ui/` which now lives in our tree, so still relevant |
| A7-v2 | README at repo root pointing to `web/README.md` | One-line redirect + brief project description |

7 issues, all PR-sized. A2-v2 → A5-v2 are mechanical and could even fold into one PR — but keeping them separate gives Claude-dev clean review chunks.

## Plan B v2 — OpenClaw integration (web-mode)

OpenClaw integration now plugs into `web/src/`, not extension code. Architecture mirrors the v3 design (Gateway WebSocket on port 18789), only the host changes.

| # | Title | Scope |
|---|---|---|
| B1-v2 | Watcher abstraction | Define `AgentWatcher` interface in `web/src/watchers/types.ts`. Refactor `kosmosWatcher.ts` to implement it (no behaviour change). |
| B2-v2 | OpenClaw Gateway WS client | `web/src/watchers/openclawGateway.ts` — connect, handshake (`role: operator`, `scopes: [operator.read]`, token), typed RPC, auto-reconnect. Config via env vars or CLI flags (`--openclaw-url`, `--openclaw-token`). |
| B3-v2 | `session.message` → game event mapping | `web/src/watchers/openclawWatcher.ts` implements `AgentWatcher`. Sniff real payload first (capture 20 events to `~/.pixel-kosmos/openclaw-capture.jsonl`), commit fixtures, parser tests. |
| B4-v2 | Wire watchers into `server.ts` | Server boot reads config, instantiates one or both watchers, fans events to WebSocket clients. CLI flags: `--watch claude`, `--watch openclaw`, `--watch all` (default). |
| B5-v2 | UI source badge | `webview-ui/`: small `claude` / `openclaw` badge on character overlay (purely cosmetic, distinguishes sources). |
| B6-v2 | Docs — three OpenClaw deployment modes | `web/README.md` section: same machine, SSH tunnel, Tailscale Serve. |

6 issues. B1-v2 must land before B2/B3.

## Order of execution

Plan A v2 first (clean foundation), then Plan B v2.

```
A1 (✅) → A2-v2 → A3-v2 → A4-v2 → A5-v2 → A6-v2 → A7-v2
                                          ↓
                                       B1-v2 → B2-v2 → B3-v2 → B4-v2 → B5-v2 → B6-v2
```

A6-v2 (refactor) can run in parallel with B work if needed — they touch different files.
