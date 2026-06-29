# prompts/ — general system prompts for both bots

This folder holds the **plain, general, editable** prompts for the two agents in
Sequences for Slack. Keep them here so they can be tuned without hunting through
`src/`. Each file is loaded at runtime from disk (see the loader noted below).

## The two bots

1. **Context bot — Slack-hosted-MCP retrieval** (`src/slackMcpContext.ts`).
   OpenAI Responses API (`gpt-5-mini`) calling `https://mcp.slack.com/mcp` with
   the invoking user's OAuth token. Reads messages/files; returns an evidence
   pack. Its system prompt is [`context-retrieval.md`](context-retrieval.md).
   (Must be OpenAI: the Responses `mcp` tool type is OpenAI-only — OpenRouter /
   DeepSeek cannot drive it.)

2. **Planning / authoring bot — the main agent** (`src/engine/compositionRunner.ts`).
   Runs on the provider in `SLACK_SEQUENCES_PROVIDER` — Railway uses
   `openrouter-api` (DeepSeek). This is the agent that turns the brief + context
   into a direct HyperFrames composition. Its system prompt is
   [`planning-director.md`](planning-director.md).

## What belongs here vs. what does not

**Here:** static system prompts and general agent guidance — the kind of text you
want to read and edit as prose.

**Not here (composed at runtime, stays in code):**
- HyperFrames skill retrieval / RAG (`src/agent/skillContext.ts`).
- Per-run, project-specific context: deterministic color/typography picks,
  the skills selected for that run, asset manifests, brand tokens.
- The per-job `frame.md` design system (`src/engine/frameDesign.ts` +
  `src/engine/frameTools.ts`): curated mood DNA, bounded art direction, and
  deterministic brand extraction/derivation/validation that produce the
  `<frame_md>` block. It is data composed per job, not editable prose.
- The deterministic brief assembly (`assembleBrief` in `orchestrator.ts`).

Rule of thumb: if a human would tune it by editing prose, it lives here. If it is
assembled per-project from data or retrieval, it stays in `src/`.

## Current wiring

- `context-retrieval.md` → read by `src/slackMcpContext.ts`.
- `planning-director.md` → read by `src/engine/compositionRunner.ts`; exact
  HyperFrames core references, blueprints, motion rules, available assets, the
  per-job `frame.md` design system, and current revision state are appended
  deterministically per run.
