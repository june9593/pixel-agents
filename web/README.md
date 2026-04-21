# 🎮 pixel-kosmos

Watch your [kosmos-app](https://kosmos-ai.com) AI agents work in a cozy pixel art office!

A gamified visualization that monitors your kosmos-app agents in real-time, showing adorable pixel characters that walk around, visit the bookshelf to research, go to meetings, take coffee breaks, and more.

## Features

- 🏢 **Live agent monitoring** — Characters animate based on real agent activity
- 🪙 **Game economy** — Earn coins from agent work, spend on interactions
- ☕ **Interact with agents** — Buy them milk tea, pizza, salary bonuses
- 📊 **Agent profiles** — Track tasks, mood, combos, achievements
- 🌅 **Day/night cycle** — Real-time lighting that matches your local time
- ✨ **Sparkle effects** — Celebrate when agents complete tasks
- 💤 **Idle animations** — Sleepy Zzz, chatting with colleagues
- 🌐 **i18n** — English and Chinese support

## Quick Start

```bash
npx pixel-kosmos --open
```

This will:
1. Auto-detect your kosmos-app profile
2. Start a local web server on port 3210
3. Open your browser to the pixel office

## Options

```bash
npx pixel-kosmos                        # default: port 3210, auto-detect profile
npx pixel-kosmos --port 8080            # custom port
npx pixel-kosmos --profile myuser       # specify kosmos profile name
npx pixel-kosmos --open                 # auto-open browser
npx pixel-kosmos --kosmos-dir /path     # custom kosmos-app directory

# OpenClaw (in addition to or instead of kosmos):
npx pixel-kosmos --watch openclaw \
  --openclaw-url ws://localhost:18789 \
  --openclaw-token <your-token>         # OpenClaw only
npx pixel-kosmos --watch all \
  --openclaw-url ws://localhost:18789 \
  --openclaw-token <your-token>         # both sources side-by-side
```

The `--watch` flag is auto-derived if omitted: `claude` if only kosmos is reachable, `openclaw` if only `--openclaw-url` is given, `all` if both. You can also set `OPENCLAW_URL` / `OPENCLAW_TOKEN` env vars instead of flags.

## Requirements

- [kosmos-app](https://kosmos-ai.com) installed
- Node.js 18+
- macOS (kosmos-app data directory detection)

## How It Works

pixel-kosmos watches your kosmos-app's chat session files and translates agent activity into pixel art animations:

| Agent Activity | Character Behavior |
|---|---|
| Reading files / Searching | Walks to bookshelf 📚 |
| Writing / Coding | Types at desk 💻 |
| Web search / Fetch | Visits bookshelf 🌐 |
| Running commands | Works at desk ⌨️ |
| Creating sub-agents | Goes to meeting room 🤝 |
| Waiting for user | Relaxes in lounge ☕ |
| Idle | Wanders, chats, sleeps 💤 |

## Game System

- **Daily budget**: 100 coins reset at midnight
- **Work rewards**: +5 coins per tool call, +2 per text response
- **Combo bonus**: +10 extra for every 3 consecutive tool calls
- **Interactions**: Tea (10🪙), Pizza (15🪙), Salary (20🪙), Promote (50🪙), Party (30🪙)
- **Achievements**: 9 unlockable badges
- **Mood system**: Keep your agents happy!

## Connecting to OpenClaw

pixel-kosmos can also visualise [OpenClaw](https://github.com/openclaw/openclaw) agents — either standalone or alongside kosmos. Pick the deployment shape that matches where your OpenClaw instance lives.

### Prerequisites

- An OpenClaw instance reachable over WebSocket (default port `18789`)
- An **operator token** with the `operator.read` scope
  - In the OpenClaw dashboard: **Settings → Tokens → Create token** → check `operator.read`
  - Treat the token as a secret — it is sent in the WebSocket handshake
- Pass the token via `--openclaw-token` or the `OPENCLAW_TOKEN` env var

### Mode 1 — same machine

OpenClaw running on the same laptop as `pixel-kosmos`:

```bash
pixel-kosmos --watch openclaw \
  --openclaw-url ws://localhost:18789 \
  --openclaw-token <your-token>
```

This is the simplest setup and the one used during local development.

### Mode 2 — remote OpenClaw via SSH tunnel

OpenClaw lives on a remote box you can reach via SSH (e.g. a workstation or a dev VM). Forward the port locally:

```bash
# In one terminal — keep this open while pixel-kosmos runs
ssh -L 18789:localhost:18789 user@your-host

# In another terminal
pixel-kosmos --watch openclaw \
  --openclaw-url ws://localhost:18789 \
  --openclaw-token <your-token>
```

The pixel UI keeps talking to `ws://localhost:18789` — the SSH tunnel ferries traffic to the remote OpenClaw transparently. Works through corporate NATs and doesn't need anything publicly exposed.

### Mode 3 — cloud-hosted Gateway (Tailscale Serve / reverse proxy)

For a long-lived deployment where multiple people watch the same OpenClaw instance, expose the gateway over `wss://` via [Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve), Cloudflare Tunnel, or a plain Nginx reverse proxy with TLS:

```bash
pixel-kosmos --watch openclaw \
  --openclaw-url wss://openclaw.your-tailnet.ts.net \
  --openclaw-token <your-token>
```

Notes:
- **Always use `wss://`** (TLS) when traversing the public internet — the operator token is sent in the handshake
- The proxy must forward the WebSocket upgrade headers and not buffer (`proxy_buffering off` for Nginx)
- For Tailscale Serve: `tailscale serve --bg --https=443 http://localhost:18789` on the OpenClaw host

### Watching kosmos and OpenClaw at the same time

```bash
pixel-kosmos --watch all \
  --openclaw-url ws://localhost:18789 \
  --openclaw-token <your-token>
```

Both sources stream into the same pixel office. Each agent label gets a small `KO` / `OC` source badge so you can tell them apart. The badge auto-hides when only one source is active.

### Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `gateway error: Unexpected server response: 401` | Token missing or wrong scope. Confirm the token has `operator.read` and isn't expired. |
| `gateway error: Unexpected server response: 426` | Hit a non-WebSocket endpoint. Check the URL path — should be the OpenClaw ws root, not an HTTP one. |
| Endless `gateway closed: { code: 1006 }` | Cannot reach the host at all. Test with `curl -v $URL` (substitute `wss://`→`https://`). For SSH tunnel: confirm the tunnel is still up. |
| `pixel-kosmos` exits immediately with `--watch all` | Kosmos profile not found. Either pass `--kosmos-dir` or use `--watch openclaw` to skip kosmos. |
| Agents never appear | Confirm OpenClaw has at least one active session. The watcher only renders agents that have produced messages. |
| Connection drops every few minutes | Reconnect is automatic with exponential backoff (max ~30 s). If your reverse proxy idle-times-out WebSockets, raise the timeout (Nginx `proxy_read_timeout 3600s`). |

For more detail when reporting bugs, redirect stderr to a file: `pixel-kosmos … 2> pixel-kosmos.log` and attach it.

## License

MIT
