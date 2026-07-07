# SENTINEL.md — the correctness-by-construction system (layers, contract, budgets, flags)

**Read this before adding any authoring gate, rule, or repair.** FALLBACKS.md is
the *ledger* of paperwork bugs we recover deterministically; SENTINEL.md is the
*system* that decides where a new obligation should live so it never becomes a
paperwork bug in the first place. New contract classes go through the placement
decision tree here **first** — the FALLBACKS.md catalog is the L2 ledger, not the
default.

Companion docs: [SENTINEL_PLAN.md](SENTINEL_PLAN.md) (the design + phase
contract), [SENTINEL_REPORT.md](SENTINEL_REPORT.md) (what shipped, per phase,
with probe artifacts), [FALLBACKS.md](FALLBACKS.md) (fallback classes + the L2
catalog), and the registry itself: [`src/engine/sentinel.ts`](src/engine/sentinel.ts).

---

## The thesis

The old architecture was *"model writes everything → host validates → host
regex-repairs → model retries the whole artifact."* Every hardening pass
strengthened detection; none shrank the surface the model can get wrong. Sentinel
**moves every mechanically-decidable obligation OFF the model** so whole classes
become host-owned instead of merely detected. **Gates are never loosened —
Sentinel changes WHERE an obligation is enforced, not WHETHER.**

**Honest scope (2026-07-06 final audit).** The host truly owns, by construction:
the document chassis, every scene `<section>` wrapper, stage positioning, the
paused timeline + its registration + the seek, scene-window visibility, and every
plan island/runtime/compile seam. The model still authors scene INTERIORS, so an
interior-level binding (camera station, component root) remains *representable* as
missing — its ladder is: host template → **scene-scoped slot repair**
(`slotScaffoldViolations`: a scene that dropped a station/root with no trace is
re-requested ALONE, with findings + its own previous interior/script as the minimal-edit
baseline) → free L2 reconciliation for near-misses → the L3 gate. Retry
scope today: slot **truncation, scaffold repair, and one bounded validation
repair are scene-scoped**. The validation repair fixes the **scene-attributable
subset** — it fires whenever at least one finding maps to a named scene,
re-authoring those scenes and banking the improved draft; any film/shared-level
remainder keeps the whole-document ladder. (It formerly declined whenever ANY
finding was film-level, which left it inert on dense briefs — the s5-interactions
class always mixes one film-level finding into otherwise scene-local rejections.)

**Slots persist across paid attempts (2026-07-07).** The slot map that assembled
the retry baseline (`scratch`) now survives the loop iteration. While the
baseline is still slot-assembled, a rejected attempt first runs the
**scene-slot retry rung**: `repairSlotDraftForFindings` re-authors ONLY the
scenes the findings name (one bounded ≤8k-token call, at most once per run,
`strategyChanges: slot-retry:<scenes>`) instead of gambling a whole-document
patch. Findings that attribute to no scene fall through to the ladder unchanged;
adopting any non-slot draft (a whole-doc patch, a compact/full re-author, a
structural escalation) invalidates the map. Proof: `test/slotRetry.test.ts`.

## The layer model

Every obligation lives at exactly ONE layer, and every new feature is placed at
the **lowest-numbered layer that can own it**.

| Layer | Name | Mechanism | Failure cost |
| --- | --- | --- | --- |
| **L0** | Schema | Structured outputs / typed enums | zero — invalid output can't parse |
| **L1** | Scaffold | Host-emitted chassis + shipped binding coverage | zero — host code, unit-tested |
| **L2** | Normalize | Deterministic repair/normalization (`applyDeterministicSourceRepairs`, storyboard normalizers) | zero paid attempts |
| **L3** | Static gate | linkedom / regex / `kitMarkupAudit` — named findings before any browser | cheap findings-retry |
| **L4** | Browser gate | measured truth (layout, temporal judge, eye-trace, framing) | expensive; scene-scoped retry |
| **L5** | Model retry | bounded re-author, rescue rungs | a paid attempt — last resort |

