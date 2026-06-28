# Sequences for Slack

An agentic Slack bot for the **Slack Agent Builder Challenge** that turns a
product-launch brief into an **editable product demo video** — without leaving
Slack. The agent plans the video from a constrained motion catalog (so it's
always on-brand and well-timed), renders a draft, and posts it back for
one-click revision.

> Track: **New Slack Agent** · Tech: **MCP / agentic video pipeline** on a real
> deterministic engine — not a prompt-and-pray wrapper.

## What's here

This repo is the **published subset** of a larger workspace:

- `apps/slack/` — the Slack bot (Bolt for JavaScript, Socket Mode).
- `packages/core/` — `@sequences/core`: the deterministic motion engine
  (scene graph, tokens, registry, solver, compiler, linter). Pure, zero-IO.
- `packages/platform/` — `@sequences/platform`: shared host services
  (agent providers, asset metadata, media, HyperFrames vendor resolution).

Read [apps/slack/CLAUDE.md](apps/slack/CLAUDE.md),
[apps/slack/SLACK_PLAN.md](apps/slack/SLACK_PLAN.md), and
[apps/slack/HACKATHON_RULES.md](apps/slack/HACKATHON_RULES.md).

## Run

```bash
npm install
cp apps/slack/.env.example apps/slack/.env   # fill in SLACK_BOT_TOKEN + SLACK_APP_TOKEN
npm run dev
```

Node ≥ 22.18. Rendering previews additionally needs Chrome/Edge (and FFmpeg for MP4).
