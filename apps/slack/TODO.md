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
  two-tier delivery, MCP tool receipts, and the Undo / Approve & share controls.
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
- [ ] **Render HD on demand.** Lower priority. Add an HD button that re-runs
  `render` at `quality: "high"` and replaces the draft MP4. Engine already
  supports the quality arg (`renderProject` / MCP `render`).

## 3. Make it feel agentic (review item #2)

- [x] **Read the complete release thread.** The 🎬 shortcut now pulls
  `conversations.replies` and summarizes the whole thread into the brief
  ([src/thread.ts] `summarizeThread`, unit-tested), not just the clicked message.
- [ ] **Conversational create / revise in-thread.** Reply in a draft's thread →
  treat it as a revise (and `@Sequences make a video about …` → create).
  Needs a `message.channels` event subscription (manifest change → **reinstall**)
  plus loop-guards (ignore our own bot posts; dedupe). `findJobByThread` in
  [src/jobStore.ts] already maps a thread → job, so the revise wiring is small.
- [ ] **Stream tool/agent progress (Slack "Thinking Steps").** Today we post a
  *receipt* after the fact (`toolCalls` in [src/blocks.ts]). Upgrade to live
  status as `submit_plan → render_preview → render` run, using Slack's
  assistant/thinking-steps surface. Highest "wow" for the demo video.
- [ ] **RTS as a second challenge tech (optional).** When the sandbox enables the
  Real-Time Search API, use it to enrich thread context. Sandbox-gated; keep the
  current thread-read as the fallback.

## 4. Quality / polish backlog

- [ ] Screenshot upload → `assets/` → media-slot archetypes light up (SLACK_PLAN §5 day 9).
- [ ] "Context used" receipt from `events.log` + the Undo trail (trust/audit story).
- [ ] Register the same MCP server in Claude Desktop (portability demo beat).
- [ ] Graceful empty/error/loading Block Kit states; demo workspace + scripted thread.

---

_See the bottom-of-file **"What to do next"** section for the recommended order
after this PR merges._
