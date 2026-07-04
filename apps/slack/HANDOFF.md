# HANDOFF — next session (updated 2026-07-04, reliability + judge + depth pass)

Both remaining HANDOFF goals (rendered temporal judge, camera depth level 2)
and all three source-author reliability levers from the motion-quality
diagnosis are **BUILT and verified**; `PLAN_camera_depth_level2.md` is retired
(the shipped design lives in ROADMAP "Source-author reliability + rendered
temporal judge + camera depth level 2 (2026-07-04, later)" and CLAUDE.md).
No plan docs survive — ROADMAP + CLAUDE.md are the inventory.

## What shipped this session (2026-07-04, latest)

1. **Author scratch persistence** — every rejected author attempt writes
   document + findings to `planning/attempts/author-<n>-<outcome>.*`
   (diagnostics only, never re-enters the pipeline).
2. **Bind-exception escalation** — the opaque `Waiting failed: 12000ms` is now
   `runtime_bind_exception: … — <real console error>`; on that class the
   author loop abandons the scratch and re-authors with full context instead
   of a compact patch (the patch-fixed-the-chart-and-broke-the-scene bug).
3. **Static kit-markup completeness** (`engine/kitMarkupAudit.ts`, linkedom):
   the runtimes' DOM bind queries re-run statically — chartless charts,
   itemless rows/select, fill-less progress, absent morph twins, missing
   camera worlds/stations, and scenes present to regex but absent to a
   spec-parsed DOM are all named blocking findings before the browser.
4. **Rendered temporal judge** (`judgeRenderedMoments` in
   `layoutInspector.ts`): before/mid/after downscaled frame triples around
   every evidence-bound moment, pixel-diffed in-page; invisible claimed
   changes become `moment_static_frame` polish findings (strictOk-blocking,
   never unpublishing). `SLACK_SEQUENCES_TEMPORAL_JUDGE=0` kills it;
   QA_CACHE_VERSION → 3. The mid-frame exists because a highlight pulse
   returns to rest by the settle frame — before/after alone reads it static.
5. **Camera depth level 2** — whip blur relocated to a `.seq-whip-lens`
   backdrop overlay (the world element never carries a CSS filter again),
   then opt-in `"depth3d":true` on an orbit scene: preserve-3d world,
   per-layer `translateZ` as a pure function of orbit deflection, flat at
   rest. Storyboard cache contract → v7. Default-off; 1080p render-cost
   benchmarking is still open before broader-than-hero use.

Live-verified with one paid probe (`levers-live-1`, Pulseboard brief
demanding the previous session's failure shape — chart + palette + orbit):
**published `hyperframes-direct`, no fallback.** Attempt 1 repeated the old
chart/camera-world mistakes and the kit audit named them statically (plus a
DOM-level cut focal-part catch on attempt 2); attempt 3 passed; the critic
applied 5 directives; the temporal judge measured 11/12 moments as real
change and flagged one invisible tick as polish feedback; both rejected
attempts persisted under `planning/attempts/`. Details in ROADMAP.

## Read first

1. [CLAUDE.md](CLAUDE.md) — two bots, isolation, determinism boundary,
   verification ladder, publish-vs-deploy.
2. [ROADMAP.md](ROADMAP.md) — current state; the three 2026-07-04 sections
   (motion-quality, performance, reliability+judge+depth) are the latest
   inventory.

## Candidate next goals (in rough order of leverage)

1. **Recipe Studio M1–M2** (`docs/RECIPE_STUDIO_PLAN.md`, monorepo root) —
   local cockpit over the engine + recipes-as-skills retrieval.
2. **Temporal judge, vision half** — the deterministic frame-difference core
   is live; the remaining half of the original breakthrough note is a vision
   critic over the same moment frames (legibility, semantic "did the RIGHT
   thing change"). Budget/caching machinery now exists to hang it on.
3. **Depth3d render benchmark** — before teaching the prompt to use depth3d
   more than once per film, benchmark software-rasterized 1080p render cost
   of sustained preserve-3d layers.
4. **Audio** — any soundtrack must be remapped through the same warp knots
   (`sequences-time.v1.js` header note). Do not add audio without it.

## Gotchas that will save you hours (inherited + new)

1. **Injection anchors are load-bearing.** The time-wrap rewrite stays LAST
   and `timelineRegistrationAnchor` must match plain + wrapped forms.
   `test/timeRamp.test.ts` "all-five-contracts injection regression" guards it.
2. **Time bases**: content time everywhere except enumerated viewer-time
   consumers; physical seeks convert via `warpInverseOf` at the seek only.
   The temporal judge follows this (it seeks through `seekContent`).
3. **Bump the storyboard cache `contract`** (now v7) on storyboard shape
   changes; bump `QA_CACHE_VERSION` (now 3) on inspector semantics changes.
4. **Vitest root gotcha**: `npm run test --workspace @sequences/slack`, or
   `npx vitest run --root ../.. apps/slack/test/<file>` from `apps/slack`.
5. **`sequence:check` job dirs are immutable** — retried live probes need a
   fresh `--job-id`.
6. **Paid live probe recipe**: `$env:OPENROUTER_API_KEY`, then
   `npm run sequence:check --workspace @sequences/slack -- --product …
   --what "…" --provider openrouter-api --job-id <id> --format both`; inspect
   `.data/projects/<id>/planning/` (now including `attempts/`) and the
   report's `authoringMode`/`fallbackStage`.
7. **Test styling via classes, not `data-part` attribute selectors** — bridge
   clones strip `data-part`.
8. Finish = commit → `bash scripts/publish-public.sh "<msg>"` → `railway up`
   (publish does NOT deploy) → poll `railway deployment list`.
9. **When a repair loop fails 3× on the same finding, suspect the finding.**
10. **Post-authoring passes re-inject from the SHIPPED storyboard**
    (`result.draft.storyboard`), never `args.lockedStoryboard`.
11. **New plan-gate rules must not veto volunteered enhancements** — degrade,
    don't block (`depth3d` on an orbit-less path is the newest example).
12. **A pooled/unref'd child process must be re-`ref()`ed while awaited.**
13. **Hedging must never replace the retry loop.**
14. **The world element must NEVER carry a CSS filter** — whip blur lives on
    the `.seq-whip-lens` backdrop overlay, rack focus on layers. A filter on
    the world silently flattens preserve-3d children (depth3d dies, no error).
15. **Pulse-shaped evidence needs the mid-frame** — any future rendered
    comparison that only samples before/after will call highlights, presses,
    and ripples "static". Sample the peak.
16. **linkedom is the static DOM oracle** — if a bind query changes in a
    runtime template, mirror it in `kitMarkupAudit.ts` or the completeness
    check drifts from what the browser actually resolves.
