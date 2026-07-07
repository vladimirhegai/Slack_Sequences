# SENTINEL_PLAN.md — the correctness-by-construction guard for Sequences authoring

**Status:** plan, to be implemented by a separate agent. Author: Claude (Fable), 2026-07-05.
**Deadline context:** Slack Agent Builder Challenge judging ≈ **Jul 13 2026** — 8 days.
Every phase below has a cut line so a half-finished Sentinel still leaves the bot
*better* than today, never worse.

**Mission:** fewer failures (no visible fallback in front of a judge), fewer paid
attempts (cost + wall-clock), while holding or raising motion-design quality.
Targets (measured, not vibes):

| Metric | Today (observed) | Sentinel target |
| --- | --- | --- |
| Hard authoring failures (fail-loud FAILURE.md) | 2 in the last day of probes | 0 across the Phase-5 probe set |
| Storyboard attempts per run (avg) | ~3 (431s receipt) | ≤ 1.5 |
| Source-author attempts per run (avg) | 2–4 | ≤ 1.5 whole-doc equivalents |
| Wall-clock to tier-1 (thumbnails posted) | ~15–25 min | ≤ 8 min |
| Wall-clock to tier-2 (MP4) | ~30 min | ≤ 14 min |
| Author prompt size | ~60–90k chars/attempt | ≤ 45k chars, enforced by test |
| Physical model requests per clean run | successful logical calls + failed calls + hedge launches | ≤ 5 |

---

## 1. Diagnosis — why we keep fallbacking (read this before coding)

The current architecture is **"model writes everything → host validates → host
regex-repairs → model retries the whole artifact."** Every hardening pass so far
(FALLBACKS.md class-C catalog, WS1–WS7) has strengthened the *detection and
repair* half. Nobody has shrunk the *surface the model can get wrong*. Evidence:

1. **Both 2026-07-05 incidents are host-owned paperwork the model transcribed
   badly.**
   - Incident 1: `stat-resolve` declared a camera path but had no
     `data-camera-world` plane; `palette-ship` declared component `cmd-palette`
     but no `data-part="cmd-palette"` element. Both are *fully derivable from the
     locked storyboard* — the host knows the plane must exist, knows every
     declared component id, and already stamps scene shells verbatim.
   - Incident 2: `sequences-interactions.version must be 1`,
     `sequences-camera.scenes must be an array` — the model hand-wrote JSON
     islands. `prompts/planning-director.md:529-535` **instructs the model to
     copy the interactions island verbatim**, and
     `applyDeterministicSourceRepairs` (compositionRunner.ts:2205-2280) then
     re-normalizes what it copies. A transcription task handed to a model is a
     standing invitation to a fallback.
2. **The prompt is a rule dump growing monotonically.** `planning-director.md`
   is ~37,000 chars; the author prompt adds skills (≤16k compact), frame.md,
   component reference, brief, locked storyboard JSON, and skeleton — 60–90k
   chars per attempt. The storyboard base prompt (compositionRunner.ts:4261+)
   is hundreds of lines of prose rules mirroring deterministic gates. Every new
   gate added prompt prose; more prose dilutes attention; dilution causes new
   misses; misses spawn new gates. **This is the doom loop.**
3. **Attempts are whole-document.** One unbindable `data-part` in one scene
   rejects a 38k-char document and re-buys all of it (12,288 output tokens ×
   up to 3 continuation segments). The storyboard rung is worse: up to 5
   reasoning calls at 30,720 tokens each, 360s timeout apiece — the second
   failure receipt shows `storyboard-plan: succeeded (3 attempts) — 431510ms`.
   Seven minutes to produce a *plan*.
4. **Repairs are accreted regex surgery.** `applyDeterministicSourceRepairs` is
   ~600 lines of string surgery inside a 6,796-line compositionRunner. Each
   FALLBACKS.md class-C row is one past live failure. The catalog can only grow
   reactively — there is no closed-world guarantee, which is exactly the user's
   fear: "there might be that ONE error."
