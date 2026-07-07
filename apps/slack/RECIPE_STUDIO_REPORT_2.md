# Recipe Studio — session 2 report (canvas builder + agents + live proof)

Date: 2026-07-07 · Agent: Claude (session 2 of 2) · Plan:
`docs/RECIPE_STUDIO_PLAN.md` (v2) · Foundation: `RECIPE_STUDIO_REPORT.md`
(session 1) · Handoff: `docs/RECIPE_STUDIO_HANDOFF.md`.

This session built the **direct-manipulation canvas builder** (plan M1 + core of
M2) and the **agent chat layer** (M3 core), and ran the **paid live-create
proof** (milestone 1). The operator chose the scope up front: run the paid proof
first, then focus on the **canvas editor + agents** (deprioritizing library
curation and the export describe pass). This report is written to be audited
against the code — including what did **not** work.

---

## 0. Headline honesty (read this first)

- **The canvas builder works and I verified the films with my own eyes.** A
  click-together starter film gates GREEN through the *real* production gate
  (static validation + real browser QA + thumbnails) and the thumbnails show
  real content — a hero headline, a camera push-in landing on a stat-card that
  counts up, a progress bar, a CTA. I found and fixed two real bugs by looking
  at the thumbnails (blank scene-start frames; a camera that never traveled),
  not by trusting "gate green."
- **The agent chat works and I verified it live.** The OpenRouter critic read
  the real workspace state and gave grounded advice; the Claude CLI file-first
  agent spawned, streamed, and the studio re-gated its turn to GREEN.
- **The paid live-create proof did NOT succeed at its core claim.** After
  **two** paid `/sequences` creates (baseline teaching, then strengthened
  teaching), the planner **declined the offered recipe both times and
  re-derived the roulette itself.** The recipe pipeline is correctly wired
  (retrieval offers it, score 17, with a strong declare-by-default
  instruction), but an *offer* did not convert to a *declaration*. The film the
  model built itself is exactly the messy/sparse pattern the recipe exists to
  replace — which validates the thesis but leaves the live "agent WILL use it"
  loop **unproven**. Details + a recommended fix in §1.

---

## 1. Milestone 1 — paid live-create proof (the honest result)

**What I ran (two paid OpenRouter creates, `--provider openrouter-api --no-mcp`,
fail-loud):**

```
npm run sequence:check --workspace @sequences/slack -- \
  --product Sequences --what "<brief naming the slot-machine last-word roulette>" \
  --tone bold-launch --length 14 --job-id roulette-live-proof-{1,2}
```

The brief strongly named the pattern ("final word spins like a slot-machine
roulette … snaps to LAND on the payoff word … this last-word word-roulette is
the signature moment"). Both runs used the SAME brief (I did not game it by
telling the "user" to declare a recipe).

**Result — both runs, verified in the artifacts:**

| check | proof-1 (baseline) | proof-2 (strengthened teaching) |
|---|---|---|
| shipped | `hyperframes-direct`, no fallback | `hyperframes-direct`, no fallback |
| `data-recipe-uid` in composition | **0** | **0** |
| `last-word-roulette` in `planning/` | **absent** | **absent** |
| what the planner did | built its own roulette (scenes `hook-roulette`/`snap-payoff`) | built its own roulette again (`demo-snap`) |

**Was the recipe even offered?** Yes. I verified directly:
`recipeRetrievalScore(manifest, brief) = 17`, `retrieveHyperframesSkillContext`
surfaces `recipeIds: ['last-word-roulette']`, the recipe loads clean (not
stale). The `recipePlanningVocabulary` block leads the selected-knowledge
section with "DECLARE these, do not re-derive them … declaring it is the
DEFAULT." So the pipeline did its job; the model overrode it.

**I eyeballed the model's self-built roulette** (proof-1 thumbnails). It is the
thesis in one picture: `m05-snap-payoff` shows "a film." with "thread" bleeding
through underneath (two words overlapping at the snap); `m08-word-settle` is a
tiny, low-contrast "a film." floating in a washed-out cream void. This is
exactly the sparse/messy signature craft the plan (§1) says models produce and
the recipe exists to replace.

**Why the planner declined (my read of the logs):** proof-1 attempts 1–3 were
rejected for `camera/energy` ("a 14s film has no high-energy peak"); the model
added a morph cut + camera compress to satisfy the energy audit — i.e. it built
its own *energetic* roulette to pass the gate. A text-only recipe declaration
plus a CTA may not by itself satisfy `auditCameraEnergy`, so gate pressure
actively pushed the model toward re-deriving the mechanism.

