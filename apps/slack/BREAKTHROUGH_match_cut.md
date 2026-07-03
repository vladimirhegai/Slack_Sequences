# BREAKTHROUGH — General match cuts (beyond object-match)

Status: **planned, not built.** Handoff plan for a future agent. Scoped out of
the 2026-07 polish pass because it is a new *analysis* capability, not a data
extension of the existing cut contract.

## Problem

The strongest scene transitions in premium SaaS films are matches: a circular
avatar becomes a pie chart; a progress bar's motion carries into a timeline
scrubber; the search field's rectangle expands into the next scene's app
window. Today the only match mechanism is the typed `object-match` cut
(`cutContract.ts` + `templates/sequences-cuts.v1.js`): a measured FLIP bridge
for **one shared `data-part` id** across the boundary. If the two scenes don't
deliberately share a part id, no match is possible — and nothing helps the
planner *find* matchable pairs.

## Why this is breakthrough-scale, not polish

- A general match cut needs similarity analysis across scene boundaries —
  shape (aspect/border-radius/size class), color (dominant fill), and motion
  vector at the boundary — none of which exists anywhere. `object-match`
  is geometry bridging; this is geometry *discovery*.
- Doing it well means either (a) a deterministic DOM analysis pass that scores
  candidate pairs post-authoring and rewrites the cut, or (b) teaching GLM to
  plan matched pairs up front with a vocabulary for visual attributes. Both are
  new subsystems with their own QA (a bad match is worse than a hard cut).

## Design sketch (deterministic-first, per the codebase's philosophy)

1. **Planner vocabulary first (cheap half):** extend the storyboard schema so a
   cut may declare `match: { fromPart, toPart, on: "shape" | "motion" }` with
   *different* part ids on each side. The cut runtime already knows how to FLIP
   a measured rect; generalize the bridge to interpolate between two different
   elements' measured boxes + border-radius + background color (a superset of
   today's twin morph in `sequences-components.v1.js` `compileMorph`, hoisted
   across the scene boundary).
2. **Deterministic audit:** at validation time, measure both parts; if their
   aspect ratios differ by >2.5× or either is mostly off-frame at the boundary,
   degrade to the cut's declared base style (enhancement-never-veto, same as
   every other contract).
3. **Discovery pass (the actually-hard half, optional v2):** a post-authoring
   analysis that inventories each boundary's outgoing/incoming element geometry
   and *suggests* match pairs as advisory findings to the continuity critic —
   the critic (GLM) decides whether to direct a patch.

## Files that will change

`cutContract.ts` (schema + validation + degrade rules),
`templates/sequences-cuts.v1.js` (cross-element bridge compile),
`compositionRunner.ts` (`parseStoryboard` + prompts), `layoutInspector.ts`
(boundary measurement reuse), `storyboardMoments.ts` (a match cut is prime
moment evidence), browser test with two deliberately-matched scenes.

## Risks

- A geometric bridge between dissimilar elements reads as a glitch — the
  degrade rules matter more than the happy path.
- Boundary measurement happens under camera transforms; reuse the
  camera-aware rect logic from `layoutInspector.ts` rather than re-deriving.
- Keep `object-match` untouched as the stable fallback; the new style is
  additive (`shape-match`), never a replacement.
