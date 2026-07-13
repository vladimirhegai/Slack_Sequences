# Sequences for Slack — agent guide

Sequences turns a Slack release brief into a storyboard, preview, and MP4. The
app is Bolt + Socket Mode and runs TypeScript through `tsx`.

Keep the active documentation set small:

- [REFACTOR_PLAN.md](REFACTOR_PLAN.md): the ACTIVE step-by-step refactor work
  order — if you are here for refactor work, follow its agent protocol.
- [OPERATIONS.md](OPERATIONS.md): local probes, publish, deploy, and recovery.
- [LUNA_WORKFLOW.md](LUNA_WORKFLOW.md): default author route, worker security,
  asset/session contract, and explicit legacy rollback.
- [SENTINEL.md](SENTINEL.md): correctness ownership, retries, and fallback.
- [PROBE_LOG.md](PROBE_LOG.md): current paid-probe evidence.
- [REFACTOR_HANDOFF.md](REFACTOR_HANDOFF.md): architecture rationale behind
  the plan.

Current state (2026-07-13): Luna direct is the default creative route. The
S6.9-S6.13 OpenRouter stabilization work is historical evidence, not the live
orchestration path. Do not restart its paid-probe loop.

## Delivery and scope

Slack work publishes to **https://github.com/vladimirhegai/Slack_Sequences**.
This monorepo is only the development workspace. From the repository root:

```bash
bash scripts/publish-public.sh "type(scope): concise message"
```

Publishing and deploying are separate. The live sandbox changes only after
deploying the exact clean `.publish` snapshot with `railway up`. Never publish
or deploy unless the user explicitly asks.

Active work lives in `apps/slack`. It may use `@sequences/core`,
`@sequences/platform`, and pinned HyperFrames packages. The retired app/studio
trees are gone (REFACTOR_PLAN.md Phase P); never recreate or import from them.
Treat `packages/*` as stable dependencies.

## Model boundaries

There are two different bots and one deterministic engine:

1. `src/slackMcpContext.ts` uses the OpenAI Responses API and Slack hosted MCP
   with the invoking user's OAuth token. This path requires `OPENAI_API_KEY`.
2. `src/engine/lunaRoute.ts` sends verified facts/assets to the private
   `codex-worker`, where one persistent Codex CLI thread runs
   `gpt-5.6-luna` with high reasoning. That thread owns treatment, assets,
   motion intent, storyboard, source, rendered self-review, and structural
   revisions. `src/engine/runner/` is frozen behind the explicit
   `legacy-provider` rollback route; it is never an automatic fallback.
3. The internal Sequences MCP owns deterministic mutation, preview, render,
   and undo for accepted compositions.

Editable Luna prompts belong in `prompts/luna-*.md`; the legacy planning prompt
remains for rollback. Runtime facts and approved asset manifests are job-local
files, while typed host contracts remain in source.

## Execution contract

The default Luna pipeline is staged and transactional:

1. Collect the brief and permission-scoped Slack evidence.
2. Copy/hash approved `/sequences assets` files into an isolated worker job.
3. The same Luna thread chooses treatment and assets, declares motion intent,
   and authors storyboard plus complete seekable source.
4. Preserve exact raw bytes, validate declared selectors and local assets, then
   run the existing static and real-browser direct-composition gate.
5. Checkpoint accepted source and return thumbnails/evidence to the exact Luna
   thread for zero or one self-directed polish pass.
6. Revalidate changed bytes, render the MP4, and preserve hashes/evidence.
7. Resume the exact thread ID for structural revisions; never use `--last`.

The legacy frame/storyboard/scaffold/repair pipeline stays unchanged behind
`SLACK_SEQUENCES_AUTHOR_ROUTE=legacy-provider`.

`SLACK_SEQUENCES_USE_MCP=0` is diagnostic only. Receipts never contain prompts,
credentials, workspace content, plan data, or model output.

## Ownership and motion truths

- The host owns verified facts, permissions, asset/source hashes, local-only
  execution, runtimes, scene windows, seek semantics, browser/encoding health,
  checkpointing, and delivery.
- Luna owns concept, structure, art direction, screen copy within verified
  facts, assets, layout, transition/camera choice, pacing, and choreography.
- Plugins and assets lower into ordinary components and beats. Recipes are
  proven fragments; reconciliation is degrade-never-veto.
- Continuity and camera blocking are default-on. Stable `entityId`s should
  produce measured shared-element handoffs and one primary lens route.
- Supporting phrases do not move the lens. Camera fitting uses painted content,
  not empty station boxes.
- Ambient motion belongs on imagery, furniture, and light. Primary copy holds
  still while it is meant to be read.
- A gesture follows anticipation → action → settle → readable hold. The film
  gets one energy peak; connective motion stays subordinate.
- A green JSON report is not a motion-quality pass. Inspect representative
  frames and blocking evidence, then read the motion code for movement between
  those frames.
- Preserve creative ownership. Host repairs may correct contracts, bindings,
  measured frame containment, and camera/station fit. They must not rewrite
  copy, story order, component choice, beat timing, palette, typography, or
  motion style merely to satisfy a taste heuristic.

The authoritative environment-variable registry is
`src/engine/featureFlags.ts`. Do not add an unregistered
`SLACK_SEQUENCES_*` read.

## Failure discipline

Read [SENTINEL.md](SENTINEL.md) before adding a rule or repair. The existing
Sentinel committee applies to the legacy route; Luna currently reuses only its
objective direct-composition mechanics. Put each
obligation at the lowest layer that can own it: schema, scaffold,
deterministic normalize, static gate, browser gate, then paid retry. Register
finding classes in `src/engine/sentinel.ts`.

For a paid attempt or fallback:

1. Stop the retry loop when practical.
2. Preserve the exact rejected artifact.
3. Reproduce it without a model call.
4. Fix only the shared deterministic cause and add a minimized regression.
5. Record it in [PROBE_LOG.md](PROBE_LOG.md), then rerun only if authorized.

Classify before acting: runtime/schema failures are hard; host-known mechanical
defects belong to one bounded deterministic repair; taste preferences remain
visible advisories and do not trigger another author call or probe. Never raise
attempt counts, loosen a hard gate, or add prompt prose merely to hide a
mechanical failure. A Luna-authored defect should eventually return to the same
thread with exact evidence; do not rebuild the old repair committee around it.

## Safety and verification

Railway owns the only live Socket Mode process. Never copy Railway tokens into
local `.env` or start a second process with sandbox credentials.

Fast loop:

```powershell
npm run typecheck --workspace @sequences/slack
npm run test:unit --workspace @sequences/slack
npm run test:browser --workspace @sequences/slack
```

Source gate:

```powershell
npm run mcp:demo --workspace @sequences/slack
npm run direct:demo --workspace @sequences/slack
npm run sequence:check --workspace @sequences/slack -- --demo --no-mcp --format both
```

Runtime, camera, cut, render, or temporal changes also require the relevant
browser tests and a rendered golden/probe inspection. Report exactly what ran;
unit tests do not prove OAuth, Slack upload, Railway, or visual quality.
