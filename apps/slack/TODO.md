# Sequences for Slack — TODO

Living roadmap distilled from the codebase review. Ordered by value. Canonical
plan/timeline is [SLACK_PLAN.md](SLACK_PLAN.md); this file is the actionable
checklist on top of it. Each box notes *why* and *where*.

Legend: `[x]` done · `[~]` partial · `[ ]` not started.

## 1. Publish & ship hygiene (review item #1)

- [x] **Align the MCP default.** Local + published now default MCP **on**
  (`mcpEnabled` = `SLACK_SEQUENCES_USE_MCP !== "0"` in
  [src/orchestrator.ts](src/orchestrator.ts)). Republishing propagates it.
- [x] **Commit `apps/slack`.** Was untracked; now committed in the dev monorepo.
- [x] **Harden `scripts/publish-public.sh`.** Replaced blind `--force` with
  `--force-with-lease`; refreshed the generated README/CLAUDE to describe demo,
  two-tier delivery, the observable build path, and the Undo / Approve & share
  controls.
- [ ] **Decide publish cadence.** Script still mirrors to `main`. For reviewable
  changes prefer a branch + PR (as used for this change); keep the script for
  fast snapshot pushes only.

## 2. Complete the workflow (review item #3 — do before HD render)

- [x] **Undo.** Button on every result → `undo_apply` → `runUndo` → `undoVideo`
  (MCP `undo` tool, in-process fallback) → re-delivered via the two-tier path.
  Deterministic (journal replay, no model). [src/orchestrator.ts], [src/index.ts].
- [x] **Approve & share.** "Approve & share" appears once the reel is `ready` →
  `approve_open` → channel-picker modal (`buildShareModal`) → `share_video` →
  `runShare` reposts the MP4 to the chosen channel. [src/blocks.ts], [src/index.ts].
- [x] **Render HD on demand.** Ready results expose **Render HD**, which re-runs
  the existing renderer at `quality: "high"`, uploads the replacement, and
  makes it the canonical artifact used by **Approve & share**. No composition or
  motion-design decisions change.

## 3. Make it feel agentic (review item #2)

- [x] **Read the complete release thread.** The 🎬 shortcut now pulls
  `conversations.replies` and summarizes the whole thread into the brief
  ([src/thread.ts] `summarizeThread`, unit-tested), not just the clicked message.
- [x] **Conversational revise in-thread.** Human replies in a reel thread route
  through `findJobByThread` → `runRevise`. Bot/system/self posts are ignored;
  channel+message timestamps dedupe Socket Mode retries and overlapping
  `message.channels` / `app_mention` delivery; a per-job lock prevents concurrent
  mutation/render work. The manifest now subscribes to `message.channels` and
  `message.groups`, so **reinstall the Slack app** after updating it.
- [x] **Live "Thinking Steps" progress.** The orchestrator emits progress around
  each real operation and the bot incrementally `chat.update`s the result as
  `submit_plan`/`apply_commands` → `render_preview` → `render` complete. Success,
  local fallback, failure, duration, and HD quality are represented. The final
  message keeps a compact build trace rather than being the first time progress
  becomes visible.
- [ ] **RTS as a second challenge tech (optional).** When the sandbox enables the
  Real-Time Search API, use it to enrich thread context. Sandbox-gated; keep the
  current thread-read as the fallback.

## 4. Quality / polish backlog

- [ ] Screenshot upload → `assets/` → media-slot archetypes light up (SLACK_PLAN §5 day 9).
- [ ] "Context used" receipt from `events.log` + the Undo trail (trust/audit story).
- [ ] Register the same MCP server in Claude Desktop (portability demo beat).
- [~] Graceful empty/error/loading Block Kit states. Live progress, HD failures,
  and busy-job notices are covered; a scripted demo workspace is still pending.

---

## What to do next (recommended order)

After this PR merges, in priority order:

1. **Reinstall and sandbox-test the manifest** — `message.channels` and
   `message.groups` are now declared, but Slack must issue a refreshed
   installation before thread replies arrive. Exercise create → reply revise →
   HD → share in one channel.
2. **Screenshot upload → media archetypes** — lets `feature-reveal` / `ui-walkthrough`
   use real product UI, not just text. Keep this separate from the current
   workflow-only polish because it can change visual output.
3. **Context / version receipt** — summarize the deterministic event journal and
   current artifact quality without changing composition.
4. **RTS second tech** (sandbox-gated) and **Claude Desktop MCP registration**
   (portability demo beat) — do when the sandbox/recording is being prepared.

Cut-line: sandbox proof is next. Motion-system and creativity work intentionally
remain deferred until the HyperFrames authoring direction is revisited.
