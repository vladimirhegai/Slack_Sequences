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

2. **Planning / authoring bot — the main agent** (`src/engine/planRunner.ts`).
   Runs on the provider in `SLACK_SEQUENCES_PROVIDER` — Railway uses
   `openrouter-api` (DeepSeek). This is the agent that turns the brief + context
   into the video. Today it emits a typed Sequences `Plan`; the target
   (ARCHITECTURE.md) is for it to author HyperFrames directly.

## What belongs here vs. what does not

**Here:** static system prompts and general agent guidance — the kind of text you
want to read and edit as prose.

**Not here (composed at runtime, stays in code):**
- HyperFrames skill retrieval / RAG (`src/agent/skillContext.ts`).
- Per-run, project-specific context: deterministic color/typography picks,
  the skills selected for that run, asset manifests, brand tokens.
- The deterministic brief assembly (`assembleBrief` in `orchestrator.ts`).

Rule of thumb: if a human would tune it by editing prose, it lives here. If it is
assembled per-project from data or retrieval, it stays in `src/`.

## Current wiring

- `context-retrieval.md` → read by `src/slackMcpContext.ts`.
- The planning bot's **base** prompt currently comes from
  `@sequences/core` `buildPlanPrompt` (a frozen shared package), with skill
  context appended as `guidance`. When the planning bot is rewritten to author
  HyperFrames directly, put its new system prompt + director guidance here as
  `prompts/planning-*.md` and load it the same way `context-retrieval.md` is.
