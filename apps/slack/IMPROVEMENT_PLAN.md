# IMPROVEMENT_PLAN — "readable, not just alive" (2026-07-04)

**Mandate:** perfect the existing motion features; do NOT add large new systems.
The operator's verdict on the current output (latest run `probe-cutfix-3`,
2026-07-04 ~4:20 PM, `.data/projects/probe-cutfix-3/`): *"looks good but very
messy — nice animations but I don't understand what's going on; assets seem
random; it's not built for the eyes (I constantly look all over the place);
important frames should stay on screen longer after introducing many assets;
assets don't disappear when necessary and overlap; I never see the morphing /
match cuts happen."*

Every complaint above traced to a concrete mechanism. This plan is the map:
findings first, then prioritized workstreams (each with files, approach,
tricky bits, and verification). Anything large is out of scope and parked in
HANDOFF.md "Something next".

---

## 0. How to start (first 30 minutes)

1. Read `apps/slack/CLAUDE.md`, then skim the `slack-map` skill if loaded.
2. Open the evidence run: `.data/projects/probe-cutfix-3/` —
   `build/qa/sequence-check.md` (report), `composition/STORYBOARD.md`,
   `planning/author-run.json`, `build/thumbs/*.png` (LOOK at these images),
   `qa-cache/*.json` (grep for `cut_degraded`), `composition/motion-plan.json`.
3. Reproduce the baseline cheaply: `npm run film:demo --workspace @sequences/slack`
   and `npm run sequence:check --workspace @sequences/slack -- --demo --no-mcp --format both`
   (both model-free).
4. Live paid probe (only after deterministic work is green): the OpenRouter key
   is stored in the gitignored `apps/slack/.env` under `OPENROUTER_API_KEY`
   (temporary — the owner will revoke it; if it 401s, ask for a new one).
   `scripts/sequenceCheck.ts` does **not** read `.env`, so export it first:
   ```powershell
   $env:OPENROUTER_API_KEY = (Select-String -Path apps/slack/.env -Pattern '^OPENROUTER_API_KEY=').Line.Split('=',2)[1]
   npm run sequence:check --workspace @sequences/slack -- --product "RADAR" --what "SRE rollback copilot: find the failing trace, score rollback risk, roll back in one click" --provider openrouter-api --job-id improve-r1-1 --format both
   ```
   Job dirs are immutable — every retry needs a fresh `--job-id`.

---

## 1. Findings — what the diagnostics actually show

### 1.1 The declared morph NEVER rendered (complaint: "I don't see morphing/match cuts")

`probe-cutfix-3` declared `shape-match (palette-input-pill → trace-card)` at the
scene-2→3 boundary. The runtime's bind-time geometry audit degraded it:

> `cut_degraded: shape-match palette-invoke->trace-resolve compiled as
> zoom-through: focal silhouettes differ 7.9x in aspect ratio (cap 2.5x)`

- The degradation is **warning-only**. It never re-enters the repair loop, so
  the author is never asked to make the two silhouettes actually rhyme.
- `STORYBOARD.md` and the Slack outline still *advertise* the morph
  ("shape-matches into the trace card boundary") — the paperwork lies.
- `cut_degraded:` is consumed in exactly one place: `compositionRunner.ts`
  `applyShapeMatchUpgrade` (~line 5231) rejects **discovery** upgrades that
  degrade — planner-**declared** morphs get no such protection.
- `objectMatchCutCount: 0` in the report; cut discovery (`cutDiscovery.ts`)
  found no upgradable rhyme (it only upgrades hard/directional boundaries,
  max ONE per film, aspect cap 2.0×).
- Component `morph` beats (FLIP twins) exist in the kit but the planner used
  none in this run.

Net effect: morph-class cuts are *planned* often and *shipped* almost never.

### 1.2 Frames are mostly empty / content is tiny (complaint: "messy, random assets")

Look at the thumbnails:
- `m01-trace-flood.png`: a 1920×1080 frame that is ~90% empty dark; one clipped
  text line top-left, a half-off-frame terminal at the right edge.
