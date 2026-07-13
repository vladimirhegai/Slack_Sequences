# Current live-probe ledger

This is the concise active ledger. Exact rejected artifacts under
`.data/projects/<job>/planning/attempts/` are the detailed evidence. Older
incident narratives were removed from active docs; durable lessons belong in
tests, registries, and [REFACTOR_HANDOFF.md](REFACTOR_HANDOFF.md).

For every paid attempt: preserve the artifact, replay it without a model call,
fix the lowest deterministic owner, add a regression, and record the honest
terminal status. Provider faults are environmental but still count in call
accounting.

Current boundary (2026-07-12): this ledger now runs through the early-stopped
ProofLane J probe. The next work is S6.9's guardrail/retry inventory, not probe
K. The active sprint permits at most two new paid probes total and stops after
the first runtime-valid, human-acceptable MP4; advisory-only residue is not a
reason to rerun.

## 2026-07-12 Hackathon stabilization probe preflight

The required negative-control evidence is already recorded below without
revision: ProofGrid I published a real non-fallback MP4, while ProofLane J was
stopped at its first runtime-valid browser QA and produced no MP4 or terminal
call ledger. S6.9-S6.11 are locally committed. Root and Slack typechecks, the
complete Slack unit and browser suites, `replay:all` (25/0/0), exact ProofGrid
I and ProofLane J source replays, the persisted ProofLane hard-finding
classifier checks, and the deterministic golden/render proof are green.

Probe A will use the ordinary 15-second Sequences-for-Slack brief through the
documented OpenRouter create path: fallback off, continuity and composition
audit on, MCP/render/temporal evidence on, and `format both`. The create path
persists GLM frame/asset direction before storyboard/source authoring, matching
the Slack two-tier asset-then-result flow without inventing a second probe
schema or provider call. Stop at the first human-acceptable MP4; advisory-only
residue cannot authorize another run.

### Sequences for Slack A — `s6-12-sequences-slack-a-20260712-1652` (fail-loud)

Probe A ran for 6m26s. Its GLM frame/asset direction, concept, shape, first
storyboard, and first full source response all completed; the storyboard kept
one component-density advisory without retrying. The source's bounded scaffold
repair restored two dropped scene contracts. The first browser inspection then
hard-failed `interaction_not_visible` for `brief-cursor`: the cursor arrived at
the Slack chat surface from 3.95–4.15s while that target was invisible. The
six-logical-call ceiling correctly refused another author patch, so the run
ended without runtime, render, QA report, temporal strip, or MP4. Triage: 6
logical / 8 physical requests, one storyboard attempt, two source-family calls,
two hedges, fallback off, `runtimeValid=false`, `qualityResidue=0`.

Exact replay localized the defect to canonical component markup. The typed
chat's later `swap` and `stream` beats had no kit-internal child markers, so the
runtime fell back to the whole `slack-chat` root and pre-hid the interaction
target. The bounded repair now marks only one descendant whose existing copy
exactly matches the beat and whose id/part/class names the required input or
response role. It changes no copy, timing, hierarchy, style, or story; a second
pass is byte-stable, while canonical and ambiguous controls are unchanged. The
minimized real-browser regression is green. Re-inspection of A's exact rejected
HTML changes only `chat-input` / `ai-response` binding attributes: runtime
`ok:true`, zero hard findings, and arrival/press/release all hit within 0.001px.
Remaining `container_overflow`, washout, and contrast findings are advisory.
Probe B is authorized after the full verification surface, using the same
semantic brief and only a new job/cache marker.

### Sequences for Slack B — `s6-12-sequences-slack-b-20260712-2113` (live fail-loud; exact source recovered)

