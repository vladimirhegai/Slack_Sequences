# Hackathon guardrail and retry map (S6.9)

Date: 2026-07-12
Scope: inventory only; no production behavior changed
Policy source: `REFACTOR_PLAN.md` S6.9-S6.13 and `SENTINEL.md`

## Decision vocabulary

Every finding that can affect the create path has exactly one target decision:

| Target decision | Meaning in this report | Paid-call effect |
| --- | --- | --- |
| **HARD** | Parse/schema/typed-contract failure; runtime exception or invalid timeline; missing/blank load-bearing content; state contradiction/reset; missing render/MP4; broken typed interaction; or a load-bearing focal still out of frame after the one bounded containment repair. | May block publication and, after deterministic ownership is exhausted, buy at most one author repair in that stage. |
| **DETERMINISTIC SAME-ATTEMPT REPAIR** | Canonical markup/binding/script order or measured load-bearing wrapper/station/camera containment. The repair is bounded, idempotent, re-inspected, adopted only on exact improvement and no new hard finding. | Zero model calls. |
| **ADVISORY** | Taste or non-catastrophic quality evidence: washout/contrast preference, already-visible occupancy preference, settle/reversal/jerk taste, supporting static moments, parent/child overlap, density, non-catastrophic pacing/readability, camera-idea/style preferences. | Remains in QA/status as `warn`; never enters storyboard/source retry feedback, scene repair, rescue, critic, or critic patch. |

When a broad detector can describe both a real failure and a preference, the target tier depends on measured evidence, not only its code. For example, `camera_blocking_landing` is deterministic/hard when a typed primary is missing, zero-area, or below the 85% visibility floor, but advisory when the focal is visible and only an occupancy preference misses.

## Current retry call graph and cost

| Seam | Current decision input | Current paid cost | Current publication effect | Target under the hackathon policy |
| --- | --- | ---: | --- | --- |
| Storyboard parse + `validateStoryboardPlan` (`runner/storyboardAudit.ts:1415`, `runner/ladder.ts:2274-2550`) | Every returned validation string after the plan normalizer chain. | One full storyboard call per attempt; up to 3 primary + 2 rescue attempts. | Exhaustion fails loud or permits fallback. | Send only HARD contract findings to at most one correction after the initial attempt. All camera/energy/density/pacing/style preferences are ADVISORY. |
| Storyboard scene repair (`runner/ladder.ts:2480-2524`) | First rejection when all/part of the findings map to named scenes. | One extra scene-repair call in addition to the logical storyboard attempt. | May accept immediately; otherwise the full ladder continues. | Eligible only for HARD scene-local contract failure, and it must count inside the two-storyboard-attempt cap. |
| Source static gate (`directComposition.ts:615-778`) | HTML/schema, host contracts, lint, kit markup, motion/moment findings. | A scene repair may run inside attempt 1; otherwise the next source attempt is a patch/re-author. | `validation.ok=false` cannot bank the draft. | HARD structural/runtime obligations may retry once. Canonical markup/binding/order first receives zero-call repair. Density/supporting-moment/taste findings stay ADVISORY. |
| `repairSlotDraftForFindings` (`runner/ladder.ts:2846-2945`) | Any attributed list supplied by static QA, browser QA, or critic directives. It does not classify findings itself. | One physical/logical scene source call (`validation-repair`, `scaffold-repair`, or `critic-scene-repair`). | Candidate is accepted on fewer static finding classes or lower whole-film quality penalty. | Call only for unresolved HARD findings. ADVISORY findings must be removed before attribution. |
| Browser source retry (`runner/browserQuality.ts:298-321`, `runner/ladder.ts:3410-3955`) | `sourceRetryFeedbackForBrowserQa`: static repair warnings + every browser error + almost every warning. Only washout and some static supporting moments are filtered today. | Same-attempt scene repair can add one call; remaining feedback buys the next patch/re-author. | `ok=true` banks a runtime-valid draft, but `strictOk=false` normally continues spending. | `ok=true` + no HARD issue banks and ends source authoring immediately. Keep advisory warnings in artifacts/status only. |
| Quality penalty (`runner/browserQuality.ts:15-84, 109-164`) | Static warnings, browser warnings, every issue severity/code, and hidden measured occupancy/settle/dead-frame scores. | Indirect: decides scene-repair adoption, banked candidate, early-publish eligibility, and critic patch adoption. | Can prefer one runtime-valid draft and delay publication. | May rank deterministic candidates or guard non-regression, but must never create retry eligibility. Advisory weights cannot delay banking. |
| Source rescue (`runner/ladder.ts:4038-4147`) | No runtime-valid candidate after three source attempts. | One independent full source call (attempt 4). | Runtime-valid rescue publishes even with polish; otherwise fail/fallback. | Remove on the bounded create path: two source attempts total, including any repair/re-author. Fail loud only for unresolved HARD failure. |
| Continuity/vision critic (`runner/ladder.ts:4238-4729`) | Any non-pristine result unless `strictOk && penalty=0` or two prior patches were stagnant. | One critic call, then up to one scene repair or whole-document patch call. | Candidate must be non-regressive; the original already-publishable draft remains banked. | Once a runtime-valid candidate has no HARD failure, do not call the critic. Advisory residue cannot buy either call. |
| CLI status (`sequenceCheckStatus.ts:25-53`) | Static validity, thumbnails, requested MP4, fallback/degradation, ledger runtime/quality/attempt axes, QA warnings. | Zero. | Missing required artifact is `fail`; fallback, advisory residue, attempts, or degradation are `warn`. | Keep. An advisory-only authored MP4 is honestly `warn`, not `pass` and not `fail`. |
| Physical request hedge/retry (`runner/ladder.ts:431-664`) | Slow/transient provider route, independent of finding tier. | Up to 3 transport attempts per call; hedge budget currently defaults to 2 for the job. | Environmental failure can exhaust a rung. | At most one hedge per expensive stage, six logical/eight physical requests globally. Finding classification must not reset these budgets. |