Prose in `prompts/planning-director.md` is reserved for **creative judgment the
model must internalize** (pacing feel, energy curve, one-focal discipline,
silhouette rhyme). A mechanical rule gets deleted from the prompt when its layer
moves down. **A gate at L3+ that could have been L0/L1 is a Sentinel violation.**

## Placement decision tree (use this before writing any gate)

```
New obligation "X must hold or the film is wrong."
│
├─ Can a SCHEMA make the violation unparseable? ............ L0  (typed enum / json_schema)
├─ Can the HOST emit X so the model never authors it? ...... L1  (scaffold — skeleton / islands)
├─ Can a DETERMINISTIC normalization fix it without
│  inventing content (delete / degrade / retime / rebind)? . L2  (normalizer / reconcile)
├─ Is it decidable from static DOM / plan structure? ....... L3  (linkedom / regex / plan audit)
├─ Does it need measured pixels / geometry / timing? ....... L4  (browser QA)
└─ Only if none of the above ............................... L5  (a paid model retry)
```

**Never add a prose rule + post-hoc gate pair without writing down why L0–L2
can't own it.** If you skip a layer, say so in the row's `addedBecause`.

## Feature-addition protocol (the exact steps for a future agent)

1. **Write the obligation as one sentence:** *"X must hold or the film is wrong."*
2. **Place it at the lowest layer that can own it** (the tree above): Can the host
   emit it (scaffold)? Can a schema make violations unparseable? Can a
   deterministic normalization fix violations without inventing content? Only then
   a static gate; only for measured-pixels truth a browser gate. **Never add a
   prose rule + post-hoc gate pair without writing down why L0–L2 can't own it.**
3. **Register it in `src/engine/sentinel.ts`** (CI enforces — `test/sentinel.test.ts`
   fails on any emitted finding class no row owns).
4. **Prompt text only for creative judgment;** it must fit the budget test
   (`test/promptBudget.test.ts`).
5. **Add the minimized-replay regression test** (authorReliability convention:
   the recoverable case recovers, the ambiguous case stays blocking).
6. **Decide degrade-vs-block per the FALLBACKS.md principle** (unambiguous →
   recover/degrade honestly; ambiguous → block loudly).
7. **One paid probe** (`sequence:check`) before calling it live; record its
   project dir in the PR/report.

---

## The contract table

Generated from and kept in sync with [`src/engine/sentinel.ts`](src/engine/sentinel.ts);
the closed-world test (`test/sentinel.test.ts`) walks the registered
`findingPrefixes` against the validators' actually-emitted strings, so an
unregistered finding class fails CI. `blocking`: **impossible** (unrepresentable)
· **det-repair** (normalized, no paid attempt) · **blocking** (rejects the
attempt) · **advisory-late** (blocks early attempts, advisory from the final
rung) · **advisory** (never blocks).