- `m03-palette-opens.png` (a **primary** moment): a featureless gray circle —
  the palette itself is invisible at its own moment's capture time.
- `m06-card-resolves.png`: the trace card occupies maybe 6–8% of frame area,
  adrift in darkness.

Mechanisms:
- Browser QA's camera-arrival audit only checks **clipping**
  (`camera_framed_clipped`, `layoutInspector.ts` ~line 2158). There is no
  minimum-coverage check — a landing that frames 6% content passes.
- The one clipping finding it DID raise (error: `error-terminal` only 27%
  on frame at 2.0s) **still shipped**, because after 3 author attempts the
  loop publishes the least-bad browser-valid draft
  (`compositionRunner.ts` ~4807: `attempt === 3 && browserQa.ok`), and
  `browserQualityPenalty` (~3868) weighs an error at only 4 points.
- The prompt says "Fill the frame: hero text at 60–80% of frame width"
  (`prompts/planning-director.md` ~77) but nothing enforces it.

### 1.3 The film is choreographed churn (complaint: "not built for the eyes")

Count the eye-relocations in 21.5s: 7 full camera moves + ~15 segments total
(3 whips), 5 cut styles across 4 boundaries (cut-right, shape-match→zoom-through,
zoom-through, inverse-zoom, hard), 14 component beats, 13 moments. Causes:

- The prompt **demands** churn: "a new framing roughly every 3.5 seconds"
  (`planning-director.md` ~23) and "Two focal points minimum — the eye needs
  somewhere to travel" (~80). Real editors do the opposite: ONE focal point at
  a time, and the eye should already be where the next shot's subject appears
  ("eye trace" — see §2).
- Moment spacing ≤2.6s + liveness (quiet gap >2.5–3s = blocking) punish
  stillness, and `auditCameraEnergy` (`cameraContract.ts` ~806) **blocks a
  repeated camera verb** — the system structurally rewards variety and has NO
  counterweight that rewards coherence or holds. There is no audit that ever
  says "too many framings" (only `dedupeRedundantBeats` and
  `auditComponentComplexity`, which are about beats/components, not framings).
- Nothing measures **where** the viewer's eye is: cut/camera geometry is
  measured per boundary (`DirectBoundaryInventory` in `layoutInspector.ts`)
  but never compared across the seam.

### 1.4 Nothing owns exits (complaint: "assets don't disappear, they overlap")

- Ownership is explicitly "the author owns entrances + FINAL states"
  (componentContract header; prompt "Author the final state"). Exits are
  nobody's job: the kit has a `close` beat for menus/modals/toasts, but no
  audit or prompt rule ever requires retiring a surface whose story job ended.
