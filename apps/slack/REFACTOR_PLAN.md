# REFACTOR_PLAN.md — the canonical, resumable refactor + bug-fix plan

Status: **ACTIVE**. This file is the single source of truth for the refactor.
It supersedes the narrative in [REFACTOR_HANDOFF.md](REFACTOR_HANDOFF.md)
(keep that file — it is the architecture rationale; this file is the work
order).

Current boundary (2026-07-13): S6.9-S6.13 are complete and preserved below as
the final OpenRouter-era stabilization record. The live authoring contract is
now [LUNA_WORKFLOW.md](LUNA_WORKFLOW.md): one private Railway Codex worker, one
persistent `gpt-5.6-luna`/high director thread, and the deterministic direct-
composition gate. The old provider committee remains unchanged only as an
explicit rollback. S7+ in this historical plan stays frozen unless the owner
opens a new scoped engine step.

Do not interpret the first unchecked S7 checkbox as active work. For Luna,
audit existing taste-heavy gates and repair policy later from real artifacts;
do not pre-emptively weaken objective mechanics or rebuild the committee.

## Agent protocol — read this first, follow it exactly

1. Find the first step whose checkbox is `[ ]` (top to bottom). Steps inside a
   phase are ordered; phases are ordered. Do not skip ahead unless a step is
   marked `BLOCKED` with a reason.
2. Do exactly that step. Each step is sized for a fraction of one session and
   states its own verification. Do not batch several steps into one commit.
3. Verify with the step's listed checks, plus always:
   `npm run typecheck --workspace @sequences/slack` and the focused tests the
   step names.
4. Commit with the step id in the message, e.g.
   `refactor(slack): S2.3 branded viewer-time in pacing audit`.
5. **Update this file in the same commit**: tick the checkbox, and append one
   entry to the Step Journal at the bottom (step id, date, what changed, files
   touched, verification run, anything the next agent must know, deviations).
   If you discovered new work, add it as a new step in the right phase —
   never do it silently.
6. If you run out of budget mid-step: do NOT tick the box. Append a Journal
   entry marked `PARTIAL` describing exactly where you stopped and what state
   the tree is in.
7. Paid probes only where a step says so; every probe result goes to
   [PROBE_LOG.md](PROBE_LOG.md) AND a one-line pointer in the Step Journal.
8. Behavior-preserving first: any step that moves code must leave exact
   replays byte-identical unless the step explicitly says it changes output.

Read [SENTINEL.md](SENTINEL.md) before any step that touches gates, retries,
normalizers, or fallback. Read the "Golden demo — what good means" section
before any motion step.

## Why (evidence, 2026-07-11)

Aggregate over 157 recorded runs (`npm run sentinel:report`):

| Metric | Target | Observed |
| --- | --- | --- |
| Storyboard attempts / run | ≤ 1.5 | 2.43 |
| Source attempts / run | ≤ 1.5 | 2.89 |
| Wall-clock to tier-1 | ≤ 8 min | 14.9 min |
| Author prompt size | ≤ 45k chars | up to 137k |
| Physical requests / clean run | ≤ 5 | 10.2 |
| Dispositions | published | 34 published / 102 published-degraded / 21 fail-loud |
| L2 normalizations | small | 7,359 (interaction-binding 1,749 · layout-intent 1,185 · slot-script-envelope 593 · plugin-inject 487 · world-layout-derive 457) |
| Hedge duplicates | rare | 236 |

The engine is ~63.6k lines of src + ~35.7k of tests for a product whose golden
film is 618 hand-written lines. The refactor's purpose is not smaller code —
it is: **one attempt, one owner per fact, honest status, and directed motion.**

Hotspots (lines): layoutInspector 5,775 · runner/repairs 5,580 · runner/ladder
4,505 · componentContract 2,400 · pluginContract 2,359 · runner/storyboardAudit
2,309 · sentinel 1,895 · pacingAudit 1,717 · directComposition 1,688 ·
cameraContract 1,512.

Probe evidence: SignalDock (`architecture-stress-5-20260711`) and this
session's probes (see "Live probe findings" below and PROBE_LOG.md).

## Golden demo — what "good" means

Source: `demos/slack-ad` (618 lines total; render output
`demo-output/slack-ad-luna`). Analyze it before motion work; these are the
mechanics that make it good, stated as *measurable properties*, not taste:

1. **One dominant idea per act.** 7 acts / 28s. Every act has exactly one
   subject; everything else is subordinate. SignalDock had 14 camera phrases
   over 4 scenes — paperwork, not ideas.
2. **The field is calm; content is the frame.** White field; the wallpaper
   exists only inside the two desktop scenes and sits *behind* a real UI
   window that owns ≥60% of frame attention. Probe films invert this: loud
   full-frame wallpaper, floating translucent content.
3. **Measured geometry, no guessed coordinates.** Every landing (camera math
   `camAt`, mark dock slot, cursor press point) is computed from
   `getBoundingClientRect()` at identity transforms before any tween exists.
4. **Anticipation → action → settle → readable hold** on every gesture, with
   explicit hold windows in the timing (e.g. zoomed read hold 15.87–16.30
   before the pull-back; reaction pops only on a settled frame).
5. **One energy peak** (the 2.3× superzoom dive+pan, 14.3–16.3s). Everything
   else is connective or ambient. Ambient motion lives on wallpaper/cards/
   light — never on copy being read.
6. **Cause and effect chain.** Clutter → collapses into the mark → mark is
   clicked → product flow → proof → lockup. Each transition is motivated by
   the previous shot's action.
7. **State never resets.** The typed text, the created channel, the message
   thread persist across camera moves. (Probe films reset metrics to 0% at
   every shot boundary.)
8. **Repeated transition grammar.** A small set of moves reused; not a zoo.
9. **Ends early, breathes.** Lockup lands ~24s; last 4s is a near-invisible
   1.4% scale breath. No motion after the resolve.
10. **Typewriters are physical** — width-reveal so the caret rides the edge;
    counts/carets are stepped, not eased opacity.

Translate these into constraints and host-owned mechanisms (Phases 4 & 8) —
never into more prompt adjectives.

## Live probe findings (this session, 2026-07-11)

> Keep this section updated as probes run. Full detail in PROBE_LOG.md.

- `refactor-review-normal-1-20260711` (Briefly, calm production-shaped brief,
  16s, fallback disabled): **published-degraded**, 24.0 min, 8 QA warnings.
  Full entry in PROBE_LOG.md. What it proves, step by step:
  - Storyboard: 1 logical / 3 physical streams + 2 hedges (provider
    timeouts) → S1.1 ledger; a single >18-min mega-call dominates tier-1
    latency.
  - ~11 sentinel normalizations rewrote plan timing, including collapsing
    the authored 2.2s/3.2s staggered arrivals to 0.28s — a normalizer erased
    the intended one-by-one storytelling → S5.3 (registry with declared
    write-sets) and the Phase 3/8 principle that hosts must not "direct by
    committee".
  - Author attempts 1→2 repeated the SAME three GSAP-null-target warnings
    (NodeList/empty/null dataflow forms) → S5.4; repair prompts hit
    107k/110k chars → S6.1; attempt 3 changed the locked scene count and was
    atomically rejected; attempt 2 early-shipped as "browser-valid" with
    open quality findings → S1.3.
  - Film: small windows adrift on a loud wallpaper (`camera_framed_sparse`
    6–10% painted, `composition_washed_out`), low-contrast row text,
    mid-word headline wrap ("th / e loop"), story-mismatched seeded plugin
    copy, 1.2s empty opening → S8.1 and a new step S8.6 below.
- SignalDock (`architecture-stress-5-20260711`, previous session) agrees on
  every class from the stress side; see PROBE_LOG.md.
- LP-1 (`phase3-lp1-camera-20260711-a…e`, 2026-07-11/12): Phase 3 checkpoint
  **passed** — landings 7/7, occupancy 7/7, ≤1 route/scene, no new QA class.
  Residue: `motion_jerk_excess` (repeated across source attempts, shipped as
  the single quality residue) → S8.4; edge-cropped count-up numerals,
  near-black owner scene, loud wallpaper swipe covers → S8.1/S8.6. Full
  entry in PROBE_LOG.md and PHASE_3.md.
- LP-2 (`s4-lp2-state-20260712`): **inconclusive** — the paid metric-
  continuity run failed before authoring at the existing Phase-3
  `camera/idea-budget` gate (`shot-4-owner-verifies` declared two lens ideas).
  Five exact storyboard replays reproduce that rejection; no source, render,
  temporal, or state-handoff evidence was produced. Full entry in
  PROBE_LOG.md. The checkpoint remains outstanding; no second paid attempt was
  launched because the fix-first rule blocks retries on the repeated planning
  class.
- LP-2 follow-up (`s4-lp2-state-20260712-b`, `-c`, `-d`, `-d-resume`):
  **still inconclusive before authoring**. Fix-first stops produced three
  deterministic repairs (semantic camera identity, no quantitatively worsened
  atomic moment gap, metric kind reconciliation). Exact affected artifacts
  converge and digit-leading scene slugs now canonicalize, but the final fresh
  response still carried planner-owned two-station lens and read-hold findings.
  No fallback, source, render,
  temporal, or state-runtime evidence was produced; full ledger in
  PROBE_LOG.md.
- LP-3 sequence (`lp3-state-capsule-20260712-a…j`): A-D exposed prompt budget,
  hero-modal camera grouping, and missing canonical progress-fill ownership;
  E-I then reached source/runtime convergence. ProofGrid I published a real
  non-fallback MP4 after its first storyboard and first full source response,
  but deterministic/critic work still produced 7 logical / 10 physical calls
  and two washout advisories. ProofLane J was deliberately stopped at its first
  browser QA because its fully visible 12% headline, parent/child surface
  overlap, and unsettled opener were taste evidence rather than justification
  for another repair loop. J has no terminal ledger or MP4, so its call count
  is not guessed. Full E-J evidence is now in PROBE_LOG.md; the next action is
  S6.9, not probe K.

## Staffing guide — which agent runs which steps

Two tiers: **HEAVY** (most capable/expensive model, high reasoning — for
coupled architecture, subtle byte-stability, and anything that judges motion
from rendered frames) and **LIGHT** (cheaper model — for mechanical,
test-verifiable work). When a phase mixes tiers, the HEAVY agent should do
the first step and leave crisp notes so a LIGHT agent can finish.

| Steps | Tier | Why |
| --- | --- | --- |
| S0.1 triage tool, S0.2 replay:all, S0.4 census | LIGHT | Read JSON/format reports; verified against recorded runs. |
| S0.3 dead file | LIGHT | Trivial, test-verified. |
| SP.1–SP.5 purge | LIGHT | Wide but mechanical; strong verification (root tests + slack fast loop + demo). Follow the steps literally; delete nothing outside the listed paths. |
| S1.1 attempt ledger | HEAVY | Must understand 4.5k-line ladder and reproduce counters exactly. |
| S1.2–S1.3 status derivation | LIGHT→HEAVY review | Mechanical once S1.1 exists; the rename semantics (S1.3) need HEAVY sign-off. |
| S2.1 time types | LIGHT | Well-specified, property-tested, pure. |
| S2.2 cascade retime | HEAVY | Byte-stable replays across pacing/ramp normalizers — subtle. |
| S2.3 audit migration | LIGHT | Mechanical after S2.2, grep-verifiable. |
| S3.1–S3.4 camera phrase | HEAVY | The hardest coupling in the codebase (blocking/runtime/QA unification). Keep one agent across all four steps if possible. |
| S4.1–S4.2 state handoff | HEAVY | Browser seek semantics + continuity graph. |
| S5.1–S5.2 megafile splits | LIGHT | Large but mechanical moves; byte-identical replay is the referee. |
| S5.3 normalizer deps | HEAVY | Declaring read/write sets and ordering needs real judgment. |
| S5.4 dead-dataflow check | LIGHT | Bounded, fixture-driven. |
| S6.1 prompt diet | HEAVY | Judging which prose is redundant vs load-bearing. |
| S6.2 basis gate | LIGHT | Small typed check + fixture. |
| S6.3 studio capsule | LIGHT build + HEAVY probe read | Counters are mechanical; the conversion judgment isn't. |
| S6.9-S6.13 hackathon stabilization | LUNA high/xhigh only if delegation is necessary | Guardrail classification and rendered acceptance require judgment; keep delegation narrow and do not create a probe swarm. |
| S7.1–S7.3 flags/dead exports/compat | LIGHT | Evidence-driven deletion with full-suite verification. |
| S8.1–S8.5 motion gates | HEAVY | This is taste-to-measurement translation from the golden demo; requires reading rendered frames. |
| S9.1 probe:run tool | LIGHT | Wraps existing scripts. |
| S9.2 playbook doc | LIGHT | Documentation. |
| S9.3 acceptance probes | HEAVY | Paid probes + motion judgment; also every "one live probe" tail in Phase 8. |

Rules of thumb: anything whose verification is "exact replay byte-identical +
tests" can go LIGHT; anything that changes what ships visually, touches the
ladder/camera coupling, or interprets rendered evidence goes HEAVY. A LIGHT
agent that finds itself making a judgment call must stop, journal `BLOCKED`,
and leave it for a HEAVY agent — that is cheaper than a wrong guess.

## Live-probe checkpoints — when reality gets a vote

A live probe is the only proof the architecture works end-to-end; replays and
tests only prove we didn't change behavior. But probes cost real money and
20–40 minutes, so they run at **fixed checkpoints**, not per step. Every probe
needs explicit owner authorization, uses a cache-distinct brief + job id with
fallback disabled, and ends with `probe:triage` + a PROBE_LOG.md entry + a
Step Journal pointer. The fix-first policy always applies: a repeated
mechanical class blocks further probes until it is fixed and replayed.