Probe B used the same semantic brief with only the cache-distinct job marker
changed. The real OpenRouter run took 9m15s: one frame decision, one concept,
one accepted storyboard, and two source-family calls, for 5 logical / 7
physical requests with one storyboard hedge and one source hedge. Fallback was
off. It stayed inside the six/eight request caps without a runaway retry. The
live command nevertheless failed loud before render: `slack-chat` measured
0% visible because two overlapping PRIMARY continuity routes sent the camera
to disjoint Slack/context stations. The two-source ceiling correctly refused a
third patch, so the live command itself produced no MP4 and has no
`sequence-check.json`. Its complete ledger, rejected source, author record,
Sentinel record, and triage remain in the project.

Exact replay identified camera-phrase ownership as the lowest deterministic
owner. When typed spatial/interaction evidence names one route, the compiler
now executes that route and retains a simultaneous disjoint continuity route
only as an advisory. Ambiguous and sequential routes remain unchanged. The
minimized Chromium regression keeps the Slack focal on-frame and the click
arrival/press/release on target. Replaying B's exact rejected HTML after this
repair gives runtime `ok:true`, no hard finding, and nine executable blocking
phrases instead of ten. The earlier A chat binding repair is also applied.

Human review then found one source-specific judge-visible residue: the author
had drawn a canvas-scale blue diagonal `accent-hairline` through the opener.
The bounded source normalizer now retires only the paint of a non-host,
non-component, simple two-point hairline spanning at least 50% of canvas width
and 25% of height. It preserves the target element, camera/continuity geometry,
copy, component choices, beats, timing, palette, and motion. Horizontal rules,
short accents, charts, and host geometry are negative controls; a second pass
is byte-stable. Consecutive encoded-frame inspection confirms the diagonal is
gone and the suspected dark rectangles were contact-sheet tiling artifacts,
not MP4 frames.

No provider or Probe C call was used for recovery. The exact persisted
OpenRouter-authored source was normalized, re-inspected, committed locally as
revision 2, thumbnailed, temporally inspected, and rendered model-free in
1m25s. Primary artifact:
`renders/sequences-for-slack-recovered-probe-b-20260713-015938.mp4` (H.264,
1920x1080, 30fps, 480 frames, 16.0s, 2,366,676 bytes). The strip, blocking
overlay, cut sheets, temporal JSON, and ten thumbnails are under `build/qa`
and `build/thumbs` in the same project.

Human disposition: **accept with warn**. The film reads as one commercial:
scattered release inputs → Slack brief and permission-scoped retrieval →
storyboard/preview → MP4 returned → the requested CTA, which lands and holds.
The click is visible, state does not reset, primary content remains on-frame,
and no broken interaction or transition survives. Remaining advisories are
washout/contrast preference, supporting copy size, one safe-area preference,
degraded morph-to-swipe, camera occupancy taste, and quiet/static holds. None
is a hard failure or authorizes another call. Across both authorized probes the
historical evidence totals 11 logical / 15 physical requests; B itself was
within the per-job caps. The accepted B path is 9m15s of live authoring plus
1m25s of model-free recovery/render after the fix, about 10m40s end to end.

### S6.13 freeze and rehearsal — `s6-13-hackathon-rehearsal-20260713`

Product code was frozen at S6.12 commit `9aa6aa6`; no provider call, fallback
probe, or publish followed. The corrected Probe B MP4 above remains the primary
artifact. After rehearsal the owner authorized a production deploy from the
committed S6.13 tree; publish remains separate and was not authorized.

The exact judge runbook was checked against the Slack handlers: `/sequences
debug on`; `/sequences assets` (the `asset` alias is equivalent) with UI
screenshots and optional notes; wait for the deterministic captured-brand
receipt/preview; then `/sequences` and the ordinary launch modal. The building
message exposes honest frame/storyboard/source phases and submit/preview/render
receipts, posts storyboard thumbnails plus `frame.md`, changes to rendering,
then lands on the ready message and MP4 upload. With normal production fallback
enabled, any safe proof film is explicitly labeled with the failed model stage
and is never represented as authored output.

