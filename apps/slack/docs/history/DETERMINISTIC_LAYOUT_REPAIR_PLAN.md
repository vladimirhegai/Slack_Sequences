# Deterministic Layout Repair Plan

Date: 2026-07-08

Purpose: hand off a safe implementation plan for deterministic browser-measured layout repair. The target is a new normalizer near `correctSparseFraming` that can repair high-frequency canvas/safe-area overflow without a paid model retry, then later support a much more constrained settled-overlap mover.

## Verdict

This is feasible for a useful subset, but not exactly with the current data shape.

The browser QA path already measures real rendered geometry under the active camera transform. HyperFrames' browser audit returns `rect`, `containerRect`, and `overflow` for `canvas_overflow`, `text_box_overflow`, `clipped_text`, and `container_overflow`; `content_overlap` returns the first text rect. Sequences also measures boundary `data-part` geometry for cut discovery. However, `normalizeHyperframesIssue` currently drops those rect fields before persisting `DirectLayoutIssue`, so a deterministic repair pass must first preserve structured geometry. Do not parse the prose messages.

The first implementation should repair only canvas/safe-area overflow. Free-form overlap movement should be a second milestone after the geometry evidence, addressed-part skip rules, and adoption gates are proven.

## Verified Premises

| Claim | Status | Evidence |
| --- | --- | --- |
| Browser QA can measure bbox under camera transform | True, with caveats | QA uses `getBoundingClientRect()` in the browser after seeking the compiled timeline. This includes `data-camera-world` transforms. Boundary measurements are viewport-space `data-part` boxes. |
| Current `DirectLayoutIssue` exposes every bbox | False | `DirectLayoutIssue` exposes selector/time/message plus special `framing` metadata, but not general `rect`/`containerRect`/`overflow`. |
| HyperFrames already returns rect data for overflow | True | `layout-audit.browser.js` emits `rect`, `containerRect`, and `overflow` for overflow findings. |
| A sparse-framing-style repair seam exists | True | `correctSparseFraming` mutates storyboard, `applyDeterministicSourceRepairs` re-injects, `inspectDirectComposition` re-measures, and the candidate is adopted only on strict improvement. |
| Component id doubles as `data-part` and geometry address | True | The storyboard contract explicitly says component ids are `data-part` names for camera, cuts, and cursor interactions. |
| Motion-window suppression exists | True | Browser QA suppresses static layout findings inside cut, full-camera, and component motion windows before issue collapse. The overlap mover still needs its own guard over grouped issue windows. |

## Archive Evidence

I scanned 102 persisted `qa/spatial.json` files under `.data/projects` for probe/audit/baseline/sentinel/sequence-check projects.

Top recurring layout-relevant codes:

| Code | Count |
| --- | ---: |
| `canvas_overflow` | 148 |
| `container_overflow` | 64 |
| `content_overlap` | 46 |
| `important_safe_area` | 32 |
| `text_box_overflow` | 20 |
| `clipped_text` | 6 |

`probe-audit-03` specifically had:

| Code | Count |
| --- | ---: |
| `canvas_overflow` | 8 |
| `container_overflow` | 2 |
| `content_overlap` | 1 |
| `important_safe_area` | 1 |

The probe-03 overflow cases were mostly text inside camera-world product surfaces, for example fragment-card author/snippet text during `timeline-alignment`, and sidebar item text during `momentum-board-reveal`. That confirms the footgun: viewport bboxes already include camera transforms, but a fixed local repair can behave differently at other camera keyframes. Candidate adoption must re-measure the full scene and ideally force extra camera-keyframe samples.

## Architecture

Add this as a sibling to `correctSparseFraming`, but do not make it a pure storyboard-only mutation unless the storyboard gains a host-only layout repair field.

Recommended shape:

1. Extend geometry evidence.
   - Add `LayoutRect` and `LayoutOverflow` types.
   - Add optional `rect`, `containerRect`, `overflow`, `peerRect`, `repairSelector`, `sceneId`, `part`, `componentRootPart`, `insideCameraWorld`, and `motionWindowOverlap` fields to `DirectLayoutIssue` or a separate `layoutEvidence` array.
   - Preserve raw HyperFrames fields in `normalizeHyperframesIssue`.
   - Generate a unique `repairSelector` in browser QA. Prefer `#id`, `[data-part="..."]` only when unique in scene, otherwise a scene-rooted nth-of-type path. Do not rely on broad selectors like `div.cmp-item`.

