# HANDOFF — next Fable session (written 2026-07-03)

Previous session implemented `BREAKTHROUGH_match_cut.md` **v1** (shape-match
cuts) and `BREAKTHROUGH_camera_depth.md` **level 1 + rack focus** (orbit,
`data-depth`, `focus` modifier), commit `9d24e47`, published to
`Slack_Sequences`, deployed to Railway (healthy). This file is what remains,
how to work here, and what that session learned the hard way.

## Read first, in this order

1. [CLAUDE.md](CLAUDE.md) — the two bots, isolation rule, determinism
   boundary, **verification ladder** (section you will actually re-run),
   publish-vs-deploy. Non-negotiable context.
2. [BREAKTHROUGH_speed_ramping.md](BREAKTHROUGH_speed_ramping.md) — the main
   remaining build. Already re-scoped against the real code; trust its file
   list but re-verify line numbers.
3. [BREAKTHROUGH_match_cut.md](BREAKTHROUGH_match_cut.md) — v1 is DONE; only
   the "v2 — discovery pass" section remains.
4. [ROADMAP.md](ROADMAP.md) "Shape-match cuts + camera depth (2026-07-03,
   second pass)" — exact inventory of what v1 shipped and its proof.

## Goal A — speed ramping / time remapping (the big one)

Full plan in `BREAKTHROUGH_speed_ramping.md`. The two load-bearing decisions
are already made — do not relitigate them:

- **Net-zero-per-scene warp** (`warp(t) = t` at every scene boundary) keeps
  duration, scene windows, ETA, and `cutContract.ts` untouched.
- **Nested master timeline**: wrap at the `window.__timelines[id] = tl`
  registration seam (`SequencesTime.wrap(tl)` → a paused master whose
  `ease:"none"` proxy tween seeks the content timeline at `warp(masterTime)`).
  All four existing runtimes compile against the content timeline unchanged.

Order of work is in the doc; follow it literally (solver + unit tests first,
pure Node). The one risk that can quietly ruin the app is **QA time-base
drift** — the doc's consumer list (`motionDensity`, `storyboardMoments`,
`thumbnailCaptures`, `layoutInspector` suppression windows,
`temporalInspector`) was exhaustive on 2026-07-03; re-grep for `.seek(` and
`startSec` arithmetic before trusting it, because this session added new
consumers of camera windows (orbit) and cut bindings (degrade warnings).
Planner adoption is already probe-proven; save the paid live create for last.

## Goal B — shape-match v2: the discovery pass

v1's delivery mechanism is *declare-then-hope*: GLM declares
`shape-match` up front, DeepSeek authors the two parts, and a bind-time
geometry audit degrades to zoom-through if the silhouettes don't rhyme. The
live probe proved exactly this failure: GLM planned a perfect pill→bar pair,
DeepSeek authored the status bar 11× too wide, the audit degraded it. The film
stayed sound, but the premium cut vanished.

v2 inverts the direction — *measure-then-upgrade*:

1. Post-authoring, inventory each boundary's outgoing/incoming `data-part`
   geometry from browser QA (layout samples near boundaries already measure
   rects; add border-radius + size class → a silhouette classification).
2. Score candidate pairs across each boundary (aspect ratio distance, radius
   similarity, size class, story-beat sensibility).
