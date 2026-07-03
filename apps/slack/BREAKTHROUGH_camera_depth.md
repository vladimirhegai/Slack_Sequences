# BREAKTHROUGH — Camera depth: true orbit + rack focus

Status: **level 1 + rack focus BUILT 2026-07-03.** `orbit` is a live
`CameraMoveStyle` (`arcDeg` clamped 8–35, default 28): perspective on the
scene wrapper + a `rotateY` sandwich on the flat world plane that returns to
rest, counted as a high-energy peak by `auditCameraEnergy`, with a
deterministic validation error when a cursor interaction overlaps an orbit
window (`validateInteractionContract`). Rack focus is a typed `focus`
modifier on any camera segment (`{part|depth, blurMaxPx ≤ 10}`): the runtime
pulls a tweened focal plane across `data-depth` layers (`data-parallax` is
now an alias; blur caps at 4 layers and lands on layers, never the world).
Proven by `test/cameraDepth.browser.test.ts` (3D transform + focus blur,
byte-identical under out-of-order seek) plus a paid live create. Level 2
(translateZ under preserve-3d) remains fenced off as planned. Originally
re-scoped 2026-07-03 after a code audit and a live GLM 5.2 probe (see
"Evidence").

## Problem (unchanged)

Two premium shot types are impossible today:

1. **True orbit reveal** — the camera arcs around a subject. Today's
   `orbit-lite` is a flat ±7° 2D rotation sandwich around the viewport center
   (`templates/sequences-camera.v1.js:79` `ORBIT_DEG`, `:280-295`).
2. **Rack focus** — pulling focus between depth layers. No focal-plane
   concept exists; `data-parallax` encodes only translation counter-motion
   (factor `1 - depth`, `sequences-camera.v1.js:214-220`).

## Corrected scope — what the audit changed

The original doc claimed 3D "invalidates the assumptions `layoutInspector.ts`
uses" and breaks `interactionContract` hit-testing. **Mostly false:**

- `layoutInspector` already suppresses static-layout heuristics during full
  camera moves (`cameraMotionWindows`, wired at `layoutInspector.ts:1415-1422`),
  skips anchor checks for any element inside a transformed world (`movedWorld`,
  `:385-402`), and drops findings for off-frame world stations (`:1299-1329`).
  `getBoundingClientRect` returns the *projected* box of a 3D transform, so
  the off-frame math keeps working. A new `orbit` verb added to
  `CAMERA_FULL_MOVES` inherits all of this suppression automatically.
- The cursor is already forced to live in a `data-camera-overlay` *outside*
  the world (`layoutInspector.ts:783-802` + the interaction runtime's own
  check), and targets are measured live via `getBoundingClientRect`, which
  projects 3D. Hit-testing does not break; precision merely degrades on a
  rotated plane. The cheap correct rule: a **validation error** when a cursor
  interaction's time window overlaps an `orbit` segment in the same scene —
  both are typed and time-windowed, so this is trivial Node-side arithmetic
  (put it in `validateInteractionContract`, which already receives scenes).
- Scene-boundary cuts animate the scene *wrappers*, outside the world plane —
  unaffected by world-level 3D.

**The landmine the original plan missed:** CSS `filter` on an element forces
3D flattening of its children (it creates a containing block and kills
`transform-style: preserve-3d`). The whip motion-blur already sets
`world.style.filter` (`makeWhipBlur`, `sequences-camera.v1.js:153-161`). So:

- **Level 1 (ship first):** rotate the flat world plane itself. `perspective`
  goes on the scene wrapper; the world gets a `rotateY` sandwich; children
  stay flat (no `preserve-3d` needed). Whip blur keeps working. This already
  reads as "a plane being toured" — the premium look at a fraction of the risk.
- **Level 2 (separate follow-up):** per-layer `translateZ` from `data-depth`
  for true depth parallax under orbit. Requires `preserve-3d` on the world →
  whip blur must move to an inner wrapper (or be disabled in 3D scenes), and
  the world + ancestors must keep `overflow: visible`. Do not bundle this
  with level 1.

## Design

### Shared depth semantic

`data-depth="0..1"` on layers; derive the parallax factor from it so
`data-parallax` becomes an alias (keep the existing `1 - depth` translation
factor to stay backward compatible). One vocabulary shared by camera,
components, and QA.

### `orbit` — new camera verb (level 1)

- Schema: new `CameraMoveStyle` `"orbit"`, optional `arcDeg` (cap 25-35°,
  default ~28). Join `CAMERA_MOVES`, `CAMERA_FULL_MOVES`, `MOVE_DEFAULTS`
  (ease `seqGlide`, zoom ~1.06 like orbit-lite). `orbit-lite` stays untouched.
- Runtime: extend the camera proxy `{x,y,z,r}` with `ry`. `apply()`
  (`sequences-camera.v1.js:201-221`) already has the 2D rotate sandwich around
  the viewport center; the 3D version is the same sandwich with `rotateY`,
  plus `perspective: 1200px` set on the scene wrapper when the scene's plan
  contains an orbit. The framed subject is centered by `frameState`, so
  rotating about the viewport center orbits the subject. All values stay pure
  functions of tweened proxies (`fromTo` + `immediateRender:false`), so
  deterministic seek holds by construction.
