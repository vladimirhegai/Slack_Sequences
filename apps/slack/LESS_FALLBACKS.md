# LESS_FALLBACKS — why runs fall back, what it costs, and how to stop it (2026-07-04)

A deterministic fallback is the **most expensive possible outcome**: you pay
for every model call in the run (frame + concept + shape + storyboard + up to
3 author attempts + hedged duplicates), then throw all of it away and spend
render time on a generic film the audience can tell is canned. Every lever
below either makes a paid attempt succeed or makes a failure cheap.

## The evidence — every recorded live author run on this machine

`planning/author-run.json` exists for 5 live runs. 3 published, **2 fell back
(40%)** — and both fallbacks died at `source-author`, not planning:

| run | outcome | attempts | what actually went wrong |
|---|---|---|---|
| probe-cutfix-1 | published (2) | full → patch | attempt 1: `kit_markup_incomplete` rows beats |
| probe-cutfix-2 | **fallback** (3) | full → patch → patch | 3 browser rejections; two identical patches in a row didn't converge |
| probe-cutfix-3 | published (2) | full → patch | attempt 1: `kit_markup_incomplete` rows beats |
| improve-ws15-1 | published (3) | full → patch(exc) → patch | polish findings; published least-bad |
| verify-ws1ws5-2 | **fallback** (3) | full → full → patch | 1: authored **10 scenes vs the 5-scene plan**; 2: rows beats + moment gaps; 3: compact patch introduced **invalid JS syntax** |

Recurring classes, by frequency:

1. **`kit_markup_incomplete` rows beats** — 3 of 5 runs. The author declares a
   `rows` beat but writes a component with no `.cmp-row/.cmp-item/.cmp-card/
   .cmp-msg` children. The single biggest waster of paid attempts.
2. **Final-attempt compact patch fails** — both fallbacks ended on a patch
   (syntax error / non-converging). A patch is the cheapest call but the
   riskiest way to spend the *last* attempt.
3. **Scene-graph mismatch on attempt 1** — DeepSeek authored double the
   scenes. One full attempt burned on structure the host already knows.
4. **Moment-evidence gaps at author time** — the plan promises a moment, the
   author never places a tween/beat at that second.

The storyboard stage, by contrast, is now robust (moment top-up + rescue rung
landed 2026-07-04); `verify-ws1ws5-2`'s storyboard passed on attempt 1.

## Levers you can pull today (no code)

- **Stop rendering ugly fallbacks on probes:**
  `SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK=0` makes an exhausted run fail
  visibly instead of publishing the canned film. For local `sequence:check`
  probes this saves the fallback's render time and makes failures impossible
  to miss. Keep the fallback ON for the live Railway bot (a real audience
  should never see a raw error).
- **`/sequences debug on`** — per-stage receipts with attempt counts, so you
  see *where* money went on every run.
- **Don't re-pay planning on your own retries:** job dirs are immutable, but
  `planning/storyboard.json` from a failed run is a valid locked plan. When
  the storyboard was fine and only the author failed, a retry with the same
  brief re-pays frame+concept+shape+storyboard for nothing (see engineering
  lever 5).

## Engineering levers, in order of credits saved per effort

### 1. Deterministic rows-markup top-up (S) — kills the #1 attempt-waster

The kit already owns component *structure* (`sequences-components.v1.css`,
static end states). When static validation finds a `rows`/`stream` beat whose
target root exists but has no revealable children, **inject N minimal
`.cmp-row` children host-side** in `applyDeterministicSourceRepairs` (same
philosophy as the existing cut/camera/interaction binding reconciliation:
mechanically recoverable paperwork never consumes a paid repair). Mirror the
check in `kitMarkupAudit.ts`. Content of the rows can be neutral (the beat
reveals them; the author styled the container). This converts the most common
paid retry — seen in 3 of 5 runs — into a free repair. Complement with one
prompt line in the component section: "a `rows` beat requires ≥3 `.cmp-row`
children authored in the target".

### 2. Never end on a compact patch + add a source-author rescue rung (M)

Both recorded fallbacks died on a 3rd-attempt compact patch from the same
model that already failed twice. Two changes to the attempt ladder in
`requestDirectComposition`'s author loop:

- **The last attempt is always a full-context re-author** (patches only
  mid-ladder). A patch that misapplies (`2/5 searches not found`) or breaks
  syntax on the final attempt guarantees the fallback; a full re-author at
  least rolls new dice with the complete findings list.
- **Rescue rung parity with the storyboard stage:** when the primary author
  model exhausts its attempts, spend ONE full-context attempt on an
  independent model (`SLACK_SEQUENCES_SOURCE_RESCUE_MODEL`, default e.g.
  `tencent/hy3-preview`, `none` disables) before the deterministic fallback is
  allowed. This costs one extra call **only on the path that currently wastes
  the entire run**, and the storyboard stage's identical rung is the proven
  pattern (it eliminated the storyboard-plan fallback class).

### 3. Host-owned scene skeleton (M) — eliminates the scene-graph class

`verify-ws1ws5-2` burned attempt 1 authoring 10 scenes against a 5-scene
locked plan. The host already knows the exact scene shells (ids, `data-start`,
`data-duration`, order). Generate the `<section data-scene …>` skeleton from
the locked storyboard and hand it to the author as mandatory verbatim
scaffolding to fill (or, parse-side: extract only scene interiors from the
response and re-seat them into host-built shells, discarding invented
scenes). `lockedSceneGraphError` then becomes nearly unreachable. This is the
same "the author never spends budget on mechanics" philosophy as the injected
cut/camera islands.

### 4. Per-patch syntax validation instead of atomic attempt loss (S)

Attempt 3 of `verify-ws1ws5-2` applied 3/5 patches and the result had
`invalid_inline_script_syntax` — the whole attempt was rejected atomically.
Two cheap hardenings in the patch applier: (a) whitespace-normalized search
matching so fewer patches miss their anchor; (b) apply patches one at a time,
re-parsing inline scripts after each, and **revert the individual patch** that
breaks the parse instead of discarding the attempt. A partial repair that
fixes 3 findings is strictly better than a lost attempt.

### 5. Reuse planning artifacts across job-ids on retry (S, credits-only)

Cache the concept/shape/storyboard artifacts under a key derived from the
brief + contract version (not just inside the per-job `planning/` dir), so a
fresh `--job-id` retry after a source-author failure reuses the already-paid,
already-validated plan. The storyboard cache already carries a `contract`
version — extend the lookup to a shared cache dir. Live Slack retries get the
same benefit when a user immediately re-runs a failed create.

### 6. Downgrade author-side moment paperwork pressure (S, needs care)

`moment_unbound` + dead-interval findings blocked attempts in both fallback
runs. Plan-time top-up (`topUpStoryboardMoments`) already fixed the planning
side; the residual class is the *author* not placing evidence where the plan
promised it. Option: at author time, when a **secondary** moment's evidence is
missing but the scene otherwise passes liveness, degrade that moment
(drop/re-anchor it via the same top-up machinery against the *authored*
timeline) instead of rejecting the attempt — primaries and the floor stay
blocking so the review contract keeps teeth. This is degrade-never-veto
applied to paperwork the viewer never sees.

### 7. Make the fallback film worth watching (S/M, damage control)

Whatever remains after 1–6 still occasionally falls back, and the current
fallback reads as canned ("looks horrible"). It already obeys the full motion
contract; its weakness is *design sameness*. Cheap wins: feed it the per-job
`frame.md` palette/typography and the brief's product name + one-line value
prop (all deterministic, already extracted at frame-design time — no model
call), so the fallback is at least on-brand and on-message instead of
generic. The Slack label ("deterministic fallback, stage: source-author")
stays — honesty is a feature.

## New evidence from the WS3+WS2 probes (2026-07-04, `improve-ws32-1`)

A dense multi-component brief died at `storyboard-plan` after 3 primary + 2
rescue attempts (`SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK=0`, so it
failed visibly instead of rendering the canned film). One cause was in-scope
and is fixed (marginal pacing shortfalls no longer veto —
`PACING_TOLERANCE_SEC` in `pacingAudit.ts`); three were out of scope for
WS3/WS2 and belong on this plan:

### 8. Degrade unsupported beats at parse instead of vetoing (S)

