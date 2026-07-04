# HANDOFF — next session (updated 2026-07-04, performance pass)

Both 2026-07-03 goals (speed ramping, shape-match v2 discovery) are **BUILT
and live**; their breakthrough docs are retired — the shipped designs live in
ROADMAP ("Speed ramping + shape-match discovery (2026-07-04)") and CLAUDE.md.
The only surviving plan doc is [PLAN_camera_depth_level2.md](PLAN_camera_depth_level2.md)
(unbuilt, fenced).

## What shipped this session (2026-07-04, later): the performance pass

A 15s `/sequences` create was taking up to ~15 minutes. Profiling a healthy
paid run showed 527s wall-clock (storyboard+concept 148s, author chain 277s,
commit re-QA 12s, render 81s) — ~80% serial model time, with stalls/retries
supplying the rest. Four quality-neutral changes (no prompt, model, reasoning,
or QA-threshold changes; deterministic gates still decide what ships):

1. **Stream idle watchdog** — streaming calls abort after 90s with no token
   and retry as transient (`SLACK_SEQUENCES_STREAM_IDLE_TIMEOUT_MS`).
2. **Hedged requests** (`hedgedCompletion`, OpenRouter only) — a duplicate
   launches after 25s; first completion wins, loser aborted. Never replaces
   the serial retry loop (fast failures reject immediately). Kill switch
   `SLACK_SEQUENCES_HEDGED_REQUESTS=0`, delay `SLACK_SEQUENCES_HEDGE_DELAY_MS`.
   Costs ≤2× tokens on slow calls — policy is quality > price.
3. **Browser-QA cache** — clean `inspectDirectComposition` results cached in
   `<projectDir>/qa-cache/` by html+storyboard+runtime+audit hash; the commit
   re-inspection (MCP subprocess) becomes a file read. Only `ok` non-infra
   results are cached. Kill switch `SLACK_SEQUENCES_QA_CACHE=0`. The spatial
   guide is now captured on every interaction pass so cached results are
   supersets.
4. **MCP connection pool** (`withPooledMcpClient`) — one server per job
   across submit/preview/render; idle unref+close after 45s.

Live-verified with two paid probes on the optimized pipeline: probe-2
(Pulseboard) PASSED direct with hedges winning 3× and the commit re-QA served
from cache (submit_composition 12.2s → 1.2s); probe-3 (Ledgerline) hit the
pre-existing deterministic fallback after the author chain failed its 3
bounded repairs on a component-beat binding — a model-content failure, the
designed degrade, not a perf regression (hedge/watchdog/pool all behaved).

Docs: retired `BREAKTHROUGH_{match_cut,speed_ramping,camera_depth}.md`
(level-2 remainder → `PLAN_camera_depth_level2.md`); added
`docs/RECIPE_STUDIO_PLAN.md` (monorepo root) — the seed plan for the
operator-facing Recipe Studio (lite editor + chat + recipes exported as
retrievable skills). A follow-up agent is expected to enhance that plan.

## Read first

1. [CLAUDE.md](CLAUDE.md) — two bots, isolation, determinism boundary,
   verification ladder, publish-vs-deploy.
2. [ROADMAP.md](ROADMAP.md) — current state; the 2026-07-04 sections are the
   latest inventory (features, then performance).

## Candidate next goals (in rough order of leverage)

1. **Recipe Studio M1–M2** (`docs/RECIPE_STUDIO_PLAN.md`) — local cockpit over
   the engine + recipes-as-skills retrieval; golden recipe: last-word
   roulette.
2. **Rendered temporal judge** — promote rendered temporal evidence into the
   live publication boundary (see ROADMAP 2026-07-03 note); hard parts are
   cost budgets and false-positive control.
3. **Camera depth level 2** — fenced; see PLAN_camera_depth_level2.md (whip
   blur must relocate off the world element first).
4. **Audio** — any soundtrack must be remapped through the same warp knots
   (`sequences-time.v1.js` header note). Do not add audio without it.

## Gotchas that will save you hours (inherited + new)

1. **Injection anchors are load-bearing.** The compile-call injections anchor
   on the registration line; the time-wrap rewrite must stay LAST and
   `timelineRegistrationAnchor` must keep matching both plain and wrapped
   forms. `test/timeRamp.test.ts` "all-five-contracts injection regression"
   guards this — keep it green.
2. **Time bases**: content (timeline) time everywhere except the enumerated
   viewer-time consumers. A new consumer that physically seeks the registered
   timeline converts via `warpInverseOf(parseTimeRampPlan(html).plan)` at the
   seek — and nowhere else.
3. **Bump the storyboard cache `contract`** (now v6) whenever the storyboard
   shape changes — and bump `QA_CACHE_VERSION` in `layoutInspector.ts`
   whenever inspector semantics change (runtime/audit content is already in
   the key; version covers logic-only changes).
4. **Vitest root gotcha**: always `npm run test --workspace @sequences/slack`
   (never `npx vitest run --root ../..` from the monorepo root).
5. **`sequence:check` job dirs are immutable** — a retried live probe needs a
   fresh `--job-id` (and re-spends the concept call).
6. **Paid live probe recipe**: set `$env:OPENROUTER_API_KEY`, then
   `npm run sequence:check --workspace @sequences/slack -- --product ...
   --what "<brief>" --provider openrouter-api --job-id <id> --format both`;
   inspect `.data/projects/<id>/planning/storyboard.json` and the report's
   `authoringMode`/`fallbackStage`. Stage receipts carry per-stage
   durations; `--no-mcp` isolates engine issues from the MCP transport.
7. **Test styling via classes, not `data-part` attribute selectors** — bridge
   clones strip `data-part`.
8. Finish = commit → `bash scripts/publish-public.sh "<msg>"` (publishes
   HEAD; commit first) → `railway up` (publish does NOT deploy) → poll
   `railway deployment list` (old instance answers `ready` on `/healthz`).
9. **DeepSeek does not keep geometry discipline from prose** — that is why
   cut discovery upgrades from measured geometry. Keep the scorer's caps
   tighter than the runtime degrade so the host's own choice can never
   degrade.
10. **When a repair loop fails 3× on the same finding, suspect the finding**
    (the FP clip-overlap incident).
11. **Post-authoring passes must re-inject from the SHIPPED storyboard**
    (`result.draft.storyboard`), never `args.lockedStoryboard`: authoring may
    have quarantined an optional interaction, and the stale plan resurrects
    the proven-broken binding. Any NEW post-authoring pass must follow the
    same rule.
12. **New plan-gate rules must not veto volunteered enhancements.** When you
    add typed vocabulary + gates, always ask: what happens when the model
    volunteers it badly on a brief that never asked? Degrade, don't block —
    reserve blocking findings for brief-derived requirements
    (`dropUnusableVolunteeredTimeRamps` is the template).
13. **A pooled/unref'd child process must be re-`ref()`ed while awaited** —
    an unref'd MCP client awaited with no other live handles lets node exit
    silently mid-build with code 0 (cost this session: one mystery
    3-second "successful" demo run).
14. **Hedging must never replace the retry loop.** A fast primary failure
    rejects immediately; only a *slow* primary earns a duplicate. The
    directComposition retry-contract tests encode this — if they start
    counting extra calls, the hedge is misbehaving.
