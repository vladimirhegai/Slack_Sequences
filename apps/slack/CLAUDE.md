# Sequences for Slack — agent notes

This is the active Slack app. Read [SLACK_PLAN.md](SLACK_PLAN.md) for the
current product state and HyperFrames direction, then
[HACKATHON_RULES.md](HACKATHON_RULES.md) for challenge constraints.

## Architectural position

HyperFrames is now the preferred creative and rendering foundation. Sequences
still supplies useful deterministic structure: typed plans and commands,
project validation, journaling, linting, and reliable Slack delivery. Forge is
paused, although its Stage/component-making ideas may return as agent tools.

The current implementation is transitional: a planning brain retrieves
HyperFrames skill knowledge but still emits a Sequences Plan/Command payload.
Do not describe that as direct freeform HyperFrames authoring yet.

## App isolation

`apps/slack` must remain publishable without the paused apps:

- It may import `@sequences/core`, `@sequences/platform`, and its declared
  `@hyperframes/*` npm packages.
- It must not import `apps/sequences/*` or `apps/forge/*`.
- Engine glue needed by Slack belongs in `src/engine/`.
- Changes for this app should not modify `apps/sequences`, `apps/forge`, or
  shared packages unless the task explicitly expands that scope.

The public Slack repo contains this app plus shared packages, so cross-app
relative imports will break after publishing.

## MCP path

MCP is the default for create, revise, thumbnails, and MP4 rendering.
`SLACK_SEQUENCES_USE_MCP=0` is a diagnostic opt-out.

The normal call sequences are:

- create: `submit_plan` → `render_preview` → `render`;
- revise: `apply_commands` → `render_preview` → `render`.

Keep the in-process fallback behaviorally equivalent and narrow. Every actual
MCP attempt must remain visible through the argument-free tool receipt. Do not
put plan content, command arguments, credentials, or model output in a Slack
receipt.

`/sequences demo` remains model-free. Routing its deterministic mutation and
rendering through MCP does not make it non-deterministic.

## HyperFrames source and skills

- [`skills/`](skills) contains all 19 upstream HyperFrames skills, intact.
- [`skills-manifest.json`](skills-manifest.json) records the imported catalog.
- [`src/agent/skillContext.ts`](src/agent/skillContext.ts) performs deterministic
  bounded retrieval for the planning/revision prompts.
- [`vendor/hyperframes`](vendor/hyperframes) is a trimmed `0.7.17` source/docs
  snapshot. See [`UPSTREAM.md`](vendor/hyperframes/UPSTREAM.md) for provenance
  and what was intentionally omitted.

The skills are prompt-engineering inputs for the Sequences agent. Their workflow
commands are not automatically executed by the Slack process. Preserve the
prompt boundary that says they are reference knowledge and that the response
must still satisfy the typed Sequences JSON contract.

The production npm packages remain pinned at `0.6.86` until a separate `0.7.x`
migration proves compiler/render compatibility. Do not silently point runtime
imports into the vendored snapshot.

## Two-tier delivery contract

Create and revise must preserve this order:

1. apply the plan/commands;
2. create and upload thumbnails;
3. update the message to “rendering”;
4. render asynchronously;
5. update to ready/unavailable and upload MP4 when present.

Missing Chrome/FFmpeg or a render failure must leave a valid thumbnails-only
result. Background Slack API errors must be logged and contained.

## Layout

```text
apps/slack/
  src/
    index.ts                  Bolt listeners + two-tier delivery
    orchestrator.ts           create/revise + MCP/fallback + receipts
    blocks.ts                 Block Kit UI
    jobStore.ts               Slack job ↔ project directory
    slackApi.ts               Slack API resilience
    agent/skillContext.ts     HyperFrames skill retrieval
    engine/                   self-contained Sequences/MCP/render glue
  skills/                     complete upstream HyperFrames skill catalog
  vendor/hyperframes/         trimmed upstream source/docs snapshot
  scripts/                    demo, smoke, MCP demo
  test/                       Slack/UI/retrieval tests
  .data/                      runtime projects and jobs (gitignored)
```

## Verification

From the repository root:

```powershell
npm run typecheck --workspace @sequences/slack
npm run test --workspace @sequences/slack
npm run mcp:demo --workspace @sequences/slack
npm run demo --workspace @sequences/slack
```

For the slower real MP4 check:

```powershell
$env:VERIFY_RENDER='1'
npm run demo --workspace @sequences/slack
```

Only expose Slack controls after their complete handler and failure path exist.
Render HD, Approve/Share, Undo, full-thread ingestion, and conversational
reply-to-revise are not built yet.