5. **Retries re-run creative reasoning to fix arithmetic.** Pacing/moment
   findings that are mechanically fixable (retime by 0.3s, drop a third whip,
   clamp a move count) go back to GLM as findings-retries — a 2-minute
   reasoning call to do subtraction. `topUpStoryboardMoments` and the timing
   re-base proved the alternative works: normalize deterministically, accept.

**The Sentinel thesis: move every mechanically-decidable obligation OFF the
model.** Detection stays (the gates are the quality moat); what changes is that
whole classes become host-owned or mechanically repairable instead of merely
detected, and attributable retries become *scene-scoped* instead of
*document-scoped*. Interior bindings remain representable as missing, so L2/L3
stay as explicit backstops.

---

## 2. The Sentinel layer model (the core design decision)

Every contract obligation must live at exactly one of these layers, and every
new feature must be placed at the **lowest-numbered layer that can own it**:

| Layer | Name | Mechanism | Failure cost |
| --- | --- | --- | --- |
| L0 | **Schema** | Structured outputs / response formats; typed enums | zero — invalid output can't parse |
| L1 | **Scaffold** | Host-generated chassis the model fills; shipped binding coverage measured explicitly | zero — host code, unit-tested |
| L2 | **Normalize** | Deterministic repair/normalization (`applyDeterministicSourceRepairs`, storyboard top-ups) | zero paid attempts |
| L3 | **Static gate** | linkedom / regex / kitMarkupAudit — named findings before any browser | cheap findings-retry |
| L4 | **Browser gate** | measured truth (layout, temporal judge, eye-trace) | expensive; scene-scoped retry |
| L5 | **Model retry** | bounded re-author, rescue rungs | a paid attempt — last resort |

Today, camera worlds, component roots, islands, script order, and timeline
registration all live at L3/L5 with L2 band-aids. Sentinel moves them to L1.
Prose in the prompt is reserved for **creative judgment the model must
internalize** (pacing feel, energy curve, one-focal discipline, silhouette
rhyme); every mechanical rule gets deleted from the prompt when its layer moves
down. **A gate at L3+ that could have been L0/L1 is a Sentinel violation.**

---

## 3. Workstreams

### Phase 0 — telemetry baseline (½ day; do first, never cut)

You cannot claim the targets without numbers.

- Add `planning/sentinel-run.json` per job (extend the existing
  `persistAuthorRunSummary` pattern): per-stage wall-clock, model-call count,
  prompt chars, completion chars, attempt outcomes by layer (which layer caught
  each finding), and final disposition (`published | published-degraded |
  fallback | fail-loud`). Reuse `stageTimings.ts` observations; do NOT change
  ETA behavior.
- Add `scripts/sentinel-report.mjs` (or a `npm run sentinel:report` tsx script)
  that aggregates all `sentinel-run.json` + `author-run.json` under a directory
  into one table. This is the before/after instrument for the audit.
- Baseline: run `npm run sequence:check` with the three canonical probe briefs
  (§7) once, record the numbers in `SENTINEL_REPORT.md` (the implementer's
  report, §8).

**Acceptance:** report script produces the metric table for a real run.

### Phase 1 — kill model-owned paperwork that already burned runs (1–1.5 days)

Small, surgical, each item deletes a live failure class. All in
`compositionRunner.ts` + `prompts/planning-director.md` unless noted.

1. **Interactions island becomes host-owned, always.** The host already
   injects/normalizes it (compositionRunner.ts:2205-2280). Make injection
   unconditional-authoritative: after parse, **delete every model-authored
   `sequences-interactions` / `sequences-camera` / `sequences-components` /
   `sequences-cuts` island unconditionally** and re-inject canonical islands
   from the locked storyboard (today `stripUnusedHostPlanIslands` only removes
   islands with *no* matching plan — a model island that shadows a real plan
   survives until validation). Then **delete the copy-the-island instruction**
   from `planning-director.md:529-535` and every mention that the author writes
   islands. The model must never see island syntax again.
