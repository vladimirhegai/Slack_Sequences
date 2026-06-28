# Sequences for Slack — Hackathon Plan (grounded in the real engine)

> Slack Agent Builder Challenge · 16 days · one builder.
> This supersedes the rough draft. It rewrites that spec against what
> **already exists** in this repo so agents don't rebuild the engine.

## 0. The one correction that changes everything

The draft assumed we'd build a "Sequences API" + "Hyperframes renderer" from
scratch in Python/FastAPI/Postgres/Celery, and that the agent would emit a
free-form `{script, scenes, assets_needed}` blob.

**None of that is real here.** Sequences is already a no-build **TypeScript/Node**
monorepo (`@sequences/core`) governed by [the 9 laws](CLAUDE.md). It already has:

- a deterministic engine: `compile(Project) → HTML` ([packages/core/](packages/core/src/))
- an **agent planner** that emits a *constrained beat sheet*, not free JSON
  ([plan.ts](packages/core/src/plan.ts), [planRunner.ts](apps/sequences/src/agent/planRunner.ts))
- a **render pipeline** to MP4 via HyperFrames ([render.ts](apps/sequences/src/render.ts))
- an **MCP server** exposing the exact tools the draft wanted to invent
  ([mcp.ts](apps/sequences/src/mcp.ts))
- a **CLI** (`init / plan / tweak / render / thumbs / mcp / studio`) ([cli.ts](apps/sequences/src/cli.ts))
- an **HTTP host** that serves `/renders/`, `/assets/`, `/build/` and the editor UI
  ([server.ts](apps/sequences/src/server.ts))

> Note: Sequences is the **paused** app (Forge is the active product — see
> [CLAUDE.md](CLAUDE.md)). This hackathon **temporarily resumes Sequences** as
> the engine behind a Slack surface. Do not touch Forge. Do not break the 9 laws.

**So the hackathon is small:** build a thin **Slack surface** that drives the
existing Sequences engine. We are not building a video tool. We're putting a
Slack front door on one we already have.

```
Slack (request / review / approve)
   → apps/slack  (Bolt app: slash cmd, modal, buttons, file upload)
       → sequences CLI + MCP  (the integration seam — never reimplement engine)
           → @sequences/core   (plan → validate → compile, the 9 laws)
               → @hyperframes/producer  (MP4 render)
   → MP4 + thumbnails served back into Slack
```

> Hackathon facts (deadline, tracks, judging) live in
> [HACKATHON_RULES.md](HACKATHON_RULES.md). Our angle: **New Slack Agent** track
> via **MCP**. Repo isolation rules: [CLAUDE.md](CLAUDE.md).

## ⚡ Tonight's foundation sprint (build this first)

Goal: a **working vertical slice** end-to-end in this monorepo —
`/sequences demo` → modal → real plan → a rendered preview back in Slack. Rough
is fine; prove the wire. Order, each step independently testable:

1. **Copy the engine glue in.** `apps/sequences/src/{projectIo,render,thumbs,
   projectTemplates}.ts` + `agent/planRunner.ts` → `apps/slack/src/engine/`
   (fix imports per §2). Sanity: `npm run typecheck --workspace @sequences/slack`.
2. **One orchestrator function.** `apps/slack/src/orchestrator.ts`:
   `createDemoVideo({ title, brief, tone, lengthSec }) → { projectDir, outline,
   thumbnailPaths, mp4Path? }`. Inside: `initializeProject` → build a
   `ProjectStore` → `runPlan("claude-code-cli", brief, store)` (maps tone→profile,
   lengthSec→durations) → `commitProject` → `generateSceneThumbnails` (fast) →
   optionally `renderProject` (slow MP4). Test it from a tiny Node script before
   touching Slack.
3. **Modal.** Replace the stub in [src/index.ts](src/index.ts): `/sequences demo`
   → `views.open` with Block Kit inputs (product, feature, audience, tone select,
   length select, context). Handle `view_submission`: `ack()` immediately, then
   run the job async.
4. **Post the result.** Post one "Building your demo…" message
   (`chat.postMessage`), then `chat.update` it with the scene outline + thumbnails
   (`files.uploadV2`, needs `files:write` scope). MP4 can come in a follow-up edit.
