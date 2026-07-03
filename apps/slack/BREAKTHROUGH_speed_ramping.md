# BREAKTHROUGH — Speed ramping / time remapping

Status: **planned, not built.** Handoff plan for a future agent. Scoped out of
the 2026-07 polish pass because it touches the deterministic-seek invariant —
the hardest runtime law in this codebase.

## Problem

Premium motion pieces use time itself for emphasis: a fast whip that decelerates
into slow motion as the key metric lands, then snaps back to speed. Today every
segment/beat maps wall-clock time affinely onto the master GSAP timeline; eases
shape motion *within* a fixed duration but the film's clock never bends. The
result reads "smooth but even" — no rhythm spikes.

## Why this is breakthrough-scale, not polish

- Every consumer assumes `seconds → timeline position` is affine per scene:
  thumbnail capture (`directComposition.ts` seeks by seconds), motion-density
  windows (`motionDensity.ts`), layout QA sampling (`layoutInspector.ts`),
  moment `atSec` binding (`storyboardMoments.ts`), cut boundary compilation
  (`cutContract.ts`), and the render frame loop. A time-warp function breaks
  all of their arithmetic at once unless it is threaded through a single shared
  mapping utility they all call.
- Deterministic seek is a hard invariant (CLAUDE.md): frame N must render
  identically no matter the seek order. GSAP `timeScale` animation is
  stateful/integration-based — the safe implementation is a *precomputed*
  monotonic time-remap curve, not live timeScale tweens.

## Design sketch

- One typed declaration per scene: `timeRamp: { atSec, slowTo (0.2–0.6),
  recoverSec }` — a single dip per scene, planned by GLM at a moment of
  emphasis (bind it to a `StoryboardMomentV1` id so it is motivated by
  contract).
- Compile to a **piecewise-linear time-remap function** `warp(t)` embedded in
  the composition (host-owned runtime, like the cut/camera islands). The master
  timeline is built in *warped* time; `warp` and its inverse are exported on
  the runtime object.
- Add `sharedTimeMap.ts` in `engine/`: the single source both Node-side QA
  (density, moments, thumbnails) and validation use to convert declared seconds
  ↔ timeline seconds. Every consumer that currently does raw seconds math gets
  one mechanical call-site change.
- Degrade-gracefully: a scene whose ramp fails normalization (overlapping cut
  window, ramp longer than scene) drops the ramp, never the scene.

## Files that will change

`compositionRunner.ts` (storyboard schema + prompt vocabulary), new
`engine/timeRamp.ts` + runtime template, `directComposition.ts` (seek
conversion), `motionDensity.ts`, `storyboardMoments.ts`, `layoutInspector.ts`,
`cutContract.ts` (cut windows must live in warped time), render path
verification, plus a dedicated seek-order browser test.

## Risks

- Silent QA drift: if one consumer forgets the warp, its findings point at the
  wrong frames — worse than no feature. Mitigate with a lint that greps for raw
  `durationSec`/`startSec` arithmetic outside `sharedTimeMap.ts` in files that
  import it.
- Audio (future): any soundtrack work would need matching remap.
- Keep scope to ONE dip per scene, cap 2 per film — rhythm, not chaos.