The timed local `/sequences demo` equivalent used the documented model-free
`sequence:check --demo --no-mcp --render --temporal --format both` command. It
completed in 30.6s with status `pass`, clean lint, five thumbnails, and no
model/MCP request. The backup MP4 is H.264, 1920x1080, 30fps, 525 frames, 17.5s,
1,391,378 bytes:
`.data/projects/s6-13-hackathon-rehearsal-20260713/renders/relay-20260713-021028.mp4`.
Its JSON/Markdown receipts are under the same project's `build/qa`. Contact-
sheet review confirms readable hook, product proof, stat, social proof, and
held CTA. Production `/healthz` returned `200 ready` in 296ms. The evidence-only
fallback variable was staged from explicit-off to explicit-on with deploys
skipped, ready for the single owner-authorized committed-tree deployment. No
publish or provider call was made.

## 2026-07-11 audit sequence

### LaunchRelay — `architecture-audit-live-1-20260711`

- Baseline: 3 storyboard attempts, 3 source attempts, 13 logical / 17 physical
  calls, 35.9m, `published-degraded`, rendered 27.3s.
- Shared defects: camera chassis lost on rollback, plugin region loss,
  host-auto moments protecting optional motion, global GSAP escaping the
  seekable timeline, shared-station support stealing the lens, and a light
  pedestal on a dark basis.
- Result: exact rejected storyboard/source replays pass after common-layer
  fixes. The baseline itself remains evidence, not a quality pass.

### PulseForge — `architecture-stress-2-20260711`

- Stopped after one storyboard findings retry.
- Cause: ramped scenes measured the introduction/development floor in source
  time instead of viewer time.
- Result: bounded viewer-time cut extension now commits atomically; exact raw
  replay passes at 25.203s.

### GatePilot — `architecture-stress-3-20260711`

- Corrected fixture passed storyboard attempt 1; source attempt 1 produced
  seven browser findings and attempt 2 was stopped.
- Shared defects: wrong primary cue, late chassis loss, impossible cross-kind
  morph promise, cut/read dwell mismatch, QA/runtime occupancy mismatch,
  plugin-child camera ownership, and a zero-length post-cut route.
- Result: exact rejected source now reports `strictOk:true`, `ok:true`, zero
  warnings. Focused unit/browser checks and typecheck pass.

### RelayGuard — `architecture-stress-4-20260711`

- Attempt 1 provider-truncated; attempt 2 rejected with three pacing findings;
  the next stream faulted and the run was stopped.
- Shared defects: a long opener approach missed the scene-stretch cap by only
  260ms, reverting toast holds; duplicated camera paperwork protected a whip
  through click settlement.
- Result: marginal approach trim is bounded to 350ms / 15% with a 600ms floor;
  interaction retiming protects camera-only evidence and matches audit
  tolerance. Exact attempt-2 strict replay passes at 25.5s; 82 pacing tests and
  typecheck pass. Commit: `63a1064`.

### SignalDock — `architecture-stress-5-20260711` (final session probe)

- Terminal: 25.2m, logical storyboard stage reported one accepted attempt after
  two provider stream timeouts; one bounded scene-repair call; two source
  attempts; 10 logical / 14 physical model requests; `published-degraded`;
  penalty 32; 23s MP4; fallback film not used.
- The output is not a motion-quality pass: 8 QA warnings, 4/8 readable primary
  landings, 9/14 occupancy samples in range, 30 jerk markers, peak speed 2.798
  diagonals/s, and 26.7% dead eligible runtime.
- Important frames show 0% reset flickers, label/value collision, cropped 94%
  numerals, sparse staging, wrong workspace anchoring, and weak final hierarchy.
  Code shows 14 blocking phrases for four scenes, two-step cursor correction,
  and a pseudo-element `querySelector` passed to GSAP as `null`.
- The critic correctly rejected its patch (`32 → 34`). This probe marks the
  boundary for the broad refactor; no further paid probe was launched at the
  user's request.