3. Emit **advisory findings** into the continuity critic's evidence pack
   (`requestContinuityCritique`, GLM job #3, `compositionRunner.ts` ~3463) —
   the critic decides whether to direct a patch re-declaring a boundary as
   `shape-match`. Stay inside the existing ≤5-directive critic contract; the
   patch then passes full deterministic QA like any other.

Because the pairing comes from *measured* geometry, the aspect-mismatch
failure mode is eliminated by construction. Two cautions from the live run:
(a) the critic's patch was rejected atomically for desyncing the
interactions island from the storyboard ("storyboard declares 0 interactions
but HTML binds 1") — a critic-directed cut re-declaration must update the
storyboard-side declaration AND the injected `sequences-cuts` island together
or it will always bounce; (b) re-declaring a boundary changes the resolved cut
plan, which is validated by exact JSON equality against the storyboard — go
through the storyboard, never patch the island directly.

## Not goals (fenced off deliberately)

- Camera depth **level 2** (per-layer `translateZ` under `preserve-3d`) —
  requires relocating whip blur off the world element first; own plan needed.
- Live `timeScale` tweens for ramping — banned; not seek-safe.

## How this codebase works (10-line orientation)

- Everything premium is a **host-owned typed contract**: planner (GLM)
  declares typed intent in the storyboard → a resolver in
  `src/engine/*Contract.ts` normalizes it → `compositionRunner.ts` injects a
  JSON island + versioned runtime (`src/engine/templates/sequences-*.v1.js`)
  + compile call from the *locked* storyboard → static validation proves the
  island matches the resolver's output byte-for-byte → browser QA
  (`layoutInspector.ts`) proves it runs. Four exist: cuts, camera,
  components, interactions. Speed ramping becomes the fifth; copy the pattern.
- **Enhancement-never-veto**: an unbindable declaration degrades (to `hard`,
  to no camera plan, to zoom-through), never fails the film.
- **Deterministic seek** is the one hard law: every runtime value must be a
  pure function of timeline time (fromTo + `immediateRender:false`, proxy
  tweens with `onUpdate`; no clocks/timers/rAF state). A source-hygiene test
  greps the templates for `Date.now|setTimeout|Math.random|rAF`.
- Model prompts: storyboard vocabulary lives in `compositionRunner.ts`
  (`basePrompt`, ~line 2360+, plus the structured-output JSON schema ~line
  110 — **both** must change together); authoring rules live in
  `prompts/planning-director.md`; per-storyboard deterministic guidance in
  `lockedLayoutGuidance()`.

## Lessons learned this session (will save you hours)

1. **Brief-derived requirements beat prose.** GLM only reaches for a new
   typed feature reliably when `inferStoryboardPlanRequirements` turns brief
   phrases into blocking `validateStoryboardPlan` errors (see
   `requireShapeMatch`/`requireRackFocus`). Free-form "focus onto the
   rollback control" got reinterpreted as `track-to-anchor`.
2. **Bump the storyboard cache `contract` version** (in
   `requestStoryboardPlan`'s cacheKey, now v5) whenever the storyboard shape
   changes, or stale cached plans mask your change.
3. **Vitest root gotcha**: never `npx vitest run --root ../..` from the
   monorepo root — it sweeps in the gitignored `.publish/` mirror and breaks
   `@hyperframes/core` resolution. Always
   `npm run test --workspace @sequences/slack -- <files>`.
4. **`sequence:check` job dirs are immutable** — a retried live probe needs a
   fresh `--job-id` (and re-spends the concept call).
5. **Paid live probe recipe**: set `$env:OPENROUTER_API_KEY`, then
   `npm run sequence:check --workspace @sequences/slack -- --product ...
   --what "<brief>" --provider openrouter-api --no-mcp --job-id <id>
   --format both`. ~5–10 min. Inspect
   `.data/projects/<id>/planning/storyboard.json` (what GLM declared) and the
   report's `authoringMode`/`fallbackStage` (whether it really published).
6. **Floating point is a production hazard here**: the pinned linter rejected
   `7.4 + 4.2 = 11.600000000000001` as an overlapping clip and burned an
   entire authoring repair loop on a phantom the repair model could not see.
   Fixed via `isFloatingPointClipOverlap` in `directComposition.ts`. When a
   repair loop fails 3× on the *same* finding, suspect the finding.
7. **DeepSeek does not keep silhouette/geometry discipline** from prose
   guidance alone — that is *why* v2 discovery should upgrade from measured
   geometry instead of trusting authored geometry.
8. **Test styling via classes, not `data-part` attribute selectors** — bridge
   clones strip `data-part`, so attribute-styled fixtures produce invisible
   bridges.
9. Finish = commit → `bash scripts/publish-public.sh "<msg>"` (publishes
   HEAD; commit first) → `railway up` (publish does NOT deploy) → poll
   `railway deployment list` for the new id (old instance answers `ready` on
   `/healthz`, so health alone proves nothing about the new build).

## Verification bar for both goals

Slack source gate (CLAUDE.md §1) green + a focused browser test proving
seek-order determinism of the new runtime + one paid live create before
claiming planner adoption. For speed ramping additionally run the
render/Docker gate (`VERIFY_RENDER=1 npm run film:demo`) since it touches the
frame driver, and ship one deterministic ramp in the fallback film — the
fallback is the proof path for every contract.
