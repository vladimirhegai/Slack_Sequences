# Sequences for Slack — agent notes

The active hackathon app (Slack Agent Builder Challenge, deadline **Jul 13 2026**).
It turns a release thread into an on-brand launch video, in the channel. Bolt +
Socket Mode; `tsx` runs the TS directly. Pitch: *from shipped to shown*.

## GitHub destination & deploy

Publish this app to **https://github.com/vladimirhegai/Slack_Sequences**.
`vladimirhegai/Sequences` is the local/private development monorepo and is not
the Slack app's GitHub delivery target. From the monorepo root, use
`bash scripts/publish-public.sh "<message>"`; do not finish Slack work by pushing
the monorepo branch and calling it published. The script archives **HEAD**, so
commit first — uncommitted work is not published.

**Deploying the live bot is a separate step:** `railway up` from the monorepo root
builds the root `Dockerfile` on Railway. GitHub autodeploy is deliberately **OFF**,
so publishing source does **not** deploy. Verify with `/healthz` → `ready`. Docs-only
changes need a publish but not a redeploy. Full runbook: [OPERATIONS.md](OPERATIONS.md).

**Deep docs (read only when this file is insufficient):**
[ARCHITECTURE.md](ARCHITECTURE.md) (target design) ·
[ROADMAP.md](ROADMAP.md) (current state / task list / TODOs) ·
[OPERATIONS.md](OPERATIONS.md) (local setup + Railway deploy + recovery) ·
[FALLBACKS.md](FALLBACKS.md) (fallback classes, recoverable-paperwork catalog, the
prep-mode fail-loud flag, how to diagnose a fallback) ·
[HACKATHON_RULES.md](HACKATHON_RULES.md) (challenge constraints).

> ⚠️ **Prep-mode:** the bot currently runs **fail-loud**
> (`SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK=0`) so authoring failures surface
> the full log instead of a generic film. **Set it back to `1` on Railway before
> judges test the bot** — see [FALLBACKS.md](FALLBACKS.md). Read FALLBACKS.md
> before changing the authoring pipeline.

## The two bots

This app runs **two distinct agents**. Keep them straight:

1. **Context bot — Slack-hosted-MCP retrieval** ([src/slackMcpContext.ts](src/slackMcpContext.ts)).
   OpenAI Responses API (`gpt-5-mini`) calling `https://mcp.slack.com/mcp` with
   the **invoking user's** OAuth token. Reads messages/files, returns an evidence
   pack. **Must be OpenAI** — the Responses `mcp` tool type is OpenAI-only, so
   OpenRouter/DeepSeek cannot drive it. Always needs `OPENAI_API_KEY`. This is the
   primary hackathon-qualifying MCP integration.
2. **Planning / authoring bot — the main agent** ([src/engine/compositionRunner.ts](src/engine/compositionRunner.ts)).
   Runs on `SLACK_SEQUENCES_PROVIDER` — Railway uses **`openrouter-api` (DeepSeek)**.
   Turns brief + context into a canonical, direct HyperFrames HTML composition.
   The video execution layer (validate/checkpoint/preview/render) is additionally
   isolated behind an internal **stdio Sequences MCP** server.

## Prompts live in [prompts/](prompts/)

General, editable system prompts for both bots go in `prompts/*.md` — not buried
in `src/`: [prompts/context-retrieval.md](prompts/context-retrieval.md) for the
context bot and [prompts/planning-director.md](prompts/planning-director.md) for
direct authoring. **Not** in `prompts/`: RAG/skill retrieval
([src/agent/skillContext.ts](src/agent/skillContext.ts)) and per-run
deterministic context (color/typography picks, selected skills, brand tokens) —
those are composed at runtime. See [prompts/README.md](prompts/README.md).

## App isolation (do not break)

`apps/slack` must publish standalone, without the paused apps:

- ✅ May import `@sequences/core`, `@sequences/platform`, and pinned
  `@hyperframes/*@0.6.86`.
- ❌ Never import `apps/sequences/*` or `apps/forge/*`. Need their glue? **Copy it
  into [src/engine/](src/engine/) and adapt.**
- ❌ Don't modify `packages/*`, `apps/forge`, `apps/sequences` unless the task
  explicitly says so.

The public Slack repo contains this app plus shared packages, so cross-app
relative imports break after publishing.

## MCP execution path (the internal Sequences MCP)

MCP is the **default** live path; `SLACK_SEQUENCES_USE_MCP=0` is a diagnostic
opt-out. Normal flow:

- live create/revise: `submit_composition` → `render_preview` → `render`;
- curated demo: `submit_plan` → `render_preview` → `render`.

The in-process fallback ([src/orchestrator.ts](src/orchestrator.ts) `applyMutation`)
is narrow and behaviorally equivalent — a flaky subprocess never breaks a demo.
Every MCP attempt is visible through an **argument-free** receipt. Never put plan
content, command args, credentials, user tokens, workspace messages, or model
output in a Slack receipt.

