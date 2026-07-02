# Sequences for Slack — agent notes

The active hackathon app (Slack Agent Builder Challenge, deadline **Jul 13 2026**).
It turns a release thread into an on-brand launch video, in the channel. Bolt +
Socket Mode; `tsx` runs the TS directly. Pitch: *from shipped to shown*.

## GitHub destination & deploy

Publish this app to **https://github.com/vladimirhegai/Slack_Sequences**.
`vladimirhegai/Sequences` is the local/private development monorepo and is not
the Slack app's GitHub delivery target. From the monorepo root, use
`bash scripts/publish-public.sh "<message>"`; do not finish Slack work by pushing
the monorepo branch and calling it published. The script archives **HEAD**, so
commit first — uncommitted work is not published.

**Deploying the live bot is a separate step:** `railway up` from the monorepo root
builds the root `Dockerfile` on Railway. GitHub autodeploy is deliberately **OFF**,
so publishing source does **not** deploy. Verify with `/healthz` → `ready`. Docs-only
changes need a publish but not a redeploy. Full runbook: [OPERATIONS.md](OPERATIONS.md).

**Deep docs (read only when this file is insufficient):**
[ARCHITECTURE.md](ARCHITECTURE.md) (target design) ·
[ROADMAP.md](ROADMAP.md) (current state / task list / TODOs) ·
[OPERATIONS.md](OPERATIONS.md) (local setup + Railway deploy + recovery) ·
[HACKATHON_RULES.md](HACKATHON_RULES.md) (challenge constraints).

## The two bots

This app runs **two distinct agents**. Keep them straight:

1. **Context bot — Slack-hosted-MCP retrieval** ([src/slackMcpContext.ts](src/slackMcpContext.ts)).
   OpenAI Responses API (`gpt-5-mini`) calling `https://mcp.slack.com/mcp` with
   the **invoking user's** OAuth token. Reads messages/files, returns an evidence
   pack. **Must be OpenAI** — the Responses `mcp` tool type is OpenAI-only, so
   OpenRouter/DeepSeek cannot drive it. Always needs `OPENAI_API_KEY`. This is the
   primary hackathon-qualifying MCP integration.
2. **Planning / authoring bot — the main agent** ([src/engine/compositionRunner.ts](src/engine/compositionRunner.ts)).
   Runs on `SLACK_SEQUENCES_PROVIDER` — Railway uses **`openrouter-api` (DeepSeek)**.
   Turns brief + context into a canonical, direct HyperFrames HTML composition.
   The video execution layer (validate/checkpoint/preview/render) is additionally
   isolated behind an internal **stdio Sequences MCP** server.

## Prompts live in [prompts/](prompts/)

General, editable system prompts for both bots go in `prompts/*.md` — not buried
in `src/`: [prompts/context-retrieval.md](prompts/context-retrieval.md) for the
context bot and [prompts/planning-director.md](prompts/planning-director.md) for
direct authoring. **Not** in `prompts/`: RAG/skill retrieval
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

- live create/revise: `submit_composition` → `render_preview` → `render`;
- curated demo: `submit_plan` → `render_preview` → `render`.

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
Approve & share. Per-user OAuth for hosted MCP. Direct HyperFrames create,
revision, validation, checkpoint undo, thumbnails, and render are wired. Each job
gets a per-job `frame.md` design system — curated SaaS mood DNA plus one bounded
art-direction decision over harmony, type, and spatial character. **Deterministic
design tools** extract brand truth, derive and validate semantic tokens, repair
unsafe contrast/unavailable fonts, and expose which values are committed versus
tunable without limiting motion; the chosen frame.md is
shown in the result and attached to the thread
([src/engine/frameDesign.ts](src/engine/frameDesign.ts) +
[framePresets.ts](src/engine/framePresets.ts) /
[brandTokens.ts](src/engine/brandTokens.ts) / [frameTools.ts](src/engine/frameTools.ts) /
[brandCapture.ts](src/engine/brandCapture.ts)). Direct shots may also carry
typed spatial/focal intent and semantic cursor interactions. A versioned local
runtime resolves hotspot/target/ripple geometry under camera transforms;
interaction-time browser QA is enforced and persisted with each revision.
Shots may also declare typed outgoing cuts (`hard`, directional,
zoom/inverse-zoom, flash, or object-match). `cutContract.ts` resolves those
declarations and `sequences-cuts.v1.js` compiles host-owned, seek-safe boundary
motion into the canonical timeline; `compositionRunner.ts` injects the binding
from the locked storyboard so the source author cannot silently omit it.
Object-match uses measured `data-part` geometry, while static validation catches
missing bindings and warns when authored scene-wrapper tweens compete with the
cut runtime.
A host-owned **cinematography kit** (`engine/cinemaKit.ts` +
`templates/sequences-cinema.v1.css`) is injected inline into every direct
composition: automatic film grain + vignette, key-light fields, hero blooms,
lit `.material` surfaces, and per-scene color grades that give each film a
cold→warm color arc; `frame.md` renders palette-derived `--cinema-*` values
and the planning prompt teaches the vocabulary. Pure static CSS — no timeline
ownership, enhancement-only, deterministic under seek.
`frame.md` also exposes six flow-first scene compositions and semantic zone
helpers so primary content defaults to safe-area Grid/Flex placement. Ambiguous
cursor targets still quarantine, while exact-id/unique-semantic mismatches are
reconciled deterministically. Browser-QA infrastructure outages fall back to
static validation, and a failed planning/authoring pass falls back to a small
model-free direct composition rather than surfacing a create error.
`npm run film:demo` exercises the model-free 24-second golden Slack ad through
the real direct gate and writes compact temporal evidence (development strip,
cut sheets, change curve, quiet windows) via `temporalInspector.ts`. Temporal
evidence is developer-facing only; it is not yet generated by live
create/revise. Typed cuts and cinematography-kit injection are proven both by
the fixture and by a paid OpenRouter live-authoring smoke (2026-07-01): the
planner chose sensible cut styles and the author adopted kit material classes
unprompted. Not built yet: Slack screenshot ingestion,
registry source approval/materialization + in-Slack audition, component
sub-agents.