5. **One button: Revise.** A `Revise` button → modal → `runPlan` again (or
   `tweak`) → re-thumb → update. That closes the loop and demos the whole promise.

**Tonight's cut line (ship at least this):** steps 1–4 with **thumbnails only**
(skip MP4 if `@hyperframes/producer` / FFmpeg / Chrome aren't cooperating).
A scene outline + thumbnail grid in Slack already proves the agentic pipeline.

**Provider tonight:** `claude-code-cli` (no key needed). Fallback: set
`ANTHROPIC_API_KEY` and use `anthropic-api`.

**Host deps for rendering:** thumbnails/MP4 need **Chrome/Edge**; MP4 also needs
**FFmpeg** (`render.ts` auto-detects WinGet FFmpeg + Edge on Windows). If missing,
stay on the thumbnails-only cut.

**Definition of done (tonight):** in your sandbox, `/sequences demo` opens a
modal, and submitting it posts back a real, plan-generated scene outline + at
least one rendered thumbnail, with a working **Revise** button.

## 1. The real plan model (do NOT invent a scene schema)

The agent does **not** write scripts and scene JSON freely. It produces a
**Plan** ([PlanSchema](packages/core/src/plan.ts)):

```jsonc
{
  "motionProfile": "<profile id>",
  "scenes": [
    { "archetype": "<id>", "layout"?, "durationFrames"?, "slots": {…}, "camera"? }
  ]   // 3–6 scenes
}
```

It contains **no motion numbers** — the deterministic solver + linter make every
timing/stagger/easing decision (laws 3, 4, 8). The agent only selects **named
building blocks** and writes short copy. This constraint *is* the quality story
and the strongest "Technological Implementation" point for judging.

The only real vocabulary (from the registry — verify before relying on it):

| Concept | Real ids | Maps from modal |
| --- | --- | --- |
| **motionProfile** (3) | `crisp-saas`, `warm-startup`, `bold-launch` | Tone |
| **archetype** (7) | `hook-opener`, `feature-reveal`, `stat-callout`, `ui-walkthrough`, `social-proof`, `logo-sting-cta`, … | Scene arc |
| **camera** | enabled camera-move ids only, ≤2 scenes | (agent's call) |
| **durationFrames** | per-scene, within archetype range | Target length |

Pipeline (already wired): `buildPlanPrompt` → provider completes → `extractJsonObject`
→ `parsePlan` (referential pre-check) → `planToCommands` → `ProjectStore.apply("agent")`
(validated, journaled, undoable). The Slack app **must not** bypass this — every
change goes through `apply` (law 1).

## 2. Integration seam — COPY engine glue into `apps/slack`

**The public repo (`Slack_Sequences`) ships only `apps/slack` + `packages/core`
+ `packages/platform`.** `apps/sequences` is **not** in it. So the bot can't
shell the `sequences` CLI or import `apps/sequences/*`. Instead:

- ✅ Import the **shared packages** `@sequences/core` + `@sequences/platform`
  (they're in the repo) — that's how we get plan / compile / store / asset
  metadata.
- ✅ **Copy the host glue** out of `apps/sequences/src/` into
  **`apps/slack/src/engine/`** and adapt it. The files we need and their only
  external deps (all available to `apps/slack`):
  - `projectIo.ts` → `@sequences/core`, `@sequences/platform/{asset-metadata,vendors}`
  - `render.ts` → `@hyperframes/producer`, `./projectIo.ts`
  - `thumbs.ts` → `@sequences/core`, `./projectIo.ts`, `./render.ts`
  - `planRunner.ts` → `@sequences/core`, `@sequences/platform/providers`
  - `projectTemplates.ts` (the `init` helper) → `@sequences/core`, `@sequences/platform/asset-metadata`, `./projectIo.ts`
  Keep the relative imports between them intact; they become
  `apps/slack/src/engine/*.ts` and resolve locally. **This is allowed and
  expected** — copy-in, not cross-app import (see [CLAUDE.md](CLAUDE.md)).
- 🔧 We're free to **fix/trim Sequences as we copy** — the engine is buggy and
  we won't fully repair upstream in time. The copied glue is ours to harden.

> Local-only shortcut (this monorepo, not the published repo): you can also spawn
> `node ../sequences/src/cli.ts mcp <dir>` to poke the existing MCP server while
> prototyping. The shipped bot must not rely on it.

**Planning provider:** `planRunner` calls a provider from
`@sequences/platform/providers`. Use **`claude-code-cli`** (no API key — uses the
Claude Code login) or **`anthropic-api`** (`ANTHROPIC_API_KEY`,
`SEQUENCES_ANTHROPIC_MODEL` defaults to `claude-sonnet-4-6`).

## 3. A "project" is a directory, not a database

There is no Postgres/S3 to build. A Sequences project is a folder
([projectIo.ts](apps/sequences/src/projectIo.ts)):

```
<workspace>/<projectId>/
  project.json   canonical scene graph
  events.log     append-only journal (undo / audit / "context used")
  assets/        uploaded screenshots (hashed, metadata-probed)
  build/         compiled HTML + vendor scripts (gitignored)
  renders/       MP4 + thumbnail PNGs  ← served to Slack
```

The only **new** persistence we need is a tiny map so a Slack interaction can
find its project. Keep it minimal (SQLite or a JSON file is fine):

- `SlackInstallation` — team_id, bot_token (encrypted), bot_user_id
- `SlackJob` — id, team_id, channel_id, user_id, thread_ts, **project_dir**,
  status, message_ts (for in-place updates)

Everything else the draft listed (SequencesProject / Asset / VideoPlan /
RenderJob) **already lives in the project dir** — don't duplicate it.

## 4. Modal → engine mapping

Modal stays as drafted, but field values map onto **real** controls:

- **Tone** → one of 3 `motionProfile` ids (collapse the 6 tone options onto 3).
- **Target length** (15/30/45/60s) → total `durationFrames` budget the agent
  distributes across scenes (default 30s @ 30fps).
- **Product / Feature / Audience / Context / CTA** → the `brief` string fed to
  `sequences plan` / `buildPlanPrompt` (audience & tone also steer copy).
- **Screenshots** → download Slack file → drop in `assets/` → hash + probe via
  `@sequences/platform/asset-metadata` → append to `project.assets`. Only then
  can the planner put `{ "assetId": "…" }` in `feature-reveal`/`ui-walkthrough`
  media slots. **No asset added = those archetypes are unavailable** (the
  planner is told this in `planningContext`).

## 5. Render + Slack preview reality

`renderProject` ([render.ts](apps/sequences/src/render.ts)) shells
`@hyperframes/producer`, which needs **FFmpeg + Chrome/Edge** on the host and
takes ~0.5–2 min. Implications for a clean demo:

1. **Two-tier preview.** Post **scene thumbnails** instantly
   (`sequences thumbs` / MCP `render_preview` → PNGs, near-zero cost), then
   replace the message with the **MP4 link** when the async render finishes.
2. **One message, updated in place** (`chat.update`) — never spam per-scene
   status (draft §4.3). Status: "Building…" → "Draft ready ▶".
3. **Slack needs a public URL for the MP4.** In the sandbox, serve `renders/`
   via the existing [server.ts](apps/sequences/src/server.ts) (it already has a
   `/renders/` route) behind a tunnel (cloudflared/ngrok), and post that URL.
   Avoid the deprecated `files.upload`; share a hosted URL (draft §3.7).
4. Render **draft** quality for the demo; offer "Render HD" as a button later.

## 6. Revision loop = tweak, not re-plan

"Revise → make it shorter / more technical" should use the **cheap tier**, not a
full re-plan: NL → command via [tweak.ts](packages/core/src/tweak.ts) /
[tweakRunner.ts](apps/sequences/src/agent/tweakRunner.ts) (`sequences tweak`),
or `apply_commands` over MCP. Both are journaled + undoable, so "Undo" is free
(MCP `undo`). Re-render thumbnails first, MP4 after.

## 7. Where it lives + Slack scopes

- New package: **`apps/slack/`** (`@sequences/slack`). Node, no-build TS, `.ts`
  import extensions, `import type` — same rules as the rest of the repo
  ([CLAUDE.md](CLAUDE.md) working rules). Use **`@slack/bolt`** (JS), not Python.
- Slash command `/sequences demo` → opens modal. App-mention + message shortcut
  are stretch (draft §11).
- **Minimum scopes** (draft §4.5): `commands`, `chat:write`, `files:read`,
  `app_mentions:read`. Add `channels:history`/`groups:history` only if you ship
  thread-summarization (stretch). Verify request signatures.

## 8. Build vs reuse

| Need | Status | Source |
| --- | --- | --- |
| Project create | ✅ reuse | `sequences init` |
| Plan / script / scenes | ✅ reuse | `plan.ts`, `sequences plan` |
| Validate + quality (9 laws) | ✅ reuse | store + linter + solver |
| MCP tool surface | ✅ reuse | [mcp.ts](apps/sequences/src/mcp.ts) |
| Compile → HTML | ✅ reuse | `@sequences/core` |
| MP4 render | ✅ reuse | `render.ts` (needs FFmpeg+Chrome) |
| Scene thumbnails | ✅ reuse | `thumbs` / `render_preview` |
| Revise (NL→command) | ✅ reuse | `tweak.ts` |
| "Open in Sequences" UI | ✅ reuse | `sequences studio <dir>` |
| **Slack app** (cmd/modal/buttons/files) | ❌ build | `apps/slack/` |
| **Slack job ↔ project_dir map** | ❌ build | SQLite/JSON |
| **Public render hosting** (tunnel) | ❌ build | cloudflared + `/renders/` route |
| OAuth install / token store | ❌ build (thin) | Bolt installation store |

## 9. Trimmed 16-day order

1. **D1–2** `/sequences demo` → Bolt → modal opens, submit handled, job persisted.
2. **D3** Modal submit → `sequences init` a project dir + map Slack job → dir.
3. **D4** Brief → `sequences plan` → post scene outline + thumbnails to Slack.
4. **D5** `sequences render` async → host `renders/` behind tunnel → update msg with MP4.
5. **D6** Buttons: Open in Sequences (`studio`), Revise, Render Again, Approve.
6. **D7** Revise modal → `sequences tweak` → re-thumb → re-render.
7. **D8** Screenshot upload → `assets/` + metadata → media-slot archetypes work.
8. **D9** Drive the **MCP server** for the revise loop (the headline MCP integration).
9. **D10** "Context used" receipt from `events.log` (trust, draft §4.6); Undo button.
10. **D11–12** Polish Slack Block Kit + the Sequences project page.
11. **D13** Polish one profile/arc preset so the default video looks great.
12. **D14** Demo workspace + fake `#launch-analytics-v2` thread.
13. **D15** Record ~3-min demo. **D16** Devpost: text, **architecture diagram**,
    sandbox URL (grant `slackhack@salesforce.com` + `testing@devpost.com`).

## 10. Minimum viable demo (if time collapses)

`/sequences demo` → modal → `sequences plan` (real beat sheet) → thumbnails +
one MP4 → Slack message with a **Revise** button that runs `sequences tweak`.
That alone proves the promise: *messy Slack launch request → real, editable
Sequences video draft, in minutes.* Skip thread search, OAuth multi-workspace,
HD render, voiceover until the core path is green.

## 11. Risks / cut lines

- **Render host deps.** FFmpeg + Chrome/Edge must be installed on the demo box
  (`render.ts` finds WinGet FFmpeg / Edge automatically). Pre-warm; render is slow.
- **Tunnel for Slack to fetch the MP4.** Set up early; it's the silent blocker.
- **Don't break the engine.** End every change green (`npm test`,
  `npm run typecheck`; use `/verify`). The 9 laws and `compiler.test.ts` (the HF
  substrate handshake) must stay green — they're our "quality of code" evidence.
- **Scope creep into editing-in-Slack.** Slack only does create / revise /
  approve / open. Real editing stays in `sequences studio` (draft §4.1).

---

**Pitch:** *Sequences for Slack turns a launch thread into an editable product
demo video — the agent plans it from a constrained motion catalog (so it's
always on-brand and well-timed), renders a draft with HyperFrames, and posts it
back for one-click revision. Built on a real deterministic engine and a real MCP
server, not a prompt-and-pray wrapper.*