2. **Camera-world plane in the mandatory skeleton.** The `## Mandatory scene
   skeleton (copy verbatim)` section (compositionRunner.ts:5448-5457) currently
   emits bare `<section>` shells. For any scene whose storyboard declares a
   camera path, emit the shell **with the plane and stations included**:
   `<section …><div data-camera-world style="<exact size from
   cameraWorldStyle()>"><div data-region="hero-claim" style="<exact rect from
   worldLayout>">…</div>…</div><div data-camera-overlay></div></section>`.
   `reconcileCameraWorldPlanes` and the worldLayout rect math already exist —
   reuse them to *generate* instead of *repair*. Scenes without camera paths
   keep bare shells.
3. **Component roots in the skeleton.** For every declared component, the
   skeleton includes its root element inside the correct station:
   `<div class="cmp cmp-command-palette" data-part="cmd-palette"
   data-component="command-palette">…interior yours…</div>` — kind class and
   `data-part` stamped by the host from the storyboard. The kit CSS
   (`sequences-components.v1.css`) already owns structure, so a host-emitted
   root is guaranteed bindable. `component_root_missing`,
   `component_beat_unbound`, and the cmd-palette alias class die by
   construction. Cut focal parts that name component ids are then also
   guaranteed present; for non-component focal parts, stamp an empty
   `data-part` carrier `<div data-part="…">` in the skeleton with a prompt note
   "style and fill this element; it is the cut's focal subject."
4. **Runtime script block + timeline registration seam emitted by the host.**
   `ensureRuntimeScriptOrdering` already builds the canonical block as a
   repair; emit it in the skeleton instead, plus the registration line
   (`window.__timelines["<id>"] = tl;` + compile calls in canonical order) as a
   literal the model copies once — and keep the L2 repair as backstop. Delete
   the corresponding prompt paragraphs ("load gsap only from…", script-order
   rules) — keep only the seek-safety creative rules.
5. **Fix the known false-reject:** the `gsap.timeline({ paused: true })` regex
   in `directComposition.ts` breaks on nested objects (FALLBACKS.md "Known open
   risks"). Replace `[^}]*` with a balanced scan or a two-step match. Add the
   regression test.
6. **Prompt deletions.** Every paragraph made redundant by items 1–4 is
   *removed*, not softened. Record before/after byte counts of
   `planning-director.md` in the report.

**Tests:** extend `test/authorReliability.test.ts` with replays of both
2026-07-05 incidents against the new skeleton path (the failure inputs are in
the incident text above); assert the skeleton emits planes/roots/islands;
assert a model-authored shadow island is replaced. `npm run film:demo` must
stay byte-stable or the diff explained (model-free path shares the gate).

**Acceptance:** both incident replays pass on attempt 1 with zero repairs
logged for those classes. Kill switch: `SLACK_SEQUENCES_SENTINEL_SKELETON=0`
reverts to bare shells.

### Phase 2 — scene-scoped authoring: tagged slots, slot retries (2 days)

The big cost/latency lever. **Decision: keep ONE authoring call for the whole
film** (coherence: shared CSS, motifs, copy voice) **but make the response
scene-addressable**, so validation, truncation, and retries operate per scene.

1. **Response format.** The author returns, instead of one `<index_html>`:
   - `<film_style>` — one shared `<style>` payload (design tokens usage,
     shared classes).
   - `<scene_html id="…">` per scene — interior of that scene's shell (the
     host owns the shell itself, per Phase 1).
   - `<scene_script id="…">` per scene — a statement block appended into a
     host-owned per-scene function `(tl) => { … }`; absolute times inside the
     scene window, exactly as today's rules require.
   The host assembles the canonical document deterministically: chassis +
   film_style + interiors + one timeline builder that invokes scene blocks in
   order, then the registration/compile seam. `extractIndexHtmlSource` grows a
   sibling `extractSceneSlots`.
2. **Slot-scoped validation.** Run `applyDeterministicSourceRepairs` + static
   gates on the assembled doc as today, but **attribute every finding to a
   scene** (kitMarkupAudit and most validators already carry scene ids in their
   messages — make the mapping explicit in code, not string-parsed).