## Storyboard finding inventory

`parseStoryboardResponse` normalizes, then `validateStoryboardPlan` combines structural validation with creative heuristics. Today every un-degraded result is one paid `findings-retry`, and the first scene-attributable set may also buy a scene-repair call.

| Detector/finding family | Deterministic owner | Current tier/cost/blocking | Target decision |
| --- | --- | --- | --- |
| Response envelope/JSON, production basis, typed scene parsing (`storyboard/basis`, `frame/*`) | L0 parser/frame contract | Blocking; one full storyboard retry, then rescue ladder. | **HARD**. |
| Scene count; stable/unique IDs; contiguous finite windows; required strings; known capabilities; valid focal ids (`storyboardAudit.ts:1420-1480`) | L0 typed plan schema; digit-leading IDs already have bounded normalization | Blocking; full or scene retry. | **HARD** for malformed schema/contract. |
| Beat/component compatibility, morph target existence/family, interaction IDs/scene/timing/settle (`storyboardAudit.ts:1481-1524`) | Component/interaction schema | Blocking; full or scene retry. | **HARD** because an invalid typed interaction/timeline cannot execute coherently. |
| `display_type_invalid` | Display-type typed contract | Blocking storyboard retry. | **HARD** when malformed/outside its scene/unbound. |
| `display_type_budget_exceeded` | Creative display-type governor | Blocking storyboard retry. | **ADVISORY**; it is density/component-choice taste. |
| Framing-count floor, camera-move minimum, multi-station/orbit/rack-focus/time-ramp/component-kind/component-beat requirements (`storyboardAudit.ts:1540-1710`) | Planner requirements + camera/component contracts | Blocking storyboard retry; some have L2 top-ups. | **HARD** only when the user's brief explicitly requires an executable contract; otherwise framing/move/component density is **ADVISORY**. The judge probe intentionally specifies none of these. |
| Time-ramp solvability and scene-1 prohibition | Time-ramp schema/runtime | Blocking storyboard retry; some L2 retime/degrade. | **HARD** for an invalid declared ramp; the number/style/motivation of otherwise valid ramps is **ADVISORY**. |
| Repeated foreground/camera intent | Planner diversity heuristic | Blocking storyboard retry. | **ADVISORY**. |
| `storyboard/moments*` (`storyboardMoments.ts:166`) | Typed moment/evidence contract | Blocking, scene repair/full retry, then last-resort primary-to-supporting demotion. | **HARD** only for missing/unbound load-bearing primary content; supporting spacing/static paperwork is **ADVISORY**. Do not demote a promised primary merely to clear a gate. |
| Morph/shape-hint compatibility (`storyboardAudit.ts:1750`) | Cut contract | Blocking early, volunteered cuts degrade late. | **HARD** only for a user-required impossible contract; volunteered transition taste is **ADVISORY** and may deterministically degrade only when state remains coherent. |
| `camera/energy*` (`cameraContract.ts:1245`) | Creative direction heuristic | Blocking storyboard retry; L2 energy lift changes a camera pose. | **ADVISORY**; no model retry or deterministic motion-style change. |
| `camera/idea-budget*` (`cameraBlocking.ts:464`) | Creative lens-route heuristic | Blocking storyboard retry. | **ADVISORY**. |
| `cuts/coherence*` (`cutContract.ts:205`) | Transition-language taste | Blocks early; advisory-late. | **ADVISORY** from attempt 1. |
| `components/complexity*` (`componentContract.ts:1866`) | Authorability/density heuristic | Blocking storyboard retry; component trim can delete set dressing. | **ADVISORY** unless the typed plan is unrepresentable. Never change component choice to satisfy it. |
| `pacing/*` and framing/read/payoff holds (`pacingAudit.ts:401`) | Timing/taste heuristic | Blocks attempts 1-2; advisory-late; many timing normalizers run first. | **ADVISORY** unless it proves an invalid timeline or missing load-bearing content. No copy/beat retime in deterministic repair. |
| Dive vs interaction conflict (`storyboardAudit.ts:1778`) | Typed camera/interaction execution contract | Blocking storyboard retry. | **HARD** when the cursor would visibly operate a different moving surface. |
| `components/exit*` (`componentContract.ts:2075`) | Surface-overlap heuristic | Blocks early; advisory-late. | **ADVISORY**; parent/child/supporting overlap does not buy a call. A true contradictory state is separately HARD. |