### Briefly — `refactor-review-normal-1-20260711` (refactor-review session probe)

- The first run of the prepared calm production-shaped brief (16s,
  crisp-saas, fallback disabled). Terminal: 24.0m, `published-degraded`,
  8 QA warnings, 20.2s MP4, fallback not used, status `warn`.
- Storyboard: 1 logical attempt but 3 physical streams (two provider
  timeouts) + 2 hedge duplicates; then ~11 sentinel normalizations rewrote
  plan timing — including moving the staggered 2.2s/3.2s arrival beats of the
  opening "inputs pile up one by one" scene all to 0.28s (the
  entrance-cannot-be-blank normalizer erased the authored stagger), dropping
  camera moves for budget, and delaying a whip 2.5s.
- Source: attempt 1 browser-rejected (3 GSAP-null-target warnings — NodeList/
  empty/null dataflow forms that the literal dead-selector strip missed —
  plus important_safe_area 29px and camera_framed_sparse 6%); attempt 2
  compact repair (107,819-char prompt) failed slot validation, kept draft,
  re-reported the SAME classes with safe-area now 159px; attempt 3
  (110,924 chars) changed the locked scene count 5→4 and was atomically
  rejected; the ladder early-shipped attempt 2 as "browser-valid". Critic
  issued 4 directives; its patch regressed quality 20→21 and was rejected.
- Film look (strip + thumbs): five white app-window scenes floating small on
  a loud orange/blue wallpaper; low-contrast gray-on-white row text;
  ~1.2s empty opening card; seeded plugin copy mismatched the story
  ("Meeting recapped — Leo Diaz" toast in a weekly-update publish beat);
  final headline wraps mid-word ("Keep everyone in th / e loop"); sparse
  final lockup (6–10% painted). `composition_washed_out`,
  `camera_framed_sparse`, `important_safe_area`, `moment_static_frame`
  all shipped as warnings.
- Verdict: replicates SignalDock's classes on a CALM brief — repeated-class
  repair loop, prompt bloat, sparse/washed staging, normalizers overriding
  intended choreography, headline typography. Evidence feeds
  [REFACTOR_PLAN.md](REFACTOR_PLAN.md) S1.3, S5.4, S6.1, S8.1, and Phase 3.
  No second probe launched: stress + normal evidence now agree; next paid
  probe should follow Phase 0 tooling.

## 2026-07-11/12 Phase 3 LP-1 checkpoint (FrameProof)

### FrameProof — `phase3-lp1-camera-20260711-a…e` (five fail-loud runs, then pass)

Stress-shaped seven-scene brief, fallback disabled, continuity on, audit
composition, OpenRouter. Attempts A–D each stopped fail-loud at storyboard
planning, and each exposed one deterministic Phase 3 integration defect that
was fixed at the lowest owner with an exact-artifact replay plus a minimized
regression before the next paid run (full narratives in
[PHASE_3.md](PHASE_3.md)):

- **A** (`…-a`, 6 logical / 8 physical): idea gate counted same-target visits
  as competing ideas → semantic de-duplication by target + contextual framing
  (commit `22b9086`).
- **B** (`…-b`, 7/10): `topUpFramingFloor` could not upgrade a single
  continuity-owned hold chassis, and its finding message encouraged
  supporting-evidence tours → neutral-chassis upgrade to a bounded same-target
  push-in (commit `bbbfb80`).
- **C** (`…-c`, 4/8): plugin reconciliation kept a renamed one-child
  team-strip beside the typed load-bearing avatar stack, creating a second
  camera owner → retire the duplicate plugin (commit `14e86c7`).
- **D** (`…-d`, 8/9): a generic spatial focal did not receive its declared
  region as contextual framing, so the authored station move was claimed by a
  supporting phrase → region-as-context for spatial focals (commit `6f7064c`;
  intentional LaunchRelay replay refreeze).
