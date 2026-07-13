# Luna CLI author route experiment - 2026-07-13

## Status and boundary

This is an owner-authorized, local experiment for the separate high-quality
CLI-on-Railway track. It does **not** change the Slack bot, provider defaults,
Railway services, production fallback, or the frozen hackathon presentation
runbook.

The author was one ChatGPT collaboration subagent instructed to simulate the
requested `5.6 Luna high` profile. The collaboration tool cannot select or
prove that exact CLI profile, so this result measures the proposed
single-director workflow and same-model creative behavior, not Railway auth,
Codex CLI model selection, or Slack integration. No OpenRouter, provider API,
web, Railway, or Slack call was used.

Recommendation: **promising enough to build the real CLI adapter after owner
review; do not switch production yet.**

## Proposed route

The route should treat Luna as the director-author and the Sequences engine as
the mechanical execution host:

1. Slack and the host create a fresh persisted job containing only verified
   facts, audience, duration range, brand inputs, user assets, permissions, and
   an untrusted-content boundary.
2. One authenticated Codex CLI session receives read access to the product
   references and write access only to that job. It owns concept, copy, visual
   thesis, storyboard, project-local assets, DOM/CSS/SVG, camera, cuts, pacing,
   and motion.
3. The agent emits a complete 14-18 second composition plus a small evidence
   manifest: scene windows, one semantic primary selector per act, important
   moments, and any interaction/cut bindings it chose to use. The host owns the
   persistence envelope, asset hashing/registration, and runtime injection.
4. `submit_composition` transactionally runs static and real-browser gates.
   Missing files/bindings, invalid seeks, off-frame primary content, invisible
   interaction targets, nondeterministic time, and encode failure are hard.
   Contrast, occupancy taste, quiet holds, composition preference, and
   supporting static moments remain advisory.
5. One reproduced hard mechanical failure may return to the **same CLI
   session** for one targeted repair. Advisory-only findings do not trigger a
   model retry or a host-authored taste rewrite.
6. The host produces thumbnails and temporal evidence. Luna may inspect them
   and choose one self-directed polish pass in an interactive workflow, but
   the system must not demand a rewrite merely to satisfy advisory scores.
7. The host rechecks exact bytes, renders the MP4, and uploads it to Slack with
   honest status. OpenRouter remains a later, visibly labelled emergency path;
   its exact trigger policy must be implemented and tested separately.

This replaces the current multi-call frame-planner -> storyboard-planner ->
slot-author committee for the Luna path. Existing recipes, components, and
catalogs are optional tools the agent can request, not a mandatory creative
template.

## Prompt contract

The production prompt should be short and authority-oriented:

> You are the single director-author for this launch film. Preserve the
> verified facts and required CTA, then choose the concept, copy, visual
> language, scenes, assets, camera, cuts, choreography, pacing, and one energy
> peak yourself. Create a complete local-only, deterministic, seekable
> composition in the job workspace. Also identify the semantic primary subject
> and important moments for each act so the host can verify what you intended.
> Treat host findings marked hard as mechanical defects. Advisory evidence is
> creative information for your judgment, not an instruction to homogenize the
> film. Do not change facts, call external services, write outside the job, or
> deploy anything.

The host should supply a compact output schema and examples of the runtime
bindings, not the current full planner/scaffold prompt stack. This is “lower
guardrails” in the creative layer, while facts, filesystem scope, runtime,
rendering, and delivery stay deterministic.

## Controlled Harborview probe

Brief: create a silent 16-second launch film for Harborview. Feedback is
scattered across email, chat exports, and spreadsheets; Harborview gathers it
into one prioritized inbox; a teammate assigns a theme to an owner in one
click; verified triage time drops from 4 hours to 20 minutes; close with “Start
triaging with Harborview” and CTA “Start triaging.” The agent received no
prescribed motif, frame, shot list, component list, or camera plan.

The agent chose five acts - scatter, convergence, assignment, proof, resolve -
connected by one luminous mint signal current. It authored a 10,410-byte local
Harborview inbox SVG and a 32,415-byte standalone composition. The exact raw
HTML and committed revision have the same SHA-256:
`303c660d0d17175d4d4b81881c34699c3e3bdc255f1b871c6cae916e9b9e1e6f`.