## Static source finding inventory

All `validateDirectComposition` errors currently set `validation.ok=false`; every such line can reach scene repair, patch/re-author, rescue, and fail/fallback. Its `frameWarnings` and `motionWarnings` also join browser retry feedback even though the static gate passed.

| Detector/finding family | Deterministic owner | Current tier/cost/blocking | Target decision |
| --- | --- | --- | --- |
| Empty/oversize/incomplete HTML; invalid root/canvas/duration; missing/invalid scene windows; locked storyboard mismatch | L0/L3 document schema | Blocking source attempt. | **HARD**. |
| Network/time/random/timer/infinite-repeat/play/display-visibility invariants; missing paused registered timeline; invalid inline script; missing local assets | L3 runtime invariants | Blocking source attempt. Several canonical syntax/order forms already normalize first. | Canonical syntax/order gets **DETERMINISTIC SAME-ATTEMPT REPAIR**; any unresolved invalid runtime/timeline is **HARD**. |
| Host camera/component/interaction/cut/time/FX/recipe/plugin/asset/environment/continuity contract findings (`camera_*_missing`, `component_*`, `interaction_*`, `kit_markup_incomplete`, `dead_gsap_target`, etc.) | L1 scaffold -> L2 canonical binding/markup -> L3 backstop | Blocking; may buy scaffold/validation scene repair plus later source attempt. | Canonical markup/binding/script order is **DETERMINISTIC SAME-ATTEMPT REPAIR**. Missing/ambiguous load-bearing binding after that is **HARD**. Optional decorative absence is **ADVISORY**. |
| HyperFrames lint errors (`overlapping_clips_same_track`, `overlapping_gsap_tweens`, occlusion/parse findings) | L3 lint/runtime contract | Blocking; source retry. Floating-point phantoms already filter. | Invalid timeline/script is **HARD**. Pure visual overlap is **ADVISORY** unless it makes primary content missing/unreadable. |
| Frame validation errors | Frame contract | Blocking source retry. | **HARD** for committed-basis/contract contradiction. |
| Frame warnings | Frame/design comparison | Non-blocking statically, but added to source retry feedback after browser QA and weighted at 2 each. | **ADVISORY**, never retry input. |
| Motion-density/liveness errors (`motion/*`) | Static motion analyzer | Blocking source retry. | **HARD** only for invalid/dead timeline or effectively blank load-bearing content. Density, supporting stillness, and non-catastrophic pacing are **ADVISORY**. |
| Motion/moment warnings | Motion/moment analyzer | Non-blocking statically, then retry feedback/penalty after browser QA. | **ADVISORY**. |

