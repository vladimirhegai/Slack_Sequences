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

`apps/sequences` and `apps/forge` are **not** in this repo — they live in the
private dev monorepo. When the bot needs host glue (render, project IO, plan
runner), we **copy it into `apps/slack/src/engine/`** and adapt it. The bot must
never depend on code outside this repo.

Hackathon roadmap: [apps/slack/ROADMAP.md](apps/slack/ROADMAP.md).
Hackathon rules: [apps/slack/HACKATHON_RULES.md](apps/slack/HACKATHON_RULES.md).

## Commands

```bash
npm run dev          # run the Slack bot (Socket Mode)
npm run typecheck    # tsc --noEmit over packages + apps/slack
npm test             # vitest (engine suite)
```
