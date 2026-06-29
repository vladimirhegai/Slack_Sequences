# Sequences for Slack — agent notes

The active hackathon app (Slack Agent Builder Challenge, deadline **Jul 13 2026**).
It turns a release thread into an on-brand launch video, in the channel. Bolt +
Socket Mode; `tsx` runs the TS directly. Pitch: *from shipped to shown*.

**Deep docs (read only when this file is insufficient):**
[ARCHITECTURE.md](ARCHITECTURE.md) (target design) ·
[SLACK_PLAN.md](SLACK_PLAN.md) (current state / what's built) ·
[OPERATIONS.md](OPERATIONS.md) (local setup + Railway deploy + recovery) ·
[TESTING.md](TESTING.md) (verification ladder) ·
[HACKATHON_RULES.md](HACKATHON_RULES.md) (challenge constraints).

## The two bots

This app runs **two distinct agents**. Keep them straight:

1. **Context bot — Slack-hosted-MCP retrieval** ([src/slackMcpContext.ts](src/slackMcpContext.ts)).
   OpenAI Responses API (`gpt-5-mini`) calling `https://mcp.slack.com/mcp` with
   the **invoking user's** OAuth token. Reads messages/files, returns an evidence
   pack. **Must be OpenAI** — the Responses `mcp` tool type is OpenAI-only, so
   OpenRouter/DeepSeek cannot drive it. Always needs `OPENAI_API_KEY`. This is the
   primary hackathon-qualifying MCP integration.
2. **Planning / authoring bot — the main agent** ([src/engine/planRunner.ts](src/engine/planRunner.ts)).
   Runs on `SLACK_SEQUENCES_PROVIDER` — Railway uses **`openrouter-api` (DeepSeek)**.
   Turns brief + context into the video. **Today** it emits a typed Sequences
   `Plan`; the **target** ([ARCHITECTURE.md](ARCHITECTURE.md)) is for it to author
   HyperFrames directly. The video execution layer (apply/preview/render) is
   additionally isolated behind an internal **stdio Sequences MCP** server.

## Prompts live in [prompts/](prompts/)

General, editable system prompts for both bots go in `prompts/*.md` — not buried
in `src/`. Today: [prompts/context-retrieval.md](prompts/context-retrieval.md)
(context bot). The planning bot's base prompt still comes from `@sequences/core`
`buildPlanPrompt` (frozen); its future HyperFrames-authoring system prompt belongs
in `prompts/`. **Not** in `prompts/`: RAG/skill retrieval
([src/agent/skillContext.ts](src/agent/skillContext.ts)) and per-run
deterministic context (color/typography picks, selected skills, brand tokens) —
those are composed at runtime. See [prompts/README.md](prompts/README.md).

## App isolation (do not break)

`apps/slack` must publish standalone, without the paused apps:

- ✅ May import `@sequences/core`, `@sequences/platform`, and pinned
  `@hyperframes/*@0.6.86`.
- ❌ Never import `apps/sequences/*` or `apps/forge/*`. Need their glue? **Copy it
  into [src/engine/](src/engine/) and adapt.**
- ❌ Don't modify `packages/*`, `apps/forge`, `apps/sequences` unless the task
  explicitly says so.

The public Slack repo contains this app plus shared packages, so cross-app
relative imports break after publishing.

## MCP execution path (the internal Sequences MCP)

MCP is the **default** live path; `SLACK_SEQUENCES_USE_MCP=0` is a diagnostic
opt-out. Normal flow:

- create: `submit_plan` → `render_preview` → `render`;
- revise: `apply_commands` → `render_preview` → `render`.

The in-process fallback ([src/orchestrator.ts](src/orchestrator.ts) `applyMutation`)
is narrow and behaviorally equivalent — a flaky subprocess never breaks a demo.
Every MCP attempt is visible through an **argument-free** receipt. Never put plan
content, command args, credentials, user tokens, workspace messages, or model
output in a Slack receipt.

## Determinism boundary

- **No model:** `/sequences demo` (curated preset, [src/demo.ts](src/demo.ts));
  the solver + linter; all delivery plumbing (thumbnails, render, uploads); the
  zero-token tweak matcher in `tweakRunner.ts`; undo (journal replay).
- **Uses a model:** real `/sequences` create (planning bot) and the context bot;
  revise only when the zero-token matcher is unsure.

Keep deterministic things deterministic: build new deterministic behavior in the
plumbing layer or behind a preset/zero-token path. The 9 laws are **revised** for
direct HyperFrames authoring — see ARCHITECTURE.md "Revised architecture laws";
hard runtime invariants (deterministic seek, local assets, finite timelines,
framework-owned playback) still bind.

## Two-tier delivery contract

In [src/index.ts](src/index.ts), create/revise preserve this order:
1. apply plan/commands; 2. build + upload thumbnails; 3. update message to
*rendering*; 4. render the MP4 async; 5. update to *ready*/*unavailable* and
upload the MP4. Missing Chrome/FFmpeg or a render failure must leave a valid
thumbnails-only result. Background Slack errors must be logged and contained
(never crash the process).

## Current feature state

Wired end-to-end: `/sequences` create modal, `/sequences demo` (model-free),
`/sequences mcp-test` self-check, 🎬 message shortcut (reads the whole thread),
conversational reply-to-revise, live Thinking-Steps progress, Undo, Render HD,
Approve & share. Per-user OAuth for hosted MCP. Not built yet: screenshot asset
ingestion, direct HyperFrames authoring, component sub-agents.

## Environment

One live Slack app: the developer-sandbox app on Railway. Local work is source,
deterministic MCP/demo, render, and Docker checks only. **Never** copy Railway
credentials into `apps/slack/.env`, and never start a second Socket Mode process
with sandbox tokens. Socket Mode carries Slack events; the HTTP server exists only
for `/healthz`, `/slack/install`, `/slack/oauth_redirect` — do not add Events API
/ interactivity request URLs. Railway is not a public `/mcp` endpoint.

## Verification

Routine source gate (no credentials, no paid model):

```powershell
npm run typecheck --workspace @sequences/slack
npm run test --workspace @sequences/slack
npm run mcp:demo --workspace @sequences/slack
```

Run `npm run demo --workspace @sequences/slack` (`+ $env:VERIFY_RENDER=1` for MP4)
after engine/render/delivery changes. Root `npm run typecheck` **excludes**
apps/slack. Full ladder + sandbox checklist: [TESTING.md](TESTING.md). Never
report live Slack/OAuth/provider/Railway behavior as verified from unit tests
alone — state which layer actually ran.
