# Copy-paste prompt: simulate the official Luna CLI route with one sub-agent

Use this when testing from a coding agent that can create and continue a
sub-agent. It mirrors the creative session shape and artifact contract of the
official Railway Codex worker. It does **not** prove Railway networking,
ChatGPT authentication, the Codex CLI binary, model identity, permissions, or
deployment.

---

You are the host simulator for Sequences' official Luna route.

Create exactly one capable sub-agent and keep its stable agent/thread identity
for the whole film. Do not split treatment, storyboard, assets, source, or
review among agents. The sub-agent simulates one
`codex exec --model gpt-5.6-luna -c model_reasoning_effort="high"` session; a
follow-up to that same sub-agent simulates `codex exec resume <exact-thread-id>`.
Never use a new sub-agent for self-review or revision and never use a generic
"last session" shortcut.

Workspace setup:

1. Create a fresh ignored job workspace. Do not overwrite an existing project.
2. Put verified facts in `inputs/fact-envelope.json`.
3. Put asset notes and a SHA-256 manifest in `inputs/asset-brief.md`; copy only
   explicitly approved regular files beneath `inputs/brand-assets/`. Reject
   path escapes and symlinks.
4. Copy these canonical prompts into the task context:
   - `apps/slack/prompts/luna-director.md`
   - `apps/slack/prompts/luna-motion-reference.md`
5. Tell the sub-agent it may read/write only the fresh job workspace, must not
   use the network or external providers, and must place all substantive output
   under `deliverables/` exactly as the canonical prompt specifies.

Initial turn:

- Send the entire canonical Luna director prompt to that one sub-agent.
- Let it inspect the approved inputs, create assets first, then write treatment,
  motion intent, storyboard, complete seekable composition, and asset manifest.
- Preserve every returned byte and SHA-256 before any host validation.
- Do not run the legacy frame planner, storyboard/scaffold committee, creative
  critic, repair ladder, or source replay over the result.

Host gate:

- Validate only verified facts, contained local files and hashes, composition
  dimensions/runtime, tiled scene windows, deterministic arbitrary seeking,
  declared semantic selectors/anchors, real-browser runtime, and encoding.
- Treat taste and motion-density observations as advisory.
- If the source is accepted, capture representative thumbnails, spatial QA,
  declared boundary frames when available, and relevant motion code.

Self-review continuation:

- Put evidence under `inputs/evidence/` and send
  `apps/slack/prompts/luna-self-review.md` as a follow-up to the **same**
  sub-agent.
- Allow zero changes or one coherent polish pass. Do not ask it to clear an
  advisory score and do not spawn a repair agent.
- Re-run the mechanical gate only if bytes changed.

Later user revision:

- Put the instruction in `inputs/revision.json` and current committed artifacts
  under `inputs/current/`.
- Send `apps/slack/prompts/luna-revision.md` to that same stable sub-agent.
- Preserve unrelated directing choices and re-run the hard gate.

At handoff, report:

- the stable simulator agent ID used for initial/review/revision turns;
- exact raw and committed hashes;
- artifacts and tests produced;
- whether the film passed the mechanical gate;
- a visual judgment based on rendered motion, not just JSON;
- the explicit limitation: this is a collaboration-subagent simulation, not
  proof of the Railway CLI model, authentication, private network, or sandbox.

---
