# Recipe Studio — operator motion-design editor + recipe factory (full plan)

> ## ⚠️ SUPERSEDED by the 2026-07-10 pivot — this plan is historical
>
> The owner changed the model: **coding agents author recipes directly as
> committed source files** (`apps/slack/recipes/<id>.recipe.html`, one file
> per recipe — guide: `apps/slack/recipes/README.md`; CLI:
> `npm run recipes -- gate|export <id>`), and the operator only **views**
> components, assets, and recipes in ONE combined tool (`npm run studio` —
> Sequences Studio, which absorbed the Asset Lab). The operator-facing canvas
> builder (M1/M2), the in-studio agent chat (M3: OpenRouter critic + Claude
> CLI spawning), the workspace store, and the export wizard UI were removed.
> **Kept unchanged:** the RecipeV2 export format, Level-1 host instantiation,
> retrieval, version fencing, the full production gate as the referee, and
> every guardrail in §10. Current contract:
> `apps/slack/studio/INTEGRATION.md` + `apps/slack/recipes/README.md`.

Status: PLAN v2 (2026-07-05), **partially built** (M0–M3 core landed 2026-07-07).
This remains the authoritative spec — it still governs the parts not yet built
and the invariants everything must obey. For *what is actually shipped* read the
build status below and the two build reports it links. Owner-facing internal
tool — **never deployed, never part of the hackathon submission surface, never
on Railway.**

---

## Build status (2026-07-07) — read before using this plan

Two build sessions landed against this plan; both reports are in `apps/slack/`
and were verified against the code. The one-line map from milestones (§9) to
reality:

| milestone | state | evidence |
|---|---|---|
| **M0** referee cockpit | ✅ done | server, workspace store, gate-on-demand, preview scrubber (`studio/server.ts`, `workspaces.ts`, `gate.ts`) |
| **M1** deterministic builder | ✅ core done | canvas world view + live catalog + place/retime + typed camera transitions + zero-token compiler (`studio/canvasModel.ts`, `compileCanvas.ts`; `npm run studio:canvas` gates green) |
| **M2** cursor paths + effects | ⛔ **not built** | no `clickAnchor` metadata, no cursor-path editor, no `studioKit.ts` text/backdrop presets, no holds/timeRamp UI |
| **M3** agents | ✅ core done | provider abstraction, OpenRouter **critic** (GLM/DeepSeek-Flash), Claude-CLI file-first agent + re-gate, image attach (`studio/agents/`) — see caveats below |
| **M4** recipes | ✅ mechanics done, ❌ **live proof failed** | RecipeV2 + Level-1 host instantiation (`src/engine/recipeContract.ts`, the sixth host contract), retrieval, export wizard, golden `last-word-roulette` — but the paid live-create proof did NOT convert (§ the gap, below) |
| **M5** library + stretch | ⛔ barely started | library still holds only `last-word-roulette` |

**The one load-bearing open problem — the recipe-declaration gap.** Two paid
`/sequences` creates whose brief named the roulette pattern **declined the
offered recipe and re-derived the pattern themselves** (sparse/messy output —
exactly what the recipe exists to replace). Retrieval offered it (score 17,
declare-by-default teaching); the model overrode the offer under camera/energy
gate pressure. A retrieval *offer* is too weak to reliably convert a capable
planner. The recommended fix (recorded, not built — it changes live-create
behavior and must not land in the hackathon window unilaterally): a **host-side
auto-declare** — when a recipe scores above a high threshold AND the brief
clearly names its pattern, Sentinel L1/L2 injects the declaration into the
best-matching scene rather than merely offering it. Full detail:
`apps/slack/docs/history/RECIPE_STUDIO_REPORT_2.md` §1.