- **E** (`…-e`, 24.0 min, 9 logical / 13 physical, 2 failed + 2 hedged
  physical requests — environmental): **storyboard accepted on the first
  logical attempt**; `published-degraded`, `runtimeValid=true`,
  `qualityResidue=1`, 20.2s MP4.

**LP-1 verdict vs LP-0 (SignalDock): PASS on all four criteria.** ≤1 primary
route/scene (2 full moves / 7 scenes vs 14 phrases / 4 scenes); primary
readable landings 7/7 (vs 4/8); occupancy in range 7/7 (vs 9/14); one
registry-known QA class, nothing new (1 warning vs 8; 3 jerk markers vs 30;
peak speed 0.776 vs 2.798 diag/s; 0% vs 26.7% dead eligible runtime).

Residue, honestly stated: `motion_jerk_excess` in `gathered-workspace`
repeated across both source attempts and shipped as the single quality
residue (`stagnant-polish-early-ship`). The artifact replays statically clean;
the class is the S8.4 gesture-settle contract and is logged there. Frame
inspection also shows Phase-8 staging classes (edge-cropped count-up
numerals, a near-black owner scene, loud wallpaper swipe covers) → S8.1/S8.6.
No camera-semantic defect remains; Phase 4 (state continuity) is next.

## 2026-07-12 Phase 4 LP-2 checkpoint (StateRelay)

### StateRelay — `s4-lp2-state-20260712` (inconclusive; failed before state runtime)

Explicitly authorized metric-continuity probe using a cache-distinct five-scene
brief (`28% → 54% → 86%`), OpenRouter, fallback disabled, continuity graph on,
audit composition, MCP, render, and temporal evidence requested. The run
terminated fail-loud after 14m35s: frame design succeeded (2 logical / 2
physical); storyboard planning made 6 logical / 7 physical calls with one hedge,
then exhausted the primary/rescue ladder. No fallback, source authoring, MP4,
or temporal strip was produced.

Every terminal attempt failed on the same pre-existing Phase-3
`camera/idea-budget` finding: scene `shot-4-owner-verifies` asked the lens to
tell both `window-score` and `last-check` in `relay-surface`. `probe:triage`
reports `fail-loud`, `runtimeValid=false`, `qualityResidue=0`, no QA findings,
and no degradation. The five raw storyboard artifacts were replayed without a
model call and reproduced the exact finding. This is not evidence for or
against S4.1/S4.2 state handoff; LP-2 remains open. Fix-first policy blocks a
second paid run until the repeated planning owner is fixed and replayed.

## Session conclusion

No fresh stress probe completed as a clean one-attempt motion-quality pass.
Exact-artifact fixes converged, but the final production-shaped run demonstrated
that camera/blocking/layout/repair ownership is too coupled for another local
patch cycle. Continue with [REFACTOR_HANDOFF.md](REFACTOR_HANDOFF.md).

## 2026-07-12 Phase 4 LP-2 follow-up (fix-first sequence)

Four cache-distinct metric-continuity probes were launched with OpenRouter,
fallback disabled, continuity enabled, audit composition, MCP, render, and
temporal requested. Every run was stopped as soon as persisted rejection
artifacts became visible; none reached source authoring or runtime, so LP-2
remains inconclusive.

- `s4-lp2-state-20260712-b` (ProofRail, 31% -> 59% -> 88%): stopped after two
  storyboard rejections. Both repeated `camera/idea-budget` for one continuity
  metric represented as `score-meter` then `score-ring`; the same audit also
  miscounted local button evidence inside an already-framed app surface. Fixed
  at the semantic idea owner: phrases now share an idea when they share a
  contextual framing surface or continuity `entityId`. Both exact artifacts
  replay strictly clean.
