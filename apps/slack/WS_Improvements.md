# WS_Improvements — follow-ups from the WS1/WS5 verification (2026-07-04)

Verification verdict: **WS1 and WS5 are correct and shippable as-is.** The
deterministic ladder is green (typecheck, 48 tests, `film:demo`,
`sequence:check --demo`), the golden film and the deterministic fallback stay
clean of `cut_degraded` / `camera_framed_sparse`, and the live evidence from
`improve-ws15-1` shows honest cut paperwork (manifest == cut island ==
`outgoingCut` prose) and two *true-positive* sparse findings (10% and 2%
coverage, confirmed by eye). Nothing below blocks a commit; these are
sharpening passes, ordered by value.

## 1. (WS5) Final-scene exemption does not cover camera landings — add a two-tier floor

`layoutInspector.ts`: the static mid-window audit exempts the film's final
scene (`draft.storyboard.slice(0, -1)`), but the fit-zoom **landing** audit
iterates every camera scene, final included. A legitimate compact end card
reached by a `pull-back` will fire `camera_framed_sparse` and burn repair
attempts, while the identical camera-less end card is exempt.

Don't extend the full exemption — `improve-ws15-1`'s final CTA at **2%**
coverage was a real defect and must keep failing. Instead give final-scene
landings a lower floor (e.g. `SPARSE_COVERAGE_MIN_FINAL = 0.08`): disasters
still fire, deliberate compact resolves (~10–15% with a badge/CTA pair) pass.
Bump `QA_CACHE_VERSION` (4 → 5) when changing this.

## 2. (WS1) Hint-mismatch degrade fires per-rung, so the rescue model never gets a shot

`requestStoryboardPlan` passes
`degradeShapeHintMismatches: attempt === rung.maxAttempts` — that is the last
attempt of **each** rung. A hopeless volunteered pair on the primary rung's
final attempt degrades to zoom-through and the plan returns immediately; the
independent rescue model (which might have re-pointed the cut at rhyming
endpoints and saved the premium morph) is never consulted. Fix: only degrade
on the last attempt of the **last** rung
(`isLastRung && attempt === rung.maxAttempts`). One-line change; the
`degradeMismatchedShapeHintCuts` docstring already says "final storyboard
attempt", so this also makes the code match its own comment.

## 3. (WS1) One degraded boundary spends two of the 20 repair-feedback slots

`browserQa.warnings` carries both encodings of a degraded boundary — the raw
runtime string (`cut_degraded: shape-match a->b compiled …`) and the formatted
measured finding (`cut_degraded [data-part=…] …`). `findingSignature`
collapses them for convergence tracking, but the repair prompt's
`validationFeedback` (sliced to 20) contains both strings. Dedupe by
`findingSignature` before slicing so a film with several findings doesn't have
its feedback list padded with duplicates. (The measured finding is strictly
more useful; prefer keeping the longer string per signature.)

## 4. (WS5) Landing path should skip zero-coverage frames like the static path does

The camera-less mid-window audit defers `fraction <= 0` to the near-blank
audit; the landing audit does not, so a fully-empty landing raises
`camera_framed_sparse` ("fills only 0%") on top of any near-blank finding.
Harmless duplication, but add the same `fraction <= 0` skip for parity — the
"content exists but is tiny" class is the finding's whole identity.

## 5. (WS1) Plan-time degrade drops authored boundary timing; the QA-time rewrite preserves it

