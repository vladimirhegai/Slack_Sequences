# Spatial system and browser QA

This is the spacing plan for direct HyperFrames authoring in Slack Sequences.
It is deliberately a **measurement and intent system**, not a template system:
shots may be centered, asymmetric, edge-pinned, sparse, dense, or deliberately
off-canvas without collapsing into the same grid.

## 1. What HyperFrames already does

The current production app installs `@hyperframes/core`, engine, player, and
producer at `0.6.86`. Direct authoring currently calls core's static
`lintHyperframeHtml`. The vendored HyperFrames CLI source is newer (`0.7.17`);
it is reference/source, not an installed Railway command.

The vendored browser tools already provide:

- `validate`: loads the composition in headless Chrome, records console/page/
  request failures, and samples screenshot-backed WCAG contrast five times;
- `inspect` / `layout`: seeks the deterministic timeline at default or explicit
  timestamps and reports text-box overflow, clipped text, canvas overflow,
  children escaping clipping containers, text collisions, and text occlusion;
- tween-boundary mode: collects GSAP tween starts/ends and the interval
  midpoints where transient collisions tend to appear;
- compact, collapsed JSON findings with bounding boxes, selectors, timestamps,
  severity, and fix hints;
- explicit exceptions: `data-layout-allow-overflow`,
  `data-layout-allow-overlap`, `data-layout-allow-occlusion`, and
  `data-layout-ignore`;
- optional `*.motion.json` assertions for appears-by, entrance order,
  stays-in-frame, and liveness;
- snapshots/contact sheets for visual review and for catching cross-file
  sub-composition mounting failures.

Sequences should consume those capabilities, not recreate their geometry
heuristics.

## 2. Real limits in this product

### Inspector limits

The inspector sees boxes and pixels, not artistic intention. It cannot know:

- whether a hero was meant to sit on a third or at optical center;
- whether two edges were meant to align;
- whether a marker belongs to a particular word;
- whether repeated gaps form one intentional group;
- whether off-canvas content is decoration or important copy;
- whether a cut preserves the viewer's eye trace;
- whether a composition is aesthetically too empty, generic, or repetitive.

Sampling is evidence, not proof of every continuous frame. Bounding boxes also
cannot replace a visual critic for hierarchy, balance, or optical weight.

### Slack limits

Slack cannot expose HyperFrames Studio's live keyframe/gesture editor. The
usable review loop is thread context → storyboard thumbnails → revise/undo →
approve/render. Debug guides therefore serve the authoring agent and generated
evidence; they are not a permanent Slack editing surface.

Long validation cannot occupy a Slack tool call indefinitely. It stays inside
the durable create/revise job and reports through the existing progress flow.
Compact findings—not screenshots or raw DOM dumps—go back to the author.

### Railway limits

- The container has system Chromium plus `puppeteer-core`, not the HyperFrames
  CLI or its pinned downloaded browser.
- Chromium runs headless, software-rendered, and no-sandbox in a memory-limited
  container. Inspection must reuse one page/browser and cap its sample count.
- Render-time network access is forbidden; assets, scripts, fonts, registry
  items, and inspector code must already be local.
- The installed `0.6.86` runtime and vendored `0.7.17` CLI source must not be
  mixed through an unpinned `npx` call.
- System-Chromium pixels can drift from HyperFrames' pinned local browser.
  Structural geometry is reliable enough to gate; golden pixel comparison
  should remain a separate, pinned-environment concern.

For those reasons Sequences runs the vendored HyperFrames **browser audit
script** through its existing Chromium/Puppeteer stack instead of downloading
or shelling out to another CLI version.

### Hackathon submission freeze

`0.6.86` is the submission substrate, not a version waiting to be upgraded.
All four runtime packages are exact pins, `npm ci` installs the committed
lockfile, and application startup asserts the installed versions before marking
Railway healthy. The inspector scripts are committed local files; judge
execution never calls `npx`, npm-latest, GitHub raw, or the registry.

An accidental package bump therefore fails CI/startup before it can replace a
known-good deployment. Any intentional pre-submission upgrade would have to
change the explicit compatibility constant, package manifests, lockfile,
browser-audit tests, render smoke, and Docker verification together.

## 3. Loose coordinate system in `frame.md`

Every generated `frame.md` now turns the existing edge/region/element/micro
rhythm into CSS variables:

- safe canvas inset;
- 12-column count and an adaptive gutter;
- horizontal/vertical centerlines and thirds (conceptual debug guides);
- baseline rhythm;
- display, body, and wide text measures;
- the original edge, region, element, micro, and radius values.