- `s4-lp2-state-20260712-c` (SignalLedger, 34% -> 63% -> 92%): stopped after
  two storyboard rejections on genuine dead-moment gaps. Exact replay exposed
  a deterministic secondary defect: an atomic camera retime worsened the
  honest 3.0s gap to 5.5s but committed because both findings had the same
  digit-stripped class. Atomic normalization now reverts quantitatively
  worsened moment gaps. The exact artifact honestly replays to the original
  3.0s creative finding; no motion was invented to hide it.
- `s4-lp2-state-20260712-d` (MetricThread, 37% -> 66% -> 93%): stopped after
  one storyboard rejection because two `entityId: metric` headlines carried
  typed `count` beats. Added the bounded L2 conjunction
  `headline + metric entity + count -> stat-card`; ordinary headlines and
  metric headlines without count beats are negative controls. The exact
  artifact now replays strictly clean.
- `s4-lp2-state-20260712-d-resume`: a fresh provider response was returned
  instead of reusing the accepted paid artifact. It was stopped after attempt
  1 with digit-leading scene IDs, a genuine two-station camera idea, and a
  reading-hold finding. The mechanical IDs now receive a bounded `scene-`
  prefix; the lens choice and reading choreography require planner/Phase-8
  decisions, so no deterministic content was invented for those findings.

No fallback film, source attempt, MP4, or temporal strip was produced in this
follow-up sequence. Verification after the fixes: Slack typecheck; focused
camera/component/Sentinel/normalization tests; full Slack unit suite; exact
replays 13/0/0. Root `npm test` had five parallel-Chrome timeouts; all five
files passed serially (19/19), matching the documented contention class.

## 2026-07-12 Phase 6 LP-3 checkpoint (CurrentProof)

### CurrentProof — `lp3-state-capsule-20260712-a` (fail-loud preflight)

The explicitly authorized cache-distinct probe combined the open LP-2 state
shape with LP-3's prompt/capsule check: one metric develops 41% -> 68% -> 91%
across five scenes, then enters one approval surface. Fallback was disabled,
continuity enabled, composition audit on, with MCP/render/temporal requested.

Frame design completed. The first storyboard response was accepted after one
bounded scene repair; the host auto-declared the evidence-backed
`asset-glass-metric` on `release-readiness-68`, proving the S6.3 capsule's typed
conversion path. Before the first source provider call, the assembled slot
prompt exceeded S6.1's 45,000-char ceiling (46,602 chars). The ladder then
repeated that deterministic preflight failure for attempts 2/3 (47,539 chars)
and rescue (61,201 chars). No source call, browser runtime, MP4, fallback, or
temporal evidence was produced, so LP-2 and LP-3 remain open.

Lowest-owner fix (S6.4): retain the locked storyboard and host templates, trim
only the optional author-stage skill capsule from 5,000 to 2,000 chars, and
make `AuthorPromptBudgetError` terminal for the author ladder so a future
oversize cannot consume content retries or rescue. Recomposition of the exact
persisted plan is 43,016 chars. The failed job and all exception/storyboard
artifacts remain under `.data/projects/lp3-state-capsule-20260712-a`.

### CurrentProof — `lp3-state-capsule-20260712-b` (fail-loud preflight follow-up)

The cache-distinct follow-up exposed why a fixed skill allowance was still not
a complete S6.1 implementation. Frame design hit one provider truncation and
used its deterministic direction fallback. Storyboard attempt 1 had one
genuine `components/complexity` finding (four approval surfaces in 4.6s), which
the bounded scene repair reduced to three; `asset-glass-metric` again
auto-declared. The resulting valid five-scene plan assembled to 46,310 chars
even with the 2,000-char skill cap. The new typed budget error behaved
correctly: one preflight exception, no source provider call, no repeated author
attempt, and no rescue. No browser/runtime/render evidence was produced.

The completed S6.4 fix now fits the optional skill excerpt to each locked
plan's actual remaining budget (with 512 chars of headroom) instead of relying
on a fixed allowance. Recomposition is 43,036 chars for run A and 44,488 for
run B while both retain the full plan, frame capsule, and host scaffold. LP-2
and LP-3 still require a fresh runtime-reaching probe.

