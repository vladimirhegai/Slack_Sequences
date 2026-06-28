# CLAUDE.md — Sequences for Slack (hackathon app)

This is the **active** app: a Slack agent for the **Slack Agent Builder
Challenge** (~16 days). It turns product-launch context in Slack into an
editable Sequences video draft.

> **Spec:** [SLACK_PLAN.md](SLACK_PLAN.md) — read it first. It is prioritized
> hackathon-fit → use case → architecture → demo → 15-day timeline, and maps every
> Slack action onto the real Sequences engine (§7 lists the foundation that already
> exists). **Hackathon rules:** [HACKATHON_RULES.md](HACKATHON_RULES.md) (deadline,
> tracks, judging). Don't re-derive any of this; it's there.

The rest of the repo (Forge, Sequences, the shared engine) is **paused** — see
[../../CLAUDE.md](../../CLAUDE.md) and [../../docs/paused/](../../docs/paused/).

> **Two-repo reality:** this dev monorepo has `apps/sequences` and `apps/forge`
> next to us. The **published repo (`Slack_Sequences`, public) ships only
> `apps/slack` + `packages/core` + `packages/platform`** — `apps/sequences` is
> NOT there. So links below to `../sequences/...` are dev-monorepo references for
> *copying glue from*; the shipped bot must never import them. Copy what you need
> into `src/engine/`.

## The isolation rule (read this twice)

`apps/slack` is a **self-contained world.** The boundary:

- ✅ **May depend on the shared packages**: `@sequences/core`,
  `@sequences/platform`, and pinned `@hyperframes/*@0.6.86`. These are shared
  infrastructure (the engine + host services), not the paused *apps*. Importing
  them is allowed and expected.
- ✅ **May copy files in and modify them.** Need `apps/sequences`'s render glue
  ([render.ts](../sequences/src/render.ts)) or project IO
  ([projectIo.ts](../sequences/src/projectIo.ts))? **Copy them into
  `apps/slack/src/engine/` and adapt them here.** They depend only on
  `@sequences/core` + `@sequences/platform` + `@hyperframes/producer`, all of
  which `apps/slack` declares.
- ❌ **Must NOT `import` from `apps/sequences/*` or `apps/forge/*`.** No reaching
  across app boundaries (the same rule the rest of the repo enforces).
- ❌ **Must NOT modify** `packages/core`, `packages/platform`, `apps/forge`, or
  `apps/sequences`. They are frozen. If you think you need a change there, you
  almost certainly want to copy-and-adapt inside `apps/slack` instead.

The one sanctioned way to *use* the frozen apps without importing them: **spawn
the `sequences` CLI / MCP server as a subprocess** (`node ../sequences/src/cli.ts
mcp <dir>`). That's a process boundary, not a source import — fine when it's the
simplest path. Prefer copy-in for anything you'll iterate on.

## Stack

- **[@slack/bolt](https://slack.dev/bolt-js/)** in **Socket Mode** (no public
  URL needed for events) + `dotenv`. Entry: [src/index.ts](src/index.ts).
- **`tsx`** runs the TypeScript directly (`npm run dev`). This app opts into
  `tsx` rather than the repo's Node type-stripping, so it's free to move fast.
- Node ≥ 22.18, ESM. If you import `@sequences/core`, the repo's no-build rules
  still apply to that imported surface: explicit `.ts` import extensions,
  `import type` for types, no TS enums/namespaces/parameter-properties.
- HyperFrames is pinned **`0.6.86`** — **do not float it** (see the substrate
  contract in [../../docs/paused/WORKSPACE.md](../../docs/paused/WORKSPACE.md)).

## Engine quality still binds

If/when you drive the Sequences engine (plan → compile → render), the **9 laws**
still hold — they live in `@sequences/core` and you get them for free as long as
every project change goes through `ProjectStore.apply` / `planToCommands` and you
never invent motion JSON. Reference: [../../docs/paused/WORKSPACE.md](../../docs/paused/WORKSPACE.md).

## Commands

```powershell
# from repo root
npm run dev --workspace @sequences/slack
# or from apps/slack
npm run dev
```

Secrets live in `apps/slack/.env` (gitignored). Copy [.env.example](.env.example)
and fill in `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` (Socket Mode app token).

## Layout (grow as needed)

```
apps/slack/
  manifest.json      Slack app manifest — create the app from this (scopes, /sequences,
                     🎬 shortcut, Socket Mode). Reproducible setup; see SETUP.md.
  src/
    index.ts         Bolt app: /sequences (+ demo/help), modal, 🎬 message shortcut, revise
    slackApi.ts      Slack API resilience: public-channel auto-join + actionable failures
    orchestrator.ts  createVideo() / reviseVideo() — the engine seam (MCP + fallback; presetPlan path)
    demo.ts          DEMO_BRIEF + buildDemoPlan() — the curated, model-free /sequences demo reel
    jobStore.ts      Slack interaction ↔ project-dir map (.data/jobs.json)
    blocks.ts        Block Kit builders (modal, result message)
    engine/          copied-in engine glue (do not import apps/sequences):
      projectIo.ts render.ts thumbs.ts projectTemplates.ts planRunner.ts tweakRunner.ts
      mcp.ts mcpServer.ts mcpClient.ts  templates/dashboard.svg
  scripts/
    demoSmoke.ts     model-free: applies the demo plan, asserts real thumbnails (npm run demo)
    smoke.ts         brief → plan → thumbnails → MP4, no Slack (npm run smoke)
    mcpDemo.ts        drives the MCP server end-to-end (npm run mcp:demo)
  .data/             per-project workspaces + jobs.json (gitignored, runtime)
  SETUP.md           5-min sandbox setup (create app from manifest, tokens, run)
  SLACK_PLAN.md      the hackathon spec
  .env / .env.example  secrets (gitignored) + template
```

Verify the foundation: `npm run typecheck --workspace @sequences/slack` and
`npm run test --workspace @sequences/slack` (green), plus
`npm run demo --workspace @sequences/slack` (model-free; writes real scene thumbnails
to `.data/`). `npm run mcp:demo` additionally drives the MCP server end-to-end.

## Entry points (what a user can do today)

- **`/sequences demo`** — zero-setup, deterministic *Relay v2* reel (curated plan
  → solver → thumbnails → MP4). No modal, no model, no API key. The bulletproof
  demo path and the fastest end-to-end smoke.
- **`/sequences`** — the create modal (product, what shipped, audience, tone,
  length, context) → plan → preview.
- **🎬 Make a launch video** — message shortcut; opens the modal prefilled from
  the clicked message (full thread reading is a later day).
- **`/sequences help`** — lists the above.
- **Revise** — applies a natural-language tweak and regenerates the preview.

Planned controls such as **Render HD**, **Approve & share**, and **Undo** stay
hidden until their end-to-end handlers are implemented.
