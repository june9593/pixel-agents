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
```

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

## License

MIT
