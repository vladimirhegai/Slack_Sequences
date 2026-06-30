# TODO — Core HyperFrames Authoring

The foundation (Slack workflow, two-tier delivery, both MCP planes, OAuth) is
done. This is the **core creative engine** work — making the bot produce genuinely
good videos by authoring HyperFrames directly instead of compiling constrained
Sequences Plans.

Target: [ARCHITECTURE.md](ARCHITECTURE.md). Two bots: [CLAUDE.md](CLAUDE.md).

> **Guiding principle (verified against the vendored engine):** HyperFrames
> already owns the composition model, animation runtime, `frame.md`, website
> capture, a 50+ component registry, `media-use` audio/asset resolution, and
> lint/validate/render. Build *around* it. See ARCHITECTURE.md §"What HyperFrames
> already provides (the build boundary)". Two caveats drive the new work below:
> the **registry catalog and HeyGen media are network-only, not vendored** (§9),
> and **Studio's editor is human-only** (our surface is the Slack
> audition→revise→critic loop). Every item here must be **testable in Slack**.

Legend: `[x]` done · `[~]` partial · `[ ]` not started · ⚠ **improve** = shipped
but has a known upgrade, noted inline.

---

## 1. End-to-end HyperFrames authoring spike

The single most important task. Prove the loop before generalizing.

- [x] **Direct composition authoring.** `/sequences` → context bot gathers
  workspace evidence → planning bot (OpenRouter/DeepSeek) writes an actual
  HyperFrames composition (HTML/CSS/JS scenes, not a Sequences `Plan` JSON) →
  rendered through the existing Chrome/FFmpeg pipeline. One brief, one good output.
- [x] **New planning prompt.** System prompt in `prompts/planning-director.md`
  that instructs the bot to author HyperFrames directly. Replaces the current
  `buildPlanPrompt` from `@sequences/core` (frozen, overly constrained).
- [x] **Composition validation gate.** The bot authors freely; a deterministic
  gate validates the output before it reaches Slack (lint, inspect, duration check,
  seek-safe, local assets, finite timeline). Invalid = one bounded retry or error,
  never silent aesthetic rewrite.
- [x] **Wire into the existing two-tier delivery.** The authored composition flows
  through the same thumbnail → render → upload path. `/sequences demo` stays
  deterministic and untouched as the bulletproof fallback.
- [x] **Bound authoring cost and truncation.** OpenRouter code emission runs with
  reasoning explicitly off (DeepSeek V4 otherwise maps medium/minimal to costly
  high reasoning), receives a 10K completion ceiling with a 32K-character source
  target, and sees ~28K rather than 45K characters of retrieved craft context.
  The primary model authors every required artifact and repair by default; Flash
  is limited to the optional frame decision, which has a deterministic fallback.
  Operators may explicitly configure a separate exact-patch model; by default
  creative authoring and the rare structural repair stay on DeepSeek. Cursor
  geometry repairs are deterministic, and OpenAI is never selected implicitly. Storyboard
  and patch payloads use provider-native strict JSON schemas. Repair calls emit
  bounded exact patches (4K ceiling), not another full document; every uniquely
  addressable edit survives even if a sibling edit is ambiguous. OpenRouter
  `finish_reason=length` retains the partial source and continues it through an
  assistant prefill, so provider output ceilings no longer consume repair turns.
  Compact full-document regeneration remains the fallback when no partial source
  is available.
- [x] **Storyboard-first, frame-validated multi-shot authoring.** Create now runs
  a bounded reasoning-off pass on the primary model that locks a validated 3–5
  shot cut graph before source authoring. Every shot declares foreground,
  background, camera intent,
  capability choices, continuity anchor, and outgoing cut; commits persist
  `STORYBOARD.md` + `motion-plan.json`. Static publication QA now checks the
  authored source against committed `frame.md` accent/font facts and returns
  softer palette/type misses as bounded repair warnings.