The 12 columns are a ruler, not twelve mandatory slots. A scene can escape them
for a bleed, transition, oversized word, camera move, or asymmetric focal
balance. The escape is deliberate when it is declared or decorative.

Small optional primitives—`.safe-area`, `.stack`, `.row`, `.anchor`, and
`.overlay`—give the author a shared vocabulary. They do not own visual style.
Settled layout belongs to Grid/Flexbox; GSAP transforms belong to motion.

## 4. Relational intent

Only relationships that matter are declared:

| Attribute | Meaning |
| --- | --- |
| `data-layout-important` | Load-bearing content must clear the safe inset |
| `data-layout-anchor="frame:center"` | Geometric or optically adjusted frame anchor |
| `data-layout-anchor="frame:left-third"` | Left/right/top/bottom third anchor variants |
| `data-layout-align="left:#hero"` | Align an edge or center axis to another stable target |
| `data-layout-attach="#word"` | Annotation/marker remains attached to its measured target |
| `data-layout-gap="x"` | Visible child gaps on this axis should be consistent |
| `data-layout-optical-x="12"` | Explicit optical offset from a geometric anchor |
| `data-layout-tolerance="16"` | Narrow per-relationship tolerance override |

This vocabulary is intentionally compatible with future component contracts.
A component's stable `parts` and `anchors` become selector targets; a shot
builder declares local relationships; the later camera/cut pass moves the shot
world without rewriting its internal geometry.

Underlines, marker strokes, and highlights should be pseudo-elements or children
of the measured text wrapper. A separate decoration is acceptable only when it
targets a stable word id with `data-layout-attach`.

## 5. Debug guides

The debug view should be injected for snapshots/agent inspection, not baked
visibly into delivery renders. It draws:

- the safe rectangle;
- 12 columns and gutters;
- horizontal/vertical centerlines;
- thirds;
- baseline rows;
- named component/continuity anchors.

The first implementation keeps the variables and declarations in the canonical
source. A follow-up can add guide-overlay snapshots and onion-skin cut evidence
without changing authored layout or the public MP4.

## 6. Publication pipeline

The direct-authoring path is now:

```text
draft
  → static HyperFrames lint + Sequences runtime invariants
  → browser runtime validation
  → HyperFrames layout audit at hero/cut/tween evidence
  → Sequences relational audit
  → bounded repair (maximum two attempts)
  → publication checkpoint
  → thumbnails/render
```

The publication checkpoint repeats browser QA so direct MCP submissions cannot
bypass it. Hard runtime, clipping, occlusion, unannotated collision/container
overflow, safe-area, anchor, alignment, and attachment errors block the
checkpoint. Missing intent and gap consistency are compact repair warnings.
Contrast and browser-console warnings remain in the QA receipt but do not spend
model retries by themselves because intentionally low-energy decorative text
otherwise creates false repair loops. A final warning-only draft may preserve
an intentional aesthetic choice.

Sample evidence includes each scene's 58% hero frame, cut boundaries, all
discoverable GSAP tween starts/ends, and interval midpoints. It is capped at 48
frames while preserving hero frames.

Repair order is:

1. reflow or widen the region;
2. wrap;
3. use `fitTextFontSize`;
4. shrink type only as a last resort.

## 7. Evolution with cut-based planning and component builders

The spatial contract sits below the future director/builders:

1. The director owns story, shot windows, eye-trace, and cut anchors.
2. Component builders own internal parts, actions, states, and stable anchors.
3. Shot builders compose copy/background/components and declare only important
   local relationships.
4. A central camera/cut pass transforms the shot world and validates continuity.
5. Browser QA samples hero frames and both sides of cuts; the visual critic uses
   snapshots for hierarchy and optical judgment.

This keeps creative range broad. A cinematic poster, split product demo,
kinetic-type field, and centered logo resolve can all use the same measurement
language without sharing the same placement.

## 8. Next increments

- Inject a guide overlay into debug snapshots and attach the guide/contact sheet
  only to internal authoring evidence.
- Emit `*.motion.json` from the future motion plan so HyperFrames can check
  entrance order, in-frame motion, and liveness.
- Add component-anchor and cut/onion-skin checks when component contracts and
  `motion-plan.json` land.
- Persist compact QA JSON per revision for Slack receipts and targeted repair
  history.
- Move from system Chromium to a pinned browser artifact if pixel-golden
  reproducibility becomes a release requirement.
