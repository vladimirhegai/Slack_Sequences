# TODO — Core HyperFrames Authoring

The foundation (Slack workflow, two-tier delivery, both MCP planes, OAuth) is
done. This is the **core creative engine** work — making the bot produce genuinely
good videos by authoring HyperFrames directly instead of compiling constrained
Sequences Plans.

Target: [ARCHITECTURE.md](ARCHITECTURE.md). Two bots: [CLAUDE.md](CLAUDE.md).

Legend: `[x]` done · `[~]` partial · `[ ]` not started

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

## 3. Design system — `frame.md` per job

Each video job gets a `frame.md` that governs its visual identity. The designer
(a deterministic step + one small model decision) picks a preset and applies brand
overrides.

- [ ] **Frame preset library.** Start from the existing HyperFrames frame presets
  (`skills/hyperframes-creative/frame-presets/`). Curate 3–5 that work well for
  SaaS launches (clean/corporate, dark-premium, editorial).
- [ ] **Deterministic brand remapping.** Extract brand colors, fonts, and logo
  from the context bot's evidence pack → remap the chosen preset. Most of this
  should be deterministic (color extraction, contrast checks, font matching).
- [ ] **`frame.md` content.** Visual thesis, semantic colors with safe
  text/surface pairings, display/body/mono typography, spacing/radius/border/
  shadow rules, background family, ≤5 do/don't rules. Compact and operational.
- [ ] **Feed `frame.md` into the planning bot.** The director receives the
  frame.md as context when authoring compositions — it constrains the palette and
  typography without limiting motion creativity.

## 4. Skills retrieval for HyperFrames

The planning bot should receive only the knowledge it needs for a specific
scene — not the entire skill catalog.

- [~] **Upgrade `agent/skillContext.ts`.** It now deterministically selects and
  injects exact core references, blueprints, and motion-rule recipes for the
  brief/revision. True director-selected per-scene retrieval is still next.
- [~] **Blueprint/rule selection.** A deterministic brief router now selects a
  bounded candidate set and the director records its final choices in the
  storyboard. Move selection fully into a validated director pass next.
- [x] **Skill context for revision.** Revise prompts receive the current
  storyboard + canonical HTML and only revision-relevant skills/recipes.

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

## 6. Audio cues — Brag

- [ ] **Integrate the [Brag](https://github.com/) audio cue system.** Use it for
  beat-synced audio cues: whooshes, impacts, risers, and transition sounds that
  align with cut points and key visual moments. Provenance-tracked, license-clean.
- [ ] **Beat alignment.** Audio cues snap to the cut graph from §5 — each cut
  point and major visual transition gets an optional matched sound.
- [ ] **Mix into the render pipeline.** Audio layer added during the FFmpeg render
  pass alongside the composition video.

## 7. SaaS motion examples (retrieval seed)

- [ ] **Curate 3–5 real SaaS-motion examples.** Hand-authored, provenance-tracked
  HyperFrames compositions that demonstrate the quality bar. These become
  retrieval/inspiration material for the planning bot — not templates to fill in.
- [ ] **Example diversity.** Cover different motion profiles: a crisp dev-tool
  launch, a warm startup announcement, a bold product rebrand. Different shot
  counts, different component types.

## 8. Component contracts (Forge Stage-inspired)

- [ ] **Source-derived contracts.** Each component (search box, dashboard, card,
  phone screen, chart) ships parts, layers, variables, actions, states, and
  anchors — derived by parsing the authored source, not model-claimed.
- [ ] **Morph continuity.** Twin components with shared `morphGroup`, stable part
  IDs, and matching anchors. A checker rejects impossible pairings before
  composition. HyperFrames implements the handoff (scale-swap, card-morph-anchor,
  velocity-matched cut).

---

## Build order (hackathon-pragmatic)

Do §1 first — prove one good video. Then §2 + §3 (the prompt + design system
that make it repeatable). Then §4 + §5 (retrieval + cuts that make it excellent).
§6–§8 are polish/depth — do them if time permits, skip if not.

The demo only needs to show: real workspace thread → designed video with good
motion → revision → share. Not every feature above.