## Browser finding inventory

The browser result has two axes: `ok` is objective runtime health; `strictOk` also requires no visual errors, repair warnings, primary static moments, transition/quiet/motion-quality findings (`layout/report.ts:5700-5740`). The author ladder banks on `ok` but normally retries on `strictOk=false`.

| Detector/finding family | Deterministic owner | Current tier/cost/blocking | Target decision |
| --- | --- | --- | --- |
| `browser_runtime`, `runtime_bind_exception`, invalid/missing timeline, browser error | Runtime/browser | `errors`; `ok=false`; full re-author on bind exception; cannot publish authored candidate. | **HARD**. Browser console warnings remain HARD only when they prove runtime corruption; incidental warning text is ADVISORY. |
| `near_blank_film` | Coverage/runtime | `errors`; `ok=false`; full re-author. | **HARD**. |
| `near_blank_scene` | Coverage | Warning; `strictOk=false`; paid retry feedback. | **HARD** when the scene is load-bearing and truly blank; otherwise **ADVISORY**. One measured containment repair precedes any author repair. |
| Typed `interaction_*` failures | Interaction runtime | Errors by default; `ok=false`; optional quarantine/rescue can run. | **HARD** when the declared interaction is visibly broken, missing, or state-contradictory. A purely optional decorative interaction may be deterministically removed only if story/state remain intact. |
| `spatial_focal_missing`, `spatial_focal_invisible`, `spatial_focal_offframe` | Typed focal + measured geometry (`layout/report.ts:2125-2345`) | Warnings; `strictOk=false`; scene/full repair. Late visibility gets bounded resampling. | Load-bearing primary: **DETERMINISTIC SAME-ATTEMPT REPAIR**, then **HARD** if still missing/invisible/<85% on frame. Supporting focal metadata: **ADVISORY**. |
| `camera_framed_clipped` | Measured camera station/held primary containment (`layout/report.ts:4930-5165`) | Severity error but copied to warnings; `strictOk=false`; high penalty 10; scene/full repair. | Typed load-bearing target: **DETERMINISTIC SAME-ATTEMPT REPAIR**, then **HARD** if it remains clipped. Decorative/support: **ADVISORY**. |
| `camera_blocking_landing` | Typed phrase landing (`layout/report.ts:2350-2585`) | Warning; `strictOk=false`; high penalty 8 plus hidden occupancy penalty; scene/full repair. | Split by evidence: missing/zero-area/<85%-visible load-bearing target -> **DETERMINISTIC**, then **HARD**; already-visible occupancy/station preference -> **ADVISORY**. |
| `important_safe_area`, `canvas_overflow`, `motion_off_frame`, `clipped_text`, `text_box_overflow`, `text_occluded` | HyperFrames/layout measurement | Warnings/visual errors; generic layout repair may mutate storyboard layout; remaining findings buy source repair. | Only typed load-bearing primary containment/readability -> **DETERMINISTIC**, then **HARD**. Decorative/support/general safe-area preference -> **ADVISORY**. |
| `camera_framed_sparse`, `spatial_focal_minor`, `composition_frame_underfilled` | Occupancy/composition taste | Warning; sparse currently triggers deterministic station/camera zoom and high penalty 6; audit whole-frame floor can affect strictness. | **ADVISORY** when focal content is visible. Do not translate/scale solely to satisfy occupancy. |
| `camera_blocking_anchor`, `camera_blocking_unsettled` | Camera placement/settle taste | Warnings; strictness + high/hidden penalty; paid retry. | **ADVISORY** unless anchor miss also proves the load-bearing focal is off-frame (then the containment path owns it). |
| `composition_washed_out`, `contrast_aa` | Rendered contrast/taste | Warnings; bounded palette/plate repairs run; washout filtered from paid source feedback but still triggers critic/penalty. | **ADVISORY**. Preserve evidence and `warn`; do not change palette/style or buy critic/repair. |
| `stale_asset_lingers`, `content_overlap`, `container_overflow`, `repeated_visible_copy` | Relationship/overlap heuristics | Stale is strictness-exempt but remains warning/penalty; most others lower strictness and buy repair. | **ADVISORY** unless the overlap makes primary content actually missing/unreadable, which a focal/readability detector must prove separately. |
| `cut_degraded` | Cut runtime | Warning; high penalty 6; paid repair. | **ADVISORY** when state transfer remains coherent and the cut safely degraded. Actual state contradiction/reset is **HARD**. |
| `eye_trace_jump`, `eye_trace_pingpong` | Eye-trace taste | Warning; jump may affect strictness; deterministic schedule repair can retime beats; paid repair/critic. | **ADVISORY**. No deterministic beat-timing change. |
| `motion_quiet_window`, `transition_static_outgoing`, `motion_dead_frame`, `motion_jerk_excess`, `motion_reversal_excess`, `motion_settle_late` | Continuous-motion/transition taste | Warning; strictness + weighted/degree penalty; paid repair/critic. | **ADVISORY**, except a whole-film invalid/dead timeline is separately HARD. |
| `moment_static_frame` | Rendered temporal judge | Supporting moments are partly filtered; primary remains strictness/penalty/retry. | **ADVISORY** for supporting/non-catastrophic moments; **HARD** only when it proves missing/blank load-bearing primary content. |
| Layout anchor/gap/alignment/density and other `layout_*` findings | Layout intent measurement | Warnings; strictness/penalty/paid retry depending source/severity. | **ADVISORY** unless the same measurement proves a typed load-bearing focal is out of frame/unreadable. |