First submission result:

- one author pass, zero repair passes, zero provider/OpenRouter calls;
- revision 1 applied immediately; static and browser runtime valid;
- 2 static advisories, 48 browser samples, 23 browser advisories, 2 info
  findings, and 10 preview frames;
- model-free exact source replay passed after the host wrapped the author's raw
  storyboard array in the replay script's required `{ "storyboard": [...] }`
  envelope; and
- no creative bytes, copy, timing, palette, asset, or motion were changed.

Temporal/render result:

- 82 temporal frames sampled; 0.0% eligible dead runtime and no dead window over
  1.5 seconds;
- maximum 2 independent motion voices, no reversal or jerk markers;
- 3 rendered quiet windows, longest 1.63 seconds, and 5/13 measured directed
  motions settling within the current detector window;
- H.264/yuv420p, 1920x1080, 30fps, 480 frames, exactly 16.0 seconds,
  1,857,165 bytes;
- MP4 SHA-256
  `c99573c210f583f9cce7c5d7516aa092d29a7d078fe2b3cb779538240b8614bd`.

Primary artifact:

```text
apps/slack/.data/projects/luna-route-harborview-20260713-a/renders/harborview-follow-the-signal-20260713-043557.mp4
```

Supporting evidence is in the same job under `planning/attempts/`,
`composition/qa/`, `build/thumbs/`, `build/qa/temporal/`, and
`build/qa/encoded/contact-sheet.png`. The machine-readable local result is
`planning/luna-probe-result.json`.

For comparison, the earlier provider-backed Harborview probe consumed 5
logical / 8 physical requests over roughly 12 minutes and failed before source
or render. This simulation produced source, a custom asset, browser evidence,
temporal evidence, and an MP4 on its first author pass. This is a workflow
comparison, not a model benchmark, because the exact providers and execution
surfaces differ.

## Findings to carry into the real adapter

1. **Host-owned artifact envelopes.** The agent emitted a valid storyboard
   array, while `source:replay` expects a `storyboard` property. The adapter
   should normalize and persist this envelope; prompting the model to remember
   storage trivia wastes intelligence.
2. **Small semantic evidence contract.** The custom DOM passed, but the
   temporal inspector followed synthesized tween selectors such as a 4px rail
   or microcopy. That produced 51 sub-85%-visibility and 106 tiny-focal samples
   even though the encoded whole frames read coherently. Ask the agent to name
   semantic primary selectors; do not force it into predefined components.
3. **Asset registration belongs to the host.** The SVG copied and rendered,
   but `project.json` kept an empty asset registry. The adapter should hash,
   classify, register, and copy job-local assets after authoring.
4. **Offline fonts must be explicit.** The source used only
   `Arial, Helvetica, sans-serif`, but the producer resolved a cached Google
   Fonts Helvetica package. The Railway image should bundle the approved font
   files/cache or force a known local family so a cold worker never depends on
   font-network availability.
5. **Advisories remain useful evidence.** Four scenes were compositionally
   underfilled by the grid heuristic, fourteen text samples missed AA contrast,
   and two synthetic cut moments were near-identical. Human review found a
   deliberate editorial layout with some genuinely small/low-contrast
   supporting copy. This is suitable for `accept with warn`, not an automatic
   rewrite.
6. **The CLI/Railway seam is still unproved.** A real follow-up must verify the
   persisted ChatGPT login, exact `5.6 Luna high` selection, isolated
   filesystem permissions, job cancellation/timeouts, restart recovery, Slack
   progress/upload, and the visibly labelled OpenRouter emergency trigger.
7. **Reproducibility boundary.** The probe ran at committed HEAD `80aa701` in a
   dirty worktree containing the separate in-flight Harborview deterministic
   fix. No tracked product file from that unit was touched here. The direct
   submit/render path produced the evidence, but this should not be described
   as a clean-commit production qualification.

## Disposition

Experimental artifact: **accept with warn for owner review**. It demonstrates
that a single high-agency author can make the concept, product asset, source,
and film without the current paid planner/repair ladder. It does not authorize
deployment or retirement of the active OpenRouter path. The next step begins
only after owner review: implement the isolated Codex CLI adapter on Railway,
then test its authentication/restart behavior and emergency fallback without
changing the creative contract above.