| Obligation (group) | id | Layer | Blocking | Owns finding prefixes | Proof |
| --- | --- | --- | --- | --- | --- |
| camera | `camera.world-plane` | L1 scaffold | blocking | `camera_region_missing`, `camera_part_missing` | authorReliability |
| components | `components.root` | L1 scaffold | blocking | `component_root_missing`, `component_beat_unbound` | authorReliability |
| interactions | `normalize.host-plan-islands` | L2 normalize | det-repair | — (prevents island contract-parse errors) | authorReliability |
| interactions | `normalize.source-bindings` | L2 normalize | det-repair | — (reconciles near-miss data-part/region) | authorReliability |
| normalize | `normalize.camera-budget-clamp` | L2 normalize | det-repair | — (prevents `pacing/camera-budget`) | pacingAudit |
| normalize | `normalize.pacing-stretch` | L2 normalize | det-repair | — (prevents `pacing/reading`,`/outcome`) | pacingAudit |
| normalize | `normalize.camera-move-delay` | L2 normalize | det-repair | — (prevents `pacing/outcome` "0.0s later") | pacingAudit |
| normalize | `normalize.timeramp-retime` | L2 normalize | det-repair | — (prevents ramp motivation/solvability vetoes) | directComposition |
| normalize | `normalize.dive-window` | L2 normalize | det-repair | — (derives `dive` in/hold/out legs from the beats on its target; a beat-less dive degrades to push-in) | cameraDive |
| normalize | `normalize.fx-plan` | L2 normalize | det-repair | — (host-derives the sequences-fx garnish plan; every runtime bind is enhancement-only) | fxContract |
| normalize | `normalize.auto-pop-style` | L2 normalize | det-repair | — (HOST-fills the MD6 `open`→pop style GLM under-reaches for on COMPACT_POP_KINDS; feeds normalize.open-pop) | motionAutoStyle |
| normalize | `normalize.open-pop` | L2 normalize | det-repair | — (drops MD6 `open` style:pop to the default open on non-compact kinds / beyond 2/scene) | componentContract |
| normalize | `normalize.auto-headline-style` | L2 normalize | det-repair | — (HOST-fills the MD3 headline `type`→rise, promotes the one strongest resolve to `assemble` only with a proven lock-hold; feeds normalize.assemble-cap) | motionAutoStyle |
| normalize | `normalize.assemble-cap` | L2 normalize | det-repair | — (keeps ONE headline `assemble` per film on a primary moment; degrades the rest to `rise`) | textFx.browser |
| normalize | `normalize.auto-grade-shift` | L2 normalize | det-repair | — (HOST-derives ONE MD4 scene `gradeShift`/film from a primary moment naming a temperature GLM narrates but leaves untyped; feeds normalize.grade-shift) | motionAutoStyle |
| normalize | `normalize.grade-shift` | L2 normalize | det-repair | — (drops an undisciplined MD4 scene `gradeShift`; a surviving one is `grade-shift` moment evidence) | directComposition |
| normalize | `normalize.morph-twin-reconcile` | L2 normalize | det-repair | — (prevents morph-to-undeclared-twin vetoes) | directComposition |
| normalize | `normalize.gsap-call-shape` | L2 normalize | det-repair | — (rewrites malformed `fromTo(t, vars, <number>)` to `.to` only after an earlier opposite-state initialization; entrance-looking, mixed, and cue-less direction stays blocking) | authorReliability |
| normalize | `normalize.moment-demote-last-resort` | L2 normalize | det-repair | — (pre-throw salvage: unbound PRIMARY moments demote to supporting; run records `published-degraded`) | directComposition |
| normalize | `normalize.camera-sparse-zoom` | L2 normalize | det-repair | — (repairs `camera_framed_sparse`: bounded zoom-in `sqrt(0.18/fraction)` on the framing move; adopted only if the finding clears, no new `camera_framed_clipped`, penalty strictly drops) | framingCoverage.browser |
| camera | `camera.energy` | L3 static | blocking | `camera/energy` | cameraContract |
| components | `components.complexity` | L3 static | blocking | `components/complexity` | componentContract |
| coherence | `cuts.coherence` | L3 static | advisory-late | `cuts/coherence` | cutContract |
| exits | `exits.discipline` | L3 static | advisory-late | `components/exit` | componentContract |
| pacing | `pacing.holds` | L3 static | advisory-late | `pacing/` | pacingAudit |
| moments | `moments.plan` | L3 static | blocking | `storyboard/moments`, `moment_unbound` | storyboardMoments |
| liveness | `liveness` | L3 static | blocking | `motion/` | motionDensity |
| markup-audit | `markup-audit` | L3 static | blocking | `kit_markup_incomplete`, `dom_markup_broken` | kitMarkupAudit |
| frame | `frame` | L3 static | blocking | `frame/` | frameDesign |
| cuts | `cuts.degrade` | L4 browser | advisory-late | `cut_degraded` | cutShapeMatch.browser |
| camera | `camera.framing` | L4 browser | advisory-late | `camera_framed_clipped`, `camera_framed_sparse` | framingCoverage.browser |
| interactions | `interactions` | L4 browser | blocking | `interaction_` | interactionContract |
| moments | `moments.temporal` | L4 browser | advisory | `moment_static_frame` | temporalJudge.browser |
| eye-trace | `eye-trace` | L4 browser | advisory-late | `eye_trace_jump`, `eye_trace_pingpong` | eyeTrace.browser |
| exits | `exits.stale-asset` | L4 browser | advisory | `stale_asset_lingers` | layoutInspector |
| layout | `layout` | L4 browser | advisory-late | `layout_`, `spatial_focal_`, `important_safe_area`, `content_overlap`, `container_overflow`, `contrast_aa` | layoutInspector |
| runtime | `runtime.invariants` | L4 browser | blocking | `runtime_bind_exception`, `near_blank_film`, `near_blank_scene`, `browser_warning`, `browser_runtime`, `invalid_inline_script_syntax`, `overlapping_clips_same_track` | directComposition |
| layout | `layout.hyperframes-spatial` | L4 browser | advisory-late | `clipped_text`, `text_box_overflow`, `canvas_overflow`, `text_occluded`, `motion_*` (the vendored `LayoutIssueCode` union) | layoutInspector |

