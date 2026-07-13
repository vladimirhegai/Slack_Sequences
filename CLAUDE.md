# CLAUDE.md — Sequences for Slack (published repo)

## GitHub destination

This repository is **https://github.com/vladimirhegai/Slack_Sequences**. Push
Slack app changes here. If you are working from the larger `Sequences`
development monorepo, publish its standalone subset with
`scripts/publish-public.sh`; do not use the monorepo GitHub remote as the Slack
delivery destination.

This is the **public subset** of a larger private monorepo. It contains only the
Slack bot and the shared engine it depends on:

- `apps/slack/` — the bot. **Start here:** [apps/slack/CLAUDE.md](apps/slack/CLAUDE.md).
- `packages/core/`, `packages/platform/` — the shared Sequences engine. Ours to
  modify/harden for the hackathon.

When the bot needs host glue (render, project IO, plan runner), we **copy it
into `apps/slack/src/engine/`** and adapt it. The bot must never depend on code
outside this repo.

Current architecture handoff: [apps/slack/REFACTOR_HANDOFF.md](apps/slack/REFACTOR_HANDOFF.md).
Default Luna route: [apps/slack/LUNA_WORKFLOW.md](apps/slack/LUNA_WORKFLOW.md).
Operations: [apps/slack/OPERATIONS.md](apps/slack/OPERATIONS.md).

## Commands

```bash
npm run dev          # run the Slack bot (Socket Mode)
npm run typecheck    # tsc --noEmit over packages + apps/slack
npm test             # vitest (engine suite)
npm test --prefix apps/slack/codex-worker # private worker contract suite
```