## Deterministic normalizer and repair inventory

### Source normalizer registry

`runner/repairs/implementation.ts:3875-5372` runs 51 ordered passes in one `source-composition` atomic group. All have zero paid cost and are idempotence-audited. The registry order is:

`root-data-start`; inline source syntax (`css-var`, `template-selector`, `svg-placeholder`, persisted scene arrow, connector SVG, visibility, deterministic random); `gsap-call-shape`; source bindings (`scene-id`, timeline registration, layout intent, interaction near miss, contract, camera world, component pre/post continuity, style scope, region home, alias, rows, underline, camera runtime, liveness, layout repair, compile order, runtime order); font-face artifact; host-plan islands (asset reference, strip, environment, display type, cuts, camera, continuity, components, component kit, cinema kit, time); repeat clamp; station position; brand base/cinema profile; plugin/FX/asset/recipe lowering; chart/progress completion; world-layout styles; dead-tween strip.

Target decision:

- Keep canonical markup, typed binding, host-island reinjection, script/runtime order, and exact component completion as **DETERMINISTIC SAME-ATTEMPT REPAIR**.
- Station/world geometry stays deterministic only for the S6.10 measured load-bearing containment transaction. Generic taste-driven repositioning is **ADVISORY**.
- Brand/palette/motion-style changes are outside the allowed repair contract even if a legacy normalizer currently performs them; S6.11 must ensure advisory findings cannot invoke such changes.

### Storyboard normalizers

`runner/storyboardAudit.ts:2290-2575` currently runs scene-id/morph/kind reconciliation, entrance retime, camera chassis, component trim, held-result development, cross-station upgrade, camera budget clamp, framing top-up, energy lift, rack-focus top-up, landing reserve, destination alignment, camera/interaction retime, move spacing, early-swap delay, pacing stretch, connective schedule, and moment top-up before validation.

Target decision:

- Keep only schema/canonical contract reconciliation that does not change copy, story order, component choice, beat timing, palette, typography, or motion style.
- Camera chassis/world cells may be constructed mechanically; camera/station fit may change only through measured S6.10 containment.
- Component trim, entrance/beat/camera retiming, energy/zoom taste, framing-density top-up, and creative route changes are **ADVISORY**, not allowed deterministic repairs for this sprint.

### Browser-triggered deterministic repairs

| Current repair | Trigger | Current adoption gate | Target decision |
| --- | --- | --- | --- |
| Contrast loop (`ladder.ts:3475-3528`) | `contrast_aa` | Up to 3 passes, strict global penalty decrease. | **ADVISORY**; no palette/typography/style mutation. |
| Washout plate (`ladder.ts:3530-3615`) | `composition_washed_out` | Target clears, no diagnostics regress, penalty decreases. | **ADVISORY**; no contrast-plate style rewrite. |
| Eye-trace schedule (`ladder.ts:3617-3662`) | `eye_trace_pingpong` | Finding clears, no diagnostics regress, penalty decreases. | **ADVISORY**; it changes timing. |
| Generic layout overflow (`ladder.ts:3664-3743`) | `canvas_overflow`, `important_safe_area` | Target/score improves, no protected issue/diagnostic/penalty regression. | Restrict to typed load-bearing containment and S6.10's exact visibility-floor proof; otherwise **ADVISORY**. |
| Sparse framing (`ladder.ts:3745-3828`) | `camera_framed_sparse` | Sparse clears, no new clipping, penalty decreases. | **ADVISORY** when focal is already visible; occupancy preference cannot mutate camera/station fit. |
| Interaction quarantine | Hard typed interaction errors | Revalidate and choose best runtime candidate. | **DETERMINISTIC** only for optional, mechanically isolated interaction removal with no story/state loss; otherwise unresolved **HARD**. |
| Volunteered cut degradation | Persistent unbindable cut | Revalidate whole draft. | **DETERMINISTIC** only when state remains continuous; user-required contract or reset remains **HARD**. |
| Moment demotion | Only unbound primary moment blockers after ladder exhaustion | Revalidate and publish. | Not an allowed hackathon repair: changing a primary claim to supporting changes story evidence. Missing load-bearing content is **HARD**. |

## ProofLane J negative-control trace

Persisted evidence:

- Source: `apps/slack/.data/projects/lp3-state-capsule-20260712-j/planning/attempts/author-1-browser-rejected.html`
- Initial paid-retry record: sibling `.json`; it contains only `camera_blocking_landing` for `ready-headline` at 100% visibility and 12.2% focal occupancy.
- QA caches: `qa-cache/43fc62dbd8691b1d8b6a863eb773f988.json` and `qa-cache/aa9473f3460f755982aa248305c455db.json`.

On the three-finding cache, the current scorer charges penalty 19 (including 4
points of hidden measured-art pressure), `sourceRetryFeedbackForBrowserQa`
retains all three lines, and `criticSkippableCleanDraft` returns false. Because
all three findings name scenes, the slot path can spend one three-scene source
re-author before the next logical source attempt even begins.

| Finding | Detector -> current routing | Why it is not hard | Target decision |
| --- | --- | --- | --- |
| `stale_asset_lingers` on `approval-shell` vs child `readiness-stat` | `auditStaleAssets` -> browser warnings; strictness explicitly exempts it, but warning/penalty remain visible to retry/critic machinery. | Parent app-window and contained stat overlap is an exit/surface preference; the child remains visible and the runtime is valid. | **ADVISORY**; QA + `warn`, zero repair calls. |
| `camera_blocking_landing` on `ready-headline` | `auditCameraBlockingLandings` -> warning -> high penalty/hidden occupancy penalty -> `sourceRetryFeedbackForBrowserQa` -> scene repair/patch. | Headline is 100% visible, occupies ~12%, and is already inside its own typed 2.5-22% range. Only the parent station's 94.6-100% ensemble occupancy misses a 16-56% preference. | **ADVISORY**; no containment and no repair call. |
| `camera_blocking_unsettled` on opener | continuous camera evidence -> warning -> high/degree penalty -> source retry/critic. | The opener is still moving at the sampled landing; this is settle/taste evidence, not a runtime/visibility defect. | **ADVISORY**; QA + `warn`, zero repair calls. |