## Environment

One live Slack app: the developer-sandbox app on Railway. Local work is source,
deterministic MCP/demo, render, and Docker checks only. **Never** copy Railway
credentials into `apps/slack/.env`, and never start a second Socket Mode process
with sandbox tokens. Socket Mode carries Slack events; the HTTP server exists only
for `/healthz`, `/slack/install`, `/slack/oauth_redirect` — do not add Events API
/ interactivity request URLs. Railway is not a public `/mcp` endpoint.

## Verification & Testing Ladder

This is the shared verification contract for human development and agent verification.

### 1. Slack source gate (Routine check, no credentials needed)
```powershell
npm run typecheck --workspace @sequences/slack
npm run test --workspace @sequences/slack
npm run mcp:demo --workspace @sequences/slack
npm run direct:demo --workspace @sequences/slack
npm run film:demo --workspace @sequences/slack
```
- TypeScript compiler exits successfully.
- All Slack tests pass.
- Legacy MCP applies the curated fallback plan.
- Direct MCP validates/checkpoints authored HTML, reports clean lint, and creates runtime-seeked scene previews.
- Golden-film smoke validates typed cuts and writes temporal evidence without a model call.

### 2. Render and Docker gate (Required after engine/renderer/Docker changes)
To verify direct HyperFrames MP4 rendering locally:
```powershell
$env:VERIFY_RENDER = "1"
try {
  npm run film:demo --workspace @sequences/slack
} finally {
  Remove-Item Env:VERIFY_RENDER -ErrorAction SilentlyContinue
}
```
To test production Node/Docker MCP boundary:
```powershell
docker build -t sequences-slack .
docker run --rm sequences-slack npm run mcp:demo -w @sequences/slack
docker run --rm -e VERIFY_RENDER=1 sequences-slack npm run film:demo -w @sequences/slack
```

### 3. Monorepo CI gate (Optional pre-push checks)
Before pushing, you can validate the broader monorepo:
```powershell
npm run typecheck
npm test
npm run test:perf
```

### 4. Sandbox smoke
After `/healthz` returns `200 ready`, run in the Slack sandbox:
1. Run command: `/sequences mcp-test` (should verify Slack API, Sequences MCP, Render host browser/FFmpeg, planning provider, hosted MCP user OAuth, token encryption, data directory).
2. Run command: `/sequences demo` and confirm storyboard thumbnails arrive before the MP4.
3. Confirm the MP4 plays inline.
4. Reply in the reel thread with `make it shorter`.
5. Click **Undo** and confirm the previous revision returns.
6. Click **Render HD** (if render-related code changed).
7. Click **Approve & share** into a disposable sandbox channel.

### 5. Real hosted-MCP flow
Tester authorizes at: `https://sequences-slack-production.up.railway.app/slack/install`
1. Run `/sequences` with a short synthetic product brief.
2. Confirm the result includes a Slack-context hosted-MCP receipt.
3. Confirm the build trace includes Sequences MCP tools.
4. Try **🎬 Make a launch video** shortcut from a synthetic release thread.
5. Confirm revisions, Undo, HD, and sharing still operate on that job.

### 6. Change-specific minimums
- **Documentation only**: links/commands review; `git diff --check`.
- **Slack blocks or handlers**: Slack source gate + sandbox affected flow.
- **Manifest/scopes/events**: paste manifest, reinstall, redeploy, self-check, affected flow.
- **OAuth or hosted Slack MCP**: source gate, `/slack/install`, self-check, real `/sequences`.
- **MCP client/server/mutation**: source gate, container MCP demo, create, revise, Undo.
- **Typed cuts/temporal QA**: focused cut tests, `film:demo`, local MP4, Docker
  `film:demo`, then one paid live create before calling model selection proven.
- **Rendering/Docker/HyperFrames**: render/Docker gate, sandbox demo, draft + HD.

### 7. Understanding Failures & Troubleshooting
- `not_in_channel`: Run `/invite @Sequences` in the channel.
- `missing_scope`: Update manifest.json, reinstall, refresh bot token, and redeploy.
- Connect prompt: Complete `/slack/install` for that user.
- `/healthz` says `starting`: Inspect the matching `xapp`/`xoxb` token pair.
- Planning fails: Confirm `SLACK_SEQUENCES_PROVIDER` and its API key are correct.
- Hosted MCP fails: Confirm OpenAI key, app MCP enablement, redirect URL, and per-user OAuth.
- Thumbnails work but MP4 fails: Inspect Chromium, FFmpeg, and Railway memory.
- Duplicate replies: Another process is using the same Slack app tokens.

### 8. Reporting Verification
Always state which layers actually ran (e.g., unit/type checks, MCP demo, Docker check, Railway health/logs, Slack sandbox demo, real hosted-MCP flow). Never describe unit tests alone as proof of OAuth, Socket Mode, Railway, or live Slack behavior.