## 2. Revised architecture laws as the planning prompt

Undo the creativity-limiting "9 laws" from Sequences/Forge that produced sub-par
results. The revised laws (ARCHITECTURE.md §"Revised architecture laws") become
the planning bot's actual system prompt.

- [x] **Write `prompts/planning-director.md`.** The revised laws as actionable
  agent guidance: transactional revisions, canonical source flow, bounded freedom
  (not token-purity — let it use real CSS/GSAP numbers in vetted recipes),
  validation gates publication, explicit repairs, registry-driven prompts, raw
  motion behind an authoring boundary, scoped capabilities.
- [x] **Tone and creative direction.** The prompt should push for strong visual
  opinions — not safe/generic output. SaaS motion that looks like it was made by
  a motion designer, not a template engine.
- [x] **Craft-specific guidance.** Scene composition density (3-layer model,
  8–10 elements per scene, background/midground/foreground), typography rules
  (embedded fonts only, weight/size for video, pair across boundaries), motion
  variety (vary eases/entrances/speed, build/breathe/resolve structure), color
  commitment (one accent hue, tint neutrals, no flat solids), and anti-patterns
  to question (AI-video tells like gradient text, centered parades, same-ease
  everywhere).
- [x] **Feed it `frame.md` + the capability index.** The director receives the
  per-job `frame.md` and the pinned, registry-backed offline capability index.
  Palette/type remain bounded without limiting motion, and known registry
  structures now outrank rebuilding from scratch.

## 3. Design system — `frame.md` per job

Each video job gets a `frame.md` that governs its visual identity. One bounded
art-direction decision chooses mood, harmony, typography, and spatial character;
deterministic tools extract brand truth, derive tokens, validate safety, and
record repairs. **Highest visual-quality lever; deterministic tools, not
deterministic answers.**

- [x] **Frame preset library.** Five curated SaaS presets in
  [`src/engine/framePresets.ts`](src/engine/framePresets.ts) (clean-corporate,
  dark-premium, editorial, bold-launch, crisp-dev) distilled from the upstream
  `frame-presets/` taste library but expressed on the renderer's embedded fonts
  (the upstream FRAME.md fonts would silently fall back).
- [x] **Deterministic brand extraction + design tools.** [`brandTokens.ts`](src/engine/brandTokens.ts)
  extracts colours/fonts/URL/logo from the evidence pack (frequency-ranked, neutral
  detection, font→embedded alias map); [`brandCapture.ts`](src/engine/brandCapture.ts)
  optionally captures palette/fonts from a product URL reusing HyperFrames' capture
  approach (best-effort, gated by `SLACK_BRAND_CAPTURE`). [`frameTools.ts`](src/engine/frameTools.ts)
  generates harmony-aware semantic palettes, validates/repairs exact colour
  proposals, enforces WCAG contrast and embedded fonts, and turns density,
  spacing, corner, and depth choices into bounded spatial tokens.
- [x] **`frame.md` content.** [`frameDesign.ts`](src/engine/frameDesign.ts)
  `renderFrameMd` emits a compact operational frame.md: visual thesis, semantic
  colours with safe text/surface pairings, display/body/mono type,
  spacing/radius/shadow, background family, ≤5 do/don't, brand exceptions, and a
  metadata header for round-tripping.