3. **Slot-scoped retry.** A rejected attempt re-requests **only the failing
   scenes**: prompt = compact contract + frame capsule + that scene's storyboard
   entry + its shell/skeleton + its current interior + its findings. Budget
   ~4k output tokens, `thinkingMode: none`, and run failing scenes **in
   parallel** (`Promise.all`, the hedging/watchdog plumbing already generalizes).
   Cap: 2 slot retries per scene, then one whole-doc re-author (existing
   ladder) as the terminal rung. The existing patch mode
   (search/replace) remains only for browser-gate micro-repairs and the critic.
4. **Truncation becomes recoverable.** A response truncated mid-scene keeps
   every completed `<scene_html>` and re-requests only the missing tail —
   delete the whole-doc continuation machinery (`MAX_AUTHOR_SEGMENTS`) once
   probes confirm.
5. **Flag-gated:** `SLACK_SEQUENCES_SENTINEL_SLOTS=1` enables; the legacy
   whole-doc path stays intact until Phase 5 probes pass. Both paths share
   Phase-1 skeletons.

**Why this preserves quality:** creative authority is untouched — concept,
storyboard, copy, layout-within-station, entrances, easing all stay with the
model; one call still sees the whole film. What the model loses is the ability
to break paperwork in scene B while fixing scene D.

**Tests:** slot parse/assembly unit tests (including a truncated fixture);
determinism test that assembly is byte-stable for fixed inputs; a browser test
that an assembled two-scene composition passes the existing gate
(`test/directComposition.test.ts` conventions).

**Acceptance:** on the probe set, a seeded single-scene failure costs one
~4k-token call, not a 12k+ re-author; wall-clock for a retry run drops
accordingly (report numbers).

### Phase 3 — storyboard normalization + ladder/latency retune (1 day)

1. **Normalize-before-retry at the storyboard gate.** Extend the parse-side
   normalization family (`topUpStoryboardMoments`, timing re-base,
   `dedupeRedundantBeats`) with arithmetic fixes currently thrown back at GLM:
   clamp camera-move counts to the pacing ceiling (drop the lowest-energy
   extra move), drop the 3rd+ whip, stretch a marginal reading-floor miss by
   shifting the following cut within slack, merge the serial pan+push-in pair
   (host already merges at compile — accept at plan time too). **Decision
   rule:** if the fix deletes/degrades/retimes without inventing content →
   normalize + log `sentinel-normalized:*`; only creative deficits (no
   high-energy peak, slide-like scene, missing narrative surface) go back to
   the model. Keep every normalization visible in STORYBOARD.md.
2. **Ladder retune (only after 1 lands):** primary storyboard rung 3→2
   attempts (normalization absorbs the arithmetic rejections that used to eat
   a rung); rescue rung unchanged. Author ladder stays 3 but slot retries make
   attempts cheap. Do NOT raise any counts (ROADMAP operator lever stands).
3. **Storyboard reasoning budget:** drop `REASONING_STORYBOARD_MAX_TOKENS`
   30,720 → 20,480 **only if** probe storyboards stay clean at 2 rungs; the
   431s receipt says reasoning length, not artifact size, is the sink. Measure,
   don't guess — keep it if quality moves.
4. **Critic gating.** Skip the continuity critic when the draft is already
   clean: `browserQualityPenalty == 0`, all moments bound, no advisories above
   threshold — saves 1–2 calls (~1–2 min) on good runs. Always run it when any
   polish finding shipped. Keep `SLACK_SEQUENCES_CREATIVE_CRITIC=0` semantics.
5. **Shipping policy upgrade (the WS6 remainder, quality lever):** when the
   least-bad pick still carries a measured `camera_framed_clipped`/`_sparse` /
   `cut_degraded` on a **hero** frame, spend ONE slot retry on the offending
   scene (Phase 2 makes this cheap) before shipping least-bad. This directly
   attacks "sometimes it's messy" without loosening any gate.

**Acceptance:** probe-set storyboard attempts avg ≤1.5; no quality regression
on the golden film; report shows normalization log lines instead of retries.

### Phase 4 — the contract manifest + the ruleset (1 day; documentation is load-bearing)

This is the "airtight system + how to extend it" the project owner asked for.

