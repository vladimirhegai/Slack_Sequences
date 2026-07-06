# FALLBACKS.md — the fallback contract, the catalog, and how to diagnose one

**Read this before touching the authoring pipeline** (`compositionRunner.ts`,
`directComposition.ts`, `orchestrator.ts`) or when a `/sequences` run "fell back."

A *fallback* is any path where the model-authored film is replaced by, or degraded
to, something the pipeline produced without the author. Some are harmless
(behaviorally identical); one is the "ugly" kind a hackathon judge must never see.
The real enemy is the **middle class**: a *mechanically recoverable* paperwork bug
that silently burns a paid authoring attempt and pushes a good brief into the ugly
fallback. This doc names all of them and how we recover them.

> **New contract classes go through [SENTINEL.md](SENTINEL.md) placement FIRST.**
> This catalog is the **L2 ledger** (deterministic repair), not the default home
> for a new obligation. Before adding a class-C recovery, walk the SENTINEL.md
> placement decision tree — the cheapest owner might be a schema (L0), a
> host-emitted scaffold (L1), or a normalizer (L2), not another regex repair. A
> gate that could have been L0/L1 is a Sentinel violation.

---

## ⚠️ PREP-MODE FLAG — set it back before judging

`SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK` controls the visible safe-fallback
film ([class A](#a-the-visible-safe-fallback-film-the-ugly-one) below).

| Value | Behaviour | Use during |
| --- | --- | --- |
| `0` | **Fail loud.** No video/storyboard on authoring failure — Slack shows the full diagnostic log, and a `FAILURE.md` is written to the project dir. | **Now, while you prep** — so every failure is visible and fixable. |
| `1` / unset (**code default**) | Ships the labeled deterministic safe-fallback film so the audience never sees a raw error. | **Judging** — a labeled film beats a raw error in front of judges. |

> 🚨 **We are currently running with `=0` (fail loud) for prep.** It is set in
> `apps/slack/.env` for local runs. **Before the judges test the bot, set it back
> to `1` (or remove it) on the live Railway sandbox** so a stray failure degrades to
> the safe film, not a raw log:
>
> ```bash
> railway variables --set SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK=1   # then: railway up
> ```
>
> The goal of prep is to drive real-failure frequency to **zero** so it never
> matters which mode is live. `frame-design` failures always fail loud (brand
> direction can't be faked) regardless of this flag.

---

## The five fallback classes

### A. The visible safe-fallback film (the "ugly" one)
`buildFallbackComposition` — a model-free 3-shot reel — shipped when the
`storyboard-plan` or `source-author` stage is exhausted
([orchestrator.ts](src/orchestrator.ts), the `!authoredDraft` branch). Labeled
*"Safe fallback"* in Slack via `VideoResult.fallback`. **On by default; gated by the
prep-mode flag above.** This is what judges would see as "generic." Eliminate the
*causes* (class C) rather than the fallback itself.

### B. Invisible in-process fallbacks (harmless — leave alone)
MCP subprocess dies → the identical work runs in-process (`applyMutation`,
`buildPreviews`, `renderVideo`, `undoVideo` in [orchestrator.ts](src/orchestrator.ts)).
Same bytes out. Shows as a `fallback` **receipt**, not a quality change. Do **not**
"fix" these — they are the resilience contract.

### C. Recoverable-paperwork bugs that burn paid attempts → cause class A
**This is the class to hunt.** The model built a *valid* film but tripped a
mechanical binding/asset/ordering detail. A hard error here fails an attempt; three
failures + a rescue rung = the ugly fallback. Every one of these must be recovered
**deterministically** in `applyDeterministicSourceRepairs`
([compositionRunner.ts](src/engine/compositionRunner.ts)) — never left to burn a
model attempt. See [the catalog](#the-recoverable-paperwork-catalog-class-c).

### D. Soft degrades (honest, not ugly — fine)
"Degrade-never-veto": a declared morph the runtime can't build becomes a labeled
`zoom-through`; `pacing/*`, `cuts/coherence`, `components/exit` findings become
advisories on the final rung. The film still ships and the artifacts say honestly
what executed. Working as intended.

### E. Render/delivery degrade (infra, not quality — fine)
No FFmpeg/Chrome, or a render fault → thumbnails-only (`VideoStage = "unavailable"`).
Two-tier delivery contract; never a create failure.

---

## The recoverable-paperwork catalog (class C)

Each of these was once a live fallback; each is now recovered deterministically in
`applyDeterministicSourceRepairs` (runs on every attempt, **before** validation).
When you see a new hard-error class in a `FAILURE.md`, add its recovery here.

| Seam | Symptom | Recovery |
| --- | --- | --- |
| Interaction / cut / camera target bindings | `data-part`/`data-region` near-miss (exact id, unique semantic, exact-name) | `reconcileInteractionTargets` / `reconcileContractBindings` — exact / unique-candidate, ambiguity stays blocking |
| Missing component `data-part` | declared component whose element the author left unlabeled | `bindMissingComponentElement` inside `reconcileComponentBindings` |
| Childless `rows`/`select` target | a reveal/select beat with nothing to reveal | `topUpRowsMarkup` injects neutral kit children |
| Hallucinated host-kit asset ref | `referenced local asset does not exist: sequences-cinema.v1.js` (CSS-only kit; model invents a `.js` sibling) | `stripHostKitAssetReferences` — strips inline-injected kit refs, keeps the 5 staged runtimes |
| **Runtime `<script>` absent / mis-ordered** | `runtime_bind_exception: SequencesInteractions is not defined` (tag missing, or after the inline timeline, or before GSAP) | **`ensureRuntimeScriptOrdering`** — collapses all 5 runtime tags into one canonical block right after GSAP, injects referenced-but-missing; idempotent |
| Unavailable/empty `@font-face`, `Math.random()`, non-canonical timeline id | non-determinism / missing font | inline strip / seeded PRNG / id normalization (same function) |
| Volunteered bridged cut that can't bind | shape/object-match the brief never asked for | `degradeVolunteeredBridgedCuts` → zoom-through (brief-*required* stays blocking) |
| Moment paperwork (spacing/floor) | plan vetoed for moments it already proves | `topUpStoryboardMoments` anchors moments on the plan's own beats/cuts/camera |

### The principle
> Mechanically-recoverable paperwork must never burn a paid attempt. If the fix is
> deterministic (exact id, unique candidate, a known-staged file, a fixed script
> order) — recover it in code. If it is ambiguous (two equally-good candidates, a
> brief-required effect that genuinely can't bind) — keep it **blocking** so it
> fails honestly rather than shipping a lie.

### Adding a new recovery
1. Reproduce with `sequence:check` (below) and read the `FAILURE.md` + `planning/`
   artifacts to find the exact hard-error string.
2. Decide: is it *unambiguously* recoverable? If yes → add a deterministic repair
   in `applyDeterministicSourceRepairs` and **export it** for a unit test. If no →
   make sure it stays a blocking finding with a clear message.
3. Add a regression test in [test/authorReliability.test.ts](test/authorReliability.test.ts)
   (the minimized-incident-replay convention: recover the recoverable case, prove
   the ambiguous case stays blocking).
4. Add a row to the catalog above.
5. If a static gate could have caught it before the browser, mirror the check in
   `kitMarkupAudit.ts` (linkedom parse — what a spec parser sees is what the browser
   sees) so it surfaces as a named finding, not an opaque 12s timeout.

---

## Known open risks (not yet recovered)

- **`gsap.timeline({ paused: true })` validation — FIXED (Sentinel Phase 1).**
  The old static-gate regex (`[^}]*`) broke on a nested options object, e.g.
  `gsap.timeline({ defaults: { ease: "none" }, paused: true })`, and could
  false-reject a valid composition. [directComposition.ts](src/engine/directComposition.ts)
  now brace-matches the whole options object before testing for `paused: true`,
  so arbitrary nesting passes. Kept here as the closed incident record.

---

## Diagnosing a fallback / failure

When fail-loud mode is on, the full diagnostic is in **three** places:

1. **Slack** — the error message (code block) leads with the failed stage, the
   `FAILURE.md` path, and the terminal reason.
2. **`<projectDir>/FAILURE.md`** — the untruncated report: stage, per-attempt finding
   signatures (from `planning/author-run.json`), stage receipts, and every persisted
   artifact path.
3. **Railway logs / stderr** — `[orchestrator] fail-loud: …`, `[author] …`,
   `[storyboard] …` lines.

Persisted per-run artifacts under `<projectDir>/planning/`:
- `author-run.json` — attempt modes, outcomes, normalized finding signatures, strategy changes.
- `attempts/author-<n>-<outcome>.{html,json}` and `attempts/storyboard-<n>-<outcome>.*` — the rejected documents + their findings.
- `build/qa/sequence-check.json`, `motion-plan.json`, `STORYBOARD.md`.

**Reproduce a live fallback offline** (no Slack, no hosted MCP; needs
`OPENROUTER_API_KEY` exported — `sequence:check` does **not** auto-load `.env`):

```bash
SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK=0 \
  npm run sequence:check --workspace @sequences/slack -- \
  --provider openrouter-api --no-mcp \
  --product "…" --tone crisp-saas --length 24 \
  --what "…" --audience "…" --context "…"
```

The report + `FAILURE.md` land under the printed project dir — paste them to a
fixing agent.

---

See also: [SENTINEL.md](SENTINEL.md) (the layer model + contract registry + how to
place a new obligation), [ROADMAP.md](ROADMAP.md) "Full audit" (surviving records +
parked items), [CLAUDE.md](CLAUDE.md) (rules/state), and the `slack-map` skill.