### CurrentProof — `lp3-state-capsule-20260712-c` (stopped fix-first in planning)

The third cache-distinct run was stopped after two persisted storyboard
rejections repeated `camera/idea-budget` in `approval-surface`: the lens audit
called `metric-value-card` and `confirm-btn` competing ideas even though both
were local evidence inside the scene's one hero modal. Attempt 2 also carried
an independent genuine 3.1s moment gap. No source authoring or runtime began.

Exact replay located the mechanical owner in S3 camera blocking. Contextual
framing already groups metric/button evidence inside one sole app window, but
did not recognize the typed hero `modal` used for an approval surface. S3.5
extends only that bounded surface predicate: one hero modal groups its local
metric/CTA phrases; multiple or non-hero modals remain separate. Attempt 1 now
passes strict replay. Attempt 2 no longer reports the camera class and honestly
retains only its moment gap. LP-2/LP-3 remain open pending a fresh probe.

### CurrentProof — `lp3-state-capsule-20260712-d` (fail-loud in source authoring)

The post-S3.5 probe did not repeat the modal camera class and finally reached
source authoring. Planning still required three storyboard attempts: the first
two had genuine approval-surface reading/hold density findings; attempt 3 was
accepted with one dropped time ramp degradation and auto-declared
`asset-glass-metric`. The initial author prompt fit at 44,829 chars, proving
S6.4's dynamic preflight path live.

Author attempt 1 plus its scene-scoped slot repair produced a 28,451-char
source, but three typed `progress` beats targeting `hairline-rule` had no
`.cmp-ring-fg`, `[data-cmp-fill]`, or direct `<i>` fill element. The L3
`kit_markup_incomplete` gate rejected it. Attempt 2's compact patch repeated
all three exact findings. Attempt 3 switched to full re-authoring but its
non-optional locked context still measured 49,040 chars after the skill fit,
so the typed prompt-budget preflight stopped it without a provider call. No
runtime, MP4, or temporal evidence was produced.

`probe:triage`: fail-loud, runtime invalid, 9 logical / 12 physical calls, one
storyboard time-ramp degradation, no fallback. Exact `source:replay` reproduces
the three progress-fill findings. Required next fix: the L1 component scaffold
or bounded L2 kit-markup completion must emit the canonical fill child for a
typed `progress` root before author repair; separately, compact full-re-author
locked context below 45k without dropping the plan/scaffold/frame contract.
No further paid probe was launched.

## 2026-07-12 Phase 6 convergence sequence (ProofLine through ProofLane)

### ProofLine — `lp3-state-capsule-20260712-e` (published-degraded)

The first storyboard was accepted, but source QA exposed three typed-ownership
collisions: ring-only `.cmp-value` geometry escaped into a stat card, an
authored class-only cursor lived beside the host cursor, and repeated legs on
the same targets inflated motion density while the actual arrival changed only
0.069% of rendered pixels.

Terminal triage: `published-degraded`, status `warn`, `runtimeValid=true`,
`qualityResidue=3`, no fallback; 9 logical / 11 physical calls, including two
hedges. The MP4 and temporal evidence exist. Shipped findings were
`camera_blocking_landing`, `content_overlap`, and `moment_static_frame`.
Commit `1375c21` scoped the shared class geometry, retired only unmistakable
duplicate cursors, counted distinct moving targets, and added measured arrival
feedback. Exact browser replay then reached `strictOk:true`, removed the
overlap/static findings, and measured 6.574% arrival change.

### ProofArc — `lp3-state-capsule-20260712-f` (published, zero QA residue)

Terminal triage: `published`, status `warn`, `runtimeValid=true`,
`qualityResidue=0`, no degradation/fallback; 8 logical / 10 physical calls,
including two hedges. A real MP4, strip, blocking overlay, and thumbs exist.
The first two storyboard responses were rejected on front-loaded moments,
payoff dwell, framing floor, and energy-peak requirements. The accepted source
record contains no author repair attempt and no terminal QA finding, but the
overall run was not one-attempt because planning plus downstream quality calls
still exceeded the desired path.