1. **`src/engine/sentinel.ts` — the contract registry.** One typed table:
   `{ id, layer: "schema"|"scaffold"|"normalize"|"static"|"browser",
   blocking: "impossible"|"deterministic-repair"|"blocking"|"advisory-late"|"advisory",
   findingPrefixes: string[], promptCostChars: number, test: string,
   addedBecause: string }` for every contract obligation (cuts, camera,
   components, interactions, pacing, moments, liveness, eye-trace, exits,
   coherence, layout, markup-audit, runtime invariants). A unit test walks the
   registered `findingPrefixes` against the validators' emitted strings so an
   unregistered finding class fails CI — the closed-world guarantee the
   catalog never had.
2. **Prompt budget test.** `test/promptBudget.test.ts`: assert
   `planning-director.md` ≤ its post-Phase-1 byte count + 10%, and assert the
   assembled author prompt for a fixture job ≤ 45k chars. Growing the prompt
   now requires consciously raising a tested ceiling in a diff a reviewer sees.
3. **`SENTINEL.md`** (new, beside FALLBACKS.md) — the auditable system doc:
   - the layer model (§2 above) and the placement decision tree;
   - the **feature-addition protocol** (below), written for future agents
     (Recipes / Recipe Studio, MOTION_DESIGN_PLAN, screenshot ingestion);
   - the generated (or hand-synced) contract table from `sentinel.ts`;
   - budgets: attempt ladders, token budgets, wall-clock targets, and the
     telemetry files that prove them.
4. **Feature-addition protocol** (the exact text to include, refine wording as
   needed):
   1. Write the obligation as one sentence: *"X must hold or the film is
      wrong."*
   2. Place it at the lowest layer that can own it: Can the host emit it
      (scaffold)? Can a schema make violations unparseable? Can a
      deterministic normalization fix violations without inventing content?
      Only then a static gate; only for measured-pixels truth a browser gate.
      **Never add a prose rule + post-hoc gate pair without writing down why
      L0–L2 can't own it.**
   3. Register it in `sentinel.ts` (CI enforces).
   4. Prompt text only for creative judgment; it must fit the budget test.
   5. Add the minimized-replay regression test (authorReliability convention:
      recoverable case recovers, ambiguous case stays blocking).
   6. Decide degrade-vs-block per the FALLBACKS.md principle (unambiguous →
      recover/degrade honestly; ambiguous → block loudly).
   7. One paid probe (`sequence:check`) before calling it live; record its
      project dir in the PR/report.