2. Add a host-only repair intent.
   - Extend `DirectScene` with optional `layoutRepairs?: SceneLayoutRepairV1[]`.
   - Keep it host-authored only. The storyboard prompt should not ask the model to emit it.
   - `applyDeterministicSourceRepairs` strips and re-injects a single idempotent `<style data-sequences-layout-repair>` block from these repairs.
   - Record a `sentinelNormalizations` note and telemetry row such as `layout-overflow-clamp`.

3. Add the normalizer.
   - `correctLayoutOverflow(storyboard, browserQa): { storyboard, corrected }`
   - Build repairs only from structured evidence for `canvas_overflow` and `important_safe_area` in the first milestone.
   - Optionally include `container_overflow` later, but not in the first patch. Container overflow often requires changing internal layout, not just fitting to the frame.

4. Add the adoption branch.
   - Run after contrast repair and before or after sparse framing, but update both guards so neither repair can introduce the other's geometry problems.
   - Re-inject through `applyDeterministicSourceRepairs`.
   - Validate static contract.
   - Re-run browser QA with candidate extra sample times for the repaired scenes.
   - Adopt only if target issue score strictly improves and no protected issue count increases.

## MVP: Overflow Clamp/Scale

Target codes:

- `canvas_overflow`
- `important_safe_area`

Candidate requirements:

- Must have structured `rect`, `containerRect` or `safeRect`, `overflow`, `sceneId`, and a unique `repairSelector`.
- Must not be inside a cut, camera transit, component motion, or interaction active window.
- Must be visible at two or more settled samples if the original finding spans multiple samples.
- Must not target an addressed geometry binding:
  - camera `toPart`
  - camera `focus.part`
  - cut `focalPartOut` / `focalPartIn`
  - interaction `targetPart`, `ripplePart`, or `dragTargetPart`
- If the target is inside `[data-camera-world]`, verify the repair at all scene camera segment starts, landings, and mid-hold samples. If that forced check is not implemented in the first pass, skip camera-world targets.

Repair calculation:

1. Group findings by `sceneId + repairSelector`.
2. Compute the viewport-space union rect across all issue samples for that target.
3. Use the safe rect:
   - for `important_safe_area`, use the measured safe inset from the issue or recompute from `--space-safe`;
   - for `canvas_overflow`, use the root rect with a small guard inset, for example 8 px.
4. Compute a bounded scale and translation:
   - `scale = min(1, safeWidth / unionWidth, safeHeight / unionHeight)`.
   - Clamp scale to a floor, initially `0.86`. Below that, the layout needs a model repair or a real layout rewrite.
   - Compute `dx/dy` needed to bring the scaled union inside the safe rect.
   - Clamp translation to a small percentage of the frame, initially 10% width/height. Larger movement is a composition change.
5. Materialize as CSS longhands so existing `transform` strings are not overwritten:
   - `translate: <dx>px <dy>px !important;`
   - `scale: <scale> !important;`
   - `transform-origin: center center;`
   - Add a comment with issue code, scene id, and rounded before/after numbers.

Skip instead of guessing when:

- selector is broad or non-unique;
- target or ancestor has `data-layout-allow-overflow`;
- target is a cursor, ripple, cut bridge, runtime actor, or `data-layout-ignore`;
- target has active GSAP transform motion at any issue sample;
- required scale is below the floor;
- required translation exceeds the cap;
- target lives in a camera world and forced camera-keyframe verification is not available.

## Adoption Gate

Do not rely only on `browserQualityPenalty`: `canvas_overflow` is currently `info`, so its penalty is zero.

Use a local layout repair score:

```text
score = 4 * clipped_text
      + 4 * text_box_overflow(error)
      + 2 * important_safe_area
      + 2 * container_overflow
      + 1 * canvas_overflow
      + 1 * content_overlap
```

For MVP adoption:

- `candidateValidation.ok` must be true.
- `candidateQa.ok` must be true and `infraError` absent.
- target score for `canvas_overflow` + `important_safe_area` must strictly decrease.
- full layout repair score must decrease or stay flat with no protected increases.
- `browserQualityPenalty(candidateQa) <= browserQualityPenalty(before)`.
- No increase in:
  - `clipped_text`
  - `text_box_overflow`
  - `content_overlap`
  - `container_overflow`
  - `important_safe_area`
  - `camera_framed_clipped`
  - `camera_framed_sparse`
  - `interaction_*`
  - `cut_degraded`
- No new runtime errors or static validation warnings.

If the batch candidate fails, try only the highest-confidence single repair once. Do not loop indefinitely.