**Also not yet built / caveats** (see REPORT_2 §2.4, §3.3): cursor paths +
`clickAnchor`, effect presets, timeRamp/holds UI, custom ease-graph editor,
scene→recipe promotion (visible disabled stub); the OpenRouter agent is a
**critic only** (no file authoring/patching — that is the CLI agent's job);
Codex CLI; storyboard-frame ordering UI; the export **describe pass**; and CLI
**diff-scoping** (the `claude -p` agent can currently see the parent monorepo
from the workspace cwd — flagged as a TODO before unattended use).

---

## 0. What changed from the v1 seed plan (read this first)

The v1 plan was a *chat-first cockpit* over an existing job dir: talk to
GLM/DeepSeek, scrub, nudge, export knowledge. That survives, but three
creative decisions changed:

1. **Direct manipulation is the primary input, chat is secondary.** The
   operator is not a motion designer and should not have to describe motion in
   prose to a model that has itself proven unreliable at density and framing.
   The studio is a **canvas editor**: place components on an infinite-feeling
   world, draw camera transitions between them, draw cursor paths, pick text
   and backdrop effects from preset menus. Every one of those gestures
   compiles **deterministically, zero tokens** into a valid composition.
   Chat (OpenRouter *or* CLI agents) is for the parts you can't click
   together.
2. **Recipes are instantiated by the host, not merely retrieved as prose.**
   v1 exported `recipe.md` knowledge and hoped the author model reproduces the
   pattern. Evidence says hope is not a mechanism (see §1). The default
   consumption mode becomes **host-owned verbatim instantiation with typed
   parameter slots** — the same philosophy as the existing cut/camera/
   component injections: the model never spends budget (or correctness) on
   mechanics the host already owns.
3. **Agent connectivity is pluggable and includes CLI agents.** GLM/DeepSeek
   via the existing OpenRouter plumbing stay, but the studio also drives
   **Claude Code and Codex as headless subprocess agents** working file-first
   in the recipe workspace, because for interactive authoring the operator can
   and will switch to the much stronger models. The studio is the referee
   (gate + preview) either way.

Everything else from v1 is kept and expanded: location under `apps/slack`,
thin-cockpit-over-the-engine (never a second engine), RecipeV1 skill-pack
export, `skillContext` retrieval, full deterministic gate on every change,
guardrails.

---

## 1. Why this exists (evidence)

The operator's goal: **produce the common SaaS-ad motion templates the
current pipeline demonstrably struggles with**, as reusable presets the
agents then apply during real `/sequences` creates.

Ground truth from `.data/projects/` (the artifact store for every local run —
thumbnails in `build/thumbs/`, reports in `build/qa/`, plans in `planning/`):

- `probe-cutfix-3` (2026-07-04): `m03-palette-opens.png` — a *primary* moment
  rendered as a featureless gray circle in a void; `m06-card-resolves.png` —
  the hero card fills ~6% of the frame; the declared shape-match morph never
  rendered.
- `audit-ws32-live-2` (2026-07-04, **after** the WS1–WS5 quality gates
  landed): `m03-m2-whip-land.png` — four empty window chromes with no
  content; `m09-m5-toast-open.png` — one toast floating in darkness.

The audits (pacing, eye-trace, coverage, cut honesty) fixed *choreography*
failures. What remains is a **content-density and craft ceiling**: model
authors reliably produce sparse, generic visuals and cannot be trusted to
re-derive intricate signature patterns (word roulettes, iris fills, choreo-
graphed cursor demos) from prose. A human with a good editor produces the
pattern once, proves it through the existing gate, and the pipeline reuses it
verbatim forever. That is the whole thesis: **shift signature craft from
per-run model output to a curated, versioned, machine-checkable library.**

---

## 2. Product shape

### 2.0 The core workflow (design the UX around this exact loop)

The operator's stated end-to-end loop — every pane and endpoint below exists
to serve it:

1. **Inspiration**: sees a reel with cool motion design, isolates one idea.
2. **Rough sketch**: blocks it out crudely in the canvas editor — components
   placed, an approximate camera move, maybe a preset that's close.
3. **Describe to the agent**: writes the idea in chat, optionally attaching
   **reference images** — including an ordered *series* of frames acting as a
   storyboard ("first it looks like this, then this"). The agent (usually a
   CLI agent for hard patterns) takes the rough sketch + brief + images and
   gets it ~90% there.
4. **Finishing touches**: operator reviews with their own eyes in the
   viewer, tweaks parameters in the inspector, drags timings, re-prompts on
   what's still wrong. Iterate 3↔4.
5. **Describe for machines**: on export, an agent pass drafts the recipe's
   retrieval metadata (`recipe.md`, triggerPatterns, when-to-use) from the
   workspace + chat history; the operator reviews and edits it.
6. **Export** → the recipe lands in the skill pack and Slack Sequences
   agents can retrieve/instantiate it on real creates.

Implications encoded elsewhere in this plan: image attachments and ordered
storyboard-frame sequences are first-class chat inputs (§6.4); the export
flow includes the agent-drafted description step (§7.5); the inspector's
parameter tweaking must cover recipe param slots (so "tweak parameters" in
step 4 is literally editing the future recipe's params, not raw code).

A local web app: `apps/slack/studio/` served by
`npm run studio --workspace @sequences/slack` → `http://127.0.0.1:<port>`.

Five panes + an inspector (all in one static page; no build step):

```
┌────────────────────────────────────────────────────┬──────────────┐
│                                                    │  Component   │
│   VIEWER (iframe, 1920×1080 scaled)                │  Browser     │
│   – live composition, deterministic seek           │  (22-kind    │
│   – toggle: World View (zoomed-out canvas editor)  │  catalog +   │
│                                                    │  presets)    │
├────────────────────────────────────────────────────┤──────────────┤
│   TIMELINE (scenes · beats · camera segs · cursor  │  Inspector   │
│   paths · moments · effects; drag = retime)        │  (typed      │
├────────────────────────────────────────────────────┤  props of    │
│   CHAT (provider switcher: GLM / DeepSeek /        │  selection)  │
│   Claude CLI / Codex CLI) + gate report feed       │              │
└────────────────────────────────────────────────────┴──────────────┘
```

- **Viewer** — an iframe serving the workspace composition. Deterministic
  seek makes scrubbing trivial: drag = `window.__timelines[id].seek(t)`; play
  = a host-side rAF loop calling seek (the composition stays paused —
  framework-owned playback invariant untouched).
- **World View (the "infinite canvas")** — the load-bearing reframe: the
  engine *already* models a continuous spatial world (`data-camera-world`, a
  plane larger than the viewport with named `data-region` stations;
  `cameraContract.ts` + `templates/sequences-camera.v1.js`). The canvas
  editor is a zoomed-out, pannable rendering of exactly that world. Placing
  "dummy component 1" and "dummy component 2" = creating stations with
  catalog components inside; the camera transition between them = a typed
  camera move. Nothing new is invented — the editor is a WYSIWYG surface for
  the **same five host-owned contracts the agents emit** (camera, cuts,
  components, interactions, timeRamp). Anything the operator builds is by
  construction expressible in the storyboard vocabulary, which is what makes
  recipes consumable later.
- **Timeline** — horizontal strip: scene blocks, component beats, camera
  segments, cursor paths, text/backdrop effects, storyboard moments. Click =
  seek. Drag ends/edges = retime (quantized to 0.05s). Every retime re-gates.
- **Component Browser** — renders the existing catalog **live from
  `componentContract.ts` (`COMPONENT_CATALOG`) + `sequences-components.v1.css`**
  — the catalog markup is the source of truth; the studio must *never* fork
  it into its own copies. Click/drag a kind (app-window, search,
  command-palette, dropdown, context-menu, button, toggle, toast, modal,
  stat-card, table, list, kanban, chat, chart-bars, chart-line,
  progress-ring, progress, terminal, tabs, avatar-stack, sidebar) onto the
  canvas. Dummy content ships with each kind (the catalog markup already
  carries neutral copy). A second tab lists **effect presets** (§5.3–§5.5)
  and **saved recipes** (usable as building blocks inside new recipes).
- **Chat** — one conversation per workspace, provider switchable per message
  (§6). Gate results, QA findings, and thumbnails are appended into the feed
  automatically so both the operator and the agent see the same referee.
- **Inspector** — typed properties of the current selection: a camera
  segment's verb/duration/ease, a beat's kind/atSec/params, a cursor path's
  waypoints/press timing, a component's region/role/copy. Editing writes
  typed state, never raw HTML.

### Non-goals

- Not a general-purpose video editor; no media import, no audio, no arbitrary
  keyframing of arbitrary properties. The vocabulary is the engine's.
- Never a second engine: no studio-only runtime behavior that a shipped
  composition wouldn't have. If the studio can preview it, a `/sequences`
  create can ship it.
- No collaborative/multi-user anything. One operator, localhost.

---

## 3. Architecture

### 3.1 Where it lives

`apps/slack/studio/` — inside the app, so the isolation rule holds (imports
from `src/engine/` directly; **never** from `apps/forge`/`apps/sequences`;
never touches `packages/*`). Ships in the public repo as operator tooling;
the server refuses to start when `RAILWAY_ENVIRONMENT` is set (belt +
suspenders; it's also simply never in the Docker CMD).

```
apps/slack/studio/
  server.ts          # http.createServer + serveDir idiom (no Express)
  api/               # JSON endpoint handlers wrapping engine functions
  ui/                # one static page: index.html, studio.css, studio.js
                     #   (vanilla JS modules; optional Lit via plain script)
  scaffold.ts        # canvas state -> composition HTML (deterministic)
  studioKit.ts       # text/backdrop effect preset definitions (§5.3/5.4)
  agents/            # provider abstraction: openrouter.ts, cli.ts
  AGENT.md           # generated-per-workspace authoring contract for CLI agents
  INTEGRATION.md     # the coupling map for future agents (§8)
```

### 3.2 Workspaces (mutable) vs job dirs (immutable)

`sequence:check` job dirs are immutable by design (HANDOFF gotcha #5). The
studio therefore gets its own root: **`apps/slack/.data/studio/<workspace-id>/`**

```
.data/studio/roulette-v1/
  workspace.json     # canvas state: stations, components, camera segs,
                     #   cursor paths, effects, params — the typed source of truth
  composition/       # generated/authored index.html + assets (gate target)
  revisions/         # checkpoint per accepted change (reuse projectIo idiom)
  chat/              # transcript + per-message provider receipts
  qa/                # latest gate report, thumbnails, temporal evidence
  BRIEF.md           # operator's intent, editable in-UI (fed to agents)
```

`workspace.json` is primary; `composition/index.html` is derived output
*except* in agent mode, where agents may edit the HTML directly and the
studio marks hand-edited regions as `authored` (the scaffolder then preserves
them verbatim on regeneration — same philosophy as host-owned injection
islands, inverted). Importing an existing `.data/projects/<job>/composition`
into a fresh workspace is supported read-only-copy (study a past run, harvest
a pattern).

### 3.3 The deterministic scaffold generator (zero tokens)

`scaffold.ts` compiles `workspace.json` → a complete composition:

- root skeleton per the canonical contract (`data-composition-id`, scenes
  with `data-start`/`data-duration`, one paused registered timeline);
- `data-camera-world` plane + `data-region` stations from canvas placement;
- catalog component markup verbatim from `COMPONENT_CATALOG`, copy filled
  from inspector fields;
- camera bindings, cut bindings, component beat compile calls, interaction
  bindings, timeRamp — emitted in the **same injection order and anchors**
  `directComposition.ts` uses (time-wrap rewrite LAST; reuse the engine's
  injection helpers — do not re-implement them);
- studio-kit effect calls (§5.3/5.4).

Then the standard gate runs: `validateDirectComposition` →
`inspectDirectComposition` (both content-hash cached, so iteration is fast)
→ thumbnails via `generateDirectThumbnails`. A red gate never overwrites the
last green composition; findings land in the chat feed.

This is the core promise: **an operator who never types a prompt can still
build a valid, seek-safe, fully-gated film by clicking.**

### 3.4 Server API (sketch)

```
GET  /                       studio UI
GET  /preview/*              serve workspace composition dir
GET  /api/workspaces         list; POST create/import
GET  /api/workspace/:id      workspace.json + gate status
POST /api/workspace/:id/canvas    typed mutations (place/move/retime/...)
POST /api/workspace/:id/generate  scaffold + gate; returns findings/thumbs
POST /api/workspace/:id/chat      { provider, message } → streams via SSE
GET  /api/workspace/:id/events    SSE: gate results, agent tokens, file watch
POST /api/workspace/:id/export    RecipeV1 export (only from green gate)
GET  /api/catalog            component kinds + markup + effect presets
```

All mutation endpoints funnel through one `applyStudioMutation` that
checkpoints a revision first (undo = revision replay, same idiom the Slack
undo uses).

---

## 4. Interaction model on the canvas (feature specs, part 1)

### 4.1 Infinite canvas / world editing

- Pan (space-drag / middle-drag), zoom (wheel), fit-world, fit-viewport-rect.
- The viewport is drawn as a fixed 1920×1080 frame outline; stations are
  viewport-sized rects (the engine's `worldLayout` grid-cell pinning is the
  natural default: snap stations to grid cells, allow free placement as the
  advanced mode).
- Placing a component creates (or joins) a station; components carry
  region/role and their `id` doubles as `data-part` (existing rule), so
  cameras, cuts, and cursors can all address them immediately.
- Scene ↔ station mapping: v1 keeps the engine's model (scenes own stations;
  the camera visits stations within a scene). The canvas shows one scene at a
  time with ghosted neighbors; a scene switcher rail on top.

### 4.2 Camera transitions ("component 1 → component 2")

Select station/component A, shift-click B → "add camera move": a typed
segment with:

- **verb**: pan / whip / push-in / pull-back / track-to-anchor /
  parallax-pass / orbit-lite / orbit (the existing vocabulary — nothing new);
- **duration** + **ease**: v1 is a preset picker with live curve preview —
  the Sequences ease library (`seqSwoosh`, `seqWhip`, `seqImpulse`,
  `seqSettle`, `seqGlide`, `seqDrift`, `seqAnticipate`, `seqMicrobounce`)
  plus GSAP standards. v2 adds a custom curve graph editor (cubic-bezier /
  CustomEase serialized into the composition — must serialize, not live only
  in the studio, or recipes break);
- optional **focus** rack (`{part|depth, blurMaxPx≤10}`) and `depth3d` where
  legal (orbit only — the contract's degrade rules already police this).

The studio draws the camera path as a spline over the canvas with time ticks.
Gap auto-fill (drift) and anticipate wind-ups come free from the resolver.
The pacing/energy audits run at gate time and their findings render as
*inline canvas annotations* (e.g. "scene 2: 3 moves > budget 2") — the
operator gets the same craft guardrails the model gets, but as advice they
can see and act on spatially.

### 4.3 Mouse/cursor paths — and the click-anchor problem

The engine already has semantic cursor interactions: typed `from` (frame
anchor or `part:<name>`), `targetPart`, arrive/press/release seconds, press/
ripple feedback, and a versioned runtime that resolves hotspot/target/ripple
geometry **under camera transforms at runtime**. That is the answer to
"different components have the click in different locations":

- **Recipes and workspaces never store absolute click coordinates.** A cursor
  path stores `targetPart` (+ optional sub-part) and the runtime measures the
  real geometry at bind time, camera transform included.
- **Add per-kind `clickAnchor` metadata to `COMPONENT_CATALOG`** (small,
  additive engine change): each kind names its semantic press point as a
  selector within its own markup — button → itself; search →
  `.cmp-input`; modal → its confirm `.cmp-btn-primary`; dropdown → the
  trigger, then per-option; table/list → `.cmp-row[n]`; toggle → the knob.
  The studio uses it to snap path endpoints; the interaction runtime gains an
  optional `targetAnchor` sub-selector resolved the same way as ripple parts.
  Degrade-never-veto: unknown anchor → component rect center + advisory.
- **Path shape**: v1 the runtime's existing travel (curved arrival) with
  editable start anchor + arrive/press/release times dragged on the timeline.
  v2 extends `interactionContract.ts` with optional `via: [{x,y} in
  station-relative %]` waypoints compiled into the same seek-safe tween
  (pure function of time; contract version bump; mirror in
  `kitMarkupAudit.ts` if bind queries change — gotcha #16).

### 4.4 Text, holds, ramps

- Text blocks are components too (headline/caption kinds may be added to the
  catalog as `text-hero`/`text-caption` — additive, follows the existing
  spec shape) so they get regions, parts, beats, and QA like everything else.
- A "hold" is first-class in the UI: a scene-tail segment with a develop beat
  suggestion (the pacing audit's "hold ≠ freeze" doctrine surfaced as a
  button: add count/progress/drift develop beat).
- `timeRamp` dips are placeable from the timeline (existing contract; max 1
  per scene, 2 per film, never scene 1 — enforced by the existing validator).

---

## 5. Effects library (feature specs, part 2)

### 5.1 Principle: recipe-first, kit-later

Every effect below starts life as a **studio preset**: a parameterized,
proven markup+GSAP pattern in `studioKit.ts`, instantiated verbatim into the
composition by the scaffolder, gated like everything else. When an effect
proves itself across several recipes, it may be *promoted* into a host-owned
runtime template (`templates/sequences-text.v1.js` etc.) so live agent runs
can declare it as a typed beat. Promotion is a deliberate, separate task —
the studio must not block on new engine runtimes.

### 5.2 Seek-safety is non-negotiable

Every preset is a pure function of timeline time: no wall-clock, no
rAF-owned state, no randomness without a seeded, time-indexed source. The
gate enforces this automatically (out-of-order seek checks), but presets
should be *written* to it, not fixed after.

### 5.3 Text effects (initial set)

| preset | behavior | params |
|---|---|---|
| `type-on` | existing `type` beat (already a component beat) | text, cps, caret |
| `word-cascade` | words rise/settle in stagger ("flow") | text, stagger, ease |
| `blur-reveal` | per-word/char blur+track-in resolve | text, from-blur px |
| `motion-blur-slide` | headline slides in with directional blur that releases | direction, distance |
| `mask-wipe` | clip-path wipe reveal along an axis | axis, ease |
| `counter-roll` | odometer digits roll to value | from, to, duration |
| `last-word-roulette` | locked sentence, final-word vertical wheel ticks and snaps onto payoff | candidates[], tick spacing, payoff word |

Motion-blur on text uses tweened `filter: blur()` on the **text nodes only**
— never on the world element or any `preserve-3d` ancestor (gotcha #14), and
released ≤0.45s like rack focus so it never squats on a frame.

### 5.4 Shape/backdrop effects (initial set)

| preset | behavior | params |
|---|---|---|
| `iris-fill` | a circle tracks a target part, then expands to fill the frame and *becomes* the next background | target part, color/gradient, expand ease |
| `iris-cut` | inverse: background collapses into a shape that becomes a UI element (pairs naturally with shape-match cuts) | target part, shape |
| `wipe-panel` | full-bleed color band sweeps, carrying a headline | axis, color |
| `spotlight` | dim world + soft light ellipse on the focal part | target part, dim level |
| `gradient-shift` | background gradient re-aims toward the focal region (extends the cinema-kit color-arc idea) | from/to stops |

Backdrop elements live outside stations, are `data-layout-ignore` decor for
coverage math, but iris-fill's *end state* becomes the scene background —
spec it as an explicit scene-background swap at a known second so the
coverage and contrast audits judge the real final frame.

### 5.5 Composite presets (where the leverage is)

Multi-contract patterns stored as recipes that use recipes: "cursor flies to
button, presses, toast cascades, camera pushes into the toast", "kanban card
drags across columns while camera tracks", "pricing tiers build with counter
rolls then the chosen tier iris-fills to CTA". These are exactly the "common
SaaS templates" the pipeline can't reliably produce; they compose §4 + §5
primitives, so the studio needs no new machinery for them — only the library
needs curation.

### 5.6 Recipe backlog (the operator's target library, first ~15)

last-word-roulette · iris-fill CTA close · cursor demo click-through (3
stops) · notification stack cascade · KPI dashboard flythrough (counter
rolls + track-to-anchor) · bento-grid feature reveal · pricing table build +
tier highlight · testimonial card carousel · onboarding checklist
tick-through · command-palette power-user flow · before/after wipe · logo
constellation → snap to grid · terminal-to-chart transform (shape-match) ·
mobile-frame in-hand pan (needs a `device-frame` component kind) · headline
word-swap positioning loop.

---

## 6. Agents

### 6.1 Provider abstraction

```ts
interface StudioAgent {
  id: "glm" | "deepseek" | "claude-cli" | "codex-cli";
  send(workspace, message, context): AsyncIterable<AgentEvent>;
}
```

Context is composed per message and identical across providers so switching
is seamless: BRIEF.md + workspace.json summary + last gate report + the
authoring contract (composition skeleton, determinism rules, catalog +
effect vocabulary — reuse `skillContext.ts` composition, "recipe brief"
scoped: one pattern, 3–12s, loop-friendly).

### 6.2 OpenRouter agents (GLM plan/critique, DeepSeek author/patch)

In-process, through the **existing `compositionRunner` primitives** —
`requestDirectComposition` for full authoring against a studio-built locked
storyboard, `applyCompositionRepair` for exact patches, the critic pass for
"look at this and suggest" — with `modelPolicy.ts` supplying models
(`z-ai/glm-5.2` creative, `deepseek/deepseek-v4-pro` production,
`deepseek-v4-flash` light). Never fork prompt text: the planning prompt stays
in `prompts/planning-director.md`; studio-specific framing is an additional
composed layer. `OPENROUTER_API_KEY` from `apps/slack/.env` (never commit).

### 6.3 CLI agents (Claude Code, Codex) — file-first

The strong-model path. Design: **the agent works in the workspace directory
like a developer; the studio is a file-watching referee.**

- Studio writes/updates `AGENT.md` in the workspace: the authoring contract,
  current workspace state summary, the gate command, the *don'ts*
  (determinism rules, injection anchors are host-owned — edit scene
  interiors and authored beats only), and the current findings list.
- Chat message → spawn `claude -p "<message>" --output-format stream-json
  --permission-mode acceptEdits` (or `codex exec "<message>"`) with `cwd` =
  the workspace, streaming stdout into the chat pane. Session continuity via
  `claude --resume <session-id>` per workspace so the conversation persists.
- The agent edits `composition/index.html` (and only that subtree —
  workspace is the sandbox; the studio validates that diffs stay inside it).
- File watcher → debounce → re-gate → findings + fresh thumbnails pushed to
  the feed. A red gate auto-appends a compact findings message the operator
  can bounce back with one click ("fix these").
- Kill switch per run; transcript and receipts persisted under `chat/`.

This costs no engine changes and inherits every future engine improvement
automatically, because the gate *is* the engine. Also the reverse ripple the
owner asked about: when Slack Sequences' contracts change, the studio's gate
changes with it in the same process — nothing to sync except INTEGRATION.md
(§8) and regenerated `AGENT.md` files.

### 6.4 Image and storyboard-frame input (first-class)

The operator's primary briefing tool is visual: single reference images and
**ordered frame sequences** ("storyboard mode"). Spec:

- Chat pane accepts drag-drop images; saved under `refs/` in the workspace
  (`refs/<msg-id>/01.png, 02.png, …`), referenced from the transcript.
- **Storyboard mode**: an attached sequence gets an ordering strip in the
  composer; the operator can caption each frame ("wheel starts", "payoff
  word locks", "circle begins expanding"). Serialized as an ordered
  `{ image, note }` list in the message context.
- **CLI agents**: trivially supported — images are files in the workspace;
  the prompt references their paths and Claude Code/Codex read them
  natively. This alone justifies the CLI path for step 3 of the workflow.
- **OpenRouter agents**: pass as image content parts when the selected model
  is vision-capable; otherwise the studio degrades honestly (notes-only +
  a visible "model can't see images" badge) rather than silently dropping
  them. Check vision capability per model id in the provider adapter.
- Ref images are workspace-local working material: **never** copied into
  exported recipes or the composition (compositions must stay local-asset,
  brand-safe); `preview/` in a recipe comes from gate-produced thumbnails,
  not refs.

### 6.5 What agents are *for* in the studio

- "Author this scene's interior richer" (density — their weakness becomes
  reviewable because the operator watches the preview).
- "Make this effect from my description" → operator then hardens it into a
  preset by extracting params.
- Critique: GLM continuity-critic over the workspace film (existing pass).
- Never: owning the mechanism of an already-proven preset. Presets are
  host-instantiated (§7); agents fill slots.

---

## 7. Recipes: format, export, retrieval, and how agents use them WITHOUT breaking them

This section is the point of the whole tool. Treat it as ≥25% of the build.

### 7.1 RecipeV2 format

Exported (only from a green gate) to
`apps/slack/skills/sequences-recipes/<recipe-id>/`:

```
recipe.json      # machine header — the load-bearing file:
                 #   id, title, tags, triggerPatterns[], durationWindow,
                 #   contracts: which host contracts it uses,
                 #   componentKinds[] required, clickAnchors used,
                 #   params: typed slot schema (see below),
                 #   engine: { storyboardContract: 8, qaCacheVersion: 5,
                 #             kitVersions: {...} },
                 #   qaEvidenceHash, revision
recipe.md        # retrievable knowledge (when to use, storyboard vocabulary
                 #   to declare, craft notes) — <blueprint>/<motion-rule> tag
                 #   conventions the skill compaction already understands
fragment.html    # the proven scene-fragment markup + GSAP block, with
                 #   {{param}} slots — the unit of host instantiation
demo.html        # canonical full composition that passed the gate
preview/         # thumbnail strip + optional MP4 for the operator gallery
```

**Param slots are typed and bounded**: `{ name, kind: "text" | "color-token"
| "number" | "part-ref" | "component-copy" | "enum", constraints }`. Color
params reference frame.md tokens (`--cinema-*`, palette roles) — never raw
hexes — so an instantiated recipe is automatically on-brand for any job.
Text slots carry length windows (the reading-floor audit depends on them).

### 7.2 Three consumption levels (default = Level 1)

- **Level 0 — knowledge.** `recipe.md` injected as prompt vocabulary beside
  blueprints. Cheap, useful for style influence; NOT trusted for signature
  mechanisms. (This is all v1 had.)
- **Level 1 — host instantiation (the default).** The storyboard schema
  gains a typed, optional `recipes: [{ id, sceneRef, params }]` field. At
  authoring time the host injects `fragment.html` **verbatim** into the
  target scene (same injection machinery/anchor discipline as cut/camera/
  component islands), with params filled from the storyboard declaration —
  validated against the slot schema first (findings-retry on violation,
  degrade to Level 0 knowledge on a rung's final attempt: degrade-never-veto,
  gotcha #11). The author model authors *around* the fragment and fills
  copy-class slots; it cannot edit the mechanism (static validation rejects
  diffs inside the injected island, exactly like other injected islands).
- **Level 2 — tunable restyle.** Recipes may mark specific fragment regions
  `data-recipe-tunable`; only those may be restyled by the author. Ship
  after Level 1 is boring.

New engine file: `src/engine/recipeContract.ts` (parse/validate/inject +
paperwork), following the shape of `componentContract.ts`. Storyboard cache
`contract` bumps (v8→v9) when the schema lands, plus a `recipesVersion` in
the cache key exactly like `registryVersion` already is
(`compositionRunner.ts` ~3408).

### 7.3 Retrieval

Extend `src/agent/skillContext.ts`: score `sequences-recipes/*` against the
brief (triggerPatterns keyword match + componentKind overlap + duration-
window fit), **cap 1–2 recipes per create**, inject `recipe.md` beside
blueprints for the storyboard prompt; the author prompt receives the
fragment contract *only* for recipes the locked storyboard actually declared.
Recipes lose to brief-derived requirements on conflict. The planner may also
decline scored recipes (they are offers, not mandates).

### 7.4 Why the agent can't (easily) fuck it up — the defense stack

1. **Mechanism is unreachable** (Level 1 injection; model edits around it).
2. **Params are schema-validated** before any model sees the composition;
   violations are cheap findings-retries at storyboard validation, the
   same plumbing as `auditPacing`/`auditShapeMatchHints`.
3. **Full gate parity**: an instantiated recipe still passes markup audit,
   liveness, pacing, eye-trace, coverage, browser QA, temporal judge — a
   recipe cannot exempt a film from any existing gate.
4. **Version fencing**: `recipe.json.engine` records the contract/kit
   versions it was proven against. At retrieval, a stale recipe (any fenced
   version drifted) is skipped and flagged in the studio ("re-prove me").
   Re-proving is mechanical: re-run the gate on `demo.html` in a studio
   workspace and re-export.
5. **QA evidence hash**: the exported fragment is content-addressed;
   tampering or drift is detectable, and paperwork (STORYBOARD.md, Slack
   outline) records recipe usage honestly, same discipline as
   `reconcileDegradedCutPaperwork`.
6. **Bounded budget**: ≤2 recipes/create, fragments size-capped, so prompt
   and DOM budgets stay sane (the >60-node shape-match subtree lesson).

### 7.5 Export flow: the agent-drafted description pass

Step 5 of the core workflow (§2.0). "Export" is a short wizard, not a dump:

1. Gate must be green (hard requirement; the export button is disabled red).
2. **Describe pass**: an agent (light model by default — `deepseek-v4-flash`
   class; operator can switch to a CLI agent) receives the workspace state,
   BRIEF.md, the chat history, and the final thumbnails, and drafts:
   `recipe.md` (what it is, when to use it, the storyboard vocabulary to
   declare, craft notes), `triggerPatterns[]`, `tags[]`, the one-line title,
   and suggested param slot names/descriptions. This is what makes the
   recipe *findable and usable by other agents* — treat retrieval quality as
   part of the recipe, not an afterthought.
3. **Operator review screen**: the draft metadata side-by-side with the
   preview strip; everything editable; param slots confirmed against what
   the operator actually tweaked in step 4 (the inspector already knows
   which values were touched — offer those as the default slot set).
4. Write RecipeV2 files, compute `qaEvidenceHash`, stamp `engine` version
   fences, bump `revision` if re-exporting an existing id.
5. Post-export sanity: run the retrieval scorer against 2–3 synthetic briefs
   (one that should match, two that shouldn't) and show the scores — a
   recipe that matches everything (or nothing) gets its triggerPatterns
   fixed *now*, in the wizard, not discovered broken in production.

### 7.6 The golden first recipe

`last-word-roulette` (kept from v1 — it proves everything): sentence locked,
final-word masked vertical wheel; each tick a storyboard moment; wheel motion
= translateY snap steps (pure function of time); payoff landing = primary
moment, eligible for a `timeRamp` dip. Build it in the studio (canvas: one
station, one text-hero component, the roulette preset), export at Level 1,
then run one paid `/sequences` create whose brief names the pattern and
verify: planner declares it → host injects it → gate passes → the shipped
film's roulette is byte-identical to the proven fragment modulo params.

---

## 8. INTEGRATION.md — the coupling map (docs for future agents)

The owner explicitly wants future agents to know what to update. Ship
`apps/slack/studio/INTEGRATION.md` listing every seam, each with "when you
change X, update Y":

| engine seam | studio consumer |
|---|---|
| `componentContract.ts` COMPONENT_CATALOG / beats | component browser, scaffolder, clickAnchor map |
| `templates/sequences-*.v1.*` versions | studio kit, recipe `engine.kitVersions` fences |
| `cameraContract.ts` verbs/params | canvas transition editor + inspector enums |
| `interactionContract.ts` schema | cursor path editor (esp. if `via` waypoints land) |
| injection order in `directComposition.ts` | `scaffold.ts` (reuses helpers — breaks loudly if drift) |
| storyboard schema / cache `contract` version | RecipeV2 `recipes:` field, `recipesVersion` cache key |
| `skillContext.ts` retrieval | recipe scoring |
| QA issue codes / `QA_CACHE_VERSION` | studio findings renderer, canvas annotations |
| prompts (`planning-director.md`) | recipe vocabulary teaching lines |
| `modelPolicy.ts` models | provider switcher labels/defaults |

Rule for future engine work: touching a seam in the left column requires
updating the right column *or* recording a TODO in INTEGRATION.md — enforce
socially via CLAUDE.md pointer ("studio exists; see INTEGRATION.md").
Add a mention of the studio + this rule to `apps/slack/CLAUDE.md` and
ROADMAP.md when M1 lands.

---

## 9. Milestones

Ordered so every milestone is independently useful; sizes assume one agent.
Status tags reflect the 2026-07-07 build (see the build-status table up top).

- **M0 — Referee cockpit (1 day). ✅ DONE.** Server, workspace store, viewer +
  scrubber + timeline (read-only) over an imported past job dir, gate-on-
  demand, thumbnails. *Proves: serve/seek/gate loop.*
- **M1 — Deterministic builder (2–3 days). ✅ CORE DONE.** Canvas world view,
  component browser (catalog-live), place/drag/retime, camera transitions with
  ease picker, scaffold generator, undo checkpoints. Zero tokens end-to-end.
  *Proves: click-together valid films.* (Done: `canvasModel.ts` +
  `compileCanvas.ts`; two real bugs found by eyeballing thumbnails — blank
  scene-start frames, camera-never-travels-because-times-were-scene-relative —
  fixed with regression tests.)
- **M2 — Cursor paths + effects (2 days). ⛔ NOT BUILT.** Cursor path editor
  with clickAnchor snapping (catalog metadata addition), text presets, backdrop
  presets, holds/timeRamp placement. *Proves: the template vocabulary.* — this
  is the largest remaining builder gap.
- **M3 — Agents (1–2 days). ✅ CORE DONE (with caveats).** Provider abstraction;
  OpenRouter chat (**critic only** — author/patch not wired); CLI agent (Claude
  Code; **Codex not built**) with AGENT.md generation, **post-turn** re-gate (a
  bounded `claude -p` turn, not a live `fs.watch` loop); image attachments
  (**storyboard-frame ordering UI not built**). *Proves: steps 1–4 of the core
  workflow.* Open caveat: **CLI diff-scoping** — the agent can see the parent
  repo from the workspace cwd; add `--add-dir` restriction + a post-turn
  out-of-workspace edit check before unattended use.
- **M4 — Recipes (2–3 days). ✅ MECHANICS DONE / ❌ LIVE PROOF FAILED.** RecipeV2
  export wizard + retrieval sanity check (§7.5), `recipeContract.ts` Level 1
  host instantiation, `skillContext` retrieval + cache-key bump,
  `last-word-roulette` golden recipe are all built and green. The **agent-drafted
  describe pass** (§7.5 step 2) is NOT built. The paid live-create proof did
  **not** convert — the planner declined the offer both runs (the recipe-
  declaration gap; see build status + REPORT_2 §1). *Thesis validated, live
  loop unproven.*
- **M5 — Library + stretch. ⛔ BARELY STARTED.** Curate the §5.6 backlog;
  audition grid (render 2–3 param variants side by side); Level 2 tunables;
  custom ease graph editor; `via` cursor waypoints; screenshot-to-station
  import. (Library still holds only `last-word-roulette`.)

M0–M2 touch **zero** live-pipeline code (pure additive studio + tiny catalog
metadata). M4 is the only milestone that changes live-create behavior; it
lands behind `SLACK_SEQUENCES_RECIPES=0` kill switch (default on only after
the golden-recipe live proof), following every existing kill-switch
convention.

---

## 10. Guardrails & tricky bits (read before coding)

1. **Every studio output passes the existing deterministic gate.** No studio
   preview path that bypasses validation — otherwise recipes get proven
   against a laxer referee than production.
2. **Reuse engine injection helpers; never re-implement anchors.** The
   time-wrap rewrite stays LAST (`test/timeRamp.test.ts` guards it);
   injection anchors are load-bearing (gotcha #1).
3. **Immutable job dirs stay immutable** — studio workspaces are a separate
   root (`.data/studio/`), imports are copies.
4. **The world element never carries a CSS filter** (gotcha #14); text
   motion-blur lives on text nodes and releases.
5. **Style via classes, not `data-part` selectors** in presets — bridge
   clones strip `data-part` (gotcha #7).
6. **Degrade, never veto** volunteered richness — recipe param violations
   retry cheaply, then degrade to knowledge-level, never sink a film
   (gotcha #11).
7. **Cache bumps**: storyboard `recipes:` field → contract v8→v9 +
   `recipesVersion` in the cache key; QA semantics changes →
   `QA_CACHE_VERSION`. Mirror any new bind queries in `kitMarkupAudit.ts`
   (gotcha #16).
8. **No new heavy deps.** `http.createServer` + static files + vanilla JS.
   A file watcher may use `fs.watch`; no chokidar unless it proves flaky.
9. **Secrets**: OpenRouter key from gitignored `.env`; CLI agents use the
   operator's own logged-in sessions; nothing key-shaped in workspace.json,
   chat transcripts, or exported recipes.
10. **Never on Railway; never in the Docker image entrypoint; refuses to
    start under `RAILWAY_ENVIRONMENT`.** Not part of the hackathon
    submission narrative.
11. **Publish flow unchanged**: studio + recipes ship in the public repo via
    `bash scripts/publish-public.sh`; that never deploys (publish ≠ deploy).
12. **Don't fork the catalog or prompts** — component browser reads
    `COMPONENT_CATALOG`; prompt additions go through `prompts/` + composed
    runtime context, per the prompts convention.
13. **Timing**: this is post-hackathon-deadline-safe work only if it stays
    additive; nothing in M0–M3 may destabilize the live bot during the
    Jul 13 window. If in doubt, branch and hold M4 until after submission.

## 11. Verification ladder

- Unit: `scaffold.ts` golden-output tests (canvas state → composition
  bytes), `recipeContract.ts` parse/validate/inject tests beside
  `test/componentRuntime.browser.test.ts` patterns; preset seek-safety via
  out-of-order-seek browser tests (copy `cutShapeMatch.browser.test.ts`
  structure).
- Studio smoke: scripted `node studio/server.ts --self-check` — create
  workspace, place two components, add a transition, generate, gate green,
  export recipe, re-import, re-prove.
- Standard slack gate stays green: `npm run typecheck/test/film:demo/
  sequence:check --demo --no-mcp` (the fallback film must not change).
- M4 live proof: one paid create with a recipe-naming brief; inspect
  `planning/`, thumbnails **with your own eyes** (reports have said "pass"
  on films the operator called a mess), and the storyboard paperwork's
  recipe usage record.

## 12. Open questions for the owner (non-blocking, defaults chosen)

1. Port/binding: default `127.0.0.1:4321`, no auth (localhost-only) — ok?
2. Codex CLI: assumed installed and logged in; if not, ship Claude-CLI-only
   in M3 and stub the provider.
3. Recipe licensing/provenance in the public repo: recipes ship publicly
   with the app — fine, or keep `skills/sequences-recipes/` gitignored and
   publish only curated ones?
4. `device-frame`/`text-hero` catalog additions: proposed here as additive;
   veto if the catalog should stay frozen through the hackathon window.
