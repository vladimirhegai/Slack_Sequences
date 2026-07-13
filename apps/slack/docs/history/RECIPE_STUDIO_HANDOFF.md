# Recipe Studio — handoff prompt for the next agent (session 3)

> ## ⚠️ SUPERSEDED (2026-07-10)
>
> Session 3 took a different direction on the owner's instruction: recipes are
> now agent-authored source files (`apps/slack/recipes/`, see its README), the
> studio became the combined read-only viewer (components + assets + recipes,
> `npm run studio`), and the canvas builder / agent chat / workspace store were
> removed. Items 1 (auto-declare), 3 (cursor paths + effect presets), and 5
> (library curation — now trivially agent-driven) remain open ideas; do NOT
> rebuild items this handoff assumes exist. See `docs/RECIPE_STUDIO_PLAN.md`'s
> pivot banner and `apps/slack/studio/INTEGRATION.md`.

Two build sessions are done (foundation, then canvas + agents). This is the
prompt for the agent who **finishes** the studio. Copy everything below the line
into that agent's prompt.

---

Your job is to COMPLETE the Recipe Studio on top of a foundation two agents
already built, then write a full report. Read, in this order:

1. `docs/RECIPE_STUDIO_PLAN.md` — the product plan (v2). Read the **Build status**
   section at the top first: it maps every milestone to what actually shipped.
   The vision: an operator runs one terminal command, a browser opens, they
   build a recipe animation on a canvas (direct manipulation first, chat
   second), click Export, and the live Slack Sequences agents can and WILL use
   it.
2. `apps/slack/docs/history/RECIPE_STUDIO_REPORT.md` (session 1 — the recipe format + host
   instantiation + gate/export foundation) and
   `apps/slack/docs/history/RECIPE_STUDIO_REPORT_2.md` (session 2 — canvas builder + agents +
   the honest paid-proof result). Their "what is NOT built" sections are your
   scope; do not rebuild what they built.
3. `apps/slack/studio/INTEGRATION.md` — the seam table you MUST keep true.
4. `apps/slack/CLAUDE.md` (isolation, Sentinel, publish ≠ deploy, prep-mode
   flag) and `apps/slack/SENTINEL.md` before touching any gate.

**Session-3 pre-read — what the 2026-07-07 final audit changed under you
(read before item 1; it sharpens WHY recipes matter):**
- **Recipes are the strongest attempt-economy lever the pipeline has.** The
  49-run Sentinel ledger shows every published run burning ~3 storyboard + ~3
  source attempts, almost all on polish churn (`layout_intent_missing`,
  `contrast_aa`, overflow, focal, sparse) that model patches provably never fix.
  A recipe scene is host-injected VERBATIM — it cannot mint any of those
  classes. Every scene a live create covers with a proven recipe is a scene
  that never enters the churn loop. Frame the auto-declare work (item 1) as
  cost reduction, not just adoption.
- **Export-gate rule to add while you're in there:** an exported fragment must
  be polish-clean by construction — it declares its own layout intent
  (`data-layout-important` / `data-layout-anchor` + `data-layout-tolerance`,
  as the golden roulette already does) and its copy passes AA contrast on the
  kit surfaces it ships. A recipe that ships polish findings re-imports the
  exact churn recipes exist to eliminate. Cheap to enforce in `gate.ts` (the
  gate already measures both).
- **New author-loop behavior you'll see in ledgers:** `stagnant-polish-early-ship`
  (a browser rejection identical to the previous attempt's ships the banked
  least-bad draft at attempt 2), `layout_intent_missing` now weighs 0 in the
  least-bad penalty, contrast findings dedupe per selector, and
  `spatial_focal_invisible` re-samples later instants before firing (QA cache
  v12). Source attempts of 2 with a `stagnant-polish-early-ship` degradation
  are the system working, not a regression. See SENTINEL.md "Attempt economy
  at the author stage".
