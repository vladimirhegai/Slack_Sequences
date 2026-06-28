# CLAUDE.md — Sequences for Slack (hackathon app)

This is the **active** app: a Slack agent for the **Slack Agent Builder
Challenge** (~16 days). It turns product-launch context in Slack into an
editable Sequences video draft.

> **Spec:** [SLACK_PLAN.md](SLACK_PLAN.md) — read it first (start with
> *Tonight's foundation sprint*). It maps every Slack action onto the real
> Sequences engine. **Hackathon rules:** [HACKATHON_RULES.md](HACKATHON_RULES.md)
> (deadline, tracks, judging). Don't re-derive any of this; it's there.

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
  src/
    index.ts      Bolt app: slash command, modal, buttons, events
    engine/       (copied-in engine glue — render, projectIo — when wiring renders)
  SLACK_PLAN.md   the hackathon spec
  .env            secrets (gitignored)
  .env.example    template
```