| Checkpoint | When | What it must prove |
| --- | --- | --- |
| **LP-0 baseline** | DONE (SignalDock + `refactor-review-normal-1`) | The defect classes this plan targets. Compare every later probe's triage against these two. |
| **(no probes)** | Phases 0, P, 1, 2, 5, 7 | Behavior-preserving phases. The referee is `replay:all` + suites + the golden render. If a step here changes replay output unexpectedly, STOP and fix — do not "check with a probe". |
| **LP-1 camera** | DONE 2026-07-12 (`phase3-lp1-camera-20260711-e`; see PROBE_LOG.md) | One stress-shaped probe (SignalDock-style brief). Triage vs LP-0: phrase count collapsed (≤1 primary route/scene), landings readable/in-range, occupancy in range, no new QA class. **PASSED on all four criteria** after four fail-loud runs each fixed a deterministic Phase 3 integration defect. |
| **LP-2 state** | After S4.2 (Phase 4 complete) | One metric-continuity brief (value develops across ≥3 scenes). No reset flicker, morphs honest, reverse-seek clean. May combine with LP-1 into one probe if Phases 3+4 land together. |
| **LP-3 prompt diet** | After S6.1 (and S6.3's capsule probe folds in here) | One normal probe. Prompt changes alter MODEL behavior — replays prove nothing here. Watch: attempts, parse failures, findings-retry classes vs LP-0; acceptance quality must not drop. |
| **LP-4 per motion gate** | Tail of each S8.x that says so | One probe each: the new gate fires on real output without false-positives on the golden film. |
| **LP-5 acceptance** | POST-HACKATHON / PAUSED at S9.3 | Original long-term target: one clean stress probe plus one clean normal probe. It is not the current definition of done. |
| **Hackathon stabilization override** | ACTIVE at S6.9-S6.13 | One ordinary 14-18s brief. Stop at the first runtime-valid, human-acceptable MP4; allow only one rerun after a hard/judge-visible failure is replayed and fixed. Advisory-only `warn` is acceptable. |

The older ~6-8-probe refactor budget and LP-4/LP-5 acceptance loop are paused
until after the hackathon. The active stabilization section permits at most two
new paid probes total. If probe A is acceptable, there is no probe B; if it
fails hard, the exact replay + deterministic fix is free and only then may the
same semantic brief run once more. Count every call honestly in PROBE_LOG.md.

---

# Phase 0 — Tooling and safety net (do this before any code moves)

### S0.1 `probe:triage` — one command that reads a job and says what happened
- [x] Add `scripts/probeTriage.ts` + npm script `probe:triage -- <jobId>`.
  Reads `planning/sentinel-run.json`, `planning/author-run.json`,
  `build/qa/sequence-check.json`, `planning/attempts/*` and prints ONE
  markdown triage: disposition; logical/physical calls per stage; every
  degradation + fallback with its stage and reason; every QA finding class
  with count and whether it is **new** (not in the registry's incident list)
  or **known**; and absolute paths to the evidence to open (MP4, temporal
  strip, blocking overlay, per-moment thumbs, rejected artifacts). End with
  the SENTINEL placement reminder: replay first, fix the lowest owner, add a
  regression, log in PROBE_LOG.md. Also emit `triage.json` next to the report
  for programmatic consumption.
- Verify: run it against `architecture-stress-5-20260711` and this session's
  probe; output matches PROBE_LOG.md's recorded numbers.
- This tool is the backbone of the continuous probe loop (Phase 9); build it
  first so every later step's probes are cheap to read.

### S0.2 Freeze behavior fixtures
- [x] Ensure exact rejected artifacts for LaunchRelay, PulseForge, GatePilot,
  RelayGuard, SignalDock (+ this session's probes) replay green via
  `npm run storyboard:replay` / the strict source replay path, and wire them
  into a single `npm run replay:all` script that exits nonzero on any drift.
  Do not copy artifacts into the repo if size forbids; reference
  `.data/projects/<job>/planning/attempts/` and skip-with-warning when a
  fixture is missing locally.
- Verify: `npm run replay:all` green at HEAD.

### S0.3 Delete dead code: `planRunner.ts`
- [x] `src/engine/planRunner.ts` has zero importers (the demo Plan path uses
  `@sequences/core` `planToCommands` directly from `orchestrator.ts` /
  `engine/mcp.ts`). Delete the file and any orphaned tests.
- Verify: typecheck + `npm run test:unit` + `npm run demo` (model-free).

### S0.4 Unused-export census (mechanical, no deletions yet)
- [x] Add `scripts/deadExports.ts` (or wire `ts-prune`) listing exports with
  zero external references across src/studio/scripts/test. Commit the report
  to `.reports/dead-exports.md`. Mark candidates; actual deletions happen in
  S7.x after the moves settle.
- Verify: script runs clean; report committed.

### S0.5 Fix stale doc pointers (workspace-level)
- [x] Root `CLAUDE.md` and the orientation skill referenced deleted docs
  (ARCHITECTURE.md, ROADMAP.md, FALLBACKS.md, ASSETS.md, …) and a pre-runner
  file layout. DONE 2026-07-11: `.claude/skills/slack-map` was replaced by
  `.claude/skills/sequences` (current doc set + runner layout), `forge-map`
  deleted, root `CLAUDE.md` rewritten to the Slack-only reality. The
  2026-07-12 doc sync made `.agents/skills/sequences` the tracked canonical
  source and kept the ignored `.claude` mirror byte-identical. If layout
  changes again, update both in the same commit.
- Verify: `rg -n "ROADMAP.md|FALLBACKS.md|slack-map" CLAUDE.md
  .agents/skills/` returns nothing.

---

# Phase P — Monorepo purge: this repo is now just Slack Sequences

Owner decision (2026-07-11): Forge and the old Sequences studio are
**deprecated, not paused**. Delete everything that is not Slack Sequences or
one of its real dependencies. `apps/slack` depends on `@sequences/core`,
`@sequences/platform` (workspace packages — KEEP) and `@hyperframes/*@0.6.86`
from the npm registry (no vendored path — verified). Golden rule for every
step: delete, then prove the Slack surface still works
(`npm run typecheck --workspace @sequences/slack`, `npm run test:unit
--workspace @sequences/slack`, `npm run demo --workspace @sequences/slack`,
plus root `npm test` and root `npm run typecheck` for the kept packages).

### SP.1 Delete the retired apps
- [x] `git rm -r apps/forge apps/sequences examples/forge examples/sequences
  fixtures/sequences`. Root `package.json`: remove the `bin` entry
  (`apps/sequences/src/cli.ts`), the `sequences*`, `forge`,
  `compile:example`, `render:example`, `test:perf`, `test:forge-ui`,
  `test:golden` scripts, and fix `test:ci`. Delete
  `scripts/forge-ui-smoke.mjs`, `scripts/golden-renders.mjs`,
  `scripts/perf-budget.mjs`, `scripts/ui-smoke*.mjs`. Check
  `vitest.config.ts` and root `tsconfig.json` include/exclude lists still
  resolve (they glob `apps/*`; nothing should break, but run the suites).
  Known bonus: the pre-existing failing forge knowledge-retrieval test
  disappears with the app.
- Verify: root `npm test` green (packages only), root `npm run typecheck`
  green, slack fast loop green, `npm run demo --workspace @sequences/slack`.

### SP.2 Delete retired docs; keep Slack history
- [x] Delete `docs/paused/`. Move `docs/RECIPE_STUDIO_PLAN.md`,
  `docs/RECIPE_STUDIO_HANDOFF.md`, `docs/DETERMINISTIC_LAYOUT_REPAIR_PLAN.md`
  into `apps/slack/docs/history/` (they document the Slack studio). Delete
  the now-empty root `docs/`. Sweep root `AGENTS.md` for retired content.
  Also sweep `.claude/skills/`: `bug-hunt` and `verify` still describe
  Forge-first workflows — rewrite them Slack-first (or delete `bug-hunt` if
  redundant with SENTINEL discipline) and remove `/forge-map` mentions.
- Verify: `grep -rn "docs/paused\|forge" CLAUDE.md AGENTS.md .claude
  --include="*.md"` returns nothing load-bearing.

### SP.3 Delete `references/` vendored snapshots
- [x] `references/upstream` + `references/agent-sources` were Forge-era
  vendored HyperFrames sources. Confirm zero non-test consumers outside the
  deleted trees (`grep -rn "references/" packages apps/slack scripts
  Dockerfile railway.json --include-dir excludes node_modules`), then delete
  `references/`. If anything in `packages/*` genuinely reads it, move that
  fixture into the package and note it in the Journal.
- Verify: root `npm test` + slack fast loop; `npm run demo`.

### SP.4 Trim `evals/` (keep what packages tests consume)
- [x] `packages/core/test/agent-evals.test.ts` reads `evals/`. Keep the
  consumed files; delete the rest, or relocate under
  `packages/core/test/fixtures/` and update the test import if you prefer a
  clean root. Do not delete blindly.
- Verify: root `npm test` green.

### SP.5 Publish/deploy surfaces unaffected
- [x] Re-read `scripts/publish-public.sh` and the root `Dockerfile`: they
  must reference only `apps/slack`, `packages/core`, `packages/platform`.
  Remove any copy/step referencing deleted trees. Then run the model-free
  gate: `npm run mcp:demo --workspace @sequences/slack` and
  `npm run sequence:check --workspace @sequences/slack -- --demo --no-mcp
  --format both`.
- Verify: gates green; `git status` clean; commit. Do NOT publish or deploy
  without explicit owner authorization.

---

# Phase 1 — Attempt ledger and honest publication semantics

Goal (handoff §7): one immutable ledger; derive CLI/Slack/JSON status from it;
stop calling quality-degraded drafts "browser-valid".

### S1.1 Extract `AttemptLedger`
- [x] New `src/engine/runner/attemptLedger.ts`: append-only typed events
  (logical attempt start/end per stage, physical request, hedge launch/win,
  timeout, scene-repair call, critic call, degradation, fallback) with one
  writer. Ladder emits events; nothing else keeps counts. Keep the existing
  sentinel-run.json shape as a *derived view* so telemetry/tests don't break.
- Verify: unit test that replays a recorded run's events and reproduces the
  exact sentinel-run.json counters; `npm run replay:all`.

### S1.2 Derive all status from the ledger
- [x] `sequenceCheckStatus.ts`, Slack receipts, and sentinel telemetry read
  the ledger. Delete per-site counters. `probe:triage` switches to the ledger.
- Verify: run `sequence:check --demo`; JSON identical except additive fields.

### S1.3 Rename quality axes honestly
- [x] Split the internal "browser-valid" notion into `runtimeValid` (binds,
  seeks, finite) and `qualityResidue` (blocking-quality findings that remain).
  `published-degraded` must list which axis degraded. One-attempt success =
  no model repair + no proof-film + no material degradation + no repeated QA
  class (make this a computed ledger predicate, used by probe:triage).
- Verify: SignalDock replay reports `runtimeValid: true, qualityResidue: 8`.

---

# Phase 2 — One time domain

Goal (handoff §3): branded `SourceTime` / `ViewerTime` / `Duration` /
`SceneLocalTime`; one ramp-aware conversion service; one cascade transform.

### S2.1 Introduce branded time types + conversion service
- [x] New `src/engine/time.ts` with branded types, constructors, arithmetic,
  and ramp-aware `toViewer`/`toSource`. Property tests: monotonicity, boundary
  identity, round-trip, cascade preservation.
- Verify: new unit tests green; no call-site changes yet.

### S2.2 One cascade transform for scene stretching
- [x] Implement `cascadeRetime(plan, sceneId, delta)` returning a mapping
  applied to scenes, moments, beats, camera segments, interactions, grades,
  cuts, and evidence in ONE operation. Migrate the pacing stretch + marginal
  approach trim (`pacing-stretch`, `interaction-hold-retime`,
  `timeramp-retime` normalizers) onto it.
- Verify: 82 pacing tests + RelayGuard/PulseForge exact replays byte-stable.

### S2.3 Migrate audits off ad-hoc arithmetic
- [x] `pacingAudit.ts`, interaction audit, and motionDensity read through the
  time service only (grep-clean: no raw ramp math outside `time.ts`).
- Verify: full unit suite; replay:all.

### S2.4 Product-chassis pacing integration
- [x] CurrentProof D's single approval app-window, static metric, and static
  button shared one typed station but were charged as three independent surface
  introductions. Count a sole app-window or hero modal plus lightweight static
  local evidence as one introduction. Explicit child entrances, dense content,
  plugins, and multiple/ambiguous chassis remain independent.
- Verify: the exact storyboard attempts 1–2 pass strict replay; attempt 1's
  genuine read miss closes through the existing bounded cascade stretch;
  minimized grouping/explicit-entrance/ambiguity controls, typecheck, Sentinel,
  and `replay:all` green.

---

# Phase 3 — One camera semantic model

Goal (handoff §4): single `CameraPhrase` consumed by blocking, runtime, and QA;
collapse zero-distance/same-target phrases; budget visual ideas.

### S3.1 Define `CameraPhrase` and compile into it
- [x] New `src/engine/cameraPhrase.ts` (target, contextual framing target,
  source/arrival pose, travel/settle/dwell/departure intervals, importance,
  evidence owner, occupancy contract, route ownership authored|continuity|
  host-derived). Compile authored paths AND continuity/blocking requests into
  phrases once, before runtime injection.
- Verify: camera browser tests; golden `film:demo` render unchanged.

### S3.2 Collapse degenerate phrases before runtime
- [x] Same-target/zero-distance/sub-threshold phrases merge or drop
  deterministically (L2, atomic, telemetry tag `camera-phrase-collapse`).
  SignalDock's 14 phrases / 4 scenes must collapse to ≤ 7.
- Verify: SignalDock storyboard replay shows the collapsed count; no QA
  regression on exact replays.

### S3.3 QA consumes phrases, not re-derived geometry
- [x] layoutInspector's camera-arrival/occupancy checks and eyeTrace read the
  same compiled phrases and tolerances the runtime executes (kill the
  QA/runtime occupancy mismatch class from GatePilot).
- Verify: targeted browser tests + one exact-artifact replay per seed fixture.

### S3.4 Idea budget, not phrase budget
- [x] Replace raw per-scene move-count budgeting with: ≤1 primary route per
  scene + supporting development that cannot create a new lens route
  (handoff: "supporting evidence may develop the frame"). Plan-time gate
  message must say which idea to cut, not which number was exceeded.
- Verify: pacing/camera unit tests updated; a SignalDock-shaped fixture that
  previously passed with 14 phrases now yields a findings-retry with an
  actionable message.
- **Checkpoint LP-1:** Phase 3 is complete only after the LP-1 live probe
  (see "Live-probe checkpoints") passes triage comparison vs LP-0. If Phase 4
  is starting immediately, you may defer to a combined LP-1+LP-2 probe after
  S4.2 — journal the deferral.

### S3.5 Hero-modal camera framing integration
- [x] LP-3 exposed an approval scene whose one hero modal contained a carried
  metric and local confirm button. Camera blocking recognized only a sole
  `app-window` as contextual product framing, so the two children became a
  false `camera/idea-budget` pair. Treat a sole hero modal as the same bounded
  framing surface; do not group non-hero or competing modals.
- Verify: exact rejected artifact passes strict replay; minimized modal
  regression, camera suites, browser suite, and `replay:all` green.

### S3.6 SVG layout geometry parity in the camera runtime
- [x] CurrentProof D's source was runtime-valid but two 360px SVG metric rings
  landed at 36% and 46% occupancy. The camera runtime measured framing media
  through HTMLElement-only `offsetWidth`/`offsetParent`; SVG collapsed to 1px
  at world origin, so the lens solved against its small text label while
  browser QA measured the real ring. Continue SVG geometry through client
  dimensions and the DOM-parent offset chain before applying camera transforms.
- Verify: an SVG-only metric station lands at its 8% preferred occupancy;
  exact CurrentProof D source loses both `camera_blocking_landing` findings;
  continuity runtime, camera unit suites, typecheck, and `replay:all` green.

### S3.7 Solo hero-metric framing contract
- [x] CurrentProof D's opening ring shared a station only with a subordinate
  one-pixel progress rail. Treating that rail as ensemble context forced the
  lens to preserve the whole width, so camera sparse correction could raise
  painted area only from 2% to 3%. Let a hero progress-ring own the lens when
  every same-station peer is a support `progress`; real product/non-progress
  context still binds. Give that solo primary a 12% preferred occupancy so
  its typed landing and the existing whole-frame sparse floor agree.
- Verify: minimized rail-only and product-context controls pass; exact
  CurrentProof D source reaches browser `strictOk: true` with no sparse or
  camera-landing findings; camera tests, typecheck, and `replay:all` green.

---

# Phase 4 — State continuity (kills the 0% reset class)

Goal (handoff §5): a stable `entityId` optionally carries a typed state
handoff; morphs ship only with proven structure + state transfer.

### S4.1 Typed state handoff on continuity entities
- [x] Extend the continuity graph entity with `state?: { kind: metric|button|
  progress|selection|shell; value }`. The scaffold initializes the incoming
  scene's component from the prior resolved state (host-owned, L1). Metrics
  must begin at the previous value — never 0.
- Verify: new browser test: two-scene metric 38→71→94 with a swipe cut never
  paints a lower value than already resolved; SignalDock replay loses its
  reset flicker.

### S4.2 Morph honesty gate
- [x] A `morph` cut requires both endpoint structure AND state transfer
  proof; otherwise degrade to swipe/match AND initialize the incoming
  component from the handoff (extend the existing degrade path).
- Verify: GatePilot's impossible cross-kind morph fixture degrades cleanly;
  reverse seek restores both endpoint state and visibility (browser test).
- **Checkpoint LP-2:** Phase 4 is complete only after the LP-2 live probe
  (metric-continuity brief) shows no reset flicker and honest morphs on real
  output. Combine with a deferred LP-1 if applicable.

### S4.3 Close state-proof gaps found in S4.1/S4.2 review
- [x] Carry the last resolved state through compatible hold appearances with
  no new beat; require the continuity proof island at every runtime morph;
  and make cut clone capture delegate to the component runtime's single state
  initializer so metric/button/progress/selection/shell channels cannot drift.
  Classify proof-related degradation as the existing `cut_degraded`
  `state-proof` reason.
- Verify: hold-appearance unit regressions; forward/reverse state browser
  regression; absent-proof degradation; selection-class morph-clone capture;
  full unit/browser/root suites; replay:all; model-free demos; golden film and
  temporal strip. LP-2 remains open until an authorized paid run reaches the
  state runtime.

### S4.4 Fix LP-2 planning blockers without weakening the checkpoint
- [x] Treat child evidence inside one framing surface and alternate
  representations of one continuity `entityId` as one semantic camera idea;
  revert an atomic normalizer when it quantitatively worsens an existing
  dead-moment gap; and reconcile only the unambiguous
  `headline + metric entity + count` declaration to `stat-card`; prefix an
  otherwise-valid digit-leading scene slug with `scene-`.
- Verify: exact ProofRail and MetricThread rejected artifacts replay clean;
  SignalLedger replays to its honest pre-normalization creative gap; minimized
  positive/negative regressions; full unit suite; `replay:all`. LP-2 remains
  open because every follow-up was stopped at storyboard planning before the
  state runtime.

---

# Phase 5 — Split the two megafiles by responsibility

Goal (handoff §6). Mechanical moves, no behavior change; keep import facades.

### S5.1 layoutInspector: measurement vs policy
- [x] Split into `layout/collect.ts` (browser evidence collectors),
  `layout/selectors.ts`, `layout/checks/*.ts` (pure: evidence → typed
  findings), `layout/score.ts`, `layout/report.ts`. `layoutInspector.ts`
  becomes a facade re-exporting the public surface.
- Verify: browser suite + QA cache hash unchanged on a cached project.

### S5.2 repairs: split by domain
- [x] Split `runner/repairs.ts` into `repairs/htmlChassis.ts`,
  `repairs/cssSafety.ts`, `repairs/selectorDataflow.ts`,
  `repairs/timelineNormalize.ts`, `repairs/contractIslands.ts`,
  `repairs/boundedLayout.ts`. Each repair returns edits + proof (intended
  finding changed, no new class) — enforce with a shared wrapper.
- Verify: replay:all byte-identical; unit suite.

### S5.3 Normalizer registry gets real dependencies
- [x] Extend `runner/normalizerRegistry.ts` entries with read/write fields,
  pre/postconditions, ordering deps, atomic group, and idempotence test ref.
  Add a test that builds the dependency graph and fails on write/write
  conflicts without declared order. Run the full audit once per atomic group
  (kill scattered stale partial audits).
- Verify: registry test green; replay:all.

### S5.4 Shallow dead-dataflow check for GSAP targets
- [x] Extend `deadTweenRepair.ts`/static gate: flag `querySelector` results
  containing pseudo-elements and provably-absent literal selectors *through
  one variable assignment* (the SignalDock `.cmp-value::after` → null → GSAP
  class). No general JS rewriter; AST-lite only.
- Verify: minimized SignalDock fixture caught at L3, not browser.

---

# Phase 6 — Prompt diet and the studio→planner seam

Do this only after Phases 1–5 (handoff: don't optimize prompts before
eliminating contradictory contracts).

### S6.1 Prompt payload audit + budget enforcement
- [x] Measure actual composed prompt sizes per stage (ledger already knows).
  Reinstate a hard budget test (author ≤45k chars; the 125–137k repair
  prompts are the target). Remove now-redundant prose that restates typed
  contracts (the contracts are injected; the prose was compensating).
- Verify: budget test green; one exact storyboard replay + one authored
  replay unchanged in acceptance.
- **Checkpoint LP-3:** prompt changes alter model behavior, so replays are
  NOT sufficient proof for this step — Phase 6 is complete only after the
  LP-3 live probe (see "Live-probe checkpoints") shows attempts and
  findings-retry classes at or below the LP-0 baseline. S6.3's capsule
  conversion check rides the same probe.

### S6.2 Frame/storyboard basis contradiction gate
- [x] L0/L3: storyboard `production basis` (dark/light) must match frame.md's
  committed basis; mismatch is a cheap findings-retry before any authoring
  (SignalDock shipped dark-plan-on-light-frame).
- Verify: fixture from SignalDock's storyboard rejects at plan time with an
  actionable message.

### S6.3 Studio library capsule: offer only what converts
- [x] `studioLibraryVocabulary()` currently advertises five catalogs on every
  run while conversion is near-zero for some (recipe-auto-declare: 3 in 157
  runs). Add per-catalog conversion counters to the ledger; keep offering
  only entries with a typed declaration path that has ever converted, and
  host-auto-declare recipes/assets where the brief matches (extend the
  existing `recipe-auto-declare` L2) instead of asking the planner to opt in.
- Verify: unit tests for the capsule; the LP-3 checkpoint probe shows the
  declared unit actually appearing in the plan.

### S6.4 LP-3 prompt-budget integration fix
- [x] A production-shaped five-scene LP-3 plan assembled a 46,602-char slot
  prompt and the deterministic preflight error was retried three times plus a
  rescue. Preserve the locked plan/templates, compact the author-stage skill
  capsule enough to leave feedback headroom, and classify budget failures as
  non-retryable before any provider call.
- Verify: the exact persisted LP-3 plan composes below 45,000 chars; prompt
  budget regression, typecheck, and `replay:all` green.

### S6.5 Scene-scoped typed progress completion
- [x] CurrentProof D reused `hairline-rule` as one typed `progress` component
  across three continuity scenes. The existing L2 fill top-up required global
  component-id uniqueness, declined all three otherwise unambiguous roots, and
  spent two source attempts on the same `kit_markup_incomplete` class. Complete
  a repeated id independently inside each named scene while keeping duplicate
  roots inside one scene ambiguous and blocking.
- Verify: both exact rejected sources pass strict replay; minimized repeated-id,
  idempotence, and same-scene ambiguity controls pass; Sentinel registry,
  typecheck, and `replay:all` green.

### S6.6 Full re-author prompt headroom
- [x] CurrentProof D's non-optional full re-author context was 49,040 chars
  after optional skills reached zero. Compact only planner prose already
  compiled into the locked scaffold/host contracts, dedupe repeated finding
  feedback, and reserve 512 chars for findings on both initial slot and full
  recovery prompts without dropping any scene, timing, visible moment, frame
  capsule, or scaffold.
- Verify: the exact persisted initial and full-re-author prompts compose at or
  below 44,488 chars; prompt-budget suite and Slack typecheck green.

### S6.7 Executable, truthful asset adoption
- [x] S6.3 appended host asset declarations after plugin lowering, counted a
  catalog-id-only declaration as conversion evidence, and therefore claimed
  adoption without a UID, lowered component, or injectable runtime unit.
  Reconcile host-adopted assets before caching/counting them; require an
  asset-owned binder for semantic params instead of catalog demo copy; let an
  equivalent typed hero win rather than duplicate the visual; and revalidate
  the augmented plan before accepting the enhancement.
- Verify: a grounded glass metric lowers and injects with its scene values;
  ungrounded copy and an existing typed metric both decline; only UID-stamped
  declarations emit asset conversion evidence; exact CurrentProof D shape,
  focused asset/plugin/capsule tests, typecheck, and `replay:all` green.

### S6.8 One-attempt typed source ownership
- [x] ProofLine E reached author attempt 1, but an unscoped ring-only
  `.cmp-value` rule escaped into a stat-card, a class-only authored cursor lived
  beside the host cursor, repeated mechanical legs were counted as ten visual
  ideas, and a 32px cursor alone could not prove a primary arrival in rendered
  pixels. Scope only the exact centered-ring geometry signature; retire only
  unmistakable pointer actors inside typed interaction scenes; count density
  by distinct moving target; give the measured target one bounded arrival
  focus lift; and let sampled contrast converge through at most three strictly
  improving deterministic passes inside the same source attempt.
- Verify: exact ProofLine E source passes static replay and Chromium
  `strictOk: true`; the arrival changes 6.57% rather than 0.069% of pixels;
  the second contrast pass reaches zero browser warnings; positive/negative
  ownership controls, typecheck, and `replay:all` green.

---

# Hackathon stabilization override -- finish before Phase 7

This is the active next-agent work order. Its purpose is not to prove that the
pipeline can produce zero residue on arbitrary adversarial briefs. Its purpose
is to produce one judge-ready video promptly while preserving authorial range.
S7.1 and everything after it are frozen until this section is complete. Do not
publish or deploy without the owner's explicit authorization. Work locally with
one primary agent; if delegation is genuinely useful, use only LUNA at high or
xhigh and give it a narrow read-only or test-analysis task.

## Starting evidence and scope boundary

- Start from verified commit `00dfedb` (`fix(slack): converge ProofGrid first
  attempt`). Do not revive uncommitted post-ProofLane experiments.
- ProofGrid I (`lp3-state-capsule-20260712-i`) published a valid non-fallback
  MP4. Its first storyboard and first full source response were accepted, but
  deterministic scene repair plus critic/patch activity made the accounting
  report more than one attempt. The exact replay and full suites passed after
  the fixes in `00dfedb`.
- ProofLane J (`lp3-state-capsule-20260712-j`) was stopped at the first source
  browser result. The focal headline itself was fully visible and occupied
  about 12% of the frame. The three findings were a parent/child stale-surface
  overlap, a station-level occupancy preference, and motion still settling at
  the landing frame. Treat these as the guardrail-reduction audit's primary
  advisory controls, not as proof that the author failed.
- Do not investigate a novel or obscure finding merely because a probe exposed
  it. It enters this sprint only if it is a hard failure below, causes a visible
  judge-facing break, or is responsible for another paid author call.

## Hackathon acceptance contract

A run is successful when all of the following are true:

- it produces a real MP4 without probe fallback, the runtime completes, and no
  hard finding survives;
- a human can follow the before/after story, the intended focal content is
  visible and readable, state does not obviously reset, and the ending lands;
- storyboard authoring uses no more than two logical attempts and source
  authoring uses no more than two logical attempts, with a goal of one each;
- the full job uses no more than six logical model calls and eight physical
  provider calls, including hedges; and
- advisory findings may truthfully leave the automated result at `warn`. They
  do not invalidate an otherwise judge-ready MP4.

Target preview latency is eight minutes and target MP4 latency is fifteen
minutes. Provider latency is environmental, so missing either target is an
operational observation rather than permission to add a new creative
guardrail. Production fallback remains a launch-safety mechanism; it is
disabled only during the evidence probe so authorship failures remain visible.

## Guardrail policy

Every finding that can influence a retry must belong to exactly one tier:

1. **Hard gate -- author repair only as a last resort.** Parse/schema/contract
   failure; browser or runtime exception; missing/invalid timeline; a blank or
   effectively blank load-bearing scene; missing or zero-area load-bearing
   component; contradictory/reset state; missing render/MP4; or a load-bearing
   component that remains out of frame after the deterministic repair below.
2. **Deterministic same-attempt repair -- no paid call.** Canonical markup,
   binding, or host script order; world/station geometry; typed load-bearing
   content outside the viewport/safe area; and bounded station/camera fit. A
   repair is adopted only after reinspection proves that exact hard condition
   improved without introducing another hard condition. It may alter wrapper
   position/scale or camera fit, but never copy, story order, component choice,
   beat timing, palette, typography, or motion style.
3. **Advisory -- report for human review, never retry.** Washout preferences;
   occupancy preferences when the focal target is already visible; camera
   settling/taste; motion reversal or jerk heuristics; static supporting
   moments; parent/child or supporting-surface overlap; camera-idea counts;
   density taste; and non-catastrophic pacing or readability. Advisory findings
   must not enter storyboard/source retry feedback, slot repair, rescue, or
   critic patch prompts.

When evidence is ambiguous, default to advisory unless the rendered output is
clearly broken. The audit removes model veto power from taste heuristics; it
does not remove their diagnostic visibility.

### S6.9 Hackathon guardrail and retry map
- [x] Produce `.reports/hackathon-guardrails.md`. Enumerate every finding path
  that can influence `validateStoryboardPlan`, browser-QA retry feedback,
  `repairSlotDraftForFindings`, quality penalties, critic/patch work,
  `sequenceCheckStatus`, and normalizer/repair registries. For each row record
  its deterministic owner, current tier, paid-call cost, whether it can block
  publish, and its target tier under the policy above.
- [x] Explicitly trace the three ProofLane J findings and all current
  out-of-frame/visibility findings from detector to retry decision. Identify
  duplicate detectors that charge separately for the same rendered symptom.
- [x] This is an inventory step only: do not change production behavior, run a
  paid probe, or expand the audit into a new quality taxonomy.
- Verify: focused registry/status tests, Slack typecheck, exact artifact
  replays, and `replay:all` remain green. Commit the report and plan/journal
  update as one S6.9 commit.

### S6.10 Deterministic load-bearing frame containment
- [x] At the lowest geometry owner, implement one bounded same-attempt repair
  for a typed load-bearing component whose measured bounds prove it is partly
  or wholly outside the viewport/safe area. Prefer wrapper translation/scale or
  station/camera fit using measured bounds; keep the authored component, copy,
  scene order, timing, and style intact.
- [x] Reinspect after the one repair and adopt it only when the exact component
  is measurably more visible, satisfies the hard visibility floor, and creates
  no new hard diagnostic. If deterministic containment cannot satisfy those
  conditions, preserve the original candidate and permit at most one author
  repair for that source stage.
- [x] Add negative controls proving that decorative/support content may remain
  intentionally cropped, visible focal content is not mutated merely for being
  sparse/large, and ProofLane J's fully visible headline does not trigger this
  repair.
- Verify: exact failing artifact or a minimized typed fixture, idempotence,
  improvement/adoption/rollback controls, browser runtime, Slack typecheck,
  and `replay:all`. No paid probe in this step.

### S6.11 Attempt economy and advisory demotion
- [x] Route only hard findings into paid storyboard/source repair. Advisory
  findings stay in QA artifacts and human-facing warnings but cannot generate
  retry feedback, scene repair, rescue, or a critic patch on the hackathon
  create path.
- [x] Enforce a maximum of two logical storyboard attempts and two logical
  source attempts, including scene repair/full re-author paths. Once a
  runtime-valid source candidate is banked, do not spend a rescue or critic
  call trying to clear advisory residue. Allow at most one physical hedge for
  each expensive stage and enforce the acceptance contract's global call cap.
- [x] Preserve fail-loud behavior for unresolved hard failures. Preserve an
  honest `warn` result when a runtime-valid MP4 contains advisory residue; do
  not relabel warnings as clean and do not use fallback inside the probe.
- [x] Add a ProofLane J-shaped test proving its three advisory findings cause
  one provider source response and zero model repairs. Add controls proving an
  unresolved hard off-frame focal receives at most one author repair, while a
  runtime exception or missing timeline still fails.
- Verify: focused attempt-ledger/QA/repair/status tests, exact ProofGrid I and
  ProofLane J artifact replays where persisted, all Slack unit/browser suites,
  Slack and root typechecks, and `replay:all`. No paid probe in this step.

### S6.12 One bounded judge-representative live probe
- [x] Before spending a provider call, append honest ProofGrid I and ProofLane
  J entries to `PROBE_LOG.md`, including J's early stop and the fact that no MP4
  was produced. Run all Slack unit/browser suites, Slack/root typechecks, and
  `replay:all`; begin the probe only when they are green.
- [x] Use one normal 14--18 second launch brief, not a five-scene component and
  camera stress specification. Supply trusted product facts, audience, tone,
  desired before/after story, and CTA; let the planner choose scene count,
  composition, components, transitions, and camera language. Use the same
  semantic brief for any allowed rerun and change only the job/cache marker.
- [x] Run the documented live-probe environment with fallback disabled,
  continuity enabled, composition audit enabled, `format both`, and no deploy.
  Poll at intervals of at least 60 seconds. Preserve job, author-run, QA,
  runtime, render, MP4, and triage evidence.
- [x] Stop immediately when probe A produces a runtime-valid, human-acceptable
  MP4 under the acceptance contract. Do not fix advisory-only residue, chase
  `qualityResidue=0`, chase `oneAttemptSuccess=true`, or run another style
  variation.
- [x] Probe B is allowed only if A has an unresolved hard failure or an obvious
  judge-visible break. First replay A exactly, fix the lowest deterministic
  owner, run the full verification surface, then rerun the same semantic brief.
  There is no probe C in this sprint. A provider timeout gets at most one
  operational rerun and must not be converted into a new guardrail.
- Verify: `sequence:check` reports a real MP4 and valid runtime; triage stays
  within the call caps; human strip/MP4 review confirms story, focal visibility,
  continuity, and ending. Advisory-only `warn` is acceptable. Append the final
  evidence to `PROBE_LOG.md` and the journal, then freeze product code.

Suggested brief shape (facts must be replaced with the real demo facts):

> Create a 15-second launch video for [product/feature] for [audience]. Show the
> old friction, the new action, and the measurable result, then close on [CTA].
> Tone: confident, polished, and concise. Use only these trusted facts: [facts].
> Preserve visible state across scenes. Choose the visual structure, components,
> transitions, and camera treatment creatively.

### S6.13 Hackathon rehearsal and freeze
- [x] Keep the first acceptable authored MP4 as the primary demo artifact and
  confirm a model-free known-good backup is locally accessible. Rehearse the
  exact Slack command, progress/receipt path, output link/file, and fallback
  behavior that will be used in front of judges.
- [x] For the launch environment, restore normal production fallback policy and
  check `/healthz`. Publishing/deployment still requires explicit owner
  authorization; this step does not grant it.
- [x] After an acceptable MP4 exists, reopen product code only for P0 launch
  failures: no output, runtime/render failure, an obviously broken focal, state
  reset, or repeated hard retry. Log everything else as post-hackathon work.
- Verify: one timed local rehearsal plus the known-good backup path. Document
  exact commands and artifacts in `OPERATIONS.md`/`PROBE_LOG.md`; do not begin
  S7 or any broad cleanup.

## Non-negotiable stop rules

- First acceptable MP4 means done.
- Advisory-only findings mean report and stop, not fix and rerun.
- A novel edge case that judges will not see goes to the backlog.
- Never broaden a mechanical repair into a rewrite of authorial choices.
- Maximum two paid live probes in this section; no probe K/L/M chain.
- No S7, Phase 8, publish, deploy, or unrelated refactor work.

---

# Phase 7 — Retire old systems and shrink the flag surface

### S7.1 Feature-flag audit
- [ ] For each of the 25 feature flags: when was it last set to non-default in
  any recorded run (`sentinel-run.json` env snapshots)? Classify: (a) load-
  bearing kill switch → keep; (b) experiment that won → collapse to always-on,
  delete flag + dead branch; (c) experiment that lost / never converted →
  delete feature behind it or park behind explicit `EXPERIMENTAL_` prefix.
  Every deletion is its own commit with replay:all green.
- Verify: featureFlags registry + source-scan test; OPERATIONS.md updated.

### S7.2 Dead-export deletions
- [ ] Execute the S0.4 census: delete confirmed-dead exports/files (candidates
  observed: parts of `cameraPatterns.ts`, `designDialects.ts`,
  `backgroundCatalog.ts`, `hyperframesCompatibility.ts`, `cutDiscovery.ts`,
  `directionScore.ts` — verify each; several are only reachable via the
  studio capsule string).
- Verify: typecheck, full unit+browser suites, `npm run demo`,
  `npm run studio:golden` (studio must still gate/export).

### S7.3 Legacy vocabulary compatibility sunset
- [ ] Legacy cut names (`cut-*`, `zoom-through`, `shape-match`, …) and other
  parse-time aliases: keep the normalizers (cheap, tested) but move them to
  one `compat.ts` with a table + one test file, so new code never imports
  scattered alias logic.
- Verify: old-plan replay still byte-identical.

---

# Phase 8 — Motion quality: encode the golden demo as gates and scaffolds

Each step here changes OUTPUT, so each ends with one authorized live probe
via the Phase 9 loop. Do not start Phase 8 before Phases 3–4 land: most of
these gates need CameraPhrase + state handoffs to be enforceable.

### S8.1 Background subordination gate
- [ ] Browser check: outside declared hero/lockup scenes, the environment
  layer (wallpaper/gradient) may not exceed a saturation×area share of the
  frame at any sampled landing; primary-subject contrast against its real
  composited background meets a floor (the translucent 40%/52% numerals must
  become findings). Prefer an L1 fix too: scaffold defaults the content
  surface (window/card) to own ≥60% of the frame at landings, wallpaper
  darkened/blurred under content.
- Verify: SignalDock replay flags it; golden film:demo does NOT flag.

### S8.2 One energy peak per film
- [ ] Plan-time: exactly one scene may carry the high-energy accent (dive/
  whip/ramp); others are connective. Extend `auditCameraEnergy` from
  repeat-verb heuristics to a single-peak contract with an actionable
  message ("move the accent to the approval payoff or drop it").
- Verify: unit tests; seed-fixture replays stay green (they already resemble
  single-peak films or get the actionable retry).

### S8.3 Cause-and-effect chain check
- [ ] Plan-time advisory → later blocking: each scene's entry must be
  motivated by the previous scene's exit action (cut carries the acted-on
  entity, or an explicit `handoff` field names the causal object). This is
  paperwork the planner already half-writes; make it typed and validated
  instead of prose.
- Verify: unit tests on seed storyboards.

### S8.4 Read-hold and settle enforcement at the gesture level
- [ ] The pacing audit holds copy; extend the same discipline to gestures:
  after any press/entrance, the affected surface must be settle-stable (no
  transform above threshold) for ≥0.35s before the next voice starts; cursor
  gets ONE approach path (kill the two-step corrective cursor class — host
  should compute the approach from measured geometry like the golden demo's
  `camAt`).
- Verify: browser test with a two-correction cursor fixture; SignalDock
  replay's five-simultaneous-voices window produces findings.

### S8.6 Typography and copy floor (from probe `refactor-review-normal-1`)
- [ ] Three cheap, host-ownable defects shipped in the Briefly film:
  (a) the final headline wrapped mid-word ("Keep everyone in th / e loop") —
  add an L2/L3 check that display-size text never soft-wraps inside a word
  and never wraps a phrase shorter than ~24ch onto an orphan line (fix:
  `text-wrap: balance` + width from measured text, golden-demo style);
  (b) seeded plugin copy mismatched the story domain ("Meeting recapped —
  Leo Diaz" inside a weekly-update publish beat) — `seedContent.ts` must
  derive copy from the brief's domain vocabulary or the plan's own labels,
  never from an unrelated generic pool;
  (c) the opening scene showed an empty card for ~1.2s — extend the
  entrance-liveness rule to require the first painted content within ~0.5s
  of scene 1 without destroying authored stagger (see S5.3's write-set fix:
  the current normalizer collapsed 2.2s/3.2s arrivals to 0.28s, which is the
  opposite failure).
- Verify: fixtures from the Briefly artifacts; replay converges without a
  model call. (Numbered S8.6 but placed before S8.5 deliberately: these are
  cheap fixture-driven fixes — LIGHT tier — do them first inside Phase 8.)

### S8.5 Ending discipline
- [ ] Final scene: resolve by ~85% of runtime, then a breath hold with only
  micro-motion (≤1.5% scale). Host-derive the hold from the plan instead of
  trusting the author's last-scene choreography.
- Verify: unit + one live probe; golden demo pattern unaffected.

---

# Phase 9 — The continuous probe loop (the product of this refactor)

The owner's target workflow: an agent runs
**live probe → triage → fix fallbacks/attempts at the lowest layer → check
motion design → probe again**. Everything it needs must be one command away.

### S9.1 `probe:run` — one command, one fresh probe
- [ ] `scripts/probeRun.ts` + npm script: generates a cache-distinct brief
  (rotating product-name/domain templates with golden-demo-derived direction
  language, or `--input <file>`), a unique job id, sets the probe env
  (fallback OFF, continuity ON, composition audit), runs sequence:check with
  `--mcp --render --temporal`, then immediately runs `probe:triage` on the
  result and appends a skeleton entry to PROBE_LOG.md.
- Verify: dry-run mode (`--plan-only` prints the command without paying).

### S9.2 Probe-loop playbook in OPERATIONS.md
- [ ] Write the decision tree the agent follows, referencing tools not prose:
  1. `npm run probe:run` (authorized, paid).
  2. Read triage. Any fallback/degradation/attempt>1 with a mechanical cause?
     → replay the exact artifact (`storyboard:replay` / source replay), fix at
     the lowest SENTINEL layer, add regression, `replay:all`, log.
  3. Motion pass: open the MP4, temporal strip, blocking overlay, per-moment
     thumbs (triage lists paths). Check against the Golden-demo checklist
     (one idea/scene, background subordination, no reset, readable landings,
     one peak, ending breath). File real defects as Phase 8-style gates or
     fixtures — the agent must KNOW where a fix goes: use SENTINEL.md's
     placement tree; creative-taste-only issues go to the prompt, everything
     mechanical goes L1–L3.
  4. Repeat until one clean probe (ledger predicate from S1.3), then one calm
     production-shaped probe.
- Verify: doc exists; a fresh agent can run the loop end-to-end from it.

### S9.3 Acceptance gate for the whole refactor
- [ ] One stress probe: 1 logical storyboard + 1 logical source attempt, no
  fallback, no material degradation, primary landings readable/in-range.
  One normal probe: no real layout/motion defects on inspection. MP4 shows
  one clear subject, motivated motion, settled payoffs, confident final hold.
  Then: update CLAUDE.md + OPERATIONS.md + SENTINEL.md to the post-refactor
  reality, mark this plan COMPLETE, and record final metrics
  (`sentinel:report`) next to the "Why" table above.

---

# Documentation debt (fold into the phases; listed for visibility)

- Root `CLAUDE.md` + orientation skill: fixed 2026-07-11 and resynced
  2026-07-12 (tracked source `.agents/skills/sequences`, ignored local
  `.claude` mirror); keep both updated when layout changes.
- `SENTINEL.md`: current through the hackathon three-tier target policy; S5.3
  added the L2-churn/dependency-group principle.
- `OPERATIONS.md`: current `probe:triage` and bounded hackathon runbook added
  2026-07-12; `probe:run` remains post-hackathon S9.2 work; refresh the flag
  list after S7.1.
- `PROBE_LOG.md`: current through ProofLane J; keep it concise and append future
  probe skeletons only when a probe is actually authorized.
- `REFACTOR_HANDOFF.md`: marked historical/superseded in its header on
  2026-07-12; preserve its architecture analysis.
- apps/slack/docs/history/: leave as history.

# Explicitly out of scope (do not drift)

- New Studio components, assets, recipes, plugins, backgrounds, or camera
  patterns (unless a concrete integration bug blocks the existing path).
- Loosening any gate to make numbers look better.
- Prompt rewrites before Phase 6's precondition is met.
- Modifying `packages/core` / `packages/platform` beyond what SP.x requires
  (they are Slack's dependencies; treat as stable).
- The "High quality" Claude-CLI-on-Railway tier — separate track, not part of
  this refactor plan.

---

# Step Journal

> Append entries here after every step. Newest at the bottom. Format:
> `## <step id> — <date> — <status: DONE|PARTIAL|BLOCKED>` then what changed,
> files, verification run, and notes for the next agent.

## S-init — 2026-07-11 — DONE
Plan authored from: REFACTOR_HANDOFF.md, PROBE_LOG.md, sentinel:report over
157 runs, golden-demo source analysis (`demos/slack-ad`), SignalDock artifact
review, dead-code census (planRunner.ts), doc-drift scan, and live probe
`refactor-review-normal-1-20260711` (published-degraded; see PROBE_LOG.md).
Also done in the authoring session (not steps, already applied):
- `.claude/skills/slack-map` + `forge-map` deleted; replaced by
  `.claude/skills/sequences` (current layout + doc set).
- Root `CLAUDE.md` rewritten to Slack-only reality; `apps/slack/CLAUDE.md`
  doc list + scope line updated (Forge/Sequences: retired, Phase P).
- S0.5 ticked as part of the above.
Owner additions that session: Phase P (monorepo purge), staffing guide
(HEAVY/LIGHT tiers), S8.6 (typography/copy floor from the Briefly probe).
Next agent: start at S0.1.

## S0.1 — 2026-07-11 — DONE
Added `scripts/probeTriage.ts` and the `probe:triage` workspace command. It
reads the persisted Sentinel, author, sequence-check, and attempt artifacts;
reports disposition, per-stage logical/physical call counts, degradations,
fallbacks, registry-known/new QA classes, and absolute evidence paths; and
writes `planning/triage.md` plus `planning/triage.json` beside each probe.
Files: `apps/slack/scripts/probeTriage.ts`, `apps/slack/package.json`, this
plan. Verification: triage for `architecture-stress-5-20260711` reproduced
10 logical / 14 physical calls and 8 QA warnings; triage for
`refactor-review-normal-1-20260711` reproduced 10 / 14 and 8; Slack
typecheck passed. No paid probe was run.

## S0.4 — 2026-07-11 — DONE
Added the mechanical TypeScript AST census at `scripts/deadExports.ts`, its
`dead-exports` command, and the committed report at
`.reports/dead-exports.md`. It scans 243 Slack source/studio/script/test files,
found 1,377 named exports, and marks 314 zero-reference candidates; no
deletions were made. Verification: `npm run dead-exports --workspace
@sequences/slack` and Slack typecheck passed. Namespace imports are treated
conservatively as references; S7.x must confirm candidates before deletion.

## S0.2 — 2026-07-11 — DONE
Added `replay:all` plus the strict model-free `source:replay` path. The replay
manifest references (without copying) the available LaunchRelay, PulseForge,
GatePilot, RelayGuard, SignalDock, and Briefly artifacts under
`.data/projects`; it freezes artifact and deterministic replay hashes, treats
the RelayGuard truncated response as an expected rejection, and skips missing
local fixtures with a warning. Files: `apps/slack/scripts/replayAll.ts`,
`apps/slack/scripts/sourceReplay.ts`, `apps/slack/package.json`, this plan.
Verification: `npm run replay:all --workspace @sequences/slack` passed 13
replays with 0 skips and 0 failures; Slack typecheck passed. No paid probe was
run.

## S0.3 — 2026-07-11 — DONE
Deleted the confirmed-unreferenced `apps/slack/src/engine/planRunner.ts`;
the active demo path already uses `@sequences/core` directly. No orphaned
tests or importers were present. Verification: Slack typecheck, Slack unit
tests, and the model-free Slack demo passed.

## SP.1 — 2026-07-11 — DONE
Deleted the retired `apps/forge`, `apps/sequences`, `examples/forge`,
`examples/sequences`, and `fixtures/sequences` trees plus the listed Forge,
golden-render, performance, and UI-smoke scripts. Removed the retired root
package scripts/bin and updated `test:ci`, CI, the package lock, and the
platform boundary test. The three extension fixtures consumed by the core
test suite moved to `packages/core/test/fixtures/extensions`; the Slack Studio
source test now resolves from its own workspace. Verification: root
typecheck and full root `npm test` passed; the purge-sensitive core/Studio
tests passed 12/12; Slack typecheck, unit suite (75 files / 1,275 tests), and
model-free demo passed. No paid probe was run.

## SP.2 — 2026-07-11 — DONE
Deleted `docs/paused/` and moved the three Slack studio plans into
`apps/slack/docs/history/`. Rewrote the local Slack bug-hunt and verification
guides, updated the workspace orientation and launch config, and removed stale
retired-path guidance from the tracked agent docs. Verification: the required
guidance scan has no `docs/paused` or retired-app references. The updated local
ignored `.claude` files are intentionally not tracked. No paid probe was run.

## SP.3 — 2026-07-11 — DONE
Confirmed there were no root `references/` consumers in packages, Slack source,
scripts, Docker, or Railway configuration outside documentation/skill links;
deleted the vendored `references/` snapshots and README. Verification: the
consumer scan is empty. No runtime code changed and no paid probe was run.

## SP.4 — 2026-07-11 — DONE
Moved the consumed `phase1-briefs.json` fixture to
`packages/core/test/fixtures/phase1-briefs.json`, updated
`agent-evals.test.ts`, and deleted the unused `evals/relay-launch-film.json`.
Verification: the core agent-evals test passed and root typecheck passed. No
paid probe was run.

## SP.5 — 2026-07-11 — DONE
Rechecked the public mirror and container surfaces. `scripts/publish-public.sh`
now archives only `apps/slack`, `packages/core`, and `packages/platform` plus
the required root configuration; its generated docs no longer mention removed
trees. The root Dockerfile copies only those three workspace manifests before
the source layer. Verification: `npm run mcp:demo --workspace
@sequences/slack` and `npm run sequence:check --workspace @sequences/slack --
--demo --no-mcp --format both` passed. The worktree still contains the
pre-existing S-init edits (`CLAUDE.md`, Slack docs/PROBE_LOG) and ignored
`.tmp/`; they were not staged or altered. No publish/deploy or paid probe was
run.

## S1.1 — 2026-07-11 — DONE
Added the append-only `src/engine/runner/attemptLedger.ts` (typed events, one
writer, pure fold) and rewrote `sentinelTelemetry.ts` as a thin context facade
over it: every `recordSentinel*` emitter now appends an event, no counter
state exists anywhere else, and `finalizeSentinelRun` derives the UNCHANGED
`planning/sentinel-run.json` shape via `deriveSentinelRunView` while also
persisting the raw events to `planning/attempt-ledger.json` (for S1.2/S1.3).
The ladder now emits `attempt-start`/`attempt-end` for both logical loops
(storyboard rungs incl. truncation/artifact-grace/rejection outcomes;
source-author full/patch/rescue via a `recordAuthorAttempt` helper at every
former `summary.attempts.push` site, plus a `published` end on ship),
`hedge-win` in `hedgedCompletion`, and `stream-timeout` in the idle watchdog.
The hedge budget (`claimSentinelHedge`) reads launches from the ledger.
Files: `attemptLedger.ts` (new), `sentinelTelemetry.ts`, `ladder.ts`,
`test/attemptLedger.test.ts` (new) + fixtures
`test/fixtures/sentinel-run-{briefly,signaldock}-20260711.json` (byte copies
of the two recorded probes). Verification: the new test reconstructs each
recorded run's events and reproduces the persisted counters EXACTLY (deep
equal minus the write-time `at`; both fold to 10 logical / 14 physical);
existing `sentinelTelemetry.test.ts` passes untouched; Slack typecheck, 1,284
unit tests, `replay:all` (13/0/0), and the model-free demo all green. Notes:
degradation dedupe moved record→view (ledger keeps every emission); the
finalize event stores the caller's disposition and the fold applies the
published→published-degraded honesty downgrade; S1.2 enriches fallback events
with the failed stage and bounded reason. No paid probe was run.

## S1.2–S1.3 — 2026-07-11 — DONE
Moved status ownership to the append-only ledger. Added final
`runtimeValid`/`qualityResidue` evidence, normalized QA-class events, degraded
axis labels, derived stage receipts, and the computed `oneAttemptSuccess`
predicate. `sequence:check`, Slack result receipts, Sentinel persistence, and
`probe:triage` now consume the ledger; legacy artifact fallbacks remain only
for pre-S1.3 projects without `attempt-ledger.json`. Removed orchestrator and
ladder telemetry out-parameter writes; the compatibility fields are ignored.
Renamed the internal banked-draft path from browser-valid to runtime-valid.
Files: `src/engine/runner/attemptLedger.ts`, `sentinelTelemetry.ts`,
`sequenceCheckStatus.ts`, `scripts/sequenceCheck.ts`, `scripts/probeTriage.ts`,
`src/orchestrator.ts`, `src/index.ts`, `src/blocks.ts`, runner ladder/
orchestration/types, focused tests, and this plan.
Verification: Slack typecheck; focused ledger/status/receipt tests; full Slack
unit suite (after correcting the obsolete out-parameter assertion);
`npm run replay:all --workspace @sequences/slack` (13/0/0); and model-free
`sequence:check --demo --no-mcp --format both` plus `probe:triage`, both green.
No paid probe, publish, or deploy. SignalDock status replay asserts
`runtimeValid: true, qualityResidue: 8`.

## S2.1 — 2026-07-11 — DONE
Added `src/engine/time.ts` as the typed boundary for `SourceTime`, `ViewerTime`,
`Duration`, and `SceneLocalTime`, including validated constructors, domain-safe
arithmetic, scene-local conversion, and a ramp-aware conversion service backed
by the existing authoritative time-ramp knot mapping. Added property tests for
monotonicity, ramp-boundary identity, round trips in both domains, and cascade
translation preservation. No call sites changed. Audited S1.2–S1.3 against the
ledger/status consumers and recorded SignalDock assertions; the checked status
derivation remains consistent with the plan (`runtimeValid: true`,
`qualityResidue: 8`, degraded axis `qualityResidue`). Files:
`src/engine/time.ts`, `test/time.test.ts`, this plan. Verification: focused
time/ledger/status/telemetry tests (32/32), Slack typecheck, full Slack unit
suite (76 files / 1,291 tests), and model-free `sequence:check --demo --no-mcp
--format both`, all green. No paid probe, publish, or deploy.

## S2.2 — 2026-07-11 — DONE
Added immutable `cascadeRetime(plan, sceneId, delta)` to the branded time
service. One operation now stretches the selected scene boundary and shifts
all later absolute owners together: scene starts, display type, time ramps,
grade shifts, camera segments, component beats, interactions, moments, and
bound evidence intervals. Cut entry/exit values remain relative by contract;
resolved cut `atSec` is re-derived from the shifted boundary and is covered by
the cascade regression. Migrated all five stretch-producing pacing passes,
including `interaction-hold-retime` and `pacing-stretch`, off their duplicated
cumulative-shift helper; later time-ramp declarations now travel through the
same cascade instead of separate arithmetic. Files: `src/engine/time.ts`,
`src/engine/pacingAudit.ts`, `test/time.test.ts`, this plan. Verification:
Slack typecheck; focused time/pacing/direct-composition/time-ramp tests (288);
all 82 pacing tests; full Slack unit suite (76 files / 1,293 tests); relevant
time-ramp browser test; `replay:all` (13/0/0), including RelayGuard and
PulseForge byte-stable; deterministic `film:demo` render and 100-frame temporal
strip inspected with all four cuts intact and no eligible dead-frame window.
No paid probe, publish, or deploy.

## S2.3 — 2026-07-11 — DONE
Migrated every source-to-viewer conversion consumer onto the branded
`timeConversionService`: pacing and interaction/eye-trace audits, eye-trace
repair, motion density, storyboard moments and normalization, direct capture,
layout sampling, and temporal inspection. Low-level `warpOf`/`warpInverseOf`
usage is now grep-clean outside the numerical kernel in `timeRamp.ts` and its
single adapter in `time.ts`; ramp solving/parsing remains with the existing
contract owner. Files: `pacingAudit.ts`, `eyeTrace.ts`, `eyeTraceRepair.ts`,
`motionDensity.ts`, `storyboardMoments.ts`, `runner/storyboardAudit.ts`,
`directComposition.ts`, `layoutInspector.ts`, `temporalInspector.ts`, this
plan. Verification: Slack typecheck; focused audit/time/direct suites (7 files,
319 tests); full Slack unit suite (76 files / 1,293 tests); `replay:all`
(13/0/0); time-ramp seek and rendered temporal-judge browser tests (2/2).
No paid probe, publish, or deploy. One initial browser command was invoked from
the repository root and found no matching project; rerunning from `apps/slack`
passed, so this was an operator command-location error, not a test failure.

## S3.1 — 2026-07-11 — DONE
Added `src/engine/cameraPhrase.ts` as the canonical typed semantic model and
made camera blocking compile authored segments plus direction/continuity
requests into it before injection. Every phrase now carries source/arrival
poses, travel/settle/dwell/departure intervals, importance, evidence owner,
occupancy/anchor contracts, and `authored|continuity|host-derived` route
ownership. The existing blocking names/island remain compatibility adapters;
runtime behavior is unchanged at this seam. Files: `cameraPhrase.ts`,
`cameraBlocking.ts`, focused fixtures/tests, `PHASE_3.md`, and this plan.
Verification: Slack typecheck; focused camera/blocking/environment unit tests
(87/87); camera depth, blocking landing, and continuity runtime browser tests
(14/14); deterministic `film:demo` completed with all four cuts, 0 eligible
dead-frame windows, and unchanged runtime routing. No paid probe, publish, or
deploy.

## S3.2 — 2026-07-11 — DONE
Moved runtime-route selection and degenerate collapse into the typed camera
phrase compiler. When a scene has primary phrases, non-routing support stays
local; only a distinct authored supporting destination can join the lens
route. Consecutive same-target/context poses below the semantic distance floor
merge into one phrase with a combined dwell/departure and provenance. The
canonical island reports input/collapsed counts, and the source normalizer
emits `camera-phrase-collapse` only when that island changes (replay remains
idempotent). SignalDock's exact accepted storyboard now compiles 14 phrases to
7 routes (1/2/2/2). Files: `cameraPhrase.ts`, `runner/repairs.ts`, `sentinel.ts`,
focused tests/fixture, replay expectations, `PHASE_3.md`, and this plan.
Verification: Slack typecheck; focused phrase/blocking/normalizer/Sentinel
tests (34/34); exact `replay:all` (13/0/0), with expected hashes intentionally
refrozen because the canonical camera island gained typed fields and collapsed
routes. No QA finding class was added or loosened; no paid probe, publish, or
deploy.

## S3.3 — 2026-07-11 — DONE
Made `cameraPhrase.ts` own parsing plus the frozen landing tolerances, and
migrated layout arrival/occupancy and eye-trace attention to the canonical
phrase plan. The two QA paths now share visibility, occupancy slack, anchor,
rest-speed, dwell, sample-inset, and segment-match values; this removes the
former exact-upper-bound vs 1.1x evidence mismatch. Eye trace uses the last/
first executed phrase targets at boundaries (typed cut focal parts still win),
not raw authored camera path guesses. The browser runtime now executes the
compiler's phrase list directly and no longer filters/merges routes again.
Browser fixtures were migrated through the same collapse pass. Files:
`cameraPhrase.ts`, `cameraBlocking.ts`, `layoutInspector.ts`, `eyeTrace.ts`,
camera/continuity runtime template, focused unit/browser tests, replay
expectations, `PHASE_3.md`, and this plan. Verification: Slack typecheck; 129
focused unit/layout tests; GatePilot-shaped continuity, blocking-landing, and
eye-trace browser tests (10/10); exact `replay:all` (13/0/0). An initial browser
run exposed a legacy fixture that depended on runtime-side compilation and an
over-zoom from applying QA slack to runtime targeting; the fixture now enters
through canonical collapse and runtime again targets nominal occupancy while
QA alone applies the shared measurement band. No paid probe, publish, or
deploy.

## S3.4 — 2026-07-11 — DONE
Replaced the duration-based raw full-move cap with a static one-idea contract
over compiled camera routes. Each multi-route scene now gets a blocking
`camera/idea-budget` findings-retry that keeps the route matching the scene's
declared focal and names every competing lens idea to cut or split into its own
scene; local component motion remains the prescribed supporting development.
The L2 `normalizeCameraBudget` seam no longer deletes per-scene moves (a
creative choice); it retains only the mechanical film-wide whip cap. Added the
finding to Sentinel. The exact SignalDock accepted storyboard yields only the
three intended idea findings, naming `incident-workspace`,
`confidence-numeral-71`, and `restore-cta` as the routes to cut. Files:
`cameraBlocking.ts`, `pacingAudit.ts`, `sentinel.ts`, focused tests, replay
expectations, `PHASE_3.md`, and this plan. Verification: Slack typecheck;
pacing/camera/Sentinel tests (175/175); exact `replay:all` (13/0/0). Four old
storyboard artifacts (two LaunchRelay, PulseForge, SignalDock) intentionally
changed from parsed to expected findings-retry rejection; artifact/source
bytes remained frozen. No paid probe, publish, or deploy.

## LP-1 — 2026-07-12 — DONE (Phase 3 checkpoint passed)
Five paid runs (`phase3-lp1-camera-20260711-a…e`), fix-first between each:
attempts A–D failed loudly at storyboard planning and each yielded one
deterministic fix with an exact-artifact replay + minimized regression
(commits `22b9086`, `bbbfb80`, `14e86c7`, `6f7064c` — semantic idea
de-duplication, framing-floor neutral-chassis upgrade, duplicate team-strip
retirement, region-as-context for spatial focals). Attempt E accepted the
storyboard on the first logical attempt and published: `published-degraded`,
`runtimeValid=true`, `qualityResidue=1`, 9 logical / 13 physical, 20.2s MP4.
Triage vs LP-0 passed all four LP-1 criteria (routes ≤1/scene, landings 7/7,
occupancy 7/7, no new QA class). Ledger: PROBE_LOG.md "Phase 3 LP-1
checkpoint"; narratives: PHASE_3.md. Residue filed, not hidden:
`motion_jerk_excess` repeated across both source attempts and shipped as the
single quality residue — its fix is S8.4's gesture-settle contract (browser
class; the artifact replays statically clean); staging residue (edge-cropped
count-up numerals, near-black owner scene, loud swipe covers) → S8.1/S8.6.
Attempt E's launcher session died mid-probe; this session picked the live
process up, let it finish, and ran `probe:triage`. Post-probe verification at
HEAD: typecheck, 78 files / 1,306 unit tests, `replay:all` 13/0/0 all green.
Note: this commit also carries the previously uncommitted Briefly
(`refactor-review-normal-1-20260711`) PROBE_LOG entry that the committed docs
already referenced. Next agent: Phase 4, S4.1.

## S4.1 — 2026-07-12 — DONE
Added typed metric/button/progress/selection/shell state to continuity entities,
appearances, and edges. The component plan now derives incoming state from the
prior resolved appearance, initializes the destination component before its
first beat, and counts/progresses from that value instead of zero. Preserved
explicit continuity through direct-composition validation and extended the
component island parser for exact round trips. Files: `continuityGraph.ts`,
`componentContract.ts`, `directComposition.ts`, components runtime, focused
unit/browser tests, replay expectations, and this plan. Verification: Slack
typecheck; focused continuity/component tests; 38→71→94 swipe + reverse-seek
browser regression; full unit suite (one initial
diagnostics health-check flake passed in isolation and on full rerun); full
browser suite rerun green; `replay:all` 13/0/0; deterministic `film:demo` and
100-frame temporal strip inspected with all four cuts intact and no eligible
dead-frame window. No paid probe, publish, or deploy.

## S4.2 — 2026-07-12 — DONE (implementation; LP-2 pending authorization)
Made continuity-state proof a prerequisite for discovered and runtime morphs.
The cut runtime initializes the incoming endpoint before geometry/structure
audit and clone capture, then degrades missing-proof or structurally impossible
morphs to the existing axis-derived swipe path. Shape-match discovery now
upgrades only boundaries already proven by the continuity graph. Added a
GatePilot-shaped stat-card→app-window regression proving the incoming 94 state,
clean swipe degradation, and forward/reverse visibility/state restoration.
Files: `cutDiscovery.ts`, cuts runtime, cut-discovery unit/browser fixtures,
`stateHandoff.browser.test.ts`, and this plan. Verification: Slack typecheck;
focused cut-discovery/state-handoff/component/continuity tests; full unit suite;
full browser suite (initial parallel component-runtime timeout passed focused
and on full rerun); `replay:all` 13/0/0; deterministic `film:demo` and temporal
strip inspected. At the implementation commit, no LP-2 paid probe had yet
been run because owner authorization was not provided, so the Phase 4 live
checkpoint remained outstanding. The later authorized probe is recorded below;
it failed before state runtime. No publish or deploy.

## LP-2 — 2026-07-12 — INCONCLUSIVE (pre-state planning rejection)
Paid probe `s4-lp2-state-20260712` was explicitly authorized and ran with
OpenRouter, fallback disabled, continuity enabled, audit composition, MCP,
render, and temporal requested. Frame design succeeded (2 logical / 2
physical); storyboard planning failed after 6 logical / 7 physical calls (one
hedge), at 14m35s total. Every rejected attempt named the same existing
`camera/idea-budget` class in `shot-4-owner-verifies`; no authoring or render
stage ran. `probe:triage` reports fail-loud, `runtimeValid=false`, no
degradation/fallback, and no QA findings. All five raw storyboard artifacts
reproduce the same rejection without a model call. LP-2 remains outstanding
because the state handoff and morph runtime were never reached. See
`PROBE_LOG.md` for the job evidence and the fix-first deferral.

## S4.3 — 2026-07-12 — DONE
Reviewed the committed S4.1/S4.2 implementation against the Phase-4 contract
and fixed three deterministic gaps. Compatible appearances with no new beat
now inherit the prior resolved state, so a hold scene cannot break a later
metric baseline. Runtime morphs now require an actual continuity proof island
and degrade when the proof or shared initializer is absent. Cut clone capture
delegates to the component runtime's one state initializer, preserving the
authored selection channel (`.active`, `data-state`, or `data-active`) before
geometry/structure audit and clone capture. Proof failures are classified as
the existing `cut_degraded` `state-proof` reason. LaunchRelay's two strict
source replay hashes were intentionally refrozen because its held selection
now initializes the next compatible table; artifact bytes and all other
replays stayed frozen. Geometry-only morph fixtures gained explicit host proof
so they still exercise paint/aspect/structure policy. The component runtime
browser test kept every assertion and received a 60s orchestration timeout
because it passes in ~18s alone but repeatedly exceeded 30s under the full
parallel Chrome suite.

Files: `src/engine/continuityGraph.ts`, `cutDiscovery.ts`, component/cut
runtimes, `scripts/replayAll.ts`, focused unit/browser fixtures, and this plan.
Verification: root and Slack typechecks; focused S4/cut tests; full Slack unit
suite (78 files / 1,310 tests); full Slack browser suite (23 files / 55 tests);
root `npm test`; `replay:all` (13/0/0); model-free demo, MCP demo, direct demo,
and `sequence:check --demo --no-mcp --format both`; deterministic `film:demo`
with 100-frame temporal strip (all four cuts move/settle, 0 eligible dead-frame
windows), strip and representative thread/film/lockup frames inspected. One
initial full-unit timeout and two full-browser timeouts were reproduced as
parallel Chrome contention; the tests passed alone, the unit suite passed
sequentially, and the browser suite passed after the orchestration-only timeout
correction. No paid probe, publish, or deploy. LP-2 remains open.

## S4.4 / LP-2 follow-up — 2026-07-12 — DONE (runtime checkpoint still open)
Ran the authorized fix-first Phase-4 follow-up sequence: ProofRail
(`s4-lp2-state-20260712-b`), SignalLedger (`...-c`), MetricThread (`...-d`),
and one MetricThread resume. Each process was stopped when rejected storyboard
artifacts appeared; none reached authoring/render/runtime, no fallback film was
used, and LP-2 therefore remains inconclusive. Fixed three deterministic
owners: camera idea identity now groups a stable framing subject or continuity
  entity; atomic normalization rejects a numerically worse dead-moment gap even
  when the finding class is unchanged; the exact metric-headline/count
  conjunction lowers to `stat-card`; and digit-leading scene slugs receive a
  bounded `scene-` prefix. Exact ProofRail/MetricThread artifacts now
parse strictly; SignalLedger preserves its smaller genuine creative gap.
The resume's genuine two-station lens request and read-hold miss were logged
without inventing content. Files: `cameraBlocking.ts`,
`componentContract.ts`, `runner/storyboardAudit.ts`, `sentinel.ts`, focused
tests, replay expectation, PROBE_LOG, and this plan. Verification: Slack
typecheck; full unit suite; focused camera/component/Sentinel/normalization
tests; `replay:all` 13/0/0; model-free demo/MCP/direct/sequence-check gates.
Root `npm test` produced five parallel-Chrome timeouts; all five affected files
passed serially (19/19). No publish or deploy.

## S5.1 — 2026-07-12 — DONE
Moved the layout QA implementation under `src/engine/layout/report.ts` and
made `src/engine/layoutInspector.ts` a compatibility facade, preserving every
existing public import. Added focused module entrypoints for browser evidence
collection (`layout/collect.ts`), semantic selectors (`layout/selectors.ts`),
browser checks (`layout/checks/browser.ts`), and measurement scoring
(`layout/score.ts`). Adjusted only the moved module's relative imports and
vendored CLI path; the implementation and QA cache inputs remain unchanged.
Files: `src/engine/layoutInspector.ts`, `src/engine/layout/report.ts`,
`src/engine/layout/{collect,selectors,score}.ts`,
`src/engine/layout/checks/browser.ts`, and this plan. Verification: Slack
typecheck; `replay:all` (13/0/0); full browser suite (22/23 files passed,
54/55 tests passed, with the known 5s parallel-Chrome timeout isolated and
passing in `continuityRuntime.browser.test.ts` at 30s); cached QA evidence
reused hash `a2f66a26`. No paid probe, publish, or deploy.

## S5.2 — 2026-07-12 — DONE
Moved the repair implementation behind the stable `runner/repairs.ts` facade
and added domain entrypoints for `htmlChassis`, `cssSafety`,
`selectorDataflow`, `timelineNormalize`, `contractIslands`, and
`boundedLayout`. Added `repairs/proof.ts` with `withRepairProof`, which
returns edits plus intended-finding evidence and rejects newly introduced
finding classes; the source normalizer seams now expose that proof while
preserving the exact normalized state and registry order. Updated Sentinel's
closed-world source list and the host-contract source scan to include nested
repair/layout implementations. Files: `src/engine/runner/repairs.ts`,
`src/engine/runner/repairs/implementation.ts`, the six domain modules,
`repairs/proof.ts`, `src/engine/sentinel.ts`, `test/hostContract.test.ts`,
`test/repairProof.test.ts`, and this plan. Verification: Slack typecheck;
focused normalizer/extraction/proof/host-contract/Sentinel tests (38/38);
full Slack unit suite green; `replay:all` (13/0/0). No paid probe, publish,
or deploy.

## S5.3 — 2026-07-12 — DONE
Made source-normalizer ordering an executable dependency contract. Registry
entries now expose read/write fields, pre/postconditions, explicit transitive
ordering, atomic-group membership, and a stable idempotence-test reference.
Added a dependency-graph audit for duplicate/missing/cyclic dependencies,
execution-order violations, split atomic groups, and unordered write/write
conflicts. The runtime now invokes one full-audit hook at each atomic-group
boundary and reports only groups actually audited; source repair remains one
atomic `source-composition` group in the exact historical order. Added the L2
churn/group-audit principle to SENTINEL.md. Files:
`src/engine/runner/normalizerRegistry.ts`,
`src/engine/runner/repairs/implementation.ts`,
`test/normalizerRegistry.test.ts`, `SENTINEL.md`, and this plan.
Verification: Slack and root typechecks; focused registry/proof/extraction
tests (20/20); full Slack unit suite; root `npm test` including browser tests;
`replay:all` (13/0/0); model-free demo, MCP demo, direct demo, and
`sequence:check --demo --no-mcp --format both`, all green. The first full-unit
invocation hit the command wrapper's 124s limit without a test failure; the
same suite completed green with a 300s allowance. No paid probe, publish, or
deploy.

## S5.4 — 2026-07-12 — DONE
Added an AST-lite L3 dead-dataflow audit beside `deadTweenRepair.ts`. It tracks
one direct variable assignment from a literal `querySelector`/`querySelectorAll`
and flags pseudo-element selectors plus selectors absent from the parsed final
DOM when that variable is passed to a GSAP tween. Dynamic selectors, comments,
live targets, and second-hop assignments remain outside the bounded check.
Wired the audit into `validateDirectComposition` as the registered blocking
`dead_gsap_target` finding, with minimized unit and direct-composition
regressions proving the failure is static rather than browser QA. Extended
`replay:all` expectations to preserve four persisted SignalDock/Briefly source
artifacts as intentional strict-source rejections with the new finding.
Files: `src/engine/deadTweenRepair.ts`, `src/engine/directComposition.ts`,
`src/engine/sentinel.ts`, `scripts/replayAll.ts`,
`test/deadTweenRepair.test.ts`, `test/directComposition.test.ts`, and this
plan. Verification: root typecheck; Slack typecheck; focused dead-tween,
direct-composition, and Sentinel tests (199/199); full root `npm test`
(including Slack browser coverage); exact `replay:all` (13/0/0); model-free
demo, MCP demo, direct demo, and `sequence:check --demo --no-mcp --format both`.
No paid probe, publish, or deploy. The four strict-source replay outcomes
changed deliberately from browser-rejected artifacts to expected L3 static
rejections; artifact bytes remain frozen.

## S6.1 — 2026-07-12 — DONE (LP-3 pending authorization)
Measured the pre-diet payloads at 65.8k chars for a normal locked author
prompt, 125.1k for repair, and 72.2k for the historical multi-scene slot
prompt; archived stress runs reached 125–137k. Added a shared 45,000-char
author/patch assertion before provider calls. Locked and slot prompts now
project only author-needed creative plan fields, compact host-owned director
chapters and skills, and omit duplicated component/world/camera/cut contract
prose. Repair prompts now carry exact finding-targeted source excerpts rather
than the whole scratch document. The ledger still records successful model-call
prompt sizes; receipt behavior is unchanged.

Files: `src/engine/runner/prompts.ts`, `src/engine/runner/ladder.ts`,
`test/promptBudget.test.ts`, and this plan.
Verification: root typecheck; Slack typecheck; root `npm test`; full Slack unit
suite (80 files / 1,327 tests); focused prompt/direct/plugin/scene/runner tests;
`replay:all` (13/0/0); MCP demo; direct demo; and
`sequence:check --demo --no-mcp --format both`. Exact replays remain unchanged.
No paid probe, publish, or deploy. LP-3 remains pending owner authorization.

## S6.2 — 2026-07-12 — DONE
Added a plan-time production-basis gate: structured storyboard responses now
declare `productionBasis`, tagged/legacy envelopes are inspected when present,
and a committed frame basis rejects missing or contradictory plans before scene
validation/authoring. Basis-aware cache and rejected-artifact recovery prevent
old SignalDock-shaped arrays or stale cache entries from bypassing the gate.

Files: `src/engine/frameValidation.ts`, `src/engine/runner/storyboardAudit.ts`,
`src/engine/runner/storyboardResponseFormat.ts`, `src/engine/runner/ladder.ts`,
`src/engine/sentinel.ts`,
`test/storyboardBasis.test.ts`, `test/runnerExtraction.test.ts`, and this plan.
Verification: Slack typecheck; focused basis, runner-extraction, and direct
composition tests green. No Live Probe, publish, or deploy.

## S6.3 — 2026-07-12 — DONE (LP-3 pending authorization)
Replaced the always-on Studio inventory with an evidence-backed capsule. Typed
catalog conversions now append per-catalog/per-entry events to the attempt
ledger; historical ledgers and pre-S6.3 typed artifacts seed the counts without
double-counting new event-backed jobs. The shared planner/author context offers
only catalog entries with conversion evidence, while host-side recipe adoption
uses the complete typed recipe library and matching assets are auto-declared
from the brief and target scene. Asset declarations are recorded before later
UID reconciliation so the adoption path itself becomes evidence.

Files: `src/engine/runner/attemptLedger.ts`, `src/engine/sentinelTelemetry.ts`,
`src/engine/studioLibrary.ts`, `src/engine/runner/ladder.ts`,
`src/orchestrator.ts`, `test/studioCatalogIntegration.test.ts`, and this plan.
Verification: root typecheck; Slack typecheck; full root `npm test` including
browser coverage; full Slack unit suite; exact `replay:all` (13/0/0); MCP demo;
direct demo; and `sequence:check --demo --no-mcp --format both`. No Live Probe,
publish, or deploy. LP-3 remains pending owner authorization. S7.1–S7.3 were
intentionally left untouched per task scope.

## S6.4 — 2026-07-12 — DONE (LP-2/LP-3 rerun pending)
The authorized CurrentProof probe reached an accepted five-scene storyboard
and auto-declared `asset-glass-metric`, then failed loud before the first source
provider call because its slot prompt was 46,602 chars. The author ladder
incorrectly repeated the identical deterministic budget exception through all
three attempts and rescue. A cache-distinct follow-up proved the typed error is
terminal (one exception, no rescue), but its different valid plan still
assembled at 46,310 chars under a fixed 2,000-char skill allowance. Kept the
locked plan, frame, and scaffold intact; the author projection now fits only
the optional skill excerpt to the actual remaining prompt budget with 512
chars of feedback headroom. The two persisted plans recompose at 43,036 and
44,488 chars. Files: `runner/prompts.ts`, `runner/ladder.ts`,
`test/promptBudget.test.ts`, PROBE_LOG, and this plan. Verification: Slack
typecheck; prompt-budget tests (10/10); both exact-plan prompt measurements;
full unit suite and exact `replay:all` (13/0/0), all green. No publish or
deploy. LP-2/LP-3 remain open because no author/runtime/render stage ran.

## S3.5 — 2026-07-12 — DONE
The third CurrentProof checkpoint repeated `camera/idea-budget` for a metric
and confirm button inside one hero approval modal. Exact replay showed the
camera resolver's contextual framing recognized a sole app window but not the
equivalent typed modal surface, so local component evidence became competing
lens subjects. Extended only the sole-surface predicate to a hero modal;
non-hero and multiple modals remain separate. Added a minimized metric + CTA
modal regression. The first rejected artifact now passes strict replay; the
second loses the false camera class and retains its genuine moment gap. Files:
`cameraBlocking.ts`, `cameraBlocking.test.ts`, PROBE_LOG, and this plan.
Verification: Slack typecheck; focused camera phrase/blocking tests (23/23);
exact attempt-1 strict replay; full Slack unit and browser suites; exact
`replay:all` (13/0/0), all green. No source call, runtime, publish, or deploy.

## LP-3 follow-up — 2026-07-12 — FAILED / HANDOFF
CurrentProof D proved S3.5 (no repeated modal camera class) and S6.4's initial
author budget fit (44,829 chars), but failed before runtime. Three typed
`progress` beats reached source with a `hairline-rule` root missing its
canonical fill child; attempt 1 and compact repair attempt 2 repeat the exact
`kit_markup_incomplete` findings under strict `source:replay`. Full re-author
attempt 3 then measured 49,040 chars even after removing the optional skill
overflow and stopped at the typed preflight. Triage: fail-loud, 9 logical / 12
physical calls, one storyboard time-ramp degradation, no fallback, no runtime
or render. Next owner: L1 scaffold or bounded L2 kit markup for the progress
fill, plus non-skill compaction for full re-author prompts. S7.1-S7.3 were not
started because LP-2/LP-3 never reached state/runtime evidence. See PROBE_LOG
CurrentProof D and the persisted project for exact artifacts. No publish or
deploy.

## S6.5 — 2026-07-12 — DONE
Exact replay showed the progress top-up already owned the mechanical fill but
looked for one globally unique `data-part`; continuity intentionally reused
`hairline-rule` in three named scenes, so all three safe roots were skipped.
The L2 owner now resolves the sole root inside each scene, injects the canonical
neutral fill independently, remains idempotent, and declines two roots inside
one scene. Both CurrentProof D rejected sources now pass strict replay and are
frozen as accepted exact fixtures.

Files: `src/engine/runner/repairs/implementation.ts`, `src/engine/sentinel.ts`,
`scripts/replayAll.ts`, `test/authorReliability.test.ts`, and this plan.
Verification: both exact `source:replay` artifacts pass; focused author/Sentinel
tests (118/118); Slack typecheck; exact `replay:all` (15 replayed / 2 skipped /
0 failed), all green. S6.6 is next; no paid probe, publish, deploy, or S7 work.

## S6.6 — 2026-07-12 — DONE (LP-2/LP-3 rerun pending)
The exact CurrentProof D prompt fixture reproduces the 49,040-character full
re-author preflight. Locked recovery prompts now keep the scene title,
foreground/background thesis, continuity anchor, timing, and every visible
moment while omitting duplicated planner purpose/blueprint/rule/camera/cut
paperwork already compiled into the scaffold and host contracts. Repeated
finding signatures are emitted once. The same compact projection now activates
on an initial slot prompt only when all optional skill bytes are gone and the
512-character feedback reserve is still consumed.

Exact recomposition: initial slot 40,865 chars (was 44,829); full re-author
44,485 chars (was 49,040). Both retain every scene, the mandatory templates,
frame capsule, and visible moment contract. Files: `runner/prompts.ts`,
`test/promptBudget.test.ts`, and this plan. Verification: prompt-budget tests
(12/12) and Slack typecheck, green. No paid probe, publish, deploy, or S7 work;
LP-2/LP-3 still require a fresh runtime-reaching probe.

## S2.4 — 2026-07-12 — DONE (LP-2/LP-3 rerun pending)
The approval scene's three typed roots were one product panel to the viewer:
one app-window chassis with a metric and confirmation button in the same
`approval-station`. `sceneIntroductionTimes` now groups only lightweight static
evidence under one unambiguous app-window/hero-modal region; a child's explicit
entrance, dense/overlay content, plugin unit, missing region, or multiple
chassis keeps its independent pacing cost. This reduces the false four-surface
charge to the honest chassis + swapped-in Ready state. The exact first response
then needs only the existing 0.70s atomic cut-boundary stretch and passes; the
exact second response passes without repair.

Files: `src/engine/pacingAudit.ts`, `src/engine/sentinel.ts`,
`test/pacingAudit.test.ts`, `scripts/replayAll.ts`, and this plan. Verification:
both exact `storyboard:replay --strict` artifacts pass; focused pacing/Sentinel
tests (96/96); Slack typecheck; exact `replay:all` (17/0/0), all green. No paid
probe, publish, deploy, or S7 work.

## S6.7 — 2026-07-12 — DONE (LP-2/LP-3 rerun pending)
The S6.3 audit found that host asset adoption ran after storyboard plugin
lowering. The saved `asset-glass-metric` therefore had no UID or lowered asset
component, could not inject at source/runtime, yet still emitted conversion
telemetry; its catalog defaults also contradicted CurrentProof's 41%
release-readiness fact and duplicated the existing typed progress-ring. Host
auto-adoption now exists only for assets with a deterministic semantic-param
binder, reconciles immediately to an injectable UID/component/beats unit,
declines an equivalent typed hero, counts only UID-stamped conversions, and
is rolled back if the augmented storyboard fails its full plan gate. The
storyboard cache contract advanced to v25.

Files: `src/engine/assetContract.ts`, `src/engine/assets/glassMetric.ts`,
`src/engine/studioLibrary.ts`, `src/engine/runner/ladder.ts`,
`test/studioCatalogIntegration.test.ts`, `SENTINEL.md`, and this plan.
Verification: exact CurrentProof D-shaped adoption declines in favor of
`continuity-metric`; focused asset/plugin/capsule tests (92/92); Slack
typecheck; exact `replay:all` (17/0/0), all green. No paid probe, publish,
deploy, or S7 work.

## S3.6 — 2026-07-12 — DONE (LP-2/LP-3 rerun pending)
Browser replay of CurrentProof D exposed a runtime/QA geometry split: the
camera's transform-free layout helper used HTMLElement offsets for every node,
but SVG media supplies neither a reliable `offsetWidth` nor `offsetParent`.
The runtime therefore treated each full 360px progress ring as a 1px graphic
at world origin, solved the contextual lens from its much smaller text label,
and zoomed the two carried metrics to 36%/46% even though their typed maximum
was 22%. SVG/media measurement now falls through to client/bounds dimensions
and continues through the DOM parent until the normal offset chain resumes.

Files: `src/engine/templates/sequences-camera.v1.js`,
`test/continuityRuntime.browser.test.ts`, and this plan. Verification: the
new SVG-only metric lands at 8%; the full continuity runtime browser file
(9/9), focused camera units (81/81), Slack typecheck, exact CurrentProof D
browser replay (both blocking warnings cleared), and `replay:all` (17/0/0)
are green. The genuine sparse opening and deterministic contrast repairs remain
separate; no paid probe, publish, deploy, or S7 work.

## S3.7 — 2026-07-12 — DONE (LP-2/LP-3 rerun pending)
After SVG geometry parity, CurrentProof D's opening still failed the whole-frame
sparse floor: its hero progress-ring shared `metric-hero` only with the
subordinate `hairline-rule`, but contextual framing preserved that full-width
one-pixel rail and prevented the camera from enlarging the actual subject.
Camera blocking now treats exactly `hero progress-ring + support progress`
peers as one solo close-up; adding any product/non-progress peer restores the
region ensemble. The solo primary uses a 3%/12%/26% occupancy range, aligned
with the already-calibrated whole-frame composition floor.

Files: `src/engine/cameraBlocking.ts`, `test/cameraBlocking.test.ts`,
`scripts/replayAll.ts`, and this plan. Verification: minimized
solo/real-context controls (18/18); Slack
typecheck; exact CurrentProof D source with continuity enabled reaches
`runtime ok: true`, browser `strictOk: true`, 15.9% opening occupancy, and no
`camera_framed_sparse`/`camera_blocking_landing`; exact `replay:all` (17/0/0).
The two remaining contrast rows are advisory and already owned by the bounded
contrast repair. No paid probe, publish, deploy, or S7 work.

## S6.8 — 2026-07-12 — DONE (fresh one-attempt probe pending)
ProofLine E was the first post-fix paid run to accept its storyboard on logical
attempt 1, but source attempt 1 exposed three lower-owner collisions in the
approval station. The author's ring-centering `.cmp-value` rule also positioned
the stat-card value absolutely, placing `READINESS SCORE` behind `94%`; a
class-only `.cursor-indicator` remained visible beside the canonical actor; and
the density audit counted ten down/release/settle tween legs as ten independent
beats. The primary cursor-arrival moment changed only 0.069% of rendered pixels.
The run was stopped before source attempt 2.

L2 now scopes only the full centered-ring geometry signature away from other
typed value surfaces and retires unmistakable class-only pointer actors only
inside scenes with a typed interaction. Motion density counts distinct authored
targets, so repeated legs on five subjects form one interaction macro while
nine independent subjects still warn. The interaction runtime gives the
measured target a restrained 1.08 brightness focus on arrival and restores its
exact authored filter before press/result ownership. Sampled contrast may run
up to three atomic passes, each requiring a strict global penalty reduction.

Files: `src/engine/runner/repairs/implementation.ts`,
`src/engine/templates/sequences-interactions.v1.js`,
`src/engine/motionDensity.ts`, `src/engine/runner/ladder.ts`,
`src/engine/compositionRunner.ts`, `test/authorReliability.test.ts`,
`test/motionDensity.test.ts`, `test/interactionContract.test.ts`,
`test/normalizerRegistry.test.ts`, `scripts/replayAll.ts`, `SENTINEL.md`, and
this plan. Verification so far: focused ownership/interaction/density registry
tests (139/139), contrast tests (4/4), Slack typecheck, and exact `replay:all`
(18/0/0). Exact browser replay is runtime `ok: true`, `strictOk: true`, no
overlap/static-moment findings, and 6.574% arrival change; a second bounded
contrast pass reaches zero warnings. No publish, deploy, or S7 work.

## HACKATHON-GUARDRAIL-PLAN — 2026-07-12 — READY (docs only)
Added the active pre-S7 work order for the next agent. The new acceptance
contract deliberately targets a judge-ready, runtime-valid MP4 with bounded
cost rather than one-attempt/zero-residue purity: at most two logical attempts
per authoring stage, six logical/eight physical calls per job, and two paid
probes for the entire sprint. Hard runtime/contract failures remain blocking;
measured load-bearing frame containment moves to one deterministic same-attempt
repair; and taste/quality heuristics remain visible but cannot trigger paid
repair. The first human-acceptable MP4 freezes product code.

The plan starts from verified commit `00dfedb`, records the honest ProofGrid I
and early-stopped ProofLane J evidence, restricts any delegation to LUNA
high/xhigh, and forbids S7+, publish, deploy, and unrelated edge-case work. No
production code, paid provider call, probe, publish, or deployment was performed
for this documentation step.

## DOC-STATE-SYNC — 2026-07-12 — DONE (docs and workflow skills only)
Aligned the canonical agent/operator docs around the S6.9-S6.13 hackathon
override: hard failures may block, host-known mechanics get one measured
deterministic repair, and taste residue remains advisory without another paid
call. Updated the live ledger with honest ProofLine E through ProofLane J
evidence; J's missing terminal ledger/call count is explicitly left unknown.
Marked the broad handoff and Phase 3 narrative as historical, corrected the
current model/prompt/runner paths, froze Studio/catalog expansion, replaced the
stale submission handoff, and refreshed the dated compliance checklist against
the official 2026-07-12 Devpost overview/FAQ plus read-only Railway/public-repo
state.

Files: root/app `CLAUDE.md`; `OPERATIONS.md`, `SENTINEL.md`, `PROBE_LOG.md`,
`REFACTOR_HANDOFF.md`, `PHASE_3.md`, this plan, prompt/recipe/Studio docs,
submission handoff/compliance audit, `website-to-video`'s two repaired local
references, and the tracked `sequences`, `bug-hunt`, and `verify` workflow
skills under `.agents/skills/`. Local ignored `.claude` mirrors were
synchronized byte-for-byte. Verification: model-free triage for E-I (H/J
correctly lack terminal Sentinel ledgers); local Markdown links and current-doc
npm script names all resolve across 45 current first-party docs and all 25
product skill entrypoints; skill-mirror SHA-256 hashes match;
Railway reports the service online and `/healthz` returned `200 ready`; public
`main` was read without mutation; `git diff --check` green. No product code,
paid probe, publish, deployment, or S7+ work.

## S6.9 — 2026-07-12 — DONE
Added `.reports/hackathon-guardrails.md`, an inventory-only trace from plan,
static, browser, penalty, scene-repair, rescue, critic, status, hedge, and
normalizer seams to the active HARD / deterministic same-attempt / ADVISORY
policy. The report records present paid-call cost and publication behavior,
classifies the mixed detector families by measured evidence, inventories the
source/storyboard/browser repair registries, and identifies the retry-owner
duplicates across focal visibility, camera clipping/landing, safe-area,
overflow, sparse, and near-blank checks. ProofLane J is frozen as the negative
control: its fully visible ~12% headline, parent/child shell overlap, and
unsettled opener remain QA advisories and must cost zero repair/critic calls.

Files: `.reports/hackathon-guardrails.md` and this plan. Verification: focused
Sentinel, sequence-status, normalizer-registry, and attempt-ledger unit tests
(34/34); Slack typecheck; exact ProofLane J `source:replay`; and exact
`replay:all` (25 replayed / 0 skipped / 0 failed), all green. No production
code, paid probe, publish, deployment, or S7+ work. S6.10 is next.

## S6.10 — 2026-07-12 — DONE
Added structured browser bounds for typed primary-moment and camera-blocking
focals, then reused the existing host-owned `layoutRepairs` seam for one
measured same-attempt containment correction. The correction is capped at 40%
of the frame per translation axis and a 0.65 scale floor, replaces its own
stable scene/part repair idempotently, and is adopted only after reinspection
proves a strict visibility improvement to the existing hard floor with no new
runtime or containment failure. A failed correction leaves the authored
candidate untouched for S6.11's single paid-repair policy.

The real-Chromium minimized typed fixture moves a 40%-visible load-bearing hero
fully into frame. Unit rollback controls cover no improvement, an undersized
result, and a newly failed focal. Supporting/decorative content is untouched,
as is the explicit ProofLane J negative-control shape whose headline is 100%
visible despite its advisory ensemble-occupancy finding. No copy, story order,
component choice, beat timing, typography, palette, or motion style changes.

Files: `src/engine/{compositionRunner.ts,directComposition.ts,layout/report.ts,
runner/index.ts,runner/ladder.ts,runner/repairs/implementation.ts,sentinel.ts}`,
`test/{directComposition.test.ts,loadBearingContainment.browser.test.ts,
runnerExtraction.test.ts}`, and this plan. Verification: Slack typecheck;
focused containment/registry tests; complete Slack unit suite; complete Slack
browser suite (24 files / 59 tests); exact ProofLane J `source:replay`;
`replay:all` (25 replayed / 0 skipped / 0 failed); deterministic `film:demo`
render, preview, and temporal proof; and `git diff --check`, all green. No paid
probe, publish, deployment, feature work, or S7+ work. S6.11 is next.

## S6.11 — 2026-07-12 — DONE
The normal ledger-backed create path now separates retry eligibility from QA
visibility. Storyboard taste findings (camera/idea and energy, framing density,
pacing, transition/component coherence, and supporting moment preferences) are
accepted as explicit advisory degradations from the first response; malformed
schema, invalid timing, broken typed interactions, and explicit executable
brief contracts remain hard. Browser retry feedback is now only runtime errors,
blank scenes/films, broken typed interactions, unreadable typed primaries, and
load-bearing containment that remains below its measured floor after S6.10.
Every other finding remains in QA and final `qualityResidue`, so an advisory
film is still honestly `warn` without buying a repair.

Ledger-backed creates stop at two storyboard and two source calls, disable the
extra scene-planning and rescue rungs, and bank a runtime-valid no-hard source
immediately before any taste repair or critic. The call budget is reserved
atomically before provider launch, including the formerly uncounted frame
decision, so parallel concept/shape work cannot overrun six logical or eight
physical requests. Storyboard/source families each cap at two and each
expensive stage can hedge once. Reservation-aware folding counts the primary
request once while legacy ledgers without reservations replay unchanged.

ProofLane J's exact one- and three-warning QA caches both report `ok:true` and
zero hard retry findings. Its typed three-advisory replica consumes one source
response, retains all warnings, and skips both repair and critic calls. Controls
prove a persistent 40%-visible typed focal gets only one paid repair, while a
runtime bind exception and a missing registered timeline fail loud after two.
A live-policy storyboard fixture accepts advisory foreground/camera repetition
on response one and caps a malformed-plan retry at response two.

Files: `src/engine/{compositionRunner.ts,frameDesign.ts,sentinelTelemetry.ts}`,
`src/engine/runner/{attemptLedger.ts,browserQuality.ts,index.ts,ladder.ts,
storyboardAudit.ts}`, `test/{attemptLedger.test.ts,directComposition.test.ts,
duplicateCopyAudit.browser.test.ts,framingCoverage.browser.test.ts,
runnerExtraction.test.ts,sentinelTelemetry.test.ts}`, and this plan.
Verification: root and Slack typechecks; complete Slack unit suite; complete
Slack browser suite (24 files / 59 tests); exact ProofGrid I and ProofLane J
`source:replay`; both persisted ProofLane QA caches through the hard-finding
classifier; `replay:all` (25 replayed / 0 skipped / 0 failed); deterministic
`film:demo` preview/temporal proof; and `git diff --check`, all green. No paid
probe, fallback evidence run, publish, deployment, feature work, or S7+ work.
S6.12 is next.

## S6.12 — 2026-07-13 — DONE

Two authorized cache-distinct probes used the same ordinary 16-second
Sequences-for-Slack brief through real OpenRouter with fallback disabled,
continuity/composition audit/MCP/render/temporal requested, and `format both`.
Probe A failed loud in 6m26s (6 logical / 8 physical requests) when custom chat
swap/stream fallbacks hid the whole interaction root. Exact-copy internal chat
target reconciliation fixes that bounded markup owner idempotently; canonical
and ambiguous chats are unchanged, and the real Chromium replay keeps the
arrival/press/release on target.

Probe B failed loud before render in 9m15s (5 logical / 7 physical requests)
when overlapping disjoint PRIMARY continuity routes sent the camera away from
the typed Slack focal. The phrase compiler now executes the route named by
typed spatial/interaction ownership while retaining the competing route in
the advisory audit. Ambiguous and sequential routes are preserved. Exact B
Chromium replay is runtime-valid with no hard finding and a fully hit click.
The live command itself produced no MP4; its missing sequence-check report is
recorded honestly rather than reconstructed.

No Probe C or additional provider request was made. The exact persisted
OpenRouter-authored B source was recovered model-free. One final visible
source residue—the author's canvas-scale blue diagonal hairline—was removed by
an idempotent, measured source normalizer bounded to non-host/non-component
simple hairlines spanning at least 50% of canvas width and 25% of height. It
suppresses only path paint so camera/continuity geometry stays valid; short or
horizontal rules, charts, and host geometry remain byte-identical. Revision 2
reinspection has runtime `ok:true`, zero hard findings, and advisory-only QA.
Consecutive encoded frames prove the diagonal is gone and cuts/interactions are
intact.

Primary demo:
`.data/projects/s6-12-sequences-slack-b-20260712-2113/renders/sequences-for-slack-recovered-probe-b-20260713-015938.mp4`
(H.264, 1920x1080, 30fps, 480 frames, 16.0s). Human disposition is **accept
with warn**: coherent scattered-inputs → Slack action/retrieval → storyboard
and preview → returned MP4 → held CTA; no state reset, off-frame primary,
broken interaction, or broken transition. Remaining washout/contrast, safe-
area, degraded-morph, occupancy, and quiet-hold findings are advisory and did
not buy another call. B plus the final model-free recovery/render took about
10m40s, inside the approximate 15-minute target; A+B historical totals are 11
logical / 15 physical requests across the two separately capped probes.

Files: `src/engine/{cameraBlocking.ts,cameraPhrase.ts}`, `src/engine/runner/
repairs/implementation.ts`, `test/{cameraBlocking.test.ts,cameraPhrase.test.ts,
componentRuntime.browser.test.ts,continuityRuntime.browser.test.ts,
directComposition.test.ts,normalizerRegistry.test.ts}`, `PROBE_LOG.md`, and
this plan. Verification: root and Slack typechecks; complete Slack unit suite
(81 files / 1,386 tests); complete Slack browser suite (24 files / 61 tests);
exact ProofGrid I, ProofLane J, Probe A, and Probe B source replays;
`replay:all` (25/0/0); exact A/B Chromium reinspection; deterministic
`film:demo` preview/temporal/render proof; MP4 `ffprobe`; consecutive-frame and
human strip/thumbnail review; and `git diff --check`. No fallback evidence,
Probe C, publish, deploy, feature work, Studio expansion, or S7+ work. Product
code is frozen. S6.13 is next.

## S6.13 — 2026-07-13 — DONE

Product code remained frozen at S6.12 commit `9aa6aa6`. The corrected 16.0s
OpenRouter-authored Probe B MP4 remains the primary demo. The exact Slack
presentation path was checked from the handlers and documented in
`OPERATIONS.md`: enable argument-free debug receipts; capture UI screenshots
through `/sequences assets`; wait for the deterministic brand receipt/preview;
submit the ordinary launch modal through `/sequences`; verify the one building
message advances through frame/storyboard/source and submit/preview/render;
then confirm thumbnails, `frame.md`, rendering status, ready receipt, and MP4
upload. Normal fallback stays opt-out (unset/on) and must visibly label the
failed model stage; no fallback film may masquerade as authored output.

The timed model-free `/sequences demo` equivalent completed in 30.6s with
`sequence:check` status `pass`, clean lint, five thumbnails, and no model/MCP
request. Its backup is
`.data/projects/s6-13-hackathon-rehearsal-20260713/renders/relay-20260713-021028.mp4`
(H.264, 1920x1080, 30fps, 525 frames, 17.5s, 1,391,378 bytes); JSON/Markdown
receipts live in that project's `build/qa`. Contact-sheet review confirms a
readable hook, product proof, stat, social proof, and held CTA. Production
`/healthz` returned `200 ready` in 296ms. This checked process readiness only;
the evidence-only fallback variable was staged from explicit-off to explicit-on
with deploys skipped, then applied only through the owner-authorized deployment
of the committed S6.13 tree. Publish remained separate and unauthorized.

Files: `OPERATIONS.md`, `PROBE_LOG.md`, and this plan. Verification: the timed
model-free `sequence:check --demo --no-mcp --render --temporal --format both`
rehearsal; report/thumbnail/MP4 existence; `ffprobe`; contact-sheet review;
focused Slack result/fallback receipt tests; health check; Markdown command and
artifact path review; and `git diff --check`. No product code, provider call,
Probe C, publish, feature, Studio/catalog, broad audit, S7, or later work. The
only external mutation is the explicitly authorized production fallback
restore/deploy after the S6.13 commit. S6.9-S6.13 are complete; stop.
