# PLAN — Camera depth level 2 (translateZ under preserve-3d) — NOT BUILT

Level 1 (true `orbit` verb) and rack focus shipped 2026-07-03 and are
documented in ROADMAP ("camera depth v1") and CLAUDE.md; the browser proof is
`test/cameraDepth.browser.test.ts`. This file keeps only the **unbuilt**
follow-up so the fence and its reasons survive the cleanup of the original
breakthrough doc.

## Goal

Per-layer `translateZ` derived from `data-depth` for true depth parallax under
orbit: layers separate in Z while the camera arcs, instead of today's flat
world-plane rotation.

## Why it is fenced off (the structural landmine)

CSS `filter` on an element forces 3D flattening of its children (it creates a
containing block and kills `transform-style: preserve-3d`). The whip
motion-blur sets `world.style.filter` (`makeWhipBlur`,
`templates/sequences-camera.v1.js`). Therefore:

- Level 2 requires `preserve-3d` on the world → **whip blur must first be
  relocated to an inner wrapper** (or disabled in 3D scenes), and the world +
  ancestors must keep `overflow: visible`.
- Any future feature that puts `filter` on the world element silently breaks
  preserve-3d children. Rack focus already respects this: blur lands on
  *layers*, never the world.

## Order of work (when picked up)

1. Design and land the whip-blur relocation on its own (inner wrapper carries
   the filter; world stays filter-free). Prove whips still read identically in
   `film:demo`.
2. Add `preserve-3d` + per-layer `translateZ = f(data-depth)` behind a scene
   plan flag; keep every value a pure function of tweened proxies so
   deterministic seek holds by construction.
3. Extend `test/cameraDepth.browser.test.ts` with an out-of-order-seek proof
   over a 3D-separated orbit.
4. Benchmark software-rasterized render cost (sustained multi-layer transforms
   at 1080p) before enabling by default.

## Risks carried over from the original audit

- Deterministic seek: no physics, no rAF-time dependence — the existing camera
  runtime is the template, follow it literally.
- Legibility: text on rotated planes anti-aliases badly; `orbit` stays
  reserved for hero/graphic scenes (already enforced as prompt guidance).
- Cursor interactions never overlap an orbit window
  (`validateInteractionContract` error — already live for level 1).
