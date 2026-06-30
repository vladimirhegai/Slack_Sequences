---
name: cursor-click-ripple
description: Semantic cursor movement, synchronized press, and ripple feedback resolved from a real UI target.
metadata:
  tags: cursor, click, ripple, interaction, mouse, button, geometry
---

# Cursor Click Ripple

A visible pointer approaches a real UI target, settles, presses it, and emits
feedback from the exact pointer hotspot. In Slack Sequences this is a
`cursor-interaction-v1` recipe: creative direction remains authored, while
coordinates are measured deterministically from the target.

## Creative decisions

Choose:

- the stable target part and its role in the story;
- entry anchor or previous part;
- direct, arc, human, or custom normalized path;
- bend, ease, travel time, settle, press, release, and result hold;
- a normalized human aim within the target plus a small optical offset;
- press, ripple, combined, custom, or no feedback.

Do not choose canvas endpoint coordinates. A few pixels of human aim is an
offset within the target, not a guessed screen position.

## Scene structure

```html
<section
  id="cta"
  class="scene clip"
  data-scene="cta"
  data-start="8"
  data-duration="4"
  data-track-index="1"
>
  <div data-camera-world>
    <button data-part="primary-action">Start now</button>
  </div>
  <div data-camera-overlay>
    <svg
      data-cursor-id="main-pointer"
      data-cursor-hotspot-x="0.12"
      data-cursor-hotspot-y="0.08"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >...</svg>
    <div data-part="primary-action-ripple" class="ripple"></div>
  </div>
</section>
```

```css
[data-camera-world],
[data-camera-overlay] {
  position: absolute;
  inset: 0;
}

[data-cursor-id] {
  position: absolute;
  left: 0;
  top: 0;
  width: 32px;
  height: 32px;
  pointer-events: none;
  z-index: 100;
}

.ripple {
  position: absolute;
  left: 0;
  top: 0;
  width: 72px;
  height: 72px;
  border: 2px solid var(--accent);
  border-radius: 50%;
  pointer-events: none;
  opacity: 0;
}
```

The cursor must be a direct child of `data-camera-overlay`. Product content and
camera transforms belong in the sibling `data-camera-world`. Never put
`data-layout-ignore` on an active cursor, target, or ripple.

## Interaction plan

The cut-first storyboard declares the intent. The builder copies it exactly into
the composition's JSON island:

```html
<script src="gsap.min.js"></script>
<script src="sequences-interactions.v1.js"></script>
<script type="application/json" id="sequences-interactions">
{
  "version": 1,
  "interactions": [{
    "version": 1,
    "id": "cta-click",
    "sceneId": "cta",
    "cursorId": "main-pointer",
    "targetPart": "primary-action",
    "action": "click",
    "startSec": 9,
    "arriveSec": 9.72,
    "pressSec": 9.86,
    "releaseSec": 10.02,
    "holdUntilSec": 10.8,
    "from": "frame:bottom-right",
    "path": "human",
    "bend": -0.12,
    "ease": "power3.out",
    "aimX": 0.56,
    "aimY": 0.48,
    "offsetX": 3,
    "offsetY": -2,
    "hitInsetPx": 4,
    "feedback": "press-ripple",
    "ripplePart": "primary-action-ripple",
    "cursorScale": 0.84,
    "targetScale": 0.95
  }]
}
</script>
```

After all target and camera tweens have been authored:

```js
SequencesInteractions.compile(tl, document.getElementById("root"));
window.__timelines["launch"] = tl;
tl.seek(0);
```

Compilation is last so the cursor reads target geometry after camera/world
transforms at every deterministic seek. The helper resolves the cursor hotspot,
target anchor, drag endpoint, synchronized scale, and ripple origin from one
measurement.

## Timing guidance

- Travel: 0.4–1.0 seconds.
- Settle before press: 0.08–0.30 seconds.
- Press down: 0.06–0.12 seconds.
- Release: 0.10–0.20 seconds.
- Result hold: at least 0.6 seconds; at least 1 second for a climax.
- Cursor scale: 0.80–0.90.
- Target scale: 0.92–0.97.

Use `power3.out` for a decisive soft landing, `power2.inOut` for considered
movement, or a restrained arc/human path for authored character. Avoid elastic
endpoint overshoot that visibly leaves the target before press.

## Hard constraints

- One paused, finite GSAP timeline; never real pointer/click events.
- No guessed endpoint coordinates or separate target/ripple coordinate systems.
- No second GSAP x/y tween on a runtime-owned cursor.
- Cursor hotspot must be within the inset target hit region at arrival and press.
- Ripple center must match the hotspot within two pixels.
- Cursor uses `pointer-events:none` and remains outside `data-camera-world`.
- Custom motion keeps the semantic intent and must pass the same browser QA.

## Combinations

- `physics-press-reaction` for the tactile vocabulary; the interaction runtime
  owns the actual synchronized geometry.
- `camera-cursor-tracking` when the product world follows the interaction while
  the cursor remains in screen space.
- `scale-swap-transition` when the click resolves into a new state.
- `ambient-glow-bloom` for restrained release feedback.
