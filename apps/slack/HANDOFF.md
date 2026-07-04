# HANDOFF — next session (written 2026-07-04)

The 2026-07-03 handoff is **complete**: both goals shipped, full gate green
(301 tests), `VERIFY_RENDER=1 npm run film:demo` green, paid live create run.

## What shipped this session (2026-07-04)

**Goal A — speed ramping / time remapping** (`BREAKTHROUGH_speed_ramping.md`
is now BUILT). `timeRamp` is the fifth host-owned contract:

- `engine/timeRamp.ts` — net-zero piecewise-linear knot solver
  (`resolveTimeRampPlan`), `warpOf`/`warpInverseOf` (both sides interpolate
  the island's knot table; no solver logic in JS), `parseTimeRampPlan`,
  `validateTimeRampContract` (island byte-equality + runtime tag + wrapped
  registration), `normalizeStoryboardTimeRamp`, `timeRampHoldWindow`.
- `templates/sequences-time.v1.js` — `SequencesTime.wrap(tl)` builds a paused
  equal-duration master whose one `ease:"none"` proxy tween seeks the content
  timeline at `warp(masterTime)`; no island → returns `tl` unchanged. The
  child is never registered; it is exposed as `master.__seqChild` for QA
  tween-boundary introspection. Header carries the audio-remap note.
- The registration rewrite is the **LAST** injection in
  `applyDeterministicSourceRepairs`, and all four compile-call injection
  anchors were extended to also match the wrapped registration
  (`timelineRegistrationAnchor`) so repairs re-enter safely after the wrap
  exists (critic patches, cut-discovery upgrades). Regression-tested.
- QA converts time bases ONLY at the physical-seek choke points
  (`layoutInspector` `seekContent`, `generateDirectThumbnails`,
  `temporalInspector`); genuine viewer-time math lives in `motionDensity`
  (quiet gaps) and `storyboardMoments` (spacing/dead intervals). Evidence
  binding stays content time.
- Plan gates: never shot 1, max 2 per film, solvable inside
  `[sceneStart+0.3, sceneEnd−exitSec−0.6]`, catch-up ≤2.5× (recovery
  stretches first), and a declared moment must sit inside the slow-motion
  hold. `requireTimeRamp` fires on "speed ramp / slow motion / time remap"
  briefs. Storyboard cache contract is now **v6**.
- Deterministic proofs: fallback film (12s+) dips 0.45× on `proof-reveal`;
  `film:demo` dips 0.4× at 17.1s. Both passed the full gate and the MP4
  render gate.

**Goal B — shape-match v2, measure-then-upgrade** (`BREAKTHROUGH_match_cut.md`
v2 is now BUILT):

- `layoutInspector.ts` measures per-boundary visible `data-part` geometry
  (rect, %-resolved radius, node count, on-frame ratio) at `atSec − 0.15` /
  `atSec + entrySec` → `DirectBrowserQaResult.boundaries`.
- `engine/cutDiscovery.ts` — pure scorer: aspect cap 2.0× (tighter than the
  runtime's 2.5× degrade), ≤60 nodes, ≥65% on-frame, area ratio ≤6, radius
  rhyme weighted 0.45, component-id/continuity-anchor bonus, floor 0.55,
  max ONE upgrade per film, only `hard`/directional boundaries.
- `applyShapeMatchUpgrade` (`compositionRunner.ts`) runs BEFORE the critic:
  mutates the locked storyboard, re-runs repairs + static validation +
  browser QA, rejects on any regression or a bind-time degrade of the new
  boundary, persists the mutated storyboard everywhere downstream (result
  draft → manifest/moments/motion-plan/STORYBOARD.md, plus
  `planning/storyboard.json`). Kill-switch `SLACK_SEQUENCES_CUT_DISCOVERY=0`.
- `CompositionRunResult` now carries `browserQa` so the upgrade reuses the
  authoring pass's inventory instead of a redundant browser run.

Details + proof inventory: ROADMAP.md "Speed ramping + shape-match discovery
(2026-07-04)".

## Read first

1. [CLAUDE.md](CLAUDE.md) — two bots, isolation, determinism boundary,
   verification ladder, publish-vs-deploy.
2. [ROADMAP.md](ROADMAP.md) — current state; the 2026-07-04 section is this
   session's inventory.

## Candidate next goals (in rough order of leverage)

1. **Rendered temporal judge** — the standing breakthrough candidate (see the
   ROADMAP note under the 2026-07-03 section): promote rendered temporal
   evidence into the live publication boundary — a seek-and-render pass that
   proves primary storyboard moments are perceptually distinct and legible,
   with bounded repair directives. `temporalInspector.ts` supplies sampling
   and change curves; the hard parts are cost budgets, hold-friendly
   thresholds, and false-positive control.
2. **Camera depth level 2** (per-layer `translateZ` under `preserve-3d`) —
   still fenced off: requires relocating whip blur off the world element
   first; needs its own plan.
3. **Audio** — any soundtrack must be remapped through the same warp knots
   (`sequences-time.v1.js` header note). Do not add audio without it.

## Gotchas that will save you hours (inherited + new)

1. **Injection anchors are load-bearing.** The four compile-call injections
   anchor on the registration line; the time-wrap rewrite must stay LAST and
   `timelineRegistrationAnchor` must keep matching both plain and wrapped
   forms. `test/timeRamp.test.ts` "all-five-contracts injection regression"
   guards this — keep it green.
2. **Time bases**: content (timeline) time everywhere except the enumerated
   viewer-time consumers. If you add a new consumer that physically seeks the
   registered timeline, convert via `warpInverseOf(parseTimeRampPlan(html).plan)`
   at the seek — and nowhere else.
3. **Bump the storyboard cache `contract`** (now v6) whenever the storyboard
   shape changes.
4. **Vitest root gotcha**: always `npm run test --workspace @sequences/slack`
   (never `npx vitest run --root ../..` from the monorepo root).
5. **`sequence:check` job dirs are immutable** — a retried live probe needs a
   fresh `--job-id` (and re-spends the concept call).
6. **Paid live probe recipe**: set `$env:OPENROUTER_API_KEY`, then
   `npm run sequence:check --workspace @sequences/slack -- --product ...
   --what "<brief>" --provider openrouter-api --no-mcp --job-id <id>
   --format both`; inspect `.data/projects/<id>/planning/storyboard.json` and
   the report's `authoringMode`/`fallbackStage`.
7. **Test styling via classes, not `data-part` attribute selectors** — bridge
   clones strip `data-part`.
8. Finish = commit → `bash scripts/publish-public.sh "<msg>"` (publishes
   HEAD; commit first) → `railway up` (publish does NOT deploy) → poll
   `railway deployment list` (old instance answers `ready` on `/healthz`).
9. **DeepSeek does not keep geometry discipline from prose** — that is why
   discovery upgrades from measured geometry. Keep the scorer's caps tighter
   than the runtime degrade so the host's own choice can never degrade.
10. **When a repair loop fails 3× on the same finding, suspect the finding**
    (the FP clip-overlap incident).
11. **Post-authoring passes must re-inject from the SHIPPED storyboard**
    (`result.draft.storyboard`), never `args.lockedStoryboard`: authoring may
    have quarantined an optional interaction, and the stale plan resurrects
    the proven-broken binding (this rejected both a healthy cut-discovery
    upgrade and a healthy critic patch on the 2026-07-04 live run before the
    fix). Any NEW post-authoring pass must follow the same rule.
12. **New plan-gate rules must not veto volunteered enhancements.** The first
    live `/sequences` after the timeRamp deploy fell back because GLM kept
    volunteering dips that failed the new blocking gates
    (`dropUnusableVolunteeredTimeRamps` now strips them pre-validation when
    the brief doesn't demand a ramp). When you add typed vocabulary + gates,
    always ask: what happens when the model volunteers it badly on a brief
    that never asked? Degrade, don't block — reserve blocking findings for
    brief-derived requirements.
