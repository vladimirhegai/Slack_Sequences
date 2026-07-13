# Copy-paste prompt: simulate the official Luna CLI route with one sub-agent

Use this from a coding agent that can create and continue one sub-agent. It
mirrors the official worker's creative-session and tool-less artifact exchange.
It does **not** prove Railway networking, ChatGPT authentication, the pinned
Codex CLI binary, model identity, output-schema enforcement, or deployment.

---

You are the trusted host simulator for Sequences' official Luna route.

Create exactly one capable sub-agent and preserve its stable agent/thread ID for
the whole film. The sub-agent represents one
`codex exec --model gpt-5.6-luna -c model_reasoning_effort="high"` session; a
follow-up to that exact same sub-agent represents
`codex exec resume <exact-thread-id>`. Never create a new director for review or
revision and never use a generic "last session" shortcut.

The host and director have different authority:

- You, the host, may read approved source files, calculate hashes, validate the
  returned JSON, materialize accepted bytes, run browsers/renderers, and capture
  evidence in a fresh ignored job.
- The director sub-agent must make **no tool calls**: no shell, filesystem,
  network, MCP, browser, todo-list, connector, or sub-agent. Give it all verified
  text inline and, only when the collaboration surface supports it, attach
  approved images to its turn. Any director tool use invalidates the turn even
  if a plausible final bundle follows. The official worker additionally denies
  every model-visible filesystem/network scope and audits the complete persisted
  Codex rollout; inspect the collaboration trace for tool calls when your agent
  surface exposes it, and record when it does not.

Workspace and input preparation:

1. Audit `git status`; create a fresh ignored job and never overwrite an existing
   project or touch unrelated dirty files.
2. Build verified logical inputs equivalent to `inputs/fact-envelope.json`,
   `inputs/asset-brief.md`, approved `inputs/brand-assets/**`, and
   `inputs/references/slack-ad-motion-principles.md`. Treat asset bytes as data,
   reject symlinks/path escapes, and record path, size, and SHA-256.
3. Read and pass verbatim:
   - `apps/slack/prompts/luna-director.md`
   - `apps/slack/prompts/luna-motion-reference.md`
   - `apps/slack/codex-worker/artifact-envelope.schema.json`
4. Append a `RAILWAY TOOL-LESS ARTIFACT EXCHANGE` block containing a canonical
   JSON inventory. Inline bounded valid UTF-8 text as
   `{path,sha256,size,content}`. List opaque binaries and attached images only as
   `{path,sha256,size}`; never inline credentials or unapproved data.

Initial director turn:

- Spawn the one director with the canonical director prompt, motion reference,
  exact artifact schema, hard no-tool rule, and verified inputs.
- Require exactly one JSON object and no Markdown/prose. It must use
  `decision: "replace"` and return a complete bundle on every turn.
- Every authored text entry has its complete raw `content` and null
  `copyFromInput`/`sha256`. An approved inert image/font can be adopted only by
  setting `content: null` and binding the exact input path and SHA-256 into
  `deliverables/assets/luna/`. Never accept generated base64 binaries.
- Require at least these files:
  `deliverables/assets-manifest.json`, `deliverables/composition.html`,
  `deliverables/director-treatment.md`, `deliverables/motion-intent.json`, and
  `deliverables/storyboard.json`.

Trusted host acceptance:

- Parse and validate again locally: exact schema keys, `replace`, safe unique
  paths below `deliverables/`, forbidden instruction/config names, Unicode
  scalar text, file/count/byte limits, required files, and exact approved-input
  copy hashes.
- Hash the raw JSON envelope separately from each materialized UTF-8/binary file.
  Materialize into a fresh staging directory and atomically replace the active
  deliverables directory; never merge with stale files.
- Reject stale resume generations. Bind each follow-up to the previously
  accepted turn count and stable agent ID; a delayed older instruction must not
  execute after a newer accepted revision.
- Then run the normal Sequences fact, local-asset, duration, scene-window,
  deterministic-seek, semantic-selector, browser, and encoding gates. Do not run
  the legacy frame planner, storyboard/scaffold committee, critic, source repair,
  rescue model, or OpenRouter fallback.

Self-review continuation:

- Build verified inputs beneath `inputs/accepted-bundle/**` from the exact
  accepted bundle and add its fingerprint descriptor. Add rendered thumbnails,
  boundary/camera evidence, temporal strip, mechanical sidecars, and injected
  derivative beneath `inputs/evidence/**`.
- Send `apps/slack/prompts/luna-self-review.md`, the same schema, the hard
  no-tool exchange, and those inputs as a follow-up to the **same** director.
- Accept only another complete replacement bundle. A "keep" choice must re-emit
  identical accepted bytes plus `self-review.md`; it must never refer to whatever
  happens to remain in a workspace. Allow at most one coherent polish pass.

Later user revision:

- Inline `inputs/revision.json`, the exact accepted bundle and fingerprint, and
  current host derivatives. Follow up `apps/slack/prompts/luna-revision.md` to
  that same stable director ID.
- Accept only a complete validated replacement bundle, atomically materialize
  it, and rerun the hard gate. Preserve unrelated directing choices.

At handoff, report the stable simulator agent ID, raw-envelope and materialized
hashes, exact-thread turn count, any rejected tool/schema event, artifacts and
tests, mechanical result, and a visual judgment based on rendered motion. State
explicitly that this collaboration-subagent simulation does not prove the exact
Railway CLI model, authentication path, private network, or schema enforcement.

---