- **Fixed this session (don't re-fix):** recipe workspaces re-gate through
  `gateWorkspace` after CLI-agent edits (fragment.html actually re-staged +
  re-proven; the gate record persists); canvas workspaces keep the direct
  composition re-gate with a real SHA-256 hash; the studio scaffold + golden
  demo roots carry `data-start="0"` (also an L2 repair,
  `normalize.root-data-start`).

**Already built and proven — do not re-implement; extend:**
- RecipeV2 format + Level-1 host instantiation (`src/engine/recipeContract.ts`,
  the sixth host-owned contract — strip-and-reinject, typed param slots, version
  fences); retrieval + storyboard schema + Sentinel L2 reconciliation +
  cache-key wiring (`compositionRunner.ts` / `skillContext.ts`); the golden
  `last-word-roulette` recipe (`npm run studio:golden`); `test/recipeContract.test.ts`.
- The studio server, workspace store, production-parity gate, RecipeV2 export
  with retrieval sanity checks (`apps/slack/studio/`).
- The **canvas builder** (`studio/canvasModel.ts` + `compileCanvas.ts`): world
  view, live catalog components, typed camera transitions, timeline, inspector;
  compiles a `CanvasFilm` deterministically → the real gate
  (`npm run studio:canvas` gates green). Reuses `applyDeterministicSourceRepairs`
  for injection — never re-implements it.
- The **agent chat** (`studio/agents/`): an OpenRouter in-process **critic**
  (GLM / DeepSeek-Flash) and a **Claude Code CLI file-first agent**
  (`claude -p --output-format stream-json --permission-mode acceptEdits`, cwd =
  workspace, `--resume` per workspace, generated `AGENT.md`), re-gated after
  every CLI turn. Image attachments under `refs/` (never exported).

**Your work, in priority order (each independently shippable; commit + run the
slack verification gate after each):**

1. **Close the recipe-declaration gap — the #1 open problem.** The paid proof
   failed: two creates whose brief named the roulette **declined the offered
   recipe and re-derived it** (REPORT_2 §1). A retrieval *offer* + teaching is
   too weak to convert a capable planner under gate pressure. Prototype a
   **host-side auto-declare**: when a recipe scores above a high threshold AND
   the brief clearly names its pattern, a Sentinel L1/L2 mechanism injects the
   `recipes:[{…}]` declaration into the best-matching scene (the planner then
   authors around the host-owned fragment), rather than merely offering it. This
   **changes live-create behavior** — gate it behind a flag, keep it
   degrade-never-veto, and do NOT let it destabilize the live bot in the
   hackathon window. Then re-run one paid `sequence:check` and verify with your
   own eyes: `data-sequences-recipe` in the shipped composition, the id in
   `planning/`, gate green, wheel visible in thumbnails.
2. **Diff-scope the CLI agent (REPORT_2 §3.3)** before it is trusted unattended:
   reject/undo any edit outside the workspace subtree (`--add-dir` restriction +
   a post-turn out-of-workspace edit check). Recorded as a TODO in INTEGRATION.md.
3. **Cursor paths + effects (plan §4.3–§5.5 — M2, the biggest builder gap).**
   Add per-kind `clickAnchor` metadata to `COMPONENT_CATALOG` (additive) +
   cursor-path editing with anchor snapping; `studioKit.ts` text/backdrop effect
   presets; holds / `timeRamp` placement in the editor. Every preset is a pure
   function of timeline time and passes the real gate.
4. **Export describe pass (plan §7.5 step 2).** A light-model call drafts
   recipe.md / triggerPatterns / tags / title / param descriptions from the
   workspace + chat history; operator reviews in the export wizard (the export
   mechanics + operator-editable metadata form already exist).
5. **Library curation (plan §5.6 — as time allows).** With the canvas builder +
   CLI agent, building recipes is now a mechanical loop: build, gate, **eyeball
   the thumbnails**, export. Ship 3–5 from the backlog (iris-fill CTA close,
   cursor demo click-through, KPI counter flythrough, notification stack
   cascade), each gated green.
6. **Optional:** OpenRouter direct authoring/patching (plan §6.2 — currently
   critic-only), Codex CLI, storyboard-frame ordering UI, scene→recipe promotion
   (currently a disabled stub), custom ease-graph editor.

**Hard rules:** every studio output passes the existing deterministic gate (no
laxer referee); reuse engine injection helpers (time-wrap stays LAST);
`.data/studio/` stays the mutable root (job dirs immutable); no new heavy deps;
secrets stay in gitignored `.env`; the studio never runs on Railway; gates are
never loosened — new obligations go to the lowest Sentinel layer that can own
them and every new finding class must be registered in `src/engine/sentinel.ts`
(the closed-world test enforces this); update `studio/INTEGRATION.md` for every
seam you touch; the recipe path stays degrade-never-veto with
`SLACK_SEQUENCES_RECIPES=0` as the kill switch. **Nothing may destabilize the
live bot before the Jul 13 hackathon deadline** — the auto-declare in item 1 is
the one live-pipeline change; branch it and hold it behind a flag.

**Verification:** `npm run typecheck/test --workspace @sequences/slack`,
`npm run film:demo`, `npm run studio:golden`, `npm run studio:canvas`, and
`npm run sequence:check -- --demo --no-mcp` must all stay green; inspect every
recipe's thumbnails **with your own eyes** (reports have said "pass" on films the
operator called a mess).

**When done:** commit locally, publish with `bash scripts/publish-public.sh
"<message>"` (pushes the standalone `vladimirhegai/Slack_Sequences` repo; it
archives HEAD, so commit first; publishing does NOT deploy — do not run
`railway up`). Then write `apps/slack/RECIPE_STUDIO_REPORT_3.md`: everything you
did, every file touched, every decision and why, every verification layer you
actually ran, and everything left undone — the operator audits reports against
the code.