## Determinism boundary

- **No model:** `/sequences demo` (curated preset, [src/demo.ts](src/demo.ts));
  the solver + linter; all delivery plumbing (thumbnails, render, uploads); the
  zero-token tweak matcher in `tweakRunner.ts`; undo (journal replay).
- **Uses a model:** real `/sequences` create (planning bot) and the context bot;
  revise only when the zero-token matcher is unsure.

Keep deterministic things deterministic: build new deterministic behavior in the
plumbing layer or behind a preset/zero-token path. The 9 laws are **revised** for
direct HyperFrames authoring — see ARCHITECTURE.md "Revised architecture laws";
hard runtime invariants (deterministic seek, local assets, finite timelines,
framework-owned playback) still bind.

## Two-tier delivery contract

In [src/index.ts](src/index.ts), create/revise preserve this order:
1. apply plan/commands; 2. build + upload thumbnails; 3. update message to
*rendering*; 4. render the MP4 async; 5. update to *ready*/*unavailable* and
upload the MP4. Missing Chrome/FFmpeg or a render failure must leave a valid
thumbnails-only result. Background Slack errors must be logged and contained
(never crash the process).

## Current feature state

Wired end-to-end: `/sequences` create modal, `/sequences demo` (model-free),
`/sequences mcp-test` self-check, 🎬 message shortcut (reads the whole thread),
conversational reply-to-revise, live Thinking-Steps progress, Undo, Render HD,
Approve & share. Per-user OAuth for hosted MCP. Direct HyperFrames create,
revision, validation, checkpoint undo, thumbnails, and render are wired. Each job
gets a per-job `frame.md` design system — curated SaaS mood DNA plus one bounded
art-direction decision over harmony, type, and spatial character. **Deterministic
design tools** extract brand truth, derive and validate semantic tokens, repair
unsafe contrast/unavailable fonts, and expose which values are committed versus
tunable without limiting motion; the chosen frame.md is
shown in the result and attached to the thread
([src/engine/frameDesign.ts](src/engine/frameDesign.ts) +
[framePresets.ts](src/engine/framePresets.ts) /
[brandTokens.ts](src/engine/brandTokens.ts) / [frameTools.ts](src/engine/frameTools.ts) /
[brandCapture.ts](src/engine/brandCapture.ts)). Direct shots may also carry
typed spatial/focal intent and semantic cursor interactions. A versioned local
runtime resolves hotspot/target/ripple geometry under camera transforms;
interaction-time browser QA is enforced and persisted with each revision.
Shots may also declare typed outgoing cuts (`hard`, directional,
zoom/inverse-zoom, flash, object-match, or shape-match). `cutContract.ts`
resolves those declarations and `sequences-cuts.v1.js` compiles host-owned,
seek-safe boundary motion into the canonical timeline; `compositionRunner.ts`
injects the binding from the locked storyboard so the source author cannot
silently omit it.
Object-match uses measured `data-part` geometry, while static validation catches
missing bindings and warns when authored scene-wrapper tweens compete with the
cut runtime. Shape-match (2026-07-03) swaps two *different* rhyming-silhouette
elements through a dual-bridge crossfade with border-radius interpolation; a
bind-time geometry audit (>2.5× aspect, >60-node subtree, off-frame parts)
degrades the boundary to zoom-through with a typed reason that browser QA
surfaces as a `cut_degraded:` warning, and the static gate warns when a bridge
lands outside the incoming scene's entry framing
(`test/cutShapeMatch.browser.test.ts` proves both paths).
Shape-match v2 (2026-07-04) adds **deterministic cut discovery**: browser QA
measures every boundary's visible `data-part` geometry, `cutDiscovery.ts`
scores silhouette rhymes (aspect cap 2.0×, radius-weighted, max ONE per film,
only `hard`/directional boundaries), and the host upgrades the one provable
rhyme to shape-match before the critic — mutating the locked storyboard
everywhere downstream, keeping the pre-upgrade draft on any QA regression
(`SLACK_SEQUENCES_CUT_DISCOVERY=0` opts out).
**Declared morph/match cuts happen or are labeled honestly (2026-07-04, WS1):**
a planner-**declared** bridged cut the runtime degrades is now a measured
`cut_degraded` polish finding (strictOk-blocking, never unpublishing) carrying
the endpoint geometry from `DirectBoundaryInventory` and a restyle directive,
so the author loop can repair it instead of silently shipping a zoom-through;
`cutContract.ts` groups the `shapeOut`/`shapeIn` hints into silhouette families
(pill·bar vs card·circle·window) and `auditShapeMatchHints` rejects a
cross-family declaration at storyboard validation (cheap findings-retry), with
a volunteered hopeless pair degrading to zoom-through on the final attempt
(`degradeMismatchedShapeHintCuts` — brief-required shape-match stays blocking);
and `reconcileDegradedCutPaperwork` runs LAST in `requestDirectComposition` so
STORYBOARD.md / the Slack outline / manifest.json record the cut that actually
executed (`test/cutShapeMatch.browser.test.ts` + `test/authorReliability.test.ts`
prove the finding, hint audit, plan-time degrade, and paperwork rewrite).
**Built for the eyes (2026-07-04, WS3+WS2):** storyboard validation now runs
`auditPacing` (`engine/pacingAudit.ts`) — the density CEILING the system
lacked: per scene ≤ 1 + floor(sec/3.5) full camera moves and ≤2 whips per
film, the last introduced surface must land by ~65% of its scene with ≥0.9s
per surface of development after it, typed copy gets a
max(1.2s, 0.3s×words) reading floor before the next cut/whip, and
press/set-state/toast payoffs get a ≥0.8s outcome hold — all judged in
viewer time, all cheap findings-retries with "hold ≠ freeze" fix hints so
plans don't thrash against liveness, and a 0.35s marginal-miss tolerance so
a paid attempt is never vetoed over a rounding-scale shortfall (the
`improve-ws32-1` probe lesson; storyboard cache contract v7→v8, prompt
surgery teaches the ceiling + single-focal discipline in both prompts). And
browser QA scores **eye-trace continuity** (`engine/eyeTrace.ts`): from the
boundary geometry inventory, the outgoing attention target's viewport center
vs the incoming target's center — >38% of the frame diagonal across a
`hard`/undeclared cut (directional/zoom/bridged carry the eye; flash resets
it) is an `eye_trace_jump` polish finding (strictOk-blocking, never
unpublishing; `SLACK_SEQUENCES_EYE_TRACE=audit|0` to observe/disable), and
consecutive beats 0.25–1.2s apart whose targets sit >50% of the diagonal
apart raise an always-advisory `eye_trace_pingpong` (≤6 extra seeks;
`QA_CACHE_VERSION` 4→5). Proof: `test/pacingAudit.test.ts`,
`test/eyeTrace.test.ts`, `test/eyeTrace.browser.test.ts`.
**WS hardening + fallback elimination (2026-07-05):** the pacing gate now
covers single-surface scenes (short-final-resolve exemption only), in-flight
camera moves (hold = 0 through a payoff), swapped-in copy and headline-class
primary moments (reading floors), and judges the 65% introduction deadline
in viewer time (storyboard cache contract v9); eye-trace measurement
prioritizes declared attention targets under the 16-part cap, samples the
outgoing side before the declared cut exit, and measures each ping-pong beat
at its own time in viewer time; final-scene camera landings get a
compact-resolve sparse tier (8%), zero-coverage landings defer to
near-blank, and containment is re-checked at primary moment capture times
(`QA_CACHE_VERSION` 6). The author ladder never ends on a blind compact
patch (full re-author when nothing browser-valid is banked) and gets a
source rescue rung on an independent model
(`SLACK_SEQUENCES_SOURCE_RESCUE_MODEL`, default `tencent/hy3-preview`)
before any deterministic fallback; the patch applier reverts only the
individual edit that breaks an inline script's parse; childless `rows`
targets get neutral kit children injected host-side; storyboard parse
re-bases shot timing sequentially and degrades support-map beat violations
to supported analogs (load-bearing beats stay blocking); truncation recovery
keeps reasoning and demands a smaller artifact; planning artifacts mirror
into a shared `.data/planning-cache/` so a fresh job id never re-pays a
validated plan (`SLACK_SEQUENCES_SHARED_PLANNING_CACHE=0` opts out); and an
unbound SUPPORTING moment re-anchors/drops with a warning instead of
rejecting the attempt. Live-probe lesson (two runs died at storyboard-plan
on marginal misses): the moment-interval veto carries a 0.35s grace
(`INTERVAL_GRACE_SEC`), and `pacing/*` findings block only the primary
rung's first two attempts — from its final attempt onward a plan clean
except for pacing ships with the findings logged as advisories
(degrade-never-veto). Details in ROADMAP's 2026-07-05 sections (the
IMPROVEMENT_PLAN / WS_Improvements / LESS_FALLBACKS planning docs are retired;
ROADMAP's "Full audit" section carries their surviving record + parked items).
The storyboard stage also grants ONE artifact-less grace replay per run (a
response with no `<storyboard_json>` at all replays its attempt instead of
consuming a rung's final slot — the audit-final-a1 death class) and persists
every rejected/truncated/artifact-less attempt under
`planning/attempts/storyboard-<n>-<outcome>.*` for offline diagnosis
(author-stage parity).
**Codex-audit fixes (2026-07-05, later):** the timing re-base now normalizes
nested beat/camera/interaction/moment/ramp times in the model's OWN frame
and shifts them by the re-basing delta, so repairing a scene's arithmetic
never silently re-times the choreography inside it (storyboard cache
contract v10); the final-resolve pacing exemption accepts only COMPACT
resolve kinds (button/stat-card/toast/toggle/progress/progress-ring/
avatar-stack) — a dense window in the final slot stays judged; headline
detection matches `\btype` so "prototype reveal" no longer earns a reading
floor; and `camera_framed_sparse` mid-window sampling covers scenes whose
camera path has NO full move (drift/hold-only paths never land anywhere and
were previously unsampled — the fix-ws-probe-3 tiny-toast class;
`QA_CACHE_VERSION` 7).
**Cleaner, coherent output (2026-07-05, WS4+WS6+WS7).** Exit discipline
(WS4): `auditSurfaceExits` (`componentContract.ts`, plan-stage) flags two
station-dominating overlays (command-palette/modal/dropdown/context-menu)
whose open windows OVERLAP in one station without the first being
closed/swapped/morphed — an overlay over BASE content (⌘K over a window) is
the designed pattern and never flagged; and `stale_asset_lingers`
(`layoutInspector.ts`, ALWAYS advisory, bounded seeks) flags a component
whose last beat has passed still at opacity ≥0.9 overlapping the focal
element (`QA_CACHE_VERSION` 8). The prompt gains an exits paragraph
(short/directional ≤0.4s or recede to ≤40%; never stack a new surface over a
live one). Transition-language coherence (WS6): `auditCutCoherence`
(`cutContract.ts`) flags a cut-style ZOO — distinct non-`hard` styles beyond
`max(4, round(0.6×boundaries))`, so the golden film's four premium cuts pass
but a fifth novelty per seam is a cheap findings-retry; and
`auditCameraEnergy`'s repeated-verb rule now fires ONLY on a repeated
HIGH-energy verb (whip/orbit) — repeated pan/drift/track is coherence, not
churn. `browserQualityPenalty` already weights
`camera_framed_clipped`/`_sparse`/`cut_degraded`/`eye_trace_jump` so those
findings steer the attempt-3 least-bad pick. Both new plan findings ride the
same late-attempt polish demotion as `pacing/*` (advisory from the final
rung). Thumbnails show the moment (WS7, `generateDirectThumbnails` in
`directComposition.ts`): a moment naming a `data-part` subject
(component/interaction) walks forward from its capture time to the first
frame the subject is actually visible (opacity ≥0.5, on frame); a no-subject
moment (scene-start cut / camera / text tween) walks to the first frame that
paints meaningfully MORE than the capture frame (relative painted-pixel test
— a soft bloom cancels in the ratio), fixing the empty title-card / palette
"gray circle". Both walks stay inside the cut-safe window; the page.evaluate
bodies avoid named nested functions (the MCP-server `node --import tsx`
transform `__name`-wraps them, which is undefined in the browser). Live paid
probe `ws467-probe-2` (a dense command-palette+modal+stat-card+button+
terminal brief) **published `hyperframes-direct`, no fallback** via the full
recovery ladder (primary rung exhausted → storyboard rescue → full
re-author → critic), with 10 content-rich moment thumbnails and **zero**
`stale_asset_lingers`/`components/exit`/`cuts/coherence` false positives; a
second probe `ws467-probe-3b` gave the **WS6 live true-positive** —
`auditCutCoherence` rejected a 5-distinct-style storyboard, the planner fixed
it on retry, and the film published with no fallback.
Proof: `test/componentContract.test.ts` (`auditSurfaceExits`),
`test/cutContract.test.ts` (`auditCutCoherence`), `test/cameraContract.test.ts`
(relaxed energy rule), `test/directComposition.test.ts` (`momentSubjectPart`),
and `film:demo` (m10 lockup now shows the title card, not a bloom).
Scenes may also declare a typed **`timeRamp`** — the fifth host-owned contract
(2026-07-04, `timeRamp.ts` + `sequences-time.v1.js`): ONE motivated
slow-motion dip per scene (max 2 per film, never scene 1) compiled into
net-zero piecewise-linear warp knots; a nested paused master timeline wraps
the registered timeline at the registration seam (the LAST deterministic
injection) and seeks the content timeline at `warp(masterTime)` — seek-safe
by construction, byte-identical for non-ramped films. QA converts time bases
only at physical-seek choke points; motion-density quiet gaps and moment
spacing are judged in viewer (output) time. The fallback film and `film:demo`
both ship a deterministic ramp as the proof path.
Scenes may also declare a typed **camera path** over a continuous spatial world:
`data-camera-world` is a plane larger than the viewport with named
`data-region` stations, and `cameraContract.ts` +
`templates/sequences-camera.v1.js` compile `hold`/`drift`/`pan`/`whip`/
`push-in`/`pull-back`/`track-to-anchor`/`parallax-pass`/`orbit-lite`/`orbit`
moves into seek-safe world transforms (gaps auto-fill with drift so the camera
never silently freezes; `data-depth` layers — `data-parallax` is an alias —
get depth counter-motion). `orbit` (2026-07-03) is a true 3D arc: perspective
on the scene wrapper, a `rotateY` sandwich on the flat world plane returning
to rest, counted as a high-energy peak, and deterministically forbidden from
overlapping a cursor interaction. Any camera segment may carry a rack-focus
`focus` modifier (`{part|depth, blurMaxPx ≤ 10}`): the runtime pulls a
tweened focal plane across the scene's depth layers, blurring the others
(≤4 layers, layers only, never the world element — the CSS-filter-flattens-3D
landmine); `test/cameraDepth.browser.test.ts` proves both effects and their
determinism under out-of-order seek. **Camera depth level 2 (2026-07-04)**:
whip blur is relocated off the world element onto a `.seq-whip-lens`
backdrop-filter overlay (the world never carries a CSS filter again), so an
orbit scene may opt into `"depth3d":true` on its camera object — the world
gets `preserve-3d` and `data-depth` layers separate in Z (`translateZ`, a
pure function of orbit deflection, zero at rest so flat frames stay
byte-identical and legible). Degrade-never-veto: the flag survives only with
an orbit and warns without layers. The same
runtime registers the Sequences ease library (`seqSwoosh`, `seqWhip`,
`seqImpulse`, `seqSettle`, `seqGlide`, `seqDrift`, `seqAnticipate`,
`seqMicrobounce`) in every composition for authored beats. Storyboards scale
3-10 shots with a framing-density floor (a new framing — cut or camera move —
roughly every 3.5s); camera bindings are injected deterministically from the
locked storyboard and gated by `validateCameraContract`; layout QA suppresses
heuristics during camera transits and for off-frame world stations; the
model-free fallback ships a camera world as the deterministic proof path.
Camera motion is *energy-graded* (2026-07-03): `auditCameraEnergy` blocks 12s+
storyboards with no high-energy peak (whip / zoom≥1.3 push-in / energetic cut)
or a single repeated verb; the resolver splits the drift before committed
moves into a short `seqAnticipate` wind-up; whips carry host-compiled motion
blur; storyboards may pin regions to viewport-sized grid cells (`worldLayout`)
that the author prompt converts into deterministic station rects so content
stops clipping or drifting off-camera. Simultaneous component beats settle in
a 45ms cascade (follow-through).
The 2026-07-04 **motion-quality pass** removed the "messy" tells: a reframe
immediately followed by push-in/pull-back on the same target merges into ONE
compound move (`mergeCompoundMoves` — no more pan-then-zoom dead stop; a
zoomed compound counts as the high-energy peak); rack-focus blur *releases*
(≤0.45s) when its segment ends instead of squatting on the scene;
`dedupeRedundantBeats` degrades double-triggered motion (repeated pulses,
overlapping same-channel beats, press beats under a cursor press) to single
triggers at storyboard parse; `auditComponentComplexity` blocks plans the
author cannot build (>1 component per ~1.2s scene / cap 4, >1 per 2s film);
and browser QA runs a **camera-arrival framing audit** (`camera_framed_clipped`)
that seeks each full-move landing and proves the framed station's content is
actually on frame (double-sampled so entrances can't false-positive). The same
pass runs a **framing-coverage audit** (`camera_framed_sparse`, 2026-07-04 WS5):
the union bbox of each scene's on-frame content (post camera transform) at every
fit-zoom landing and once mid-window for camera-less scenes must fill ≥18% of
the frame — below that the viewer studies a tiny subject in a void. It is a
polish finding (strictOk-blocking, never unpublishing) with a 60%-axis escape
for full-width bands and a final-scene exemption for compact end cards;
whole-scene scope means a tight track-to-anchor close-up passes when the
surrounding UI fills the margins (`test/framingCoverage.browser.test.ts`). A
light-model **shape hint** (`requestStoryboardShape`, `STORYBOARD_SHAPES`,
kill switch `SLACK_SEQUENCES_SHAPE_HINT=0`) picks a pacing skeleton from six
structural templates in parallel with the concept pass — deterministically
rejectable, structure only, never creative authority. Details in ROADMAP's
2026-07-04 motion-quality section. Slack shows an **ETA countdown** (persisted
per-stage EMA, `stageTimings.ts`) instead of a stopwatch, and
`/sequences debug on|off` appends a model-stage receipt trail
(stage/status/attempts/duration) to results — details in ROADMAP's 2026-07-03
polish-pass section.
**Source-author reliability (2026-07-04, later):** every rejected author
attempt persists its document + findings under `planning/attempts/` for
offline diagnosis; a loaded draft that never registers its timeline is
classified `runtime_bind_exception` (browser QA leads with the real console
error, not the opaque 12s timeout) and the author loop escalates it to
full-context re-authoring instead of a compact patch; and
`engine/kitMarkupAudit.ts` re-runs the cut/camera/component runtimes' DOM
bind queries statically (linkedom parse — what a spec parser sees is what
the browser will see) so missing chart bars/rows/fills, absent morph twins,
lost scenes, and missing camera stations surface as named
`kit_markup_incomplete`/`dom_markup_broken` findings before the browser.
**Fallback elimination (2026-07-04, latest — the `palette-input` incident):**
cut focal parts and camera stations/parts now get the same conservative
deterministic reconciliation as interaction targets (exact id / unique
semantic candidate / exact-name station, scene-scoped, ambiguity stays
blocking) inside `applyDeterministicSourceRepairs`, so a mechanically
recoverable locked-storyboard binding never consumes a paid repair; a
**volunteered** bridged cut (shape-match/object-match the brief never asked
for) whose endpoint binding survives a model repair degrades to zoom-through
deterministically instead of sinking the film (brief-required styles never
degrade — they stay blocking and fall back honestly); a structural finding
signature that survives the very patch asked to fix it switches the final
attempt to a full-context re-author instead of a third identical compact
patch (`near_blank_film:` browser findings escalate the same way — a blank
scene is a missing visual world, full-document work a compact patch cannot
do); compact repair prompts carry a bridged-cut endpoint checklist
(both sides, present/missing) plus a never-delete-other-bindings warning;
and every run persists `planning/author-run.json` (per-attempt normalized
finding signatures + strategy changes) for offline failure grouping.
Proof: `test/authorReliability.test.ts` (the minimized incident replay:
recoverable endpoint reconciled, ambiguous endpoint stays blocking,
persistent volunteered cut degrades, required cut never does).
Browser QA also runs the **rendered temporal judge**
(`SLACK_SEQUENCES_TEMPORAL_JUDGE=0` to disable): before/mid/after frame
triples around every evidence-bound moment, pixel-diffed in-page; an
invisible claimed change becomes a `moment_static_frame` polish finding
(strictOk-blocking repair guidance, never unpublishes a runnable draft),
with per-moment evidence persisted as `temporalJudge` in the QA result.
Wall-clock is defended without touching quality (2026-07-04 performance
pass): every streaming model call carries a 90s no-token idle watchdog; slow
OpenRouter calls hedge with one delayed duplicate request whose first
completion wins (`SLACK_SEQUENCES_HEDGED_REQUESTS=0` /
`SLACK_SEQUENCES_HEDGE_DELAY_MS` to tune); clean browser-QA passes are cached
by content hash in `<projectDir>/qa-cache/` so the publication commit never
re-measures identical bytes (`SLACK_SEQUENCES_QA_CACHE=0` opts out); and the
Sequences MCP client pools one server per job across
submit/preview/render (`withPooledMcpClient`). Details in ROADMAP's
2026-07-04 performance-pass section.
A host-owned **cinematography kit** (`engine/cinemaKit.ts` +
`templates/sequences-cinema.v1.css`) is injected inline into every direct
composition: automatic film grain + vignette, key-light fields, hero blooms,
lit `.material` surfaces, and per-scene color grades that give each film a
cold→warm color arc; `frame.md` renders palette-derived `--cinema-*` values
and the planning prompt teaches the vocabulary. Pure static CSS — no timeline
ownership, enhancement-only, deterministic under seek.
Scenes may also declare **motion-native components** — the fourth host-owned
contract (`engine/componentContract.ts`). The storyboard lists typed
`components` (22-kind SaaS catalog: app-window, search, command-palette,
dropdown, button, toast, modal, stat-card, table, kanban, chat, charts,
progress, terminal, tabs, …) and typed `beats` (state changes at absolute
seconds: `type`, `open`, `close`, `select`, `press`, `set-state`, `count`,
`progress`, `chart`, `rows`, `stream`, `highlight`, `swap`, `morph`). The
host injects the component kit CSS
(`templates/sequences-components.v1.css`, always) and — when beats exist —
the `sequences-components` island + `templates/sequences-components.v1.js` +
compile call from the locked storyboard. The kit owns structure and end
states (static CSS, no transitions); the author owns placement, copy,
entrances, and final states; the runtime compiles seek-safe internal motion
from live geometry, including FLIP twin morphs (search→command-palette,
card→modal). A component id doubles as its `data-part`, so camera
`track-to-anchor`, object-match cuts, and cursor interactions address the
same object. `validateComponentContract` gates publication; beats count as
motion-density activities and bind storyboard moments as `component`
evidence; layout QA suppresses heuristics inside morph/open windows. GLM
plans from a compact catalog vocabulary; the authoring prompt carries the
markup contract for only the declared kinds. The fallback film ships a typed
`progress` beat and `test/componentRuntime.browser.test.ts` proves eight beat
kinds (including a morph) through real browser QA.
`frame.md` also exposes six flow-first scene compositions and semantic zone
helpers so primary content defaults to safe-area Grid/Flex placement. Ambiguous
cursor targets still quarantine, while exact-id/unique-semantic mismatches are
reconciled deterministically. Browser-QA infrastructure outages fall back to
static validation, and a failed planning/authoring pass falls back to a small
model-free direct composition rather than surfacing a create error.
`npm run film:demo` exercises the model-free 24-second golden Slack ad through
the real direct gate and writes compact temporal evidence (development strip,
cut sheets, change curve, quiet windows) via `temporalInspector.ts`. The
`temporalInspector` strips stay developer-facing, but since 2026-07-04 live
create/revise DOES get rendered temporal evidence: the temporal judge inside
browser QA (see above). Typed cuts and cinematography-kit injection are proven both by
the fixture and by a paid OpenRouter live-authoring smoke (2026-07-01): the
planner chose sensible cut styles and the author adopted kit material classes
unprompted. Not built yet: Slack screenshot ingestion,
registry source approval/materialization + in-Slack audition, component
sub-agents.

Live create/revise now also runs a static `motionDensity.ts` liveness pass for
10s+, 3+ shot films. It classifies scene starts/cuts, authored GSAP beats, and
interactions. Long quiet gaps, slide-like scenes, and front-loaded scenes are
**blocking publication errors** (fed to the bounded repair loop); dense bursts,
empty holds, and unplaceable tweens stay advisory warnings. The summary is
persisted in `motion-plan.json`. This is not rendered temporal evidence;
`temporalInspector` still owns pixel-based strips/change curves.

**Storyboard moments** (`engine/storyboardMoments.ts`) are the review contract
on top of scenes: each `StoryboardMomentV1` is one reviewable changed state
(typed word, UI state, metric completion, camera arrival, cut landing, logo
resolve) at an absolute `atSec`. The planner must declare a duration-scaled
floor of moments (≥7 for 12s+ films, ~1 per 2.25s, spacing ≤2.6s except a short
final resolve); publication binds every declared moment to executable timeline
evidence (cut / typed camera move / interaction / positioned non-wrapper tween)
and rejects unbound moments, a missed floor, or (for declared plans) dead
intervals. Legacy/fallback storyboards without declared moments get moments
synthesized from the same activity evidence. Moments drive the Slack storyboard
outline (timestamped rows grouped under scenes), the thumbnail strip (one frame
per moment, primaries first, cap 10, captured just after each moment's bound
evidence *settles* and before the outgoing cut window — never mid-animation),
`STORYBOARD.md`, and `motion-plan.json`.

**Staged planning (GLM as three bounded jobs).** Live create now runs: a cached
**concept pass** (thesis, narrative pressure, energy curve, motif, color arc,
one risk — `requestConceptDirection`, kill-switch
`SLACK_SEQUENCES_CONCEPT_PASS=0`), the **beat-expansion storyboard pass**
(consumes the concept artifact; up to two bounded retries with deterministic
findings on a rejected/truncated plan, then a **rescue rung** on an
independent model — default `tencent/hy3-preview`, medium reasoning,
`SLACK_SEQUENCES_STORYBOARD_RESCUE_MODEL`/`none` to override/disable — before
the deterministic fallback is allowed; validation itself first runs a
**deterministic moment top-up** (`topUpStoryboardMoments`) that fills dead
intervals / floor misses with moments anchored on the plan's own typed
beats/camera arrivals/cut landings, so a plan is never vetoed for moment
paperwork it already proves — the 2026-07-04 live fallback root cause;
`npm run storyboard:probe` measures this stage live), DeepSeek source authoring against the locked storyboard,
then a **continuity critic** pass (GLM reviews the implemented film's moment
evidence + motion-density contact sheet and returns ≤5 bounded repair
directives; DeepSeek applies them as patches; deterministic QA accepts or
rejects — kill-switch `SLACK_SEQUENCES_CREATIVE_CRITIC=0`; any critic failure
keeps the pre-critique draft). Each artifact is cached independently.

**Honest, labeled fallbacks.** `createVideo` attributes failures to named stages
(`frame-design`, `storyboard-plan`, `source-author`); `VideoResult.stages`
carries argument-free receipts (with per-stage retry `attempts` when
`/sequences debug on` is set). When storyboard/source recovery is exhausted,
the deterministic model-free proof film ships **by default** —
`VideoResult.fallback = { stage, reason }` marks it and Slack labels it, so
the audience never sees a raw error while the operator sees exactly what
happened. Opt out with `SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK=0` to
fail visibly instead (frame-design failures always fail visibly). The
fallback obeys the full contract (11 declared, evidence-bound information
moments over a camera-world pan; duration clamped to 20s) and is never cached
under a model-artifact key.

Agent-facing local checks use `npm run sequence:check --workspace
@sequences/slack -- ...`. It simulates a `/sequences` create after Slack has
collected the brief fields, runs the same orchestrator path, and writes one
JSON/Markdown report with provider choice, progress receipts, validation,
motion-density warnings, thumbnails, optional render, and artifact paths. It
does not call Slack hosted MCP or post to Slack.

## Environment

One live Slack app: the developer-sandbox app on Railway. Local work is source,
deterministic MCP/demo, render, and Docker checks only. **Never** copy Railway
credentials into `apps/slack/.env`, and never start a second Socket Mode process
with sandbox tokens. Socket Mode carries Slack events; the HTTP server exists only
for `/healthz`, `/slack/install`, `/slack/oauth_redirect` — do not add Events API
/ interactivity request URLs. Railway is not a public `/mcp` endpoint.

## Verification & Testing Ladder

This is the shared verification contract for human development and agent verification.

### 1. Slack source gate (Routine check, no credentials needed)
```powershell
npm run typecheck --workspace @sequences/slack
npm run test --workspace @sequences/slack
npm run mcp:demo --workspace @sequences/slack
npm run direct:demo --workspace @sequences/slack
npm run sequence:check --workspace @sequences/slack -- --demo --no-mcp --format both
npm run film:demo --workspace @sequences/slack
```
- TypeScript compiler exits successfully.
- All Slack tests pass.
- Legacy MCP applies the curated fallback plan.
- Direct MCP validates/checkpoints authored HTML, reports clean lint, and creates runtime-seeked scene previews.
- Sequence check writes a consolidated local report for agent inspection without Slack credentials or a model call.
- Golden-film smoke validates typed cuts and writes temporal evidence without a model call.

### 2. Render and Docker gate (Required after engine/renderer/Docker changes)
To verify direct HyperFrames MP4 rendering locally:
```powershell
$env:VERIFY_RENDER = "1"
try {
  npm run film:demo --workspace @sequences/slack
} finally {
  Remove-Item Env:VERIFY_RENDER -ErrorAction SilentlyContinue
}
```
To test production Node/Docker MCP boundary:
```powershell
docker build -t sequences-slack .
docker run --rm sequences-slack npm run mcp:demo -w @sequences/slack
docker run --rm -e VERIFY_RENDER=1 sequences-slack npm run film:demo -w @sequences/slack
```

### 3. Monorepo CI gate (Optional pre-push checks)
Before pushing, you can validate the broader monorepo:
```powershell
npm run typecheck
npm test
npm run test:perf
```

### 4. Sandbox smoke
After `/healthz` returns `200 ready`, run in the Slack sandbox:
1. Run command: `/sequences mcp-test` (should verify Slack API, Sequences MCP, Render host browser/FFmpeg, planning provider, hosted MCP user OAuth, token encryption, data directory).
2. Run command: `/sequences demo` and confirm storyboard thumbnails arrive before the MP4.
3. Confirm the MP4 plays inline.
4. Reply in the reel thread with `make it shorter`.
5. Click **Undo** and confirm the previous revision returns.
6. Click **Render HD** (if render-related code changed).
7. Click **Approve & share** into a disposable sandbox channel.

### 5. Real hosted-MCP flow
Tester authorizes at: `https://sequences-slack-production.up.railway.app/slack/install`
1. Run `/sequences` with a short synthetic product brief.
2. Confirm the result includes a Slack-context hosted-MCP receipt.
3. Confirm the build trace includes Sequences MCP tools.
4. Try **🎬 Make a launch video** shortcut from a synthetic release thread.
5. Confirm revisions, Undo, HD, and sharing still operate on that job.

### 6. Change-specific minimums
- **Documentation only**: links/commands review; `git diff --check`.
- **Slack blocks or handlers**: Slack source gate + sandbox affected flow.
- **Manifest/scopes/events**: paste manifest, reinstall, redeploy, self-check, affected flow.
- **OAuth or hosted Slack MCP**: source gate, `/slack/install`, self-check, real `/sequences`.
- **MCP client/server/mutation**: source gate, container MCP demo, create, revise, Undo.
- **Typed cuts/temporal QA**: focused cut tests, `film:demo`, local MP4, Docker
  `film:demo`, motion-density tests, then one paid live create before calling
  model selection proven.
- **Rendering/Docker/HyperFrames**: render/Docker gate, sandbox demo, draft + HD.

### 7. Understanding Failures & Troubleshooting
- `not_in_channel`: Run `/invite @Sequences` in the channel.
- `missing_scope`: Update manifest.json, reinstall, refresh bot token, and redeploy.
- Connect prompt: Complete `/slack/install` for that user.
- `/healthz` says `starting`: Inspect the matching `xapp`/`xoxb` token pair.
- Planning fails: Confirm `SLACK_SEQUENCES_PROVIDER` and its API key are correct.
- Hosted MCP fails: Confirm OpenAI key, app MCP enablement, redirect URL, and per-user OAuth.
- Thumbnails work but MP4 fails: Inspect Chromium, FFmpeg, and Railway memory.
- Duplicate replies: Another process is using the same Slack app tokens.

### 8. Reporting Verification
Always state which layers actually ran (e.g., unit/type checks, MCP demo, Docker check, Railway health/logs, Slack sandbox demo, real hosted-MCP flow). Never describe unit tests alone as proof of OAuth, Socket Mode, Railway, or live Slack behavior.
