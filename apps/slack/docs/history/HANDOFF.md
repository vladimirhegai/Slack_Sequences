# HANDOFF — where we are, what's next (updated 2026-07-07)

The lightweight "start here for the next session" pointer. The detailed
inventories live in [ROADMAP.md](ROADMAP.md) (feature-by-feature current state),
[SENTINEL.md](SENTINEL.md)/[SENTINEL_REPORT.md](SENTINEL_REPORT.md) (the
correctness system + its shipped evidence), and [FALLBACKS.md](FALLBACKS.md)
(fallback classes + the recoverable-paperwork catalog). This file is just the
map + the ordered plan + the gotchas.

## What is shipped (the three completed mandates)

1. **Choreography hardening (2026-07-04/05, WS1–WS7 + fallback elimination).**
   Pacing/energy/eye-trace/exit/coherence gates, moment-visible thumbnails,
   deterministic contract-binding reconciliation, the safe-fallback film. Record
   in ROADMAP's 2026-07-05 sections; the IMPROVEMENT_PLAN / WS_Improvements /
   LESS_FALLBACKS planning docs are retired (their surviving items are in
   ROADMAP's "Full audit").
2. **Sentinel — correctness by construction (2026-07-05/06, flags default ON).**
   Every mechanically-decidable obligation moved to the lowest owning layer (L0
   schema / L1 scaffold / L2 normalize), scene-scoped slot retries, the contract
   registry + closed-world test, the prompt budget test, telemetry
   (`sentinel:report`). System doc: [SENTINEL.md](SENTINEL.md); design contract:
   [SENTINEL_PLAN.md](SENTINEL_PLAN.md); shipped evidence: [SENTINEL_REPORT.md](SENTINEL_REPORT.md).
3. **Motion-design texture (2026-07-06/07, MD1–MD6).** The FX runtime
   (sweep/glow/draw/echo), the `dive` camera move, the `headline` kind + letter
   machinery, animated grade shifts, playful pops. IMPLEMENTED and registered in
   the Sentinel table — see [MOTION_DESIGN_PLAN.md](MOTION_DESIGN_PLAN.md) (now a
   verification checklist, not a build target).
4. **Recipe Studio (2026-07-07, sessions 1–2).** RecipeV2 + Level-1 host
   instantiation (the sixth host contract), the studio server/gate/export, the
   canvas builder, and the agent chat. Golden `last-word-roulette` proven; the
   paid live-create proof did NOT convert (the recipe-declaration gap). Plan:
   [../../docs/RECIPE_STUDIO_PLAN.md](../../docs/RECIPE_STUDIO_PLAN.md); reports:
   [RECIPE_STUDIO_REPORT.md](RECIPE_STUDIO_REPORT.md) +
   [RECIPE_STUDIO_REPORT_2.md](RECIPE_STUDIO_REPORT_2.md); next-agent prompt:
   [../../docs/RECIPE_STUDIO_HANDOFF.md](../../docs/RECIPE_STUDIO_HANDOFF.md).

## Read first

1. [CLAUDE.md](CLAUDE.md) — two bots, isolation, determinism boundary,
   verification ladder, publish-vs-deploy.
2. [ROADMAP.md](ROADMAP.md) — current state; the 2026-07-05/06/07 sections are
   the latest inventory.

## The plan from here (the operator's ordered roadmap)

1. **Review Sentinel + the shipped Recipe Studio features.** Walk the past
   fallbacks/attempts (`sentinel:report` over recent probe dirs + the
   `planning/attempts/` + `author-run.json` artifacts), confirm Sentinel
   actually captures each failure class at the right layer, and hunt for bugs /
   places attempts can be cut further. Fewer paid attempts is the metric.
2. **Complete the Recipe Studio** per [../../docs/RECIPE_STUDIO_HANDOFF.md](../../docs/RECIPE_STUDIO_HANDOFF.md)
   — the #1 item there is closing the **recipe-declaration gap** (a host-side
   auto-declare for high-confidence matches; today's retrieval *offer* doesn't
   convert the planner). Then CLI diff-scoping, cursor paths + effect presets,
   the export describe pass, library curation.
3. **Verify MOTION_DESIGN_PLAN end-to-end** — walk MD1–MD6 against the code +
   the §6 paid-probe checklist; confirm nothing was silently dropped/degraded.
4. **Fix bugs in the live motion-design output** — eyeball real paid runs, fix
   the "produced texture" misses, and keep watching fallbacks/attempts while you
   do (every fix goes through the Sentinel placement tree, never a prompt patch).