Commit `95c0dec` added bounded host-owned late result development, explicit
focal fallback for targetless camera routes, and same-station payoff landing
without inventing another camera idea. This is convergence evidence, not a
reason to require zero warnings on future judge-ready films.

### ProofSpan — `lp3-state-capsule-20260712-g` (fail-loud before runtime)

Storyboard attempt 1 falsely split a hero ring from its subordinate same-
station hairline. Source attempts 1 and 2 then repeated one 3.4s evidence-gap
finding; the full recovery prompt stopped at 46,522 characters before a third
provider source call. Terminal triage: fail-loud, `runtimeValid=false`, 6
logical / 8 physical calls, two hedges, no fallback, QA report, MP4, or temporal
evidence.

Commit `0412db1` grouped the exact ring/hairline station, bound unsupported
late held-result moments at the deterministic component owner, and compacted
only redundant full-recovery reference prose while preserving the locked plan,
frame, scaffold, and finding. Exact fixtures and prompt-budget proof cover this
run.

### ProofRail — `lp3-state-capsule-20260712-h` (stopped at first browser QA)

The persisted browser result was runtime `ok:true`, `strictOk:false` with four
warnings: an 8% painted sparse opener, a fully visible 10% metric landing,
`motion_reversal_excess`, and a supporting rail moment changing only 0.002% of
pixels. The run was stopped before terminal persistence. It has a storyboard
and QA cache but no `sentinel-run.json`, author ledger, sequence-check report,
MP4, or terminal disposition; logical/physical call counts are therefore
unprovable and are intentionally not estimated.

Commit `ecebb39` added measured ring/rail station co-location, one bounded
targeted-drift promotion for genuinely sparse framing, and a final landing-
reserve pass after later retimes. Exact ProofRail QA and negative controls are
in replay/browser coverage.

### ProofGrid — `lp3-state-capsule-20260712-i` (published)

The first storyboard and first full source response were accepted and a real
non-fallback MP4 was published. Deterministic source work plus critic/patch
activity still made the terminal accounting 7 logical / 10 physical calls
(one failed request, two hedges), so `oneAttemptSuccess=false`. Triage reports
`published`, `runtimeValid=true`, `qualityResidue=2`, status `warn`; both
recorded findings were `composition_washed_out`.

Commit `00dfedb` promoted the narrow typed metric opener's single drift into a
monotonic push, added a measurement-guarded focal contrast plate that is
adopted only on strict improvement, and skipped the visual critic when rendered
QA is pristine. Exact ProofGrid browser replay clears both washout findings.
The new hackathon policy still treats washout as advisory for retry decisions;
S6.9 must inventory whether the deterministic contrast path should remain.

### ProofLane — `lp3-state-capsule-20260712-j` (early stop; advisory evidence)

The run was stopped at its first persisted source browser QA. The QA result was
runtime `ok:true`, `strictOk:false`. Its three findings were:

- `stale_asset_lingers`: an approval app-window shell overlapped the child
  readiness stat it contains;
- `camera_blocking_landing`: the ready headline itself was 100% visible at
  about 12% occupancy and inside its 2.5-22% target range, while the enclosing
  station measured 94.6% against an ensemble preference; and
- `camera_blocking_unsettled`: the opener was still moving at the sampled
  landing, a motion-taste concern rather than a runtime break.

The project contains the accepted storyboard, first browser-rejected source,
and QA caches, but no attempt ledger, `author-run.json`, `sentinel-run.json`,
sequence-check report, render, or MP4. A repair request may have begun before
the process tree was stopped; without a ledger its call count is unprovable.
These findings are the primary S6.9/S6.11 controls: they remain visible for
human review but must not spend another author call or trigger a new probe.