5. **Doc updates:** FALLBACKS.md gets a pointer ("new classes go through
   SENTINEL.md placement first — the catalog is the L2 ledger, not the
   default"); apps/slack/CLAUDE.md + `.claude/skills/slack-map` get a short
   Sentinel section; ROADMAP.md logs the change like prior WS entries.

### Phase 5 — probes, flip, judge-readiness (1 day + slack)

1. Probe set (§7), Sentinel flags ON, fail-loud ON. All three must publish
   `hyperframes-direct` with zero fallback and meet the latency targets.
2. One revise + one undo on a probe job (the slot path must not break
   `directRevisionRouter` / `tweakRunner` — revision keeps whole-doc patch mode).
3. Flip defaults: `SENTINEL_SKELETON` and `SENTINEL_SLOTS` default ON; legacy
   paths stay behind `=0` for one release, delete after the hackathon.
4. Docker + `railway up` + sandbox smoke per CLAUDE.md ladder; re-check the
   pre-judging checklist (set `SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK=1`
   on Railway before judging — existing FALLBACKS.md instruction).

**Cut lines if time runs out:** Phase 1 alone removes both observed failure
classes — ship it even if nothing else lands. Phase 2 can ship with slot
*validation attribution* but whole-doc retries (still improves diagnosis).
Phase 3 items are independent — land normalization first, retune last. Phase 4
docs can trail the code by a day but must exist before the audit.

---

## 4. Explicit decisions (so the implementer doesn't re-litigate)

1. **No full multi-agent rewrite.** No per-scene independent model calls for
   the *first* pass, no new orchestration framework, no changing providers.
   One coherent authoring call + slot-scoped retries is the risk-appropriate
   move 8 days out. "Change how agents interact" = change the *artifact
   boundary* (slots), not the agent topology.
2. **Gates are never loosened.** Sentinel changes *where* obligations are
   enforced, not *whether*. The sanctioned cost levers remain hedging,
   watchdogs, caches, pooling, plus the new: scaffold, slots, normalization,
   critic gating. Prompts shrink only by deleting rules made redundant at
   L0–L2.
3. **Degrade-never-veto stands** (FALLBACKS.md principle). Sentinel adds:
   *normalize-never-retry* for arithmetic, and *slot-retry-before-least-bad*
   for measured hero-frame defects.
4. **The demo/fallback/film:demo paths stay byte-stable** unless a diff is
   explained in the report — they are the judge-day safety net.
5. **Everything new is flag-gated with the existing kill-switch culture** and
   every flag is listed in SENTINEL.md.
6. **Isolation rules unchanged:** no imports from paused apps, no `packages/*`
   edits, prompts convention respected (`prompts/*.md` for editable prose;
   generated skeletons/refs stay in code).

## 5. What Sentinel does NOT do

- Does not touch the context bot (`slackMcpContext.ts`) or Slack delivery.
- Does not add attempt rungs anywhere.
- Does not introduce a new "Sentinel model" — no extra paid calls except the
  bounded slot retries that *replace* whole-doc retries.
- Does not redesign frame.md / cinema kit / any host runtime contract.

## 6. Risk register

| Risk | Mitigation |
| --- | --- |
| Slot assembly breaks seek-determinism | Host-owned builder + existing static/browser gates run unchanged on the assembled doc; determinism unit test on assembly |
| Scaffolded stations constrain layout creativity | Stations carry exact rects the planner already chose (worldLayout); interiors and non-station decor remain free; monitor probe films for visual sameness |
| Scene-tag parsing is a new failure surface | Simple tags, fixtures incl. truncation; malformed slot → that slot retries, never the doc |
| Prompt deletions remove text a model silently relied on | Delete only paragraphs whose obligation moved to L0–L2; one probe after each deletion batch (Phase 1 acceptance) |
| Ladder retune under-provisions a hard brief | Retune only after normalization + probes; rescue rungs untouched |
| Deadline | Cut lines per phase; Phase 1 is independently shippable |

## 7. Canonical probe set (paid, ~3 runs per gate; use `sequence:check --no-mcp`)

1. **Dense-UI**: the Cursorflow-shaped brief (command-palette runs deploy;
   palette + modal + stat-card + button + terminal) — the `ws467-probe-2`
   lineage that historically kills source-author.
2. **Camera-heavy sparse-content**: a stat/dashboard brief forcing camera
   worlds + stations + a morph (the incident-1 shape).
3. **Long copy + interactions**: 30s+, typed copy reading floors, 2 cursor
   interactions, a timeRamp (pacing + interaction + warp coverage).

Record per run: project dir, disposition, attempts by stage, wall-clock by
stage, prompt chars, normalization log lines, findings by layer. Job dirs are
immutable — fresh `--job-id` per retry; export the OpenRouter key with an
absolute `.env` path (known harness gotcha).

## 8. The implementer's report (`SENTINEL_REPORT.md`) — required for audit

One file at `apps/slack/SENTINEL_REPORT.md`, updated per phase:

1. **Per phase:** what changed (files + why), deviations from this plan with
   rationale, flags added, tests added (names), commands run with outcomes
   (typecheck / slack tests / film:demo / mcp:demo / sequence:check project
   dirs), and the phase's acceptance-criteria verdict with evidence.
2. **Metrics table:** the §0 baseline vs post-Phase-5 numbers for every target
   in the mission table, from `sentinel:report`.
3. **Incident replays:** proof both 2026-07-05 incidents pass on attempt 1.
4. **Prompt diff summary:** byte counts of `planning-director.md` and one
   assembled author prompt, before/after.
5. **Open items:** anything cut, parked, or discovered, in FALLBACKS.md
   "known open risks" style.
6. Honest failures included: a probe that fell back goes IN the report with
   its FAILURE.md path, not silently retried into a clean table.