## Phase 2: Settled Overlap Mover

Do not start here. Overlap movement is possible, but only with stricter evidence than current `content_overlap` provides.

Additional evidence needed:

- `content_overlap` must carry both element selectors and both rects. Today the normalized issue carries one selector and the other element only as `containerSelector`.
- For each overlap, measure nearest component root, nearest layout zone, text content, opacity, z-index, and data-part binding.
- Carry all sample times where the overlap appears, not only first/last.

Mover rules:

- Act only outside cut/camera/component/interaction motion windows.
- Move at most one element in a pair.
- Prefer moving the lower-priority element:
  - not `data-layout-important`;
  - not a component root;
  - not a camera/cut/cursor addressed part;
  - not spatialIntent focal part;
  - not a moment subject;
  - smaller area and lower opacity wins.
- Push along the least-overlap axis.
- Keep both elements inside safe rect across all issue samples and forced camera keyframe samples.
- Cap movement to 96 px or 6% of frame; beyond that, ask the model to redesign layout.
- Never move a `data-part` root addressed by camera/cut/cursor unless a later implementation updates all dependent bindings in lockstep. First implementation should skip.

Adoption gate for mover:

- overlap count and area must strictly decrease;
- no new overflow, clipping, sparse camera, interaction, or cut degraded issue;
- visual target score must improve;
- one candidate pass plus one single-repair fallback maximum.

## Test Plan

Unit tests:

- `normalizeHyperframesIssue` preserves `rect`, `containerRect`, `overflow`, and generated unique repair selector.
- `addressedPartsForLayoutRepair` collects camera `toPart`, camera focus parts, cut focal parts, and interaction target/ripple/drag parts.
- `correctLayoutOverflow` skips addressed parts, broad selectors, low scale, large translations, motion-window overlaps, and `data-layout-allow-overflow`.
- `correctLayoutOverflow` emits stable, idempotent `layoutRepairs`.
- `applyDeterministicSourceRepairs` strips/re-injects exactly one `data-sequences-layout-repair` block.

Browser tests:

- Simple off-canvas text: QA reports `canvas_overflow`; repair clears it after re-inspection.
- Safe-area card: QA reports `important_safe_area`; repair clears it without new overlap.
- Duplicate class selectors: only unique `repairSelector` is used; broad `div.cmp-item` is skipped unless disambiguated.
- Camera-addressed part: a `track-to-anchor`/cut/cursor target that overflows is skipped.
- Camera-world keyframes: a candidate that fixes one sample but breaks another camera landing is rejected.
- Regression guard: a candidate that clears overflow but creates `content_overlap` is rejected.

Archive replay tests:

- Load `probe-audit-03` composition as a fixture. Confirm the eight `canvas_overflow` findings are discoverable as structured candidates.
- First MVP may skip camera-world candidates if forced keyframe checks are not ready; the test should assert honest skip reasons rather than fake a repair.
- Once camera-world verification is implemented, assert the candidate is adopted only if probe-03 overflow count decreases and no new overlap/clip/sparse findings appear.

## Implementation Order

1. Preserve geometry evidence in `DirectLayoutIssue`.
2. Add unique `repairSelector` generation and tests.
3. Add `layoutRepairs` type and idempotent style injection in `applyDeterministicSourceRepairs`.
4. Implement `correctLayoutOverflow` for non-camera-world `canvas_overflow` and `important_safe_area`.
5. Add adoption branch with local layout repair score and protected no-regression counts.
6. Add forced extra sample times for repaired scenes and camera keyframes.
7. Expand to camera-world overflow once forced sampling proves stable.
8. Only then implement the settled overlap mover.

## Non-Goals For The First Patch

- Do not rewrite arbitrary CSS grids/flex layouts.
- Do not parse finding prose.
- Do not move camera/cut/cursor addressed `data-part` roots.
- Do not repair broad selectors without unique disambiguation.
- Do not fix `container_overflow`, `text_box_overflow`, or `clipped_text` in the first patch unless the geometry evidence proves it is the same simple frame-fit case.
- Do not introduce a loop that keeps re-running browser QA until clean.

## Handoff Summary

The auto-fixer is worth building, but it needs one evidence-layer change first. Start with structured geometry preservation and a conservative overflow clamp/scale. The prior probes show the demand is real, especially `canvas_overflow`, but they also show many findings live inside camera-world scenes. That makes the user's camera-keyframe warning central: adopt only after re-measuring, and skip anything addressed by camera/cut/cursor until a binding-aware mover exists.