The `normalize.*` rows deliberately carry NO finding prefixes because they
PREVENT another row's findings rather than emitting their own. The scaffold rows
still list the L3/L4 backstop codes — the gate is never removed, so with
`SENTINEL_SKELETON=0` (or a brief-required case) those codes still fire and the
closed-world test stays green in either flag position. The
`layout.hyperframes-spatial` codes are DYNAMIC pass-throughs
(`normalizeHyperframesIssue`), so the closed-world scan also reads the vendored
`LayoutIssueCode` union (`vendor/hyperframes/packages/cli/src/utils/layoutAudit.ts`)
— the 2026-07-06 audit found probes shipping `clipped_text`/`text_box_overflow`
unregistered. Their severity conversion to non-blocking warnings is deliberate
resilience policy, but any run that ships them via the least-bad pick is
recorded `published-degraded`, never clean.

### The storyboard normalizers are atomic

`reconcileUndeclaredMorphTargets`, `normalizeCameraBudget`,
`delayConflictingCameraMoves`, and `stretchMarginalPacingMisses` run in
`parseStoryboardResponse` **before** `validateStoryboardPlan` and commit
**atomically**: the normalized plan is kept when it re-validates clean OR when
every remaining finding belongs to a class (digit-stripped comparison) the
model's OWN plan already carried — the arithmetic fixes stand and the
findings-retry list shrinks to the real deficits. A normalization that would
mint a *new* finding class (framing-density floor, `minCameraMoves`, moment
spacing, the 60s film cap, `components/complexity` from a declared twin) logs
`sentinel-normalization reverted`, restores the model's own artifact, and
re-validates THAT — a host arithmetic fix can never invent a finding the model
didn't earn (the `degradeVolunteeredBridgedCuts` precedent, extended by the
2026-07-06 probe lesson: the old commit-only-if-fully-clean rule meant
normalizations never committed live, because every probe plan also carried a
moments deficit). They run before `topUpStoryboardMoments` (moments anchor only
on surviving moves / post-stretch times) and never touch a move whose window
overlaps a declared moment's evidence search (the load-bearing guard).
`retimeUnmotivatedTimeRamps` runs earlier (before the volunteered-ramp drop)
with its own per-scene convergence check: a retime commits only when the ramp
provably resolves AND covers a declared moment. Every normalization is logged
`[storyboard] sentinel-normalized: …`, recorded in telemetry
(`morph-twin-reconcile` / `camera-budget-clamp` / `camera-move-delay` /
`pacing-stretch` / `timeramp-retime` tags), and rendered into STORYBOARD.md as
`- Sentinel normalized: …` lines.

### The findings-retry is a minimal edit, not a redesign

A rejected storyboard attempt now carries the exact plan the findings describe
(`StoryboardValidationError.storyboard`, post any committed normalization) back
into the retry prompt as `<previous_storyboard_json>`, with the instruction to
fix ONLY the findings and keep everything else byte-identical. The 2026-07-06
probe set proved findings-only retries make both planner models redesign from
scratch each attempt and mint fresh violations (4/5 probes exhausted all five
rungs that way). The rescue rung gets the same baseline — a different model on
the same convergence seam, not a fresh draw.