The exact negative-control expectation for S6.11 is one provider source response and zero source repair/critic calls for this three-finding shape. ProofLane J must not enter S6.10 containment because its headline is fully visible.

## Visibility/out-of-frame detector overlap

The current code can charge the same rendered symptom through several independent detectors and then again through hidden quality scoring:

| Symptom | Detectors that may report it | Duplicate cost today | Canonical target owner |
| --- | --- | --- | --- |
| Typed primary absent/hidden/zero-area | `spatial_focal_missing` / `spatial_focal_invisible`; `camera_blocking_landing`; `near_blank_scene`; sometimes `interaction_not_visible`; static `component_root_missing`/`component_beat_unbound`. | Multiple warnings/errors increase penalty and are separately included in source feedback; scene repair may see several lines for one root. | Static canonical binding first. Then one typed load-bearing visibility finding keyed by scene+part. Missing after canonical repair is **HARD**. |
| Typed primary partly/wholly out of frame | `spatial_focal_offframe` (85% at primary moment or 50% hero sample); `camera_framed_clipped` (camera station/held primary); `camera_blocking_landing` (85% phrase target); `important_safe_area`; HyperFrames `canvas_overflow`/`motion_off_frame`/text clipping; `near_blank_scene` when severe. | Each issue has its own penalty and can buy the same scene repair; generic overflow and sparse repair can both mutate layout/camera before a patch. | S6.10: one measurement keyed by typed load-bearing scene+part, one bounded containment transaction, one reinspection. Persisting failure becomes one **HARD** signature. |
| Visible but small/sparse | `spatial_focal_minor`; `camera_framed_sparse`; `composition_frame_underfilled`; `camera_blocking_landing` occupancy miss; measured-art occupancy penalty. | Hidden and explicit penalties can trigger repair even with no visibility defect. | **ADVISORY**. No containment or paid repair. |
| Primary text technically present but unreadable | `clipped_text`, `text_box_overflow`, `text_occluded`, `contrast_aa`, `important_safe_area`, focal containment. | Visual error copied into warnings, plus repair warning and penalty; contrast/layout repair and source retry can all run. | Geometric clipping/occlusion of primary text uses S6.10 containment then **HARD** if unreadable. Contrast preference is **ADVISORY**. |
| Empty scene/film | `near_blank_scene`, `near_blank_film`, focal missing/invisible/offframe, sparse coverage. | Scene warning plus film error and focal/occupancy warnings may all enter feedback. | Collapse to load-bearing blankness. Same-attempt containment first when geometry is the cause; unresolved blank load-bearing content is **HARD**. |

S6.10 should not delete diagnostic rows. It should deduplicate retry ownership by a typed `(sceneId, part)` containment target and leave every raw detector visible in QA.

## Status and publication mapping

- `summarizeSequenceCheckStatus` already returns `fail` for failed direct validation, missing thumbnails, or a requested missing/empty MP4.
- Runtime-invalid ledger state, quality residue, degraded/fallback disposition, more than one attempt, static motion warnings, and QA warnings return `warn`.
- Therefore S6.11 does not need to call advisories clean. It needs to stop advisories from purchasing calls while keeping the existing honest `warn` mapping.
- A runtime-valid authored candidate with advisory residue should be `published` at the ledger disposition level with `qualityResidue > 0`, and CLI/Slack status `warn`. `published-degraded` remains reserved for a material deterministic degradation, not the mere existence of advisory evidence.

## S6.10/S6.11 implementation boundary from this inventory

1. S6.10 owns only typed load-bearing measured containment. It must use a real off-frame/minimized fixture, keep ProofLane J negative, be bounded/idempotent, and re-inspect before adoption.
2. S6.11 owns tier-aware retry feedback, two-attempt stage caps, the six-logical/eight-physical global cap, per-stage hedge cap, banking on runtime-valid/no-HARD, advisory critic suppression, and honest `warn` status.
3. No S6.9 finding justifies copy/story/component/timing/typography/palette/motion-style changes, a paid probe, Studio/catalog work, or any S7+ work.