Attempts 2 and 3 each burned on `beat "X" uses "type"/"stream"/"rows" on a
<kind> component, which does not support it`. The planner keeps reaching for
a reasonable beat on the wrong kind (type on a `list`, rows on a
`stat-card`). `normalizeStoryboardComponentBeats` already drops malformed
beats silently; the support-map violation could likewise degrade — convert
to the nearest supported analog (`type`→`swap` text arrival, `rows`→`count`)
or drop the beat when the scene still meets liveness — with the findings
kept only when the beat is load-bearing (bound moment evidence). Same
philosophy as `dedupeRedundantBeats`: mechanically recoverable paperwork
never consumes a paid retry.

### 9. Truncation recovery should not strip reasoning on GLM (M)

Attempt 1 exhausted its completion budget; the recovery path retried at
`reasoning none`, and both reasoning-stripped attempts produced structurally
broken plans (wrong beat support, missed framing floor) — exactly the
failure mode the 2026-07-03 experiment matrix documented (reasoning-stripped
GLM fails the moment grid in 3 of 4 runs). Truncation recovery should keep
reasoning and shrink the ARTIFACT demand instead (fewer shots, compact JSON)
or jump straight to the rescue model, rather than degrading the model's
planning ability while re-asking for the same artifact.

### 10. Host-owned scene-timing arithmetic (S)

Rescue attempt 2 was structurally sound but died on contiguity arithmetic:
`shot "command-triage" must start at 2.70s; shot "cta-close" must start at
12.10s; shot "cold-open" duration must be 1.5-15 seconds`. The host already
knows the durations; re-base every `startSec` sequentially at parse (and
clamp a first-shot duration into range when the rest of the plan is valid)
so a model never spends an attempt on addition. Same philosophy as lever 3
(host-owned scene skeleton), applied one stage earlier.

## Deterministic degradations that are not whole-film fallbacks

The live `audit-ws32-live-2` run exposed two quiet recovery paths that were
not listed above. They preserve the film and should stay, but operators need
to know that the authored plan changed:

- `dropUnusableVolunteeredTimeRamps` removes a volunteered speed ramp when its
  hold cannot be solved or contains no declared moment. The audit run logged
  `resolve-metric` being dropped for the latter reason. Brief-required ramps
  remain blocking.
- `dedupeRedundantBeats` collapses a component `press` beat that overlaps a
  cursor press on the same target, retaining the component state change
  (`set-state`) without playing the press twice. The audit run did this for
  `assign-action/assign-press`.
- `degradeMismatchedShapeHintCuts` changes a volunteered, cross-family
  `shape-match` to `zoom-through` on a rung's final attempt and rewrites
  `outgoingCut` honestly. Brief-required shape matches do not degrade. Note
  WS_Improvements item 2: today “final attempt” is per rung, so this can return
  before the independent rescue model gets a chance.
- `degradeVolunteeredBridgedCuts` changes a volunteered `shape-match` or
  `object-match` to `zoom-through` after the same focal-part binding remains
  broken across attempts; brief-required bridged cuts remain blocking. Live
  `audit-ws32-live-2` used this recovery for
  `queue-enter->assign-action` after the incoming
  `data-part="alert-queue-row-3"` was still absent.
- `SLACK_SEQUENCES_EYE_TRACE=audit` keeps `eye_trace_jump` visible but removes
  its `strictOk` pressure; `=0`/`off` disables both WS2 audits. These are
  operator escape hatches for false-positive triage, not film-generation
  fallbacks. Default production behavior remains blocking polish for boundary
  jumps and advisory-only for ping-pong.

## What NOT to do

- Don't raise the author attempt count beyond 3+rescue — more attempts on the
  same failing strategy is how credits actually disappear; every lever above
  makes attempts *succeed* or makes failure *cheap* instead.
- Don't loosen the static gates (kit markup, scene graph, liveness) to "let
  more through" — they exist because a draft that fails them aborts the
  browser compile or ships a dead film; loosening converts cheap static
  rejections into expensive browser-stage rejections or visible defects.
- Don't touch prompts/reasoning/QA thresholds as a *cost* lever (CLAUDE.md:
  the sanctioned performance seams are hedging, watchdogs, QA cache, MCP
  pooling).
