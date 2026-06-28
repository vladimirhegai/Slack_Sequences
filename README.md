# Sequences for Slack

An agentic Slack bot for the **Slack Agent Builder Challenge** that turns a
product-launch brief into a **revisable product demo video** — without leaving
Slack. The agent plans from a constrained motion catalog, renders a draft, and
posts the storyboard and video back to Slack.

> Track: **New Slack Agent** · Tech: **MCP / agentic video pipeline** on a real
> deterministic engine — not a prompt-and-pray wrapper.

## What's here

This repo is the **published subset** of a larger workspace:

- `apps/slack/` — the Slack bot (Bolt for JavaScript, Socket Mode).
- `packages/core/` — `@sequences/core`: the deterministic motion engine
  (scene graph, tokens, registry, solver, compiler, linter). Pure, zero-IO.
- `packages/platform/` — `@sequences/platform`: shared host services
  (agent providers, asset metadata, media, HyperFrames vendor resolution).
- `evals/` and `examples/forge/extensions/` — small, data-only fixtures required
  by the shared engine tests; the Forge application itself is not published.

Read [apps/slack/CLAUDE.md](apps/slack/CLAUDE.md),
[apps/slack/SLACK_PLAN.md](apps/slack/SLACK_PLAN.md), and
[apps/slack/HACKATHON_RULES.md](apps/slack/HACKATHON_RULES.md).

## What works today

- `/sequences demo` builds a deterministic five-scene Relay v2 reel with no
  model or API key.
- `/sequences` and the **🎬 Make a launch video** message shortcut collect a
  launch brief and run the planning pipeline.
- Storyboard thumbnails are posted with `files.uploadV2`; MP4 export is posted
  when FFmpeg is available.
- **Revise** applies a deterministic or model-backed tweak and rebuilds the
  preview.
- The same engine can be driven over the included MCP server.

## Setup and run

```bash
npm install
cp apps/slack/.env.example apps/slack/.env   # fill in SLACK_BOT_TOKEN + SLACK_APP_TOKEN
npm run dev
```

Create or update the Slack app from
[apps/slack/manifest.json](apps/slack/manifest.json), then reinstall it whenever
OAuth scopes change. The complete five-minute walkthrough is in
[apps/slack/SETUP.md](apps/slack/SETUP.md).

Node ≥ 22.18. Rendering previews additionally needs Chrome/Edge (and FFmpeg for
MP4).

## Verify

```bash
npm run typecheck
npm test
npm run demo --workspace @sequences/slack
npm run mcp:demo --workspace @sequences/slack
```
