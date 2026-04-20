# pixel-agents

Pixel art office visualization for AI agents. Originally a VS Code extension by [pablodelucca](https://github.com/pablodelucca/pixel-agents) for Claude Code terminals; this fork repurposes it as a standalone web viewer for kosmos-app agents (and, in progress, OpenClaw agents).

```
┌──────────────────────────────────────┐
│  🎮 pixel-kosmos                     │
│  Local:   http://localhost:3210      │
│  Profile: default                    │
│  Agents:  3                          │
└──────────────────────────────────────┘
```

## Quick start

```bash
npx pixel-kosmos --open
```

This auto-detects your local kosmos-app profile, starts a server on port 3210, and opens the viewer. See **[web/README.md](web/README.md)** for full CLI options, architecture, and troubleshooting.

`pixel-kosmos` can also visualise [OpenClaw](https://github.com/openclaw/openclaw) agents — alone or alongside kosmos. See **[Connecting to OpenClaw](web/README.md#connecting-to-openclaw)** for the three deployment modes (same-machine, SSH tunnel, cloud-hosted gateway).

## Project layout

```
web/             — Standalone Node server + CLI (`pixel-kosmos`); the published npm package
webview-ui/      — React + Canvas pixel renderer (loaded by the web server)
plans/           — Architecture and roadmap documents
```

## Status

| Track | Status |
|-------|--------|
| Web mode (kosmos-app)  | ✅ shipped (`pixel-kosmos`) |
| OpenClaw agent support | 🚧 in progress (Epic B) |
| VS Code extension      | ❌ removed (this fork is web-only — see `plans/PLAN_V2.md`) |

For project history and the migration from extension-mode → web-only, read **[plans/PLAN_V2.md](plans/PLAN_V2.md)**.

## Contributing

This fork is developed via a Multica-driven workflow: one issue → one PR → Claude-dev review → merge. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the dev loop and conventions.

## License

[MIT](LICENSE) — same as the upstream project.

## Credits

Built on [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents). All original art and the core renderer are theirs.