---

## Budgets

### Attempt ladders (never raised — the ROADMAP operator lever stands)

| Stage | Ladder | Where |
| --- | --- | --- |
| Storyboard | primary rung **3** attempts → rescue rung **2** attempts (independent model) | `compositionRunner.ts` `requestStoryboardPlan` |
| Source author | **3** attempts (slot retries make them cheap) → source rescue rung | `authorCompositionLoop` |
| Repair patch | ≤ **16** edits/patch (`MAX_REPAIR_PATCHES`) | `creationPrompt` scratch path |
| Truncation (whole-doc) | ≤ **3** segments (`MAX_AUTHOR_SEGMENTS`); slots recover the tail instead | `authorSlotDraft` / segment loop |

`pacing/*`, `components/exit:`, `cuts/coherence:` demote to advisories from the
**primary rung's final attempt** (`options.degradePacingFindings`) — if the
ladder count ever changes, that boundary and all attempt accounting move with it
(a known landmine; see SENTINEL_PLAN §3 Phase 3.2).

### Token / char budgets

| Budget | Value | Constant |
| --- | --- | --- |
| Storyboard reasoning | **30,720** tokens | `REASONING_STORYBOARD_MAX_TOKENS` |
| Authored document output | **38,000** chars | `COMPOSITION_SOURCE_BUDGET_CHARS` |
| Repair-patch response | **12,000** chars | inline in the scratch prompt |
| Camera-move budget | `1 + floor(sec / 3.5)` per scene, ≤ 2 whips/film | `CAMERA_BUDGET_WINDOW_SEC`, `MAX_WHIPS_PER_FILM` |
| Marginal-miss stretch | ≤ **1.0s** | `MAX_PACING_STRETCH_SEC` |

### Prompt budget (enforced by `test/promptBudget.test.ts`)

- **`planning-director.md` ≤ 40,711 bytes** (its post-Phase-1 count 37,010 + 10%).
  ENFORCED + passing. Adding prose now means raising a tested number a reviewer
  sees.
- **Assembled slot-author prompt ≤ 45,000 chars — ENFORCED + passing.** The
  deterministic fixture is **44,773 chars**. `slotDirectorPrompt` removes or
  condenses host-owned architecture, runtime, moment, cut, easing, and spatial
  reference chapters after the CI-anchored contradiction rewrite; slot mode also
  projects the create-skills context to 5,000 chars. Creative posture, layout,
  typography, motion, camera, components, cinematography, color, and anti-pattern
  guidance remain. Whole-document/revision paths retain the full prompt.
- **Frame-as-artifact, capsule-to-author.** The full per-job `frame.md` stays the
  on-disk artifact and the **sole `frameValidation.ts` source** (the `frame` gate
  is unchanged — same L3 `frame/` findings). But the concept, storyboard, and
  author model calls receive `frameCapsule(frameMd)` (`engine/frameDesign.ts`), a
  ~45% smaller projection of just the design decisions: thesis, semantic tokens,
  type, the spatial scaffold the author must define, restraints, forbidden
  defaults, exceptions. It drops what the model already gets elsewhere or should
  never re-author — the cinematography-kit description (host-injected + taught in
  `planning-director.md`; its presence made authors redundantly re-declare
  `.material`), the verbose spatial/attribute prose, and the tool report. This is
  the same principle as `slotDirectorPrompt`: prose the model doesn't need to
  internalize is projected out of the prompt, WHERE the obligation is enforced is
  unchanged. No new finding class; `frameCapsule` round-trips under
  `test/frameDesign.test.ts`.

### Wall-clock targets (from the mission table; measured by `sentinel:report`)

| Metric | Target | Notes |
| --- | --- | --- |
| Storyboard attempts / run (avg) | ≤ 1.5 | Carryover A measured 3–4; Phase-3 normalizers target this |
| Source-author attempts / run (avg) | ≤ 1.5 whole-doc equivalents | slot retries make attempts cheap |
| Wall-clock to tier-1 (thumbnails) | ≤ 8 min | Carryover A: 12–22 min at storyboard |
| Wall-clock to tier-2 (MP4) | ≤ 14 min | — |
| Author prompt size | ≤ 45,000 chars | enforced by `promptBudget.test.ts` (fixture 44,773) |
| Physical model requests / clean run | ≤ 5 | successful + failed + hedge launches |