- `frameState`/`layoutRect` need **no change** — they measure via the offset
  chain (`:92-107`), which is transform-immune by design.
- Energy: count `orbit` as a full move (framing-density floor,
  `compositionRunner.ts:1966-1984`) and as a high-energy peak in
  `auditCameraEnergy` (`cameraContract.ts:606`). `motionDensity` picks the new
  verb up automatically because it iterates resolved segments.

### Rack focus — a segment *modifier*, not a move

`focus: { part?, depth?, blurMaxPx }` on any `CameraSegmentV1`. The live probe
supports modifier-on-segment: GLM naturally attached `focus` to consecutive
segments to stage a two-step attention pull (blur the background inbox, then
focus the draft text) without being shown an example.

- Runtime: resolve the focused layer's depth; for every `data-depth` layer,
  `blur = blurMaxPx * |layerDepth - focusDepth(t)|` where `focusDepth` is a
  tweened proxy — a pure function of timeline position, cleared at rest
  (exactly the `makeWhipBlur` pattern). Blur applies to *layers*, never the
  world element (avoids the flattening landmine and the whip-blur collision).
- Degrade: unknown part/depth, or a scene with no `data-depth` layers →
  compile no filter tweens. Enhancement-never-veto.
- Clamp `blurMaxPx` ≤ 10 and layers-per-scene ≤ 4 at normalization.

### Planner + author vocabulary

The camera vocabulary lives in the storyboard `basePrompt` inside
`compositionRunner.ts` (~line 2364, "CAMERA RIG" block) — **not** in
`prompts/planning-director.md` alone, which is the authoring side. Both need
updates: the storyboard prompt gets `orbit` (+"reserve for one hero/graphic
scene, never text-heavy") and `focus`; the authoring prompt gets the
`data-depth` layer markup contract (which layers to mark, that the kit owns
blur/perspective, author owns placement).

## Files that change (verified)

- `cameraContract.ts` — verb + `arcDeg` + `focus` modifier in schema,
  normalization, `parseCameraPlan`, `validateCameraContract` (focus part must
  exist scene-scoped, same pattern as `toPart`), `auditCameraEnergy`,
  `MOVE_DEFAULTS`.
- `templates/sequences-camera.v1.js` — `ry` proxy + perspective setup + focus
  blur compile.
- `compositionRunner.ts` — storyboard basePrompt vocabulary; authoring prompt
  additions land via its prompt-assembly path + `prompts/planning-director.md`.
- `interactionContract.ts` — orbit-window vs cursor-window overlap error.
- `layoutInspector.ts` — nothing mandatory (suppression inherited); optional:
  flag text-heavy content inside an orbiting world as a legibility warning.
- Tests: browser test proving deterministic seek across an orbit + a focus
  pull (seek out of order, assert identical transforms/filters), plus
  normalization unit tests.

## Order of work

1. `data-depth` alias + rack focus (pure enhancement, no 3D at all — ship
   independently; it works with today's 2D camera).
2. `orbit` level 1 (world-plane rotation, perspective on scene wrapper).
3. Benchmark: `VERIFY_RENDER=1 npm run film:demo` timing delta with a ramped
   focus pull + orbit in the fixture. Blur precedent already exists in
   production — zoom cuts tween `blur(18px)` on whole scene wrappers and whips
   `blur(7px)` on the world through the same software-GPU screenshot pipeline
   (`renderDirectComposition` forces `browserGpuMode: "software",
   forceScreenshot: true`) — so cost is a measured risk, not an unknown; the
   new part is blur *sustained over seconds on multiple layers*.
4. Level 2 (translateZ depth under preserve-3d) as its own plan, only if
   level 1 lands and the whip-blur relocation is designed.

## Risks

- **Filter-vs-3D flattening** is the structural risk; it is why level 2 is
  fenced off. Any future feature that puts `filter` on the world element
  breaks preserve-3d children silently.
- Deterministic seek: keep everything a pure function of tweened proxies; no
  physics, no rAF-time dependence. The existing camera runtime is the
  template — follow it literally.
- Legibility: text on a rotated plane anti-aliases badly; enforce
  "orbit is for hero/graphic scenes" as a storyboard validation warning
  (probe: GLM already self-restrained to the logo scene when told).
- Render cost of sustained blur at 1080p under software rasterization —
  benchmark before committing (step 3), cap `blurMaxPx` and layer count.

## Evidence (2026-07-03 live probe, z-ai/glm-5.2 via OpenRouter)

- Offered `orbit` with the hero-scene restriction, GLM used it exactly once,
  on the logo-resolve scene, `arcDeg: 30` — correct self-restraint.
- Offered `focus` as a segment field, GLM staged a two-segment rack pull
  (defocus background → track + focus on the draft) — sensible unprompted
  choreography; the modifier-on-segment shape is the right schema.
