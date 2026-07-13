# Sequences for Slack

An agentic Slack bot for the **Slack Agent Builder Challenge** that turns a
product-launch brief — or a whole release thread — into a **revisable product
demo video**, without leaving Slack. One persistent Luna/Codex CLI director
thread writes native HyperFrames HTML/CSS/GSAP, a deterministic gate validates
it, and Slack receives the storyboard followed by the rendered video.

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
- `packages/core/test/fixtures/` — small, data-only fixtures required by the
  shared engine tests.

Read [apps/slack/CLAUDE.md](apps/slack/CLAUDE.md),
[apps/slack/OPERATIONS.md](apps/slack/OPERATIONS.md),
[apps/slack/LUNA_WORKFLOW.md](apps/slack/LUNA_WORKFLOW.md), and
[apps/slack/REFACTOR_HANDOFF.md](apps/slack/REFACTOR_HANDOFF.md).

## What works today

- `/sequences demo` builds a deterministic five-scene Relay v2 reel with no
  model or API key.
- `/sequences` and the **🎬 Make a launch video** message shortcut collect a
  launch brief; the shortcut reads the whole release **thread** for context.
- The default author is `gpt-5.6-luna` at high reasoning in a private Railway
  Codex worker. One exact thread owns treatment, local assets, motion intent,
  source, rendered self-review, and structural revisions. OpenRouter is only an
  explicit legacy rollback and is never an automatic fallback.
- `/sequences assets` deterministically captures approved brand screenshots;
  the host hashes/copies them into Luna's isolated workspace before authoring.
- **Two-tier delivery**: storyboard thumbnails post in seconds (`files.uploadV2`),
  then the rendered MP4 replaces them inline when it's ready.
- **Revise**, **Undo**, and **Approve & share** (repost the finished reel to
  another channel) run in-channel.
- Direct films can use **typed cuts plus a continuous spatial-world camera rig**
  (host-owned camera paths over larger `data-camera-world` scenes) with the same
  deterministic validation/injection model.
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

Ordinary authoring also requires the private `apps/slack/codex-worker` with a
persisted logged-in `CODEX_HOME`; see the Luna workflow. `/sequences demo`
remains model-free.

Node ≥ 22.18. Rendering previews additionally needs Chrome/Edge (and FFmpeg for
MP4).

## Verify

```bash
npm run typecheck
npm test
npm run demo --workspace @sequences/slack
npm run mcp:demo --workspace @sequences/slack
npm run direct:demo --workspace @sequences/slack
npm test --prefix apps/slack/codex-worker
```