## Telemetry (the before/after instrument)

Per job, `planning/sentinel-run.json` (`src/engine/sentinelTelemetry.ts`) records
per-stage wall-clock + attempts, model-call counts, prompt/completion chars
(`maxAuthor`), **findings-by-layer** (L0→L5), deterministic-normalization tags,
tier-1/tier-2 wall-clock, and the disposition
(`published | published-degraded | fallback | fail-loud`). Collection uses
`AsyncLocalStorage` (diagnostic-only; a disk fault never disturbs a build).

The 2026-07-06 final audit made the instrument honest end-to-end:

- **`published-degraded` is real.** Every degradation the run ships with —
  `moment-demote-last-resort`, `least-bad-pick` (browser-valid with open polish
  findings; BOTH least-bad seams), `interaction-quarantine-shipped`,
  `rows-neutral-children-shipped` (host placeholder "Item 1…" copy on frame),
  `degraded-volunteered-cut`, `cut-degraded-shipped`,
  storyboard time-ramp/beat/shape/polish demotions,
  `rescue-published-with-polish-findings`, `browser-qa-infra-bypass`, and a
  slot-director runtime precedence fallback — is
  recorded (`recordSentinelDegradation`), and `finalizeSentinelRun("published")`
  auto-downgrades to `published-degraded` when any exists. Draft-embedded
  degradations (quarantine's style tag, neutral children's
  `data-sequences-neutral`) are detected on the SHIPPING document at the end of
  `requestDirectComposition`, so an attempt that later loses can't leave a
  stale entry. A salvaged film can no longer report itself clean.
- **Cost ledger counts failures.** `modelCalls.failed`/`failedTotal` record
  failed logical calls (transport faults, stalls, truncations) and
  `modelCalls.hedged`/`hedgedTotal` the hedge duplicates launched — previously
  only successes were counted, hiding the most expensive runs.
  `physicalRequestTotal = successfulLogicalTotal + failedTotal + hedgedTotal`;
  `slotCalls` separates truncation continuation, scaffold repair, and validation
  repair hidden inside an outer source-author attempt.
- **Layer counters count findings, not attempts** (author stage) and the
  **storyboard stage now participates** (a rejected plan's findings land in L3
  static; every persisted failed attempt lands in L5 model-retry).
- **`island-strip` counts only model-authored islands** — host-injected islands
  carry `data-sequences-host="1"` and re-strip as plumbing on repair passes.
- **Tier semantics are literal.** Tier 1 is recorded inside `buildPreviews`
  when the thumbnails exist; tier 2 when the MP4 exists
  (`recordSentinelTierFromRunStart`). They used to be stamped around the call,
  excluding preview generation from "wall-clock to thumbnails".
- **The L1 scaffold counter** (`recordSentinelScaffold`) counts host-guaranteed
  bindings **actually present in the shipped document**
  (`countScaffoldBindingsPresent` — camera planes, stations, component roots),
  not the bindings the templates planned. `scaffoldCoverage.present/planned`
  exposes the denominator; `scaffoldRestorationEvents.scene-repair/l2-normalize`
  separately reports repair work across attempts rather than pretending those
  bindings survived L1 untouched.

`npm run sentinel:report --workspace @sequences/slack -- <dir>` aggregates every
`sentinel-run.json` (+ sibling `author-run.json`) into the mission metric table
(`--json` / `--label` for before/after captures). Attempt averages **include**
fail-loud runs (the old report excluded exactly the most expensive failures);
a "Cost honesty" line carries failed calls, hedge duplicates, and shipped
degradations.

---

## Every Sentinel flag

The Sentinel behaviors are gated through `src/engine/sentinelFlags.ts` (never
`process.env` directly) so this table is the single source of truth. They join
the existing kill-switch culture.

