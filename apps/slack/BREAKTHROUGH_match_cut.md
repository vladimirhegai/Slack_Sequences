# BREAKTHROUGH — General match cuts (shape-match + discovery)

Status: **v1 BUILT 2026-07-03.** `shape-match` is a live `CutStyle`: dual-bridge
crossfade with border-radius interpolation in `sequences-cuts.v1.js`
(`bindShapeMatch`), bind-time geometry audit (>2.5× aspect, >60-node subtree,
off-frame static parts) that degrades to `zoom-through` with a typed
`{degraded, reason}` on `__sequencesCutBindings`, surfaced by browser QA as a
`cut_degraded:` warning. Planner side: prompt vocabulary + `shapeOut/shapeIn`
hints + `requireShapeMatch` brief requirement; the static gate warns when a
bridge lands outside the incoming scene's entry framing. Proven by
`test/cutShapeMatch.browser.test.ts` (matched pair flies, mismatched pair
degrades) plus a paid live create. The v2 discovery pass below remains open.
Originally re-scoped 2026-07-03 after a code audit and a live GLM 5.2 probe
(see "Evidence" at the bottom).

## Corrected premise — what exists today (verified against code)

The original doc claimed object-match requires "one shared `data-part` id
across the boundary." **That is false.** `SceneCutIntentV1` already carries
independent `focalPartOut` / `focalPartIn` names (`cutContract.ts:63-66`), the
static gate validates each in its own scene scope (`cutContract.ts:287-304`,
via `sceneScopes`), and `bindObjectMatch` (`templates/sequences-cuts.v1.js:174`)
measures the two *different* elements live on every frame and flies a bridge
between them. The planner prompt already says "a focal element visibly travels
to a **matching element** in the next shot."

So cross-element match cuts mechanically work. What actually blocks premium
matches:

1. **The bridge reads as a teleport for dissimilar elements.** The bridge is a
   raw `cloneNode` of the *outgoing* part; it tweens x/y/width/height only,
   then swaps to the incoming part instantly at landing
   (`sequences-cuts.v1.js:52-68, 174-222`). Avatar→pie-chart looks like an
   avatar sliding onto a chart, then popping. No border-radius interpolation,
   no color interpolation, no crossfade into the destination's pixels.
2. **No geometry sanity audit.** A 10:1 aspect mismatch or an off-frame target
   compiles happily and reads as a glitch.
3. **Nothing helps the planner find matchable pairs** — the discovery problem.
   Live probe confirms: GLM does not volunteer shape matches even when the
   vocabulary is offered; it uses them well only when the brief demands one.

## What to build

### v1 — `shape-match` style (small, additive, reuses proven patterns)

A new `CutStyle` `"shape-match"`, sibling of `object-match` (which stays
untouched as the stable fallback). Same `focalPartOut`/`focalPartIn` fields,
plus optional planner-side silhouette hints `shapeOut`/`shapeIn`
(`pill|bar|card|circle|window`) that exist purely so the model self-checks the
pairing (probe: given the hints, GLM picked window→card, a genuinely matched
silhouette).

**Runtime: dual-bridge crossfade.** This is `compileMorph`'s twin pattern
(`templates/sequences-components.v1.js:397-428`) hoisted across the scene
boundary, combined with `bindObjectMatch`'s live per-frame rect measurement:

- Clone *both* parts into the overlay layer (`bridgeElement` twice).
- Both bridges tween along the same interpolated rect path (the existing
  `localRect` + eased-proxy `onUpdate` loop — live measurement means camera
  transforms on either scene's `data-camera-world` are tracked for free,
  since `getBoundingClientRect` includes them).
