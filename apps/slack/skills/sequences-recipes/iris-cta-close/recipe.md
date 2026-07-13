# iris-cta-close — accent iris flood, CTA ignition, supporting line

**What it is.** The film's closing gesture: a kicker line and a ghost
(outlined) CTA pill hold the frame; an accent ring pulses once, then an accent
iris disc floods outward from behind the pill — its crisp edge sweeps past the
frame and relaxes into a subtle accent tint over the canvas. At the landing
the pill ignites to solid accent with dark ink copy and one committed pop, and
the reassurance line settles beneath. It exists because model-authored end
cards reliably ship small, timid CTAs on empty canvases; this pattern makes
the close the biggest moment of the film by construction.

**When to declare it.** Any brief that ends on a call to action, sign-up,
trial, install, or "get started" — the DEFAULT close for launch and feature
films. Declare it in the FINAL scene. The ignition is a natural PRIMARY
moment: place a declared moment at roughly `sceneStart + settleSec` with
motionIntent "resolve" or "press".

**How to stage the shot around it.**
- Final scene, calm camera: `hold` or a slow `drift`; the iris supplies the
  scene's energy. Never whip away after the ignition — leave ≥1s of read.
- The pattern owns the frame center; keep other content off the scene or in
  the margins (a small logo top-left is fine).
- The iris flood reads best arriving from a darker canvas; pair naturally
  with a warming `gradeShift` or a `flash`-free hard cut in.
- Copy discipline: `label` is the action ("Start free trial"), `sub` removes
  the friction ("no credit card"), `kicker` frames the ask.

**Slots.** `kicker` (line above), `label` (button copy — the ask), `sub`
(reassurance under the button), `accent` (a `var(--…)` brand token; vivid
tokens read best — the ignited button uses near-black ink on it),
`settleSec` (seconds after scene start when the iris lands and the button
ignites; leave ≥1s of scene after it).