**What I tried, and reverted:** I strengthened `recipePlanningVocabulary`
(runtime-composed teaching, not the byte-budgeted prompt file, not a gate) with
an explicit anti-pattern ("do NOT hand-author the slot-machine/word-cycle
yourself when it is offered … the recipe's own motion IS the film's signature
moment and counts toward its energy; add a whip/push-in in a DIFFERENT shot if
the energy curve needs a peak"). proof-2 used it. **It did not change the
outcome** — the planner still re-derived. Because the change is an *unproven*
live-pipeline nudge and the operator's hard constraint is "nothing may
destabilize the live bot before Jul 13," **I reverted it** (`git checkout
src/engine/recipeContract.ts`). My entire shipped contribution is therefore
purely additive studio tooling with **zero live-pipeline behavior change**.

**Recommendation (for the operator to weigh post-hackathon, NOT done here):** a
retrieval *offer* + teaching is too weak to reliably convert a capable planner
under gate pressure. The reliable fix is a stronger host-side intervention —
e.g. a Sentinel L1/L2 mechanism that, when a recipe scores above a high
threshold AND the brief clearly names its pattern, **auto-declares** the recipe
into the best-matching scene (the planner then authors around it), rather than
merely offering it. That materially changes live-create behavior and should not
land unilaterally in the hackathon window, so I have only recorded it here.

---

## 2. Canvas builder (plan M1 + core of M2)

A direct-manipulation film editor that compiles a typed `CanvasFilm`
**deterministically, zero tokens** into a composition and runs it through the
EXACT production gate. It is a cockpit over the engine — it never re-implements
injection.

### 2.1 New files

- **`studio/canvasModel.ts`** — the typed canvas state (scenes → stations →
  catalog components + beats; per-scene camera path over `data-camera-world`
  cells; outgoing cut). Re-exports the engine vocabularies (`CAMERA_MOVES`,
  `COMPONENT_KINDS`) so the editor and runtime can't drift. `validateCanvasFilm`
  is the cheap structural guard (kebab ids, film-global unique `data-part` ids,
  camera targets in-scene, moves inside the window). `starterCanvasFilm()` is a
  gate-safe 3-scene starter (hook → proof → cta) so a blank workspace is
  immediately previewable.
- **`studio/compileCanvas.ts`** — the load-bearing compiler. `compileCanvasFilm`
  emits the DOM (world plane + `data-region` cells + catalog markup + entrance
  tweens + declared moments), then hands `{html, storyboard}` to the REAL
  `applyDeterministicSourceRepairs`, which injects every host island (camera,
  components, cuts, fx, time — time-wrap LAST). `renderCatalogComponent` reuses
  `COMPONENT_CATALOG` markup **verbatim**, substituting only the instance
  `data-part` and the primary copy slot (never forks the catalog, guardrail
  #12).
- **`studio/canvasSelfCheck.ts`** (`npm run studio:canvas`) — compiles the
  starter through validate → commit + browser QA → thumbnails. The plan §11
  golden-output smoke.
- **`test/studioCanvas.test.ts`** (7 tests) — fast structural guards:
  `validateCanvasFilm` accept/reject, catalog-markup reuse, **absolute camera
  times** resolve (the bug in §2.3), host-island injection, declared moments at
  settled times (never scene start), flat vs world scenes.

### 2.2 Backend + UI wiring

- `studio/workspaces.ts` — added `kind: "recipe" | "canvas"` + `canvas`
  (backward-compatible; existing recipe workspaces untouched),
  `updateWorkspaceCanvas` (checkpoints, invalidates a stale gate).
- `studio/gate.ts` — `gateCanvasWorkspace` compiles the canvas and runs the
  identical `validateDirectComposition` → `commitDirectComposition` (browser QA)
  → `generateDirectThumbnails`. No recipe staging, no laxer referee.
- `studio/server.ts` — `GET /api/catalog` (live component markup + kit CSS +
  camera/ease/cut vocabularies + agent providers), `POST
  /api/workspace/:id/canvas`, canvas branch in `/generate`, a favicon 204, and
  `import "dotenv/config"` (so OpenRouter agents resolve the gitignored key,
  exactly like the bot + `sequence:check`).
- `studio/ui/index.html` — rewritten as a **two-mode** app (the recipe cockpit
  is preserved unchanged; canvas workspaces get the editor). Canvas mode:
  scene rail, **World** view (stations rendered LIVE from the catalog + kit CSS,
  select component/station), **Preview** (the gated composition iframe +
  scrubber), a **timeline** strip (scenes / camera / beats, click to seek), a
  **component browser** (23 kinds, click to place), and a context **inspector**
  (scene: title/duration/cut/camera path with **verb + target + ease + zoom +
  timing**; station: region/cell; component: id/copy/role/**beats**).

### 2.3 Bugs I found by looking (not by trusting the gate)

1. **Blank scene-start thumbnails.** Synthesized moments landed a "scene-entry"
   moment at the scene boundary → the thumbnail was a bare keylight glow (the
   "gray circle in a void" class the operator warns about). Fix: the compiler
   now **declares** moments at settled entrance/beat times (never scene start),
   with `data-part` subjects where possible. Verified: every scene's first
   thumbnail now shows content.
2. **The camera never traveled.** Every proof-scene thumbnail showed the
   *context* station ("What changed"), never the stat-card the camera was
   supposed to push into. Root cause: the engine resolver expects **absolute**
   composition times, but the compiler emitted **scene-relative** ones, so
   `resolveCameraPlan` silently returned zero scenes and no camera island was
   injected. Fix: the compiler shifts each move by `scene.startSec` (the canvas
   model keeps scene-relative times because that is the right operator-facing
   unit). Verified: the push-in now lands on the stat-card; a regression test
   guards it.

### 2.4 What the canvas does NOT do (honest scope)

- **Cursor paths + `clickAnchor` snapping** (plan §4.3) — not built; no
  `clickAnchor` catalog metadata added.
- **Text/backdrop effect presets** (`studioKit.ts`, plan §5.3–5.5) — not built.
- **Holds / `timeRamp` placement UI** (plan §4.4) — not surfaced in the editor
  (the compiler doesn't emit ramps).
- **Custom ease-curve graph editor** (plan §4.2 v2) — the ease *picker* exists;
  the graph editor does not.
- **Scene → recipe promotion** — the "Promote scene→recipe" button is a visible
  **disabled stub**; extracting a recipe fragment from a canvas scene (§7) is
  not implemented. The canvas builds full films; the existing recipe-fragment
  flow is separate.
- **Reliability caveat:** the compiler is tuned so *reasonable* layouts gate
  green (the starter does). A too-sparse operator scene (e.g. one small button
  alone) will draw a real liveness/coverage finding — by design (the plan wants
  findings as visible advice), not a guarantee that any arbitrary layout passes.

---

## 3. Agents (plan M3 core)

The chat layer: a provider abstraction with an in-process OpenRouter critic and
a file-first Claude Code CLI agent, refereed by the real gate.

### 3.1 New files (`studio/agents/`)

- **`context.ts`** — context composed identically for every provider (workspace
  state summary + last gate findings + determinism/contract authoring rules),
  `writeAgentMd` (generates `AGENT.md` in the workspace for CLI agents), and
  `regateComposition` (re-runs the production gate on an agent-edited
  composition — no laxer referee).
- **`openrouter.ts`** — in-process critic/advisor via
  `PROVIDERS["openrouter-api"].complete` with `modelPolicy` model ids (GLM
  creative, DeepSeek Flash light). Passes ref images to vision-capable models,
  degrades honestly (a visible "can't see images" note) otherwise. Never forks
  the prompt FILES — it composes a chat prompt from `context.ts`.
- **`cli.ts`** — the Claude Code file-first agent: spawns `claude -p
  --output-format stream-json --permission-mode acceptEdits --verbose` with cwd
  = the workspace, message on **stdin** (no shell escaping), parses stream-json
  into streamed text, persists the `session_id` for `--resume` per workspace.
- **`index.ts`** — the session runner: persists the transcript + ref images
  (`refs/<msgId>/`, never exported), dispatches to the provider, and — after a
  CLI turn (which edits files) — **re-gates the composition and streams the
  findings into the same feed** the operator and agent both see.
- Server: `GET/POST /api/workspace/:id/chat` (POST streams the turn as SSE);
  `/api/catalog` advertises the providers + `claudeCliAvailable`.
- UI: a chat pane in both modes with a provider switcher, streaming replies,
  and drag-in ref-image attachments.

### 3.2 What I verified LIVE

- **OpenRouter critic (DeepSeek Flash):** one real turn. It read the actual
  workspace state (quoted "hook 4.2s → proof 5.6s → cta 4.2s" and "push-in
  starts at 1.8s") and returned a specific, actionable fix. SSE streaming,
  context composition, and dispatch all confirmed working.
- **Claude CLI file-first agent:** one real turn (constrained to make no edits).
  It spawned, streamed via stream-json, and the **post-turn re-gate ran and
  reported "✅ gate GREEN · 10 thumbnails."** Spawn + stream-json parse +
  session write + re-gate all confirmed.

### 3.3 What the agents do NOT do / caveats (honest scope)

- **CLI sandboxing is a real caveat.** The CLI agent's cwd is the gitignored
  workspace dir, but `claude` can still see the parent monorepo from there (in
  my smoke it named a repo file as an edit target). `--permission-mode
  acceptEdits` auto-accepts edits. **Before this is trusted unattended, add
  diff-scoping** (reject/undo any edit outside the workspace subtree, e.g. via
  `--add-dir` restriction + a post-turn `git`-less diff check). Recorded in
  INTEGRATION.md as a TODO.
- **Live file-watcher:** the plan wants "file watch → debounce → re-gate." Since
  `claude -p` is a *bounded* one-shot turn, I re-gate **after** the turn instead
  (functionally equivalent for one-shot turns, simpler, no `fs.watch` races). A
  true live watcher for a long-running interactive agent is not built.
- **OpenRouter direct authoring/patching** through `requestDirectComposition` /
  `applyCompositionRepair` (plan §6.2) — the OpenRouter path is a **critic/
  advisor only**; it does not edit workspace files. File-first authoring is the
  CLI agent's job (as the plan intends), but the OpenRouter author/patch loop is
  not wired.
- **Codex CLI** (plan §6.3) — not built (Claude CLI only, as the plan's open
  question #2 permits).
- **Storyboard-frame ordering UI** (§6.4) — single/multi image attach works;
  the ordered-frames captioning strip is not built.
- **The export describe pass** (plan §7.5 step 2 / handoff milestone 4) — NOT
  built. The export mechanics + operator-editable metadata already existed
  (session 1); the light-model drafting call was deprioritized by the operator's
  scope choice (canvas + agents).
- **Library curation** (handoff milestone 5) — NOT done; the library still holds
  only `last-word-roulette`.

---

## 4. Verification actually run (every layer, honestly)

- `npm run typecheck --workspace @sequences/slack` — **clean**.
- `npm run test --workspace @sequences/slack` — **55 files, 714 tests pass**
  (707 prior + my 7 canvas tests). Includes the recipe-contract and
  sentinel closed-world tests (unchanged by me).
- `npm run studio:canvas` — starter canvas compiles → static gate + **real
  browser QA** + **10 thumbnails**, GREEN. **I inspected the thumbnails by eye**
  (headline, camera-framed stat-card counting up, progress bar, CTA).
- `npm run studio:golden` — the golden recipe re-proves GREEN, retrieval sanity
  OK, live retrieval surfaces it (I then reverted the incidental revision bump).
- `npm run film:demo` — the model-free golden film is unchanged.
- `npm run sequence:check -- --demo --no-mcp` — model-free path unchanged
  (5 thumbnails, no fallback).
- **Two paid `sequence:check` live creates** (proof-1, proof-2) — see §1;
  inspected planning artifacts, the shipped composition, and thumbnails by eye.
- **Live agent turns** — one OpenRouter critic turn + one Claude CLI turn
  through the running studio server (SSE), see §3.2.
- UI verified by loading the actual page in headless Chrome (puppeteer): no JS
  page errors; world view, component browser (23 kinds), timeline, and the
  context inspector render and switch on selection (screenshots reviewed).

**NOT run:** Docker gate, Railway/live-Slack flows, an MP4 render of a canvas
film, and any third paid create (two conclusively established the §1 finding).

---

## 5. Every file touched

**Created:** `studio/canvasModel.ts`, `studio/compileCanvas.ts`,
`studio/canvasSelfCheck.ts`, `studio/agents/context.ts`,
`studio/agents/openrouter.ts`, `studio/agents/cli.ts`, `studio/agents/index.ts`,
`test/studioCanvas.test.ts`, `RECIPE_STUDIO_REPORT_2.md`.

**Modified:** `studio/workspaces.ts` (canvas kind + state), `studio/gate.ts`
(`gateCanvasWorkspace`), `studio/server.ts` (dotenv, catalog, canvas + chat
endpoints, favicon), `studio/ui/index.html` (two-mode UI + chat),
`studio/INTEGRATION.md` (canvas + agent seams), `CLAUDE.md` (canvas + agents
note), `package.json` (`studio:canvas` script).

**Reverted (net zero change):** `src/engine/recipeContract.ts` and the
`last-word-roulette` recipe files (see §1).

**NOT touched by me** (pre-existing uncommitted work, left alone):
`SENTINEL_PLAN.md`, `SENTINEL_REPORT.md`.

**Live-pipeline code changed: none.** Everything shipped is additive studio
tooling under `apps/slack/studio/` + a new test + docs. `SLACK_SEQUENCES_RECIPES=0`
remains the recipe kill switch; the canvas/agents never run on Railway (the
server refuses `RAILWAY_ENVIRONMENT`).

---

## 6. Recommended next steps (in priority order)

1. **Close the recipe-declaration gap (§1).** Prototype a host-side
   auto-declare for high-confidence recipe matches (Sentinel-placed), then
   re-run the paid proof. This is the missing piece of "the agent WILL use it."
2. **Diff-scope the CLI agent (§3.3)** before it is used unattended.
3. **Export describe pass** (milestone 4) + **library curation** (milestone 5):
   with the canvas builder now able to click films together and the CLI agent
   able to refine them, building the §5.6 backlog is now a mechanical loop —
   build, gate, eyeball, export.
4. **Cursor paths + `clickAnchor`, effect presets, timeRamp/holds UI, scene→
   recipe promotion** — the remaining M2/§7 surface.
