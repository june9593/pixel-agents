# Contributing

This fork (`june9593/pixel-agents`) is web-only and is developed via a Multica-driven workflow.

> The upstream project at [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents) is a VS Code extension and accepts contributions through GitHub issues and PRs in the usual way. **This fork has different conventions** — read on.

## Prerequisites

- [Node.js](https://nodejs.org/) v22+ (see `.nvmrc`)
- [gitleaks](https://github.com/gitleaks/gitleaks) (optional; CI runs it on every PR)

## Setup

```bash
git clone https://github.com/june9593/pixel-agents.git
cd pixel-agents/web
npm install
npm run build
node bin/cli.js --help
```

The repo has **no root `package.json`** — `web/` is the canonical entrypoint. `webview-ui/` is its own package, built independently:

```bash
cd webview-ui
npm install
npm run build
```

## Workflow

1. **One Multica issue → one PR → one merge.** Issues live under the `pixel-agent` Multica project.
2. **Branch naming**: `feat/<issue-slug>` (e.g. `feat/b2v2-openclaw-ws`).
3. **Commits** use Conventional Commits format (semantic-pr-title CI enforces this on PR titles).
4. **Stack PRs** when a feature naturally depends on an in-flight one — set the base of your PR to the dependency branch, not `main`.
5. **Review**: each PR is assigned to `@claude-dev` for review. Address feedback, then merge.
6. **CI must pass**: `web/` build, `webview-ui/` build, gitleaks scan.

## Coding conventions

- TypeScript strict mode; no `any` unless commented why
- ESM imports with `.js` extensions (Node ESM convention)
- Constants in `webview-ui/src/constants.ts` — no bare numeric sentinels
- Pixel renderer code lives in `webview-ui/src/office/`; server adapters in `web/src/`

## Plan and roadmap

See `plans/PLAN_V2.md` for the active roadmap (Epic A: web-only restructure; Epic B: OpenClaw agent support).