5. **Grow the library + minor features.** Author recipes in the studio; pull
   small features from ROADMAP/ARCHITECTURE backlogs (SFX, **music** — see the
   audio note below, an unbuilt hard constraint).
6. **Finish the context bot ↔ Slack loop** — richer hosted-MCP retrieval:
   images, past-thread context, and Slack-native UX polish
   (`slackMcpContext.ts`, `thread.ts`).

## Parked large goals (deliberately deferred — don't start ad hoc)

These came out of the motion-quality diagnosis and are too big for a
perfect-what-exists pass. (Smaller parked follow-ups live in ROADMAP's
2026-07-05 "Full audit" section.)

1. **Temporal judge, vision half** — the deterministic frame-difference core is
   live (`moment_static_frame`); the remaining half is a vision critic over the
   same moment frames (legibility, "did the RIGHT thing change"). Budget/caching
   machinery now exists to hang it on.
2. **Host-owned exit contract (a typed `exits` contract)** — WS4 shipped the
   cheap version (`auditSurfaceExits` + advisory `stale_asset_lingers` + prompt
   doctrine); build the full typed contract only if that proves insufficient.
3. **Content-aware station auto-fit** — deterministically adjust station rect /
   fit zoom from measured content bounds instead of asking the author to move
   markup. Powerful, but it makes the camera plan a function of measured pixels —
   cache/determinism implications need real design.
4. **Saliency-based eye-trace v2** — upgrade WS2's focal-part proxy to real
   visual-saliency over rendered frames (pairs with the vision judge, #1).
5. **Audio / music / SFX** — any soundtrack MUST be remapped through the same
   `timeRamp` warp knots (`sequences-time.v1.js` header note) and stay a pure
   function of timeline time. Do NOT add audio without honoring the warp seam.
   This is the substrate rule for the operator's step-5 "music/SFX" work.
6. **Depth3d render benchmark** — before teaching the prompt to use `depth3d`
   more than once per film, benchmark software-rasterized 1080p render cost of
   sustained preserve-3d layers.

## Gotchas that will save you hours

1. **Injection anchors are load-bearing.** The time-wrap rewrite stays LAST and
   `timelineRegistrationAnchor` must match plain + wrapped forms
   (`test/timeRamp.test.ts` "all-contracts injection regression" guards it).
2. **Time bases:** content time everywhere except enumerated viewer-time
   consumers; physical seeks convert via `warpInverseOf` at the seek only.
3. **Bump the storyboard cache `contract`** on storyboard-shape changes; bump
   `QA_CACHE_VERSION` on inspector-semantics changes.
4. **Vitest root gotcha:** `npm run test --workspace @sequences/slack`, or
   `npx vitest run --root ../.. apps/slack/test/<file>` from `apps/slack`.
5. **`sequence:check` job dirs are immutable** — retried live probes need a
   fresh `--job-id`.
6. **Paid live probe recipe:** extract `OPENROUTER_API_KEY` from `.env` with an
   ABSOLUTE path and confirm it is non-empty (a `no OpenRouter API key` fallback
   is a harness error, not a code regression); set
   `SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK=0` so a probe fails visibly;
   then `sequence:check … --provider openrouter-api --job-id <id> --format both`;
   inspect `planning/` (`attempts/` covers author + storyboard stages,
   `author-run.json` + `sentinel-run.json` the signatures) and **LOOK at
   `build/thumbs/*.png` with your own eyes** (reports have said "pass" on films
   the operator called a mess).
7. **Style via classes, not `data-part` attribute selectors** — bridge clones
   strip `data-part`.
8. **When a repair loop fails 3× on the same finding, suspect the finding.**
9. **Post-authoring passes re-inject from the SHIPPED storyboard**
   (`result.draft.storyboard`), never `args.lockedStoryboard`.
10. **New plan-gate rules must not veto volunteered enhancements** — degrade,
    don't block (`depth3d` on an orbit-less path is the canonical example).
11. **The world element must NEVER carry a CSS filter** — whip blur lives on the
    `.seq-whip-lens` overlay, rack focus on layers, FX on transform/opacity
    children. A filter on the world silently flattens preserve-3d (depth3d dies,
    no error).
12. **Pulse-shaped evidence needs the mid-frame** — any rendered comparison that
    only samples before/after calls highlights, presses, and ripples "static".
13. **linkedom is the static DOM oracle** — if a bind query changes in a runtime
    template, mirror it in `kitMarkupAudit.ts` or the completeness check drifts
    from what the browser resolves.
14. **Finish = commit → `bash scripts/publish-public.sh "<msg>"` → `railway up`**
    (publish does NOT deploy) → poll `railway deployment list` / `/healthz`.