### Sentinel flags (this rework)

| Flag | Default | Effect |
| --- | --- | --- |
| `SLACK_SEQUENCES_SENTINEL_SKELETON` | **ON** (flipped 2026-07-06; `=0` reverts for one release) | Host emits scene skeletons carrying the camera-world plane + stations, component roots, and focal-part carriers so those paperwork classes are unrepresentable. `=0` force-reverts to bare shells. |
| `SLACK_SEQUENCES_SENTINEL_SLOTS` | **ON** (flipped 2026-07-06; `=0` reverts for one release) | Scene-addressable authoring (`film_style` + per-scene `scene_html`/`scene_script`). Truncation is script-aware; scaffold omissions get one scene repair; static/browser findings get one bounded validation repair over their scene-attributable subset (carrying previous HTML + script) whenever at least one finding maps to a named scene. Any film-level remainder retains the whole-doc ladder. The director prompt is anchor-rewritten and slot-compacted. `=0` force-reverts to whole-doc. |
| `SLACK_SEQUENCES_CRITIC_SKIP_CLEAN` | **ON** | Skip the continuity critic when the banked draft is already pristine (`strictOk` + `browserQualityPenalty == 0`). `=0` restores always-run. |

### The kill-switch family it joins

| Flag | Default | Effect |
| --- | --- | --- |
| `SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK` | ON (`=0` for prep) | `=0` fails loud with a `FAILURE.md` instead of shipping the safe fallback film. **Set to `1` on Railway before judging** (FALLBACKS.md). |
| `SLACK_SEQUENCES_USE_MCP` | ON | `=0` runs the in-process mutation/render path (diagnostic). |
| `SLACK_SEQUENCES_CONCEPT_PASS` | ON | `=0` skips the cached concept/arc pass. |
| `SLACK_SEQUENCES_CREATIVE_CRITIC` | ON | `=0` disables the continuity critic entirely. |
| `SLACK_SEQUENCES_SHAPE_HINT` | ON | `=0` disables the light-model structural shape pass. |
| `SLACK_SEQUENCES_CUT_DISCOVERY` | ON | `=0` disables deterministic shape-match cut upgrade. |
| `SLACK_SEQUENCES_SHARED_PLANNING_CACHE` | ON | `=0` disables the shared `.data/planning-cache/` reuse. |
| `SLACK_SEQUENCES_TEMPORAL_JUDGE` | ON | `=0` disables the rendered temporal judge (`moment_static_frame`). |
| `SLACK_SEQUENCES_EYE_TRACE` | ON (`block`) | `audit` observes, `0` disables eye-trace continuity. |
| `SLACK_SEQUENCES_QA_CACHE` | ON | `=0` disables the content-hash browser-QA cache. |
| `SLACK_SEQUENCES_INTERACTION_QA` | ON | `=0` disables interaction-time browser QA. |
| `SLACK_SEQUENCES_HEDGED_REQUESTS` | ON | `=0` disables the delayed-duplicate hedge; `SLACK_SEQUENCES_HEDGE_DELAY_MS`, `SLACK_SEQUENCES_HEDGE_MAX_PER_RUN` (default **2**), and `_STREAM_IDLE_TIMEOUT_MS` tune it. |
| `SLACK_SEQUENCES_STORYBOARD_RESCUE_MODEL` / `_SOURCE_RESCUE_MODEL` | `tencent/hy3-preview` | `none` disables the rescue rung; override to pick another model. |
| `SLACK_SEQUENCES_PROVIDER` | (Railway: `openrouter-api`) | the authoring provider. |

Model / thinking overrides (`_STORYBOARD_MODEL`, `_STORYBOARD_THINKING`,
`_AUTHOR_THINKING`, `_REPAIR_MODEL`, `_FRAME_MODEL`, `_CREATIVE_MODEL`,
`_LIGHT_MODEL`, `_SOURCE_RESCUE_THINKING`, `_STORYBOARD_RESCUE_THINKING`) and
`SLACK_SEQUENCES_DATA_DIR` round out the surface — see the relevant modules.
