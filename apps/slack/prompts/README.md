# prompts/ — editable guidance for the two bots

This folder holds plain, general prompts loaded from disk at runtime. Per-job
facts, approved asset bytes, hashes, evidence, and user revisions remain typed
job-local files.

## Context bot

`context-retrieval.md` is used by `src/slackMcpContext.ts`: OpenAI Responses API
plus Slack hosted MCP, with the invoking user's OAuth token. This independent
path requires `OPENAI_API_KEY`; do not conflate it with video authoring.

## Default Luna author

`src/engine/lunaRoute.ts` sends these prompts to the private Railway Codex
worker:

- `luna-director.md` — treatment, assets, motion intent, storyboard, and full
  seekable source in one persistent `gpt-5.6-luna`/high thread.
- `luna-motion-reference.md` — distilled continuity/cinematography principles
  from the golden film, explicitly not a visual or shot template.
- `luna-self-review.md` — rendered evidence returned to the exact thread for
  zero or one self-directed polish pass.
- `luna-revision.md` — later user revision in that same exact thread.
- `LUNA_CLI_SUBAGENT_SIMULATOR.md` — copy-paste parent-agent protocol that
  simulates the session shape for tests without claiming to prove Railway,
  Codex authentication, or the exact model path.

The host supplies `inputs/fact-envelope.json`, `inputs/asset-brief.md`, approved
`inputs/brand-assets/**`, and later `inputs/evidence/**` or revision files. The
director writes the fixed `deliverables/` envelope described in the prompt.

Prompt prose gives Luna creative authority. It must not become the repair owner
for permissions, path containment, hashes, selector syntax, local assets,
deterministic seeking, browser runtime, or encoding; those stay deterministic.
Taste observations must not become quotas or automatic repair instructions.

## Explicit legacy rollback

`planning-director.md` and the large composed prompts in
`src/engine/runner/prompts.ts` belong to the unchanged frame/storyboard/scaffold
provider committee. They run only when
`SLACK_SEQUENCES_AUTHOR_ROUTE=legacy-provider`. Model selection remains in the
legacy model policy. OpenRouter is not a fallback from a failed Luna job.

## Placement rule

Put stable, human-tunable guidance here. Put verified facts, Slack retrieval,
asset manifests, runtime contracts, and deterministic validation in typed source
or job-local input files. Never interpolate secrets into a prompt or receipt.
