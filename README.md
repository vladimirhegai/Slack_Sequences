# Sequences for Slack

An agentic Slack bot for the **Slack Agent Builder Challenge** that turns a
product-launch brief — or a whole release thread — into a **revisable product
demo video**, without leaving Slack. The authoring bot writes native HyperFrames
HTML/CSS/GSAP, a deterministic gate validates it, and Slack receives the
storyboard followed by the rendered video.

This is the canonical Slack app repository:
**https://github.com/vladimirhegai/Slack_Sequences**.

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
[apps/slack/ROADMAP.md](apps/slack/ROADMAP.md), and
[apps/slack/HACKATHON_RULES.md](apps/slack/HACKATHON_RULES.md).

## What works today

- `/sequences demo` builds a deterministic five-scene Relay v2 reel with no
  model or API key.
- `/sequences` and the **🎬 Make a launch video** message shortcut collect a
  launch brief; the shortcut reads the whole release **thread** for context.
- **Two-tier delivery**: storyboard thumbnails post in seconds (`files.uploadV2`),
  then the rendered MP4 replaces them inline when it's ready.
- **Revise**, **Undo**, and **Approve & share** (repost the finished reel to
  another channel) run in-channel.
- Composition checkpoint / preview / render / undo are driven over the included **MCP server**
  (with an in-process fallback); each result shows a tool receipt.

## Setup and run

```bash
npm install
cp apps/slack/.env.example apps/slack/.env   # fill in SLACK_BOT_TOKEN + SLACK_APP_TOKEN
npm run dev
```

Create or update the Slack app from
[apps/slack/manifest.json](apps/slack/manifest.json), then reinstall it whenever
OAuth scopes change. The complete setup + deploy walkthrough is in
[apps/slack/OPERATIONS.md](apps/slack/OPERATIONS.md).

Node ≥ 22.18. Rendering previews additionally needs Chrome/Edge (and FFmpeg for
MP4).

## Verify

```bash
npm run typecheck
npm test
npm run demo --workspace @sequences/slack
npm run mcp:demo --workspace @sequences/slack
npm run direct:demo --workspace @sequences/slack
```
