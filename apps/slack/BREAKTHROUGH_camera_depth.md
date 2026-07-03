# BREAKTHROUGH — Camera depth: true orbit reveals + rack focus

Status: **planned, not built.** Handoff plan for a future agent. Scoped out of
the 2026-07 polish pass because both halves need a depth model the current 2D
compositor does not have.

## Problem

Two premium shot types judges/buyers associate with expensive SaaS films are
impossible today:

1. **True orbit reveal** — the camera arcs *around* a subject (dashboard,
   device, hero card), revealing side faces and creating real spatial presence.
   Today's `orbit-lite` (`templates/sequences-camera.v1.js`, `ORBIT_DEG`) is a
   flat ±rotation wobble layered on a 2D translate+scale tween.
2. **Rack focus / depth-of-field** — pulling focus between a foreground element
   and a background layer to steer attention. No focal-plane concept exists in
   any contract; `data-parallax` only encodes translation counter-motion speed,
   not visual depth.

## Why this is breakthrough-scale, not polish

- The camera runtime's `frameState()` computes `{x, y, z(scale)}` against
  `layoutRect` — a strictly 2D model. Orbit needs `perspective`,
  `transform-style: preserve-3d`, per-element `transform-origin` in 3D, and a
  camera position that exists off the world plane. That invalidates the
  assumptions `layoutInspector.ts` uses for off-frame/overlap suppression and
  the geometry `interactionContract.ts` uses for cursor hit-testing under
  camera transforms.
- Rack focus needs a per-layer depth semantic (a `data-depth` scale shared by
  camera, components, and QA) plus animated `filter: blur()` choreography that
  must stay deterministic under seek and cheap enough for the BeginFrame
  capture pipeline (blur is one of the most expensive CSS filters at 1080p).
- Both need new validation vocabulary (what is "in focus" at time t; what is
  occluded during an arc) — a new primitive category, exactly what the
  polish-pass cut line excluded.

## Design sketch

- Introduce `data-depth="0..1"` as the single shared depth semantic; derive
  parallax factor from it (backward compatible: `data-parallax` remains an
  alias).
- Camera world gains an optional `perspective` mode: when any scene declares an
  `orbit` move (new verb, distinct from `orbit-lite`), the world root gets
  `perspective: 1200px; transform-style: preserve-3d`, and the runtime computes
  `rotateY/rotateX` arcs around the framed target's center with the existing
  proxy-tween pattern. Cap arcs (±25–35°) so flat DOM content still reads as
  a plane being toured, not a paper cutout spinning.
- Rack focus as a typed camera *modifier*, not a move: `focus: { part, blurMax }`
  on a segment; runtime tweens `filter: blur()` on layers whose `data-depth`
  differs from the focused layer's. Enhancement-never-veto: unsupported or
  missing targets degrade to no filter.
- QA: extend motion-window suppression to orbit/focus windows; teach
  `interactionContract` to refuse cursor beats during orbit segments (or
  hit-test against the 3D-projected rect — harder, later).

## Files that will change

`cameraContract.ts` (new verb + modifier + validation),
`templates/sequences-camera.v1.js` (3D math, focus tweens),
`layoutInspector.ts` (suppression + projected-rect awareness),
`interactionContract.ts`, `motionDensity.ts` (orbit/focus as activities),
`prompts/planning-director.md` + `componentPlanningVocabulary` (vocabulary),
tests: new browser test proving deterministic seek across an orbit + focus pull.

## Risks

- Deterministic seek must hold: 3D transforms + blur must be pure functions of
  the GSAP timeline position (no physics, no rAF-time dependence).
- Render cost: blur at 1080p in headless Chromium capture; benchmark before
  committing (`VERIFY_RENDER=1 npm run film:demo` timing delta).
- Legibility: text on a rotated plane anti-aliases badly; orbit should be
  reserved for hero/graphic scenes, enforced as a validation warning.