- [x] **Feed `frame.md` into the planning bot.** `compositionRunner` injects a
  `<frame_md>` block; `planning-director.md` distinguishes hard brand/font/contrast
  constraints from tunable palette and spatial recommendations (motion stays
  free). Create builds it; revise reuses the create-time frame.
  (Closes the §2 improve item's frame.md half.)
- [x] **One bounded art-direction decision.** `chooseFrame` treats presets as mood
  boards and chooses basis, harmony, neutral temperature, contrast, accent use,
  embedded type roles, density, spacing, corners, depth, optional semantic colour
  proposals, and brand exceptions. Deterministic derivation/validation follows,
  with a complete keyword/tone-ranked fallback when the decision is unavailable.
- [x] **Slack test.** Verified via smoke: `/sequences` on a brand-y brief →
  authored composition binds `--accent:#1E2BFA` + the preset palette/embedded
  fonts; the chosen `frame.md` is shown in the result message and attached to the
  thread (`uploadFrame` in [`src/index.ts`](src/index.ts)).
  The attached public copy is now a concise visual-system digest with design
  direction, richer palette guidance, and composition cues; machine-facing
  authoring guidance, layout attributes, provenance, and repair reports stay in
  the canonical job file only.

## 4. Skills retrieval for HyperFrames

The planning bot should receive only the knowledge it needs for a specific
scene — not the entire skill catalog.

- [x] **Structured skill retrieval.** Replaced generic SKILL.md excerpting with
  direct reference inclusion: composition skeleton, determinism rules, data
  attributes, embedded fonts table, complete blueprint/rule indexes (all 15
  blueprints, all 30+ rules with one-line summaries), and full recipe content
  for keyword-selected blueprints (up to 4) and rules (up to 8). Budget: 45K
  chars for create, 22K for revise — generous for DeepSeek.
- [x] **Blueprint/rule selection.** Deterministic keyword router covers all 15
  blueprints (expanded from 8) and derives associated rules. Create always
  includes kinetic-type-beats, cta-morph-press, spring-pop-entrance, and
  sine-wave-loop as defaults. Additional matches by brief keywords.
- [x] **Skill context for revision.** Revise prompts receive the current
  storyboard + canonical HTML and only revision-relevant skills/recipes with
  a tighter 22K budget.
- [x] **Registry-aware retrieval.** `agent/skillContext.ts` queries the synced
  index first and exposes the complete compact catalog plus scored job matches:
  109 blocks, 25 components, 15 blueprints, motion rules, and frame presets.
  This covers x-post/data-chart, captions, shader transitions, code, maps, VFX,
  and the local craft vocabulary without author-time network access.

## 5. Cut-centered motion direction

Planning begins with the edit, not with isolated pretty scenes. This is the core
of ARCHITECTURE.md §5.

- [x] **Storyboard-first planning.** The director writes `STORYBOARD.md` (human-
  reviewable intent) + `motion-plan.json` (validated timing, assets, recipes,
  components, continuity). Each shot declares purpose, time window, foreground,
  background, recipe/blueprint, camera intent, and outgoing cut.
- [x] **Cut graph.** Each cut declares what the eye tracks across the boundary:
  a component, anchor, direction, color field, or semantic idea. Cuts drive
  continuity — scenes don't exist in isolation.
- [ ] **Execution passes** (separated to prevent transform fights):
  1. Lock story, shots, cut graph against available assets.
  2. Reuse or build required components.
  3. Compose foreground, background, copy inside each shot.
  4. Add one camera transform at the shot/world level.
  5. Resolve cuts and continuity anchors across boundaries.
  6. Add only necessary micro-motion, then validate.
- [ ] **Per-shot dispatch.** The director sees the whole edit; bounded builders
  each receive only their shot, assets, component contracts, and selected rules.
  A central camera/cut pass preserves continuity.
- [ ] **Slack test.** The `STORYBOARD.md` is posted to the thread *before* the
  render so the user can approve/revise the cut plan, not just the final MP4.

## 6. Music and sound direction (cue layer over HyperFrames beats)

⚠ **Narrowed** from "integrate Brag wholesale." HyperFrames already does beat
detection, asset freezing, and FFmpeg mixing (`media-use` + engine) — do **not**
rebuild those. Sequences adds the musical-direction layer only. (ARCHITECTURE §11.)

- [ ] **Edit-structure analysis (deterministic).** Above HF beat detection, derive
  intro/build/drop/resolve sections, a cut-density curve, an energy envelope,
  protected narration zones, accent beats, and an SFX budget.
- [ ] **Cue assignment to the cut graph.** Each §5 cut / major transition gets an
  optional matched sound, assigned by transition character. Provenance-clean via
  `media-use` (BGM/SFX) — license-checked before it ships.
- [ ] **Mix in the render pass.** Reuse the engine FFmpeg mix; Brag, if adopted,
  is scoped to cue selection only.
- [ ] **Slack test.** A rendered MP4 carries beat-synced whooshes/impacts on its
  cut points; toggleable so the silent path still works.

## 7. SaaS motion examples (retrieval seed)

- [ ] **Curate 3–5 real SaaS-motion examples.** Hand-authored, provenance-tracked
  HyperFrames compositions that demonstrate the quality bar. These become
  retrieval/inspiration material for the planning bot — not templates to fill in.
  Register them into the §9 capability index alongside the synced registry items.
- [ ] **Example diversity.** Cover different motion profiles: a crisp dev-tool
  launch, a warm startup announcement, a bold product rebrand. Different shot
  counts, different component types.

## 8. Component contracts (Forge Stage-inspired)

- [ ] **Source-derived contracts.** Each component (search box, dashboard, card,
  phone screen, chart) ships parts, layers, variables, actions, states, and
  anchors — derived by parsing the authored source, not model-claimed. Keep it
  minimal: add parts/actions/states only where a recipe actually needs them.
- [ ] **Morph continuity.** Twin components with shared `morphGroup`, stable part
  IDs, and matching anchors. A checker rejects impossible pairings before
  composition. HyperFrames implements the handoff (scale-swap, card-morph-anchor,
  velocity-matched cut).

---

## 9. Capability index + registry sync + in-Slack audition ← biggest gap

The duplicate-building problem this whole pass exists to fix. The bot must *see*
everything HyperFrames already offers before it authors anything. (ARCHITECTURE §9.)

- [~] **Registry sync (deterministic).** `npm run capabilities:sync` pulls the
  manifest + all 134 block/component `registry-item.json` records from the pinned
  `0.7.17` skill-snapshot commit and emits a provenance-tracked offline index.
  Production packages remain frozen at `0.6.86`. Still missing: vendoring and
  compatibility-approving reusable item source files themselves.
- [~] **Normalized capability index.** One schema now covers registry blocks/
  components (including transition blocks), animation rules, blueprints, and
  frame presets with previews, tags, variables, dimensions/duration,
  dependencies, provenance, and reuse tier. Still missing: job components,
  Sequences recipes, local contact sheets, required-input/anchor contracts, and
  compatibility quality scores.
- [x] **Capability-aware retrieval.** Extend `agent/skillContext.ts` from
  skills-only to query the index first — reuse outranks invention. (Closes §4's
  improve item.)
- [ ] **In-Slack audition.** Block Kit candidate thumbnails per shot with
  *Use this · Use structure only · Blend A+B · Build custom · Why this?* actions.
  Reuses two-tier delivery + thumbnail upload. **Directly demoable in Slack.**

## 10. Visual critic + continuity QA (ARCHITECTURE §10)

§8 (and §1's gate) check technical correctness; this checks *film* quality.

- [ ] **Visual critic over rendered evidence.** Sample boundary/midpoint snapshots;
  flag weak focal hierarchy, dead/overcrowded regions, tiny text, collisions/crop
  risk, palette drift from `frame.md`, repeated composition/ease/entrance, frozen
  time after an early reveal, broken eye-trace across a cut, fg/bg transform
  coupling, cursor paths that miss. Output one **bounded, shot-specific** repair
  request — never global "make it better."
- [ ] **Continuity tooling (deterministic).** Anchor visualizer, before/after cut
  onion-skin, focal-trajectory view, morph-compatibility checker (§8).
- [x] **Deterministic cursor contract and QA.** Stable scene parts, typed
  interaction intent, measured hotspot/target/ripple geometry under camera
  transforms, interaction-time sampling, out-of-order seek checks, hard miss /
  occlusion / camera-coupling failures, guide evidence, and Flash-routed safe
  interaction revisions are implemented. The broader aesthetic critic remains.
- [ ] **Slack test.** Critic findings post as a short receipt; an auto-repair of
  one flagged shot re-renders and updates the message in place.

### Spatial foundation (implemented before the visual critic)

- [x] **Loose `frame.md` coordinate system.** Existing edge/region/element/micro
  rhythm now emits safe inset, 12-column/gutter, baseline, text measures, and
  optional safe-area/stack/row/anchor/overlay CSS primitives. These are guides,
  not required slots.
- [x] **Relational scene intent.** The authoring contract supports important
  safe-area content, frame center/third anchors, selector-to-selector alignment,
  attached annotations, consistent group gaps, and explicit optical offsets.
- [x] **Browser publication gate.** Direct drafts run runtime validation plus
  the vendored HyperFrames browser layout audit at hero, cut, tween-boundary,
  and midpoint evidence (48-frame cap), followed by Sequences-only relational
  checks. Runtime/document health is the hard publication line; visual layout,
  contrast, overlap, and occlusion findings feed bounded repair guidance and
  never discard the last browser-valid draft.
- [x] **Underline/marker contract.** Decorations attach to a measured word
  wrapper/pseudo-element, with `data-layout-attach` for the exceptional separate
  element.
- [x] **Interaction guide snapshots.** Persist an internal safe-area/part/
  target/cursor overlay as `qa/spatial-guide.png`, kept out of delivery renders.
- [ ] **Full Figma-like layout guides.** Add columns, thirds, baseline, and cut
  anchors to contact sheets beyond the interaction-focused guide.
- [ ] **Motion-plan sidecars.** Emit HyperFrames `*.motion.json` assertions from
  future cut-centered planning for appears-by, order, stays-in-frame, and
  liveness checks.

## 11. Deterministic utilities · component foundry · library learning (P1/P2)

- [ ] **Deterministic composition utilities (P1).** Optical-center snap, safe-area
  align/distribute, hierarchy-preserving text fit, responsive aspect variants
  (16:9 / 9:16 / 1:1), SVG viewbox normalization, device/window frame generation,
  chart-data import, cursor-path planning, seeded background generation, local-font
  matching, raster-cost warnings for heavy shadow/blur.
- [x] **Cursor-path planning foundation.** `cursor-interaction-v1` is a local
  capability/recipe with a versioned runtime and component-part-compatible
  bindings. The remaining utilities above are still open.
- [ ] **Component foundry (P1).** When no registry item fits: import screenshot/
  DOM/SVG/mock → segment parts → assign stable IDs/anchors → identify states/
  actions → split subject/backdrop/overlay → emit a native sub-composition →
  render state contact sheets → register in the capability index for reuse.
- [ ] **Library learning (P2).** After a video is *approved* (never raw drafts),
  capture the selected recipe, edits made, rejected alternatives, working
  parameter ranges, critic findings, and final snapshots; promote reusable
  shots/components back into the SaaS library + capability index.

---

## Build order (hackathon-pragmatic)

§1 and §3 are done. Highest leverage next, in order:

1. **§9 capability sync + in-Slack audition** — the thing that stops the bot
   rebuilding what HyperFrames already ships, and the most demoable feature.
   Closes §4's improve item (and the §2 improve item's remaining capability-index half).
2. **§5 cut-centered planning** — makes it an *edit*, not pretty isolated scenes.
4. **§10 visual critic + continuity** — cheap, high ROI; raises the floor.
5. **§6 music/sound cues, §11 utilities/foundry/learning** — polish; do if time.

The demo only needs: real workspace thread → on-brand video with good motion that
visibly *reused* known-good blocks → revision → share. Not every feature above.