`degradeMismatchedShapeHintCuts` replaces the cut with a bare
`{version:1, style:"zoom-through"}`, discarding any planner-authored
`travelPx`/`exitSec`/`entrySec`, while `rewriteDegradedCutStoryboard`
deliberately preserves them ("keep any authored boundary timing so the
executed window stays put"). At plan time nothing is compiled yet so this is
not a bug, but preserving the fields costs three spread lines and keeps the
two degrade paths behaviorally identical.

## 6. (WS1, optional) Hint-less shape-match declarations skip plan-time sanity entirely

`auditShapeMatchHints` requires both `shapeOut` and `shapeIn`; the hints are
an optional self-check, so a shape-match declared *without* hints sails
through plan validation and is only caught by the bind-time geometry audit —
after a full paid author attempt. Consider a storyboard validation finding
asking for the hints on every declared shape-match (cheap GLM findings-retry;
degrade-never-veto still applies via the existing rungs). Tradeoff: one more
paperwork demand on the planner; measure how often hint-less declarations
actually appear before adding it.

## 7. (WS5, v2 idea — park) Union bbox can be gamed by corner content

Two small elements at opposite corners produce a frame-spanning union bbox
while the frame is ~95% empty. Inherent to the specced union-bbox approach and
fine for v1 (the observed defect class is a *single* tiny subject). If false
negatives show up in probes, v2 is an occupancy grid (e.g. 24×14 cells,
coverage = fraction of cells intersecting content) on the same sampled pass —
no new seeks. Bump `QA_CACHE_VERSION`.

## 8. Cross-reference: WS6's penalty rebalance is what makes sparse findings *stick*

`improve-ws15-1` published on attempt 3 with both sparse findings unrepaired —
correct behavior (polish never blocks publication), but the least-bad-draft
pick at attempt 3 only weighs `browserQualityPenalty`, which does not yet
weight `camera_framed_sparse`. WS6 (§WS6 of IMPROVEMENT_PLAN.md) already plans
this; when implementing it, make sure the new codes (`camera_framed_sparse`,
`cut_degraded`) get weights so the attempt-3 pick prefers a draft without
them.

---

# WS3 + WS2 audit follow-ups (2026-07-04)

Verification verdict: the core implementation is sound and the full
deterministic ladder is green (typecheck; 40 test files / 405 tests, including
the Chromium-backed eye-trace test). The paid `audit-ws32-live-2` run passed
the pacing gate on storyboard attempt 1 and published `hyperframes-direct`
without a whole-film fallback (13/13 moments bound, 10 thumbnails, zero
eye-trace findings; the boundaries were directional/bridged). The items below
are future hardening; none was implemented during this audit.

## 9. (WS3, bug) A late single-surface introduction bypasses the hold gate

`auditPacing` runs the introduction/development rule only when
`introductions.length >= 2`. The WS3 contract is per scene, not only
multi-surface scenes: one dense app window opened at 3.7s in a 4s scene still
needs time to be read. An exploratory execution confirmed that exact plan
returns no pacing findings.

Run the rule for one or more introductions. If title cards need an exemption,
make it semantic and narrow (for example, a short final resolve), rather than
exempting every single-component scene.

## 10. (WS3, bug) A camera move already in flight is invisible to reading/outcome holds

`nextFramingChange(afterSec)` considers only full moves whose `startSec` is at
or after the beat settles. If a pan starts at 2.0s and a press settles at
2.5s, the frame is still moving through the payoff, but the audit treats the
scene cut as the next reframe. A real execution of this case returned no
finding.

Treat any full move whose `[startSec, startSec + durationSec]` overlaps the
post-beat hold as an immediate framing conflict (available hold = 0), then
choose the next later move/cut. Cover both `pacing/reading` and
`pacing/outcome`.

## 11. (WS3) Finish the promised headline reading-floor variant

The implementation checks typed component beats only. IMPROVEMENT_PLAN WS3
also calls for “headline-class moments”; a static headline introduced late
without a `type` beat currently has no reading floor. Resolve headline-class
evidence from primary moments / hero text (or explicitly narrow the contract
and docs to typed copy). Keep this deterministic and plan-stage where
possible.

## 12. (WS3) Convert the 65% introduction deadline through viewer time

Development duration correctly uses `warpInverseOf`, but the late-introduction
test compares content-time `lastIntro` with a content-time
`scene.startSec + duration * 0.65` cap. Under a time ramp, 65% of content time
need not be 65% of what the viewer experiences. Compute both sides in viewer
time, as the module-level contract promises, and add a ramped-scene regression
case.

## 13. (WS2, bug) The 16-part boundary cap can discard the declared gaze target

`measureBoundaryParts` stops after the first 16 visible `data-part` nodes in
DOM order, before the eye-trace scorer knows which targets matter. A real
Chromium probe with `spatialIntent.focalPart` as the 17th part measured only
`f0`…`f15` and emitted zero `eye_trace_jump` findings for a corner-to-corner
hard cut.

Measure the resolved attention targets first (or pass priority part names into
the inventory), then fill the remaining budget with arbitrary parts. The same
change also makes cut discovery/degradation diagnostics more reliable in
dense UI scenes.

## 14. (WS2, bug) Ping-pong measures both targets at the second beat

The spec says to measure gaze at consecutive beat times, but the browser pass
uses one seek at `second.atSec + 0.15` and reads both centers there. Camera
motion, swaps, or component motion between beats can therefore relocate or
hide the first target, producing false positives or false negatives.

Sample the first target just after the first beat and the second target just
after the second beat. Reuse an existing sample when possible; keep the same
six-pair cap if two seeks per pair is too expensive.

## 15. (WS2) Judge the ping-pong window in viewer time

`pingPongCandidates` compares raw content-time beat gaps to the 0.25–1.2s
window. A slow-motion ramp can stretch a 1.0s content gap well beyond 1.2s for
the viewer, yet it is still flagged and reported as “1.00s.” Pass the resolved
time warp into candidate selection (or precompute viewer timestamps) and
report the viewer-time gap.

## 16. (WS2) Sample outgoing gaze before the declared cut exit begins

Boundary inventory always samples `atSec - 0.15`. A typed cut with
`exitSec > 0.15` is already translating/fading the outgoing scene then, so the
recorded “where the eye is before the cut” can be transition geometry. The
pass already parses entry timing; parse exit timing too and sample just before
`atSec - exitSec`, with a small epsilon and scene-start clamp.

## 17. (WS3/WS6) A plan-level “hold” can still render as an empty hold

Visual inspection of the paid `improve-ws32-2` thumbnails found
`m03-row-sev1-highlight` and `m05-metric-land` showing an almost empty app
window for most of the frame. The rendered temporal judge agreed that
`metric-land` was static, but the run still passed because this remains polish
feedback. This is not a reason to make heuristics unpublish a runnable film;
it is evidence for WS6's least-bad-draft weighting and for connecting WS3's
“develop the hold” promise to rendered moment evidence when alternatives
exist.

## 18. (Cross-cutting) Dedupe all repair feedback by finding signature

The live `audit-ws32-live-2` attempt 2 feedback repeated both
`interaction_target_miss` and `interaction_not_visible` twice before listing
the remaining findings. Item 3 above identified the same slot-waste for
`cut_degraded`, but the fix should be generic: dedupe the complete merged
feedback list by `findingSignature` before the 20-item slice, retaining the
most detailed encoding. Otherwise a few duplicate classes can crowd WS2/WS5
geometry findings out of the compact repair prompt.

## 19. (WS5/visual QA) Sample camera containment at primary moments, not only landings

The live `audit-ws32-live-2` thumbnail `m08-m4-land` visibly crops the
resolution stat card off the bottom-right edge. Browser QA recorded only an
informational `canvas_overflow` for its text; the camera landing checks did not
request repair. Re-check framed-content containment at primary moment capture
times (or promote off-canvas text inside a load-bearing camera-world
`data-part` to a warning). Landing-only geometry cannot catch a subject that
drifts/clips later in the held segment.
