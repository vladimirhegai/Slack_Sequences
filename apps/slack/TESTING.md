# Testing — Sequences for Slack

This is the shared verification contract for humans and coding agents.

## Environment model

- Local machine: source tests, deterministic MCP/demo checks, and Docker builds.
- Slack developer sandbox: every live Slack interaction.
- Railway production environment: the only running Slack bot process.

Do not create or maintain a second normal-workspace app. Do not run the Railway
Slack tokens locally.

## Test ladder

Run the cheapest relevant checks first and stop when one fails.

### 1. Slack source gate

From the repository root:

```powershell
npm run typecheck --workspace @sequences/slack
npm run test --workspace @sequences/slack
npm run mcp:demo --workspace @sequences/slack
```

Expected:

- TypeScript exits successfully.
- All Slack tests pass.
- MCP lists tools, applies a plan, reports `lint: clean`, and creates previews.

This gate does not require Slack credentials or a paid model.

### 2. Render and Docker gate

Required after changes to the engine, renderer, Dockerfile, Chromium, FFmpeg,
HyperFrames, or media:

```powershell
$env:VERIFY_RENDER = "1"
try {
  npm run demo --workspace @sequences/slack
} finally {
  Remove-Item Env:VERIFY_RENDER -ErrorAction SilentlyContinue
}

docker build -t sequences-slack .
docker run --rm sequences-slack `
  npm run mcp:demo -w @sequences/slack
```

The first command proves local MP4 rendering. The container command proves the
production Node/Docker MCP boundary without exposing sandbox credentials.

### 3. Monorepo CI gate

GitHub Actions currently validates the entire repository, including paused Forge
and Sequences code. Before an important push, run:

```powershell
npm run typecheck
npm test
npm run test:perf
```

Run the slower golden/render probes when shared engine or render behavior
changed:

```powershell
npm run test:golden
node apps/sequences/src/cli.ts thumbs fixtures/sequences/starter --primitives
```

Why this is broader than the Slack gate: Railway only needs to build the Slack
Docker image, while GitHub Actions protects the whole monorepo. A green Railway
deployment and a red GitHub check can therefore coexist.

### 4. Pre-deploy review

```powershell
git status --short
git diff --check
git diff --stat
```

Confirm:

- only intended files are changed;
- no `.env`, tokens, keys, generated `.data`, renders, or temporary projects;
- commands, variable names, and doc links match the implementation.

Commit and push, then follow [OPERATIONS.md §3](OPERATIONS.md#3-routine-deploys-the-runbook).
Do not claim live behavior is verified until the new deployment is healthy.

### 5. Sandbox smoke

After `/healthz` returns `200 ready`, run in the Slack sandbox:

1. `/sequences mcp-test`
2. `/sequences demo`
3. Confirm storyboard thumbnails arrive before the MP4.
4. Confirm the MP4 plays inline.
5. Reply in the reel thread with `make it shorter`.
6. Click **Undo** and confirm the previous revision returns.
7. Click **Render HD** when render-related code changed.
8. Click **Approve & share** into a disposable sandbox channel.

The self-check should report:

- Slack API: connected
- Sequences MCP: connected, with tool count
- Render host: browser + FFmpeg found
- Planning brain: configured provider and key
- Slack hosted MCP: configured and connected for the invoking user
- Token encryption key: valid
- Data directory: `/data` writable

### 6. Real hosted-MCP flow

Each tester authorizes once at:

```text
https://sequences-slack-production.up.railway.app/slack/install
```

Then:

1. Run `/sequences` with a short synthetic product brief.
2. Confirm the result includes a Slack-context hosted-MCP receipt.
3. Confirm the build trace includes Sequences MCP tools.
4. Try **🎬 Make a launch video** from a synthetic release thread.
5. Confirm revisions, Undo, HD, and sharing still operate on that job.

Use only synthetic sandbox content. Slack context is retrieved using the
invoking user's permission-scoped token and model calls are billed to the
project owner.

## Change-specific minimums

| Change | Required checks |
| --- | --- |
| Documentation only | links/commands review; `git diff --check` |
| Slack blocks or handlers | Slack source gate + sandbox affected flow |
| Manifest/scopes/events/shortcuts | paste manifest, reinstall, redeploy, self-check, affected flow |
| OAuth or hosted Slack MCP | source gate, `/slack/install`, self-check, real `/sequences` |
| MCP client/server/project mutation | source gate, container MCP demo, create, revise, Undo |
| Rendering/Docker/HyperFrames/media | render/Docker gate, sandbox demo, draft + HD |
| Shared packages or paused apps | full monorepo CI gate plus owning-app tests |
| Railway variables/infrastructure | redeploy same source, health, self-check, demo |

## Understanding failures

### GitHub Actions

The workflow job is named `phase1`. Its annotations point to the failing test or
command. Reproduce that exact layer locally before touching Railway.

The Forge failures seen during setup were unrelated to the Slack deployment:

- a stale knowledge-retrieval test still expected a deleted
  `MOTION_CATEGORIES.md`;
- a path-traversal test behaved differently on Windows and Linux;
- `actions/checkout@v4` and `actions/setup-node@v4` used the deprecated Node 20
  action runtime.

Those are now corrected. Actions use their Node 24-based v6 releases.
CI runs on pull requests, pushes to `main`, and manual dispatch. It does not also
run a redundant branch-push check when an open pull request already covers the
same feature-branch commit.

### Railway

Use:

```powershell
railway deployment list --limit 5
railway logs --lines 100
railway status
```

Old failed deployments remain visible. Inspect the newest intended deployment
ID and confirm it used the intended source and Dockerfile.

### Slack runtime

- `not_in_channel`: `/invite @Sequences`.
- `missing_scope`: update the manifest, reinstall, refresh the bot token, and
  redeploy.
- Connect prompt: complete `/slack/install` for that user.
- `/healthz` says `starting`: inspect the matching `xapp`/`xoxb` pair.
- Planning fails: confirm `SLACK_SEQUENCES_PROVIDER` and its API key.
- Hosted MCP fails: confirm app MCP enablement, user scopes, redirect URL,
  OpenAI key, and per-user OAuth.
- Thumbnails work but MP4 fails: inspect Chromium, FFmpeg, and Railway memory.
- Duplicate replies: another process is using the same Slack app tokens.

## Reporting verification

State which layers actually ran:

- unit/type checks;
- MCP demo;
- production Docker image;
- Railway health/logs;
- Slack sandbox demo;
- real hosted-MCP flow.

Never describe unit tests alone as proof of OAuth, Socket Mode, Railway, model
credentials, or live Slack behavior.