- Layout QA has no stale-asset / occlusion-of-focal check — the sequences-side
  issue codes are only `camera_framed_clipped`, `contrast_aa`,
  `interaction_seek_instability`, `moment_static_frame`, `near_blank_scene`
  (plus hyperframes' text/canvas overflow).

### 1.5 Holds don't scale with information (complaint: "keep important frames longer")

Scene durations come solely from the GLM storyboard pass, softly steered by
`STORYBOARD_SHAPES` (`compositionRunner.ts` ~2852). Nothing links "how much
this scene introduces" to "how long it must stay". A scene may introduce 3
components and 4 camera segments in 4.5s (scene 3 of the probe did exactly
that: whip → orbit-lite → track-to-anchor → drift + 3 beats in 4.5s) and pass
every gate. Text gets no reading-time floor.

---

## 2. The craft model to encode (from real SaaS motion/editing practice)

These are the working principles the fixes below operationalize; keep them in
mind when tuning thresholds and prompt copy:

1. **Eye trace** (Murch's rule-of-six territory): know where the audience is
   looking at the cut, and put the next subject *there* — or carry the eye
   with an explicit directional move. A cut that teleports the subject across
   the frame breaks comprehension.
2. **One focal element at a time; choreography has hierarchy.** Supporting
   motion stays quiet while the hero moves; simultaneous equal-weight motion
   reads as noise.
3. **Exits are content.** When an element's job ends, animate its removal
   (with direction/finality); entry and exit are different gestures. Elements
   that just linger create the overlap mess.
4. **Hold on outcomes longer than actions.** The result of a click matters
   more than the click; a beat of stillness after a meaningful UI change aids
   comprehension. Text must stay readable for its length.
5. **Consistent transition language.** A film has 1–2 signature transitions,
   repeated — not five different cut styles in four boundaries. Premium cuts
   (morph/match) read premium because they are rare AND visible.
6. **Compression toward the CTA**: the strongest SaaS-ad move is collapsing
   the busy UI into the single next action — focal *density* rises toward the
   end. (We already have the ingredients: shape-match + close beats.)

---

## 3. Workstreams (priority order)

Each one improves an EXISTING feature. Estimated sizes: S (hours), M (a day).

### WS1 — Make declared morph/match cuts actually happen (M, highest user-visible payoff)

**Problem:** §1.1 — declared shape-match degrades silently; paperwork lies.

**Where:** `compositionRunner.ts` (author loop + repair prompts),
`cutContract.ts` / `cutDiscovery.ts` (`scoreShapePair` is the reusable
geometry oracle), `layoutInspector.ts` (~1840 emits `cut_degraded:`),
`storyboardMoments.ts`/`STORYBOARD.md` writers + `blocks.ts` (honest outline).

**Approach:**
1. **Repairable degradation.** In the author loop, treat a `cut_degraded:`
   warning on a **planner-declared** bridged cut as a strictOk-blocking polish
   finding (same class as `moment_static_frame`): feed the repair prompt the
   *measured numbers* ("outgoing 720×56 pill vs incoming 520×380 card = 7.9×;
   cap 2.5×") plus a concrete directive: restyle one endpoint (e.g. give the
   card a condensed pill-proportioned header band as the `focalPartIn`, or
   re-point `focalPartIn` at a sub-element that rhymes). Geometry is already
   measured per boundary in `DirectBoundaryInventory` — reuse it; do NOT
   invent a second measurement pass.
2. **Plan-time silhouette sanity.** The storyboard already carries
   `shapeOut`/`shapeIn` hints (`pill|bar|card|circle|window`). Add a
   deterministic mismatch table at storyboard validation (pill→card,
   circle→bar etc. = finding; pill→bar, window→card = fine) so hopeless pairs
   get fixed in a cheap GLM findings-retry instead of burning author attempts.
   Degrade-never-veto: an unfixed hint mismatch downgrades the declaration to
   zoom-through at parse (with a note), it does not block the film.
3. **Honest paperwork.** When a boundary degrades (or is upgraded by
   discovery), rewrite the executed cut in the shipped storyboard artifacts —
   `STORYBOARD.md`, the Slack outline row, `manifest.json` — from the QA
   result. Never advertise a cut that did not compile. (Post-authoring passes
   re-inject from `result.draft.storyboard`, NOT `args.lockedStoryboard` —
   HANDOFF gotcha #10.)

**Tricky:**
- Brief-required vs volunteered cuts already have different degrade policies
  (`degradeVolunteeredBridgedCuts` in the fallback-elimination pass) — don't
  break that; your new repair finding applies to cuts that *survived* to
  browser QA.
- The repair prompt must carry the bridged-cut endpoint checklist that already
  exists (both sides present/MISSING + never-delete-other-bindings) — extend
  it, don't fork it.
- `test/cutShapeMatch.browser.test.ts` proves degrade paths; add the repair
  path beside it. `test/authorReliability.test.ts` has the minimized-incident
  replay pattern to copy for loop tests.

### WS2 — Eye-trace continuity audit (M, the "built for the eyes" fix)

**Problem:** §1.3 — nothing measures gaze position across seams.

**Where:** `layoutInspector.ts` (browser QA already seeks boundaries and
measures part geometry — `DirectBoundaryInventory`, and the arrival audit
already double-samples landings), consumed in `compositionRunner.ts` repair
loop; new pure scorer next to `cutDiscovery.ts` style.

**Approach:** at each boundary, compute the viewport-space center of the
*outgoing attention target* (cut `focalPartOut` → else the last beat's
component → else the scene's `focalPart`) just before the cut, and of the
*incoming attention target* (cut `focalPartIn` → else first framed station's
hero component → else first beat target) at entry settle. Emit
`eye_trace_jump` (polish finding, strictOk-blocking, never unpublishing) when
the displacement exceeds ~35–40% of the frame diagonal AND the cut style is
not directional/zoom (directional cuts and whips legitimately carry the eye;
`hard` and crossfades do not). Fix hint: "place the incoming hero where the
eye already is, or make the boundary directional toward it."

Also add the within-scene variant: consecutive beats whose targets ping-pong
across more than ~50% of the frame in under ~1.2s (measure at beat times from
the same sampled pass) → advisory warning first (see Tricky).

**Tricky:**
- Camera transforms: measure in **viewport space after the world transform**
  (the interaction runtime already resolves geometry under camera transforms —
  reuse that path, don't recompute from region rects).
- Time bases: seek through content time (`seekContent`) like the temporal
  judge does; physical seeks convert via `warpInverseOf` only at the choke
  point (HANDOFF gotcha #2).
- Ship it warning-first for one paid probe, then promote to strictOk-blocking
  once the false-positive rate is seen. Bump `QA_CACHE_VERSION` (currently 3)
  — inspector semantics change.

### WS3 — Hold-what-matters pacing (M)

**Problem:** §1.5 + the prompt's churn mandates (§1.3).

**Where:** storyboard validation in `compositionRunner.ts` (beside
`auditComponentComplexity` / `auditCameraEnergy` — same findings-retry
plumbing), `componentContract.ts` (complexity audit is the natural host for an
"introduction load" rule), `prompts/planning-director.md`,
`STORYBOARD_SHAPES` labels.

**Approach (deterministic, plan-stage, cheap retries):**
1. **Introduction→development ratio.** Per scene: introductions = declared
   components + entrance-class beats (`open`, first `rows`, `swap` targets).
   Require the last introduction to land by ~65% of the scene window, and
   require post-introduction development time ≥ ~0.9s × (introductions), else
   finding: "scene X introduces N surfaces but leaves Ys to read them — extend
   the scene or move an introduction earlier/out."
2. **Reading-time floor.** For `type` beats and headline-class moments,
   required visible time ≈ max(1.2s, 0.3s × word count) before the next cut or
   whip in viewer time. Statically computable from beat `atSec` + text +
   boundary times.
3. **Outcome holds.** After a `press`/`set-state`/`toast open` payoff beat,
   require ≥0.8s before the next framing change ("hold on outcomes longer than
   actions").
4. **Camera-segment budget.** Cap full camera moves per scene as a function of
   duration (e.g. ≤1 + floor(duration/3.5s)), and whips per film (≤2). This is
   the counterweight the system lacks — today only under-movement blocks.
5. **Prompt surgery** (same commit, keep small): change "a new framing roughly
   every 3.5 seconds" to a ceiling AND floor ("...and never more than one
   reframe per ~2s; after introducing a dense surface, HOLD and develop it");
   replace "Two focal points minimum" with single-focal-discipline language
   ("one focal element at a time; layered secondary detail may coexist but
   only one thing commands motion at any moment"); add the outcome-hold rule
   to Motion doctrine.

**Tricky:**
- These audits interact with the moment-spacing floor (≤2.6s) and liveness —
  a hold is NOT a quiet gap if a counter/progress/drift develops it; make the
  findings' fix hints say so ("hold ≠ freeze: develop the held surface with a
  count/progress beat") or the model will thrash between the two gates.
- `topUpStoryboardMoments` runs before validation and may add moments anchored
  on the plan's own beats — run new audits AFTER top-up on the same
  storyboard the author will get.
- Never veto volunteered richness — degrade or ask for a longer scene, don't
  just reject (HANDOFF gotcha #11).
- Storyboard shape changes ⇒ bump the storyboard cache `contract` (v7 → v8).

### WS4 — Exit discipline (S/M)

**Problem:** §1.4 — assets linger and overlap.

**Where:** plan-stage in `componentContract.ts` (the `close` beat exists;
nothing demands it), browser-QA-stage in `layoutInspector.ts`, prompt Motion
doctrine + component section.

**Approach:**
1. **Plan-stage:** when a scene (or one region/station) has ≥2 overlapping
   surface-class components (window/modal/palette/card in the same region) and
   the later one opens while the earlier has no `close`/`swap`/`morph` beat
   before it → finding: "close or swap X before opening Y, or move Y to its
   own station."
2. **QA-stage `stale_asset_lingers`:** at each beat/moment sample, a component
   whose last beat has passed, which is not the current focal target and not
   `role:"hero"` chrome, still at opacity ≥0.9 AND overlapping the current
   focal element's rect → advisory warning (promote later if clean). Reuse
   existing sampled rects; do not add new seeks.
3. **Prompt:** add an explicit exits paragraph: "an element whose job is done
   exits (short, directional, ≤0.4s) or visibly recedes (scale/dim to ≤40%);
   entry and exit are different gestures; never stack a new surface over a
   live one."

**Tricky:** false positives are the whole game — dashboards legitimately keep
panels visible. Constrain to *overlap with the focal element*, not mere
presence. Start advisory. The `close` beat only exists for some kinds
(`dropdown`, `modal`, `toast`, `command-palette`, …) — for kinds without it,
the fix hint should say "author an exit tween", not "add a close beat".

### WS5 — Framing coverage: no more tiny-content-in-the-void (S)

**Problem:** §1.2.

**Where:** `layoutInspector.ts` camera-arrival audit (extend
`camera_framed_clipped`'s pass — it already seeks every landing), plus static
scenes at mid-window; `compositionRunner.ts` repair prompt already has a
camera_framed_clipped hint block (~4097) to extend.

**Approach:** at each full-move landing (and once mid-scene for camera-less
scenes), measure the union bbox of the framed station's visible content (or
the scene's focal part). Coverage < ~18% of frame area → `camera_framed_sparse`
polish finding: "the camera frames station X but its content fills only N% of
the frame — enlarge the content, tighten the station rect (the fit zoom
follows it), or move more of the scene's content into the framed station."
Keep the threshold conservative: probe-cutfix-3's m06 (~6%) must fail; the
deliberate risk-ring hold (~25–30% with its bloom) must pass.

**Tricky:** double-sample like the clipping audit does (entrances mid-tween
must not false-positive); `data-layout-ignore` decoration and blooms count
toward nothing — measure `data-layout-important`/component/part content.
Bump `QA_CACHE_VERSION`.

### WS6 — Transition-language coherence + don't ship known-clipped frames (S)

**Problem:** §1.2 shipping policy + §1.3 style zoo.

**Where:** `cameraContract.ts` (`auditCameraEnergy`), a sibling
`auditCutCoherence` (new pure function, plan-stage), `compositionRunner.ts`
`browserQualityPenalty`.

**Approach:**
1. **Cut palette rule:** per film, distinct non-hard cut styles ≤3 is fine but
   4+ distinct styles across ≤5 boundaries → finding "pick a transition
   language: reuse one directional axis / one zoom register instead of a
   different style per seam". Directional cuts should share an axis unless the
   motion motivates the change.
2. **Rebalance `auditCameraEnergy`:** keep the "needs one peak" rule; relax
   the "all moves same verb" finding to trigger only when the repeated verb is
   itself high-energy (whip×4) — repeated quiet verbs (drift/pan) are
   *coherence*, not a defect.
3. **Shipping policy:** raise the penalty weight of `camera_framed_clipped`
   (and the new `camera_framed_sparse`/`eye_trace_jump`) in
   `browserQualityPenalty` so the least-bad-draft pick at attempt 3 strongly
   prefers an unclipped film; a clipped landing is exactly what the operator
   calls "messy". Do NOT make it unpublishable — fallback pressure is worse.

### WS7 — Moment thumbnails must show the moment (S, polish)

**Problem:** §1.2 m03 — a primary moment's contact-sheet frame is an empty
circle; the same frame is what Slack shows the user.

**Where:** `thumbs.ts` (capture-time selection: "after evidence settles,
before the outgoing cut"), possibly sharing the temporal judge's frames.

**Approach:** after choosing the capture time, verify the moment's bound
element is actually visible (opacity ≥0.5, on frame, area > 0) at that seek —
if not, walk forward in small steps (≤0.6s, still before the cut window) to
the first visible frame. Scene-start-anchored moments are the failing class
(entrances haven't finished at `atSec + settle`).

**Tricky:** stay deterministic and cheap — this runs in the model-free
plumbing layer; keep it a pure function of measured state. Don't reuse
`data-part` attribute selectors on bridge clones (gotcha #7).

---

## 4. Verification ladder for this work

Per workstream: unit tests first (vitest root gotcha:
`npm run test --workspace @sequences/slack`, or
`npx vitest run --root ../.. apps/slack/test/<file>` from `apps/slack`), then:

```powershell
npm run typecheck --workspace @sequences/slack
npm run test --workspace @sequences/slack
npm run film:demo --workspace @sequences/slack        # golden film must stay green
npm run sequence:check --workspace @sequences/slack -- --demo --no-mcp --format both
```

The fallback film and `film:demo` are the deterministic proof path — if a new
audit fires on them, the audit is wrong (or the fallback needs the same fix;
decide deliberately). Then 1–2 paid probes (see §0 for the key/recipe; fresh
`--job-id` each run) with briefs that *demand* the failure shapes:
- a brief with a natural pill→card morph (WS1: assert the shipped cut is
  either a real shape-match or an honestly-labeled zoom-through),
- a dense multi-component brief (WS3/WS4: assert holds and exits),
- inspect `planning/author-run.json`, `planning/attempts/`, thumbnails, and
  the QA issue list — and LOOK at the thumbnails with your own eyes; the
  reports said "pass" on a film the operator called a mess.

Cache bumps to remember: storyboard shape change → `contract` v7→v8 in the
storyboard cache; any inspector-semantics change → `QA_CACHE_VERSION` 3→4.

Finish = update ROADMAP.md/CLAUDE.md (+ `.claude/skills/slack-map` locally) →
commit → `bash scripts/publish-public.sh "<msg>"` → `railway up` (publish ≠
deploy) → `/healthz` → `ready`. **Never commit `.env`** (it now carries the
probe key; it is gitignored — keep it that way).

## 5. Global tricky things (read before coding)

1. **Never hand-tune motion** — all fixes are contracts, audits, prompt text,
   and repair plumbing. Motion goes through the deterministic gate.
2. **Injection anchors are load-bearing**; the time-wrap rewrite stays LAST
   (`test/timeRamp.test.ts` guards it). New injected passes must respect the
   existing order in `directComposition.ts`.
3. **Degrade, never veto, volunteered enhancements** — new plan gates must ask
   for fixes or degrade typed intents, not reject creative additions outright.
4. **When a repair loop fails 3× on one finding, suspect the finding** — tune
   thresholds against probe-cutfix-3's artifacts before shipping a blocker.
5. **linkedom mirrors the browser**: if any runtime bind query changes, mirror
   it in `kitMarkupAudit.ts`.
6. **Pulse-shaped evidence needs mid-frames** (temporal judge lesson) — any
   new rendered check that samples only before/after will misread pulses.
7. `apps/slack` is isolated: copy glue in, never import from `apps/forge`/
   `apps/sequences`, never touch `packages/*`.
8. The world element must NEVER carry a CSS filter (kills preserve-3d).

## 6. Suggested build order

WS1 → WS5 → WS3 → WS2 → WS4 → WS6 → WS7. Rationale: WS1 is the loudest broken
promise and self-contained; WS5 is small and reuses the arrival audit you'll
have just read; WS3+WS2 are the heart of "built for the eyes" and share the
plan-gate/QA plumbing; WS4/WS6/WS7 are polish multipliers. Ship in 2–3 commits
minimum (WS1+WS5, WS3+WS2, WS4+WS6+WS7), each through the full ladder, with
one paid probe after the second commit and one after the third.