- Crossfade bridge A → bridge B across the middle of the flight (like the
  morph's 0.45/0.55 overlap), so the destination's real pixels arrive before
  landing instead of popping at the end.
- Interpolate `border-radius` between the two parts' computed styles on the
  outgoing bridge while it is still dominant (width/height/x/y already
  interpolate). Background color interpolation is optional polish — the
  crossfade mostly covers it.

**Geometry audit + degrade — in the browser, not the static gate.** The
original doc put the >2.5× aspect check "at validation time," but Node-side
validation is regex-over-HTML and cannot measure. Put the audit inside the
runtime's compile step (deterministic: QA and render run the identical code):
if the two parts' aspect ratios differ >2.5× or either rect is mostly outside
the frame at bind time, **compile the boundary as `zoom-through` instead of
throwing**, and record `{ degraded: true, reason }` on the binding pushed to
`__sequencesCutBindings` so browser QA (`layoutInspector.ts`
`inspectDirectComposition`) can surface it as a warning. Missing parts keep
the current throw (static gate already proves existence scene-scoped, so a
runtime miss is a real bug, not a soft mismatch). Enhancement-never-veto, same
as every contract.

**Static gate additions** (`validateCutContract`): a deterministic *warning*
when `focalPartIn` is not at the incoming scene's entry framing — checkable
without a browser because both are typed: compare the incoming part's declared
component `region` (or its `worldLayout` cell) against the first camera-path
segment's `toRegion`/`fromRegion`. A bridge that flies toward an unframed
station is the likeliest field failure.

**Planner side.** Add the style + one always-on vocabulary line to the
storyboard `basePrompt` (`compositionRunner.ts:2411-2418`, the cut-style
paragraph), and wire `requireShapeMatch` into
`inferStoryboardPlanRequirements` + `validateStoryboardPlan` exactly like the
existing `requireObjectMatch` (`compositionRunner.ts:2002-2007`). Do not
expect organic adoption (probe-confirmed); the brief-derived requirement is
the delivery mechanism, plus the continuity critic (below).

### v2 — discovery pass (the actual new capability, optional, separate PR)

Post-authoring, inventory each boundary's outgoing/incoming `data-part`
geometry from the browser QA pass (layout samples already measure rects near
boundaries) and classify silhouettes (aspect + border-radius + size class).
Score candidate pairs; emit *advisory findings* into the continuity critic's
evidence pack (`requestContinuityCritique`, GLM job #3,
`compositionRunner.ts:3463+`) — the critic decides whether to direct a patch
that re-declares a boundary as `shape-match`. This keeps discovery bounded by
the existing ≤5-directive critic contract and full deterministic QA.

## Files that change (v1, verified)

- `cutContract.ts` — style enum + `shapeOut/shapeIn` normalization + entry-
  framing warning. `resolveCutPlan`/`parseCutPlan` gain the fields.
- `templates/sequences-cuts.v1.js` — `bindShapeMatch` (dual bridge, crossfade,
  radius interpolation, geometry audit + typed degrade).
- `compositionRunner.ts` — prompt vocabulary + `requireShapeMatch`
  requirement + storyboard validation.
- `layoutInspector.ts` — read degraded bindings from
  `__sequencesCutBindings` into browser-QA warnings (small).
- Tests: unit tests for normalization/degrade; a browser test with two
  deliberately matched scenes and one deliberately MISmatched pair proving the
  degrade path (the degrade matters more than the happy path).

Explicitly **not** changed: `storyboardMoments.ts` (cuts already bind as
moment evidence via `motionDensity` cut activities — no new work),
`interactionContract.ts`, `cameraContract.ts`.

## Order of work

1. Contract + runtime + degrade (deterministic core, provable with the
   browser test — no model).
2. Prompt vocabulary + brief requirement.
3. One paid live create with a brief that demands a shape-match (per the
   verification ladder's "typed cuts" row).
4. v2 discovery as its own follow-up.

## Risks

- A geometric bridge between dissimilar elements reads as a glitch — the
  runtime audit + `zoom-through` degrade is the core deliverable, not an edge
  case. Test the mismatch path first.
- Both bridges are clones in the overlay; heavy DOM inside a cloned part
  (tables, charts) doubles paint cost for ~0.7s. Cap: refuse (degrade) when a
  part's subtree exceeds ~60 nodes — count at compile time.
- Boundary measurement under camera transforms is already handled by live
  per-frame `getBoundingClientRect` — do not re-derive static rects.
- Keep `object-match` byte-identical; `shape-match` is additive.

## Evidence (2026-07-03 live probe, z-ai/glm-5.2 via OpenRouter)

Two storyboard-planning probes with the condensed new vocabulary:
- Unprompted run: GLM used directional cuts only — it does **not** reach for
  shape-match on its own ("prefer directional when unsure" was obeyed).
- With a brief-level requirement ("the brief explicitly asks for one
  shape-match transition"): GLM declared
  `focalPartOut:"inbox-window" (window) → focalPartIn:"draft-card" (card)` —
  a plausible rounded-rect silhouette pair at the right story beat.

Conclusion: the runtime half is deterministic engineering; the planner half
works through brief-derived requirements + critic, not free adoption.
