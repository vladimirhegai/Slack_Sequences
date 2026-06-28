# CLAUDE.md — Sequences for Slack (published repo)

This is the **public subset** of a larger private monorepo. It contains only the
Slack bot and the shared engine it depends on:

- `apps/slack/` — the bot. **Start here:** [apps/slack/CLAUDE.md](apps/slack/CLAUDE.md).
- `packages/core/`, `packages/platform/` — the tested shared Sequences engine
  snapshot. Prefer app-local adapters for hackathon iteration; change shared
  packages only deliberately and with their full test suite.

`apps/sequences` and `apps/forge` are **not** in this repo — they live in the
private dev monorepo. When the bot needs host glue (render, project IO, plan
runner), we **copy it into `apps/slack/src/engine/`** and adapt it. The bot must
never depend on code outside this repo.

`evals/` and `examples/forge/extensions/` contain only data fixtures used by the
shared engine tests; they are not application dependencies.

Hackathon plan: [apps/slack/SLACK_PLAN.md](apps/slack/SLACK_PLAN.md).
Hackathon rules: [apps/slack/HACKATHON_RULES.md](apps/slack/HACKATHON_RULES.md).

## Commands

```bash
npm run dev          # run the Slack bot (Socket Mode)
npm run typecheck    # tsc --noEmit over packages + apps/slack
npm test             # vitest (engine + Slack edge cases)
npm run demo --workspace @sequences/slack
```
