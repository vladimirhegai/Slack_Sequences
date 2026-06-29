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
- [ ] ⚠ **Improve — multi-shot, not one composition.** Authoring currently emits a
  single canonical HTML composition. Move toward storyboard-first, multi-shot
  authoring (§5) and validate the output against the job `frame.md` (§3), not just
  the technical gate.

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
- [~] ⚠ **Improve — feed it `frame.md` + the capability index.** The director now
  receives a per-job `frame.md` (§3 — done), so palette/type are constrained without
  limiting motion. Still missing: the registry-backed capability index (§9) — the
  prompt says "registry-driven" but the bot can't see the registry yet.

## 3. Design system — `frame.md` per job

Each video job gets a `frame.md` that governs its visual identity. The designer
(a deterministic step + one small model decision) picks a preset and applies brand
overrides. **Highest visual-quality lever; mostly deterministic.**

- [x] **Frame preset library.** Five curated SaaS presets in
  [`src/engine/framePresets.ts`](src/engine/framePresets.ts) (clean-corporate,
  dark-premium, editorial, bold-launch, crisp-dev) distilled from the upstream
  `frame-presets/` taste library but expressed on the renderer's embedded fonts
  (the upstream FRAME.md fonts would silently fall back).
- [x] **Deterministic brand remapping.** [`brandTokens.ts`](src/engine/brandTokens.ts)
  extracts colours/fonts/URL/logo from the evidence pack (frequency-ranked, neutral
  detection, font→embedded alias map); [`brandCapture.ts`](src/engine/brandCapture.ts)
  optionally captures palette/fonts from a product URL reusing HyperFrames' capture
  approach (best-effort, gated by `SLACK_BRAND_CAPTURE`); `remapPreset` applies the
  brand accent (with WCAG contrast safety) + fonts onto the chosen preset.
- [x] **`frame.md` content.** [`frameDesign.ts`](src/engine/frameDesign.ts)
  `renderFrameMd` emits a compact operational frame.md: visual thesis, semantic
  colours with safe text/surface pairings, display/body/mono type,
  spacing/radius/shadow, background family, ≤5 do/don't, brand exceptions, and a
  metadata header for round-tripping.
- [x] **Feed `frame.md` into the planning bot.** `compositionRunner` injects a
  `<frame_md>` block; `planning-director.md` treats it as binding palette + type
  (motion stays free). Create builds it; revise reuses the create-time frame.
  (Closes the §2 improve item's frame.md half.)
- [x] **One small model decision.** Everything is deterministic except a single
  small `chooseFrame` call (which preset + which brand exceptions), with a
  deterministic keyword/tone-ranked fallback when no provider/decision is available.
- [x] **Slack test.** Verified via smoke: `/sequences` on a brand-y brief →
  authored composition binds `--accent:#1E2BFA` + the preset palette/embedded
  fonts; the chosen `frame.md` is shown in the result message and attached to the
  thread (`uploadFrame` in [`src/index.ts`](src/index.ts)).

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
- [ ] ⚠ **Improve — blind to the 50+ registry catalog.** `agent/skillContext.ts`
  retrieves only the vendored *skills* (blueprints/rules); it never surfaces the
  production registry **blocks/components** (x-post, data-chart, the 15 captions,
  14 shader transitions, code cards, charts/maps, VFX) because that catalog is
  network-only and unsynced. This is the exact "rebuild what HyperFrames already
  has" risk. Wire retrieval to the synced capability index from §9.

## 5. Cut-centered motion direction

Planning begins with the edit, not with isolated pretty scenes. This is the core
of ARCHITECTURE.md §5.

- [ ] **Storyboard-first planning.** The director writes `STORYBOARD.md` (human-
  reviewable intent) + `motion-plan.json` (validated timing, assets, recipes,
  components, continuity). Each shot declares purpose, time window, foreground,
  background, recipe/blueprint, camera intent, and outgoing cut.
- [ ] **Cut graph.** Each cut declares what the eye tracks across the boundary:
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

- [ ] **Registry sync (deterministic).** Build step pulls the HyperFrames registry
  manifest + each `registry-item.json`, vendors an approved, provenance-tracked
  subset locally (no network at author or render time), and emits
  `capability-index.json`.
- [ ] **Normalized capability index.** One schema across registry blocks/
  components, animation rules, blueprints, transitions, frame presets, job
  components, and Sequences recipes: preview/contact-sheet, semantic tags, required
  inputs/assets, configurable variables, duration/aspect fit, supported
  transitions/anchors, dependencies, provenance/quality, and reuse tier
  (parameter-swap | safe-composition | custom-build).
- [ ] **Capability-aware retrieval.** Extend `agent/skillContext.ts` from
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
- [ ] **Slack test.** Critic findings post as a short receipt; an auto-repair of
  one flagged shot re-renders and updates the message in place.

## 11. Deterministic utilities · component foundry · library learning (P1/P2)

- [ ] **Deterministic composition utilities (P1).** Optical-center snap, safe-area
  align/distribute, hierarchy-preserving text fit, responsive aspect variants
  (16:9 / 9:16 / 1:1), SVG viewbox normalization, device/window frame generation,
  chart-data import, cursor-path planning, seeded background generation, local-font
  matching, raster-cost warnings for heavy shadow/blur.
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
