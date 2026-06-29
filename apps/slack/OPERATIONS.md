# Operations — Sequences for Slack

Everything for running, deploying, and recovering the bot. One Slack developer
sandbox and one Railway deployment serve all live development — there is no
separate normal-workspace app. Edit and test source locally; exercise Slack
commands only in the sandbox. Verification ladder: [TESTING.md](TESTING.md).

- [1. Local setup & source loop](#1-local-setup--source-loop)
- [2. First-time creation (Slack app + Railway)](#2-first-time-creation-slack-app--railway)
- [3. Routine deploys (the runbook)](#3-routine-deploys-the-runbook)
- [4. Failure taxonomy & recovery](#4-failure-taxonomy--recovery)
- [5. References](#5-references)

## Production identity

| Setting | Value |
| --- | --- |
| Railway project | `Sequences Slack Hackathon` |
| Project ID | `89e9d2b7-5b63-4b09-8799-ccae5b2c707e` |
| Environment / ID | `production` / `48c3d11b-1807-42d0-85a3-1e6c67ab9c3c` |
| Service / ID | `sequences-slack` / `ce64ff82-0f2a-4193-b138-c62cc8784d8a` |
| Slack GitHub repository | **`vladimirhegai/Slack_Sequences`** — the required GitHub destination for all Slack app changes |
| Local development workspace | `vladimirhegai/Sequences` monorepo checkout — edit/test here, but do not treat its GitHub remote as the Slack publish target |
| Deploy mechanism | **`railway up` — CLI upload of the committed monorepo tree.** GitHub autodeploy is intentionally OFF |
| GitHub publish mechanism | `bash scripts/publish-public.sh "message"` commits the standalone subset to `Slack_Sequences/main` |
| Public domain | `https://sequences-slack-production.up.railway.app` |
| Persistent mount | `/data`, one volume, one replica |

IDs are not credentials, but confirm with `railway status` before changing
infrastructure. Never print Railway variables or tokens into chat/logs.

**GitHub publication and Railway deployment are separate.** Publish source to
`vladimirhegai/Slack_Sequences` with `scripts/publish-public.sh`. Deploy the
running bot via Railway CLI, not GitHub autodeploy. Railway has the `Slack_Sequences` repo
linked as a source-of-record, but **autodeploy-on-push is deliberately disabled**
(it kept picking the wrong branch). The live bot is deployed by `railway up`,
which uploads the committed **monorepo** tree and builds it with the root
Dockerfile. Pushing `Slack_Sequences` publishes the code but does **not** deploy
it; pushing `vladimirhegai/Sequences` does neither for the Slack deliverable.

## What Railway hosts

- the Bolt app + outbound Socket Mode connection;
- `/healthz`, `/slack/install`, `/slack/oauth_redirect`;
- the internal stdio Sequences MCP process;
- Chromium + FFmpeg rendering;
- the persistent `/data` volume.

Slack — not Railway — hosts `https://mcp.slack.com/mcp` (the context bot calls it
through the OpenAI Responses API with the invoking user's token). This deployment
does **not** publish a `/mcp` endpoint for Slackbot; do not configure
**Features → MCP Servers** or add `mcp:connect` (opposite integration direction).

---

## 1. Local setup & source loop

### Prerequisites

- Node.js 22.18+, npm, the committed `package-lock.json`.
- Docker Desktop (production-image checks).
- Railway CLI 5.x, logged into the account that owns the project.
- Chrome/Edge + FFmpeg only for local render checks.

From the repository root:

```powershell
npm ci
npm install --global @railway/cli
railway login
railway link    # select Sequences Slack Hackathon / production / sequences-slack
railway status
```

**Do not** copy sandbox Slack or model credentials into `apps/slack/.env`, and do
not run `npm run dev` with the sandbox `xoxb-`/`xapp-` tokens — Railway already
owns that Socket Mode connection. A second process = duplicate Slack replies.

### Source loop (while editing)

```powershell
npm run typecheck --workspace @sequences/slack
npm run test --workspace @sequences/slack
npm run mcp:demo --workspace @sequences/slack
npm run direct:demo --workspace @sequences/slack
```

For engine/render/Docker/Chromium/FFmpeg/HyperFrames/media changes:

```powershell
$env:VERIFY_RENDER = "1"
try { npm run direct:demo --workspace @sequences/slack }
finally { Remove-Item Env:VERIFY_RENDER -ErrorAction SilentlyContinue }

docker build -t sequences-slack .
```

The deterministic demo and MCP smoke do not call a paid model.

---

## 2. First-time creation (Slack app + Railway)

Do this once. For later updates, jump to [§3](#3-routine-deploys-the-runbook).

### 2.1 Create the sandbox Slack app

1. Open <https://api.slack.com/apps> → **Create New App → From a manifest** →
   select the Slack developer sandbox.
2. Paste [`manifest.json`](manifest.json) and create the app.
3. **Agents & AI Apps** → enable **Slack Model Context Protocol (MCP) Server**.
4. **Basic Information → App-Level Tokens** → create a token with
   `connections:write` → save the `xapp-...` as `SLACK_APP_TOKEN`.
5. **OAuth & Permissions → Install to Workspace** → save the `xoxb-...` bot token
   as `SLACK_BOT_TOKEN`.
6. **Basic Information** → save Client ID / Client Secret as `SLACK_CLIENT_ID` /
   `SLACK_CLIENT_SECRET`.

Do not reuse the local development app's tokens.

### 2.2 Create the Railway service

1. **New Project → Empty Service** (or deploy-from-repo then disconnect the GitHub
   source — autodeploy is intentionally off). The live bot is shipped with
   `railway up` from the monorepo root, not a GitHub push.
2. Keep service root `/`. Do not add build/start commands — root
   [`railway.json`](../../railway.json) selects the Dockerfile, `/healthz`, one
   replica, restart-on-failure.
3. **Settings → Networking** → generate a public domain. Save the full HTTPS URL
   (no trailing slash) as `PUBLIC_BASE_URL`.

The first deploy may fail before credentials exist — finish configuration and
deploy again. Judge the service by the newest intended deployment, not historical
failure rows.

### 2.3 Volume & resource limits

1. Add a Railway volume mounted exactly at `/data`.
2. Keep exactly **one replica** (jobs, tokens, job map are file-backed).
3. **Deploy → Replica Limits** → start at 4 GB memory (2 GB can do draft renders;
   4 GB is safer for 1080p Chromium).
4. Set a Railway compute usage alert and a hard limit.
5. Leave Serverless / App Sleeping **disabled** for stable Socket Mode + judging.

The Dockerfile only creates the `/data` mount point — do not add a Docker `VOLUME`
instruction (Railway volumes are configured on the service). The volume is not
self-cleaning; watch its usage.

### 2.4 Railway variables

Generate two independent 32-byte values:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

First → `SLACK_STATE_SECRET`; second → `SLACK_TOKEN_ENCRYPTION_KEY`. Open
**Variables → Raw Editor**, paste [`.env.railway.example`](.env.railway.example),
and fill every uncommented value:

```dotenv
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
PUBLIC_BASE_URL=https://YOUR-SERVICE.up.railway.app
SLACK_REDIRECT_URI=https://YOUR-SERVICE.up.railway.app/slack/oauth_redirect
SLACK_STATE_SECRET=...
SLACK_TOKEN_ENCRYPTION_KEY=...
OPENAI_API_KEY=sk-...            # context bot — REQUIRED, OpenAI only
```

Pick **one** planning-bot provider (this is only the planning bot; the context
bot above always needs `OPENAI_API_KEY`):

```dotenv
# A — OpenRouter gateway (one key → DeepSeek/GLM, cheap) — current Railway choice
SLACK_SEQUENCES_PROVIDER=openrouter-api
OPENROUTER_API_KEY=sk-or-v1-...
# SEQUENCES_OPENROUTER_MODEL=deepseek/deepseek-v4-pro

# B — reuse OpenAI temporarily
# SLACK_SEQUENCES_PROVIDER=openai-api
# SEQUENCES_OPENAI_MODEL=gpt-5-mini

# C — dedicated Anthropic key
# SLACK_SEQUENCES_PROVIDER=anthropic-api
# ANTHROPIC_API_KEY=sk-ant-...
# SEQUENCES_ANTHROPIC_MODEL=claude-sonnet-4-6
```

**Do not add:** `PORT` (Railway injects it), `SLACK_SIGNING_SECRET` (Socket Mode),
`NODE_ENV`/`HOST`/`SLACK_SEQUENCES_DATA_DIR`/`PUPPETEER_EXECUTABLE_PATH`/
`PRODUCER_LOW_MEMORY_MODE` (the Dockerfile supplies them).
`RAILWAY_DOCKERFILE_PATH=Dockerfile` is a harmless explicit fallback if Railway
ignores the checked-in `railway.json`. After it works, seal the secrets in
Railway and keep recovery copies in a password manager.

### 2.5 Finish Slack OAuth

1. **OAuth & Permissions → Redirect URLs** → add the exact `SLACK_REDIRECT_URI`
   → Save.
2. **App Manifest** → paste current [`manifest.json`](manifest.json) → save.
3. **Reinstall to Workspace** → approve bot + user scopes.
4. Copy the current `xoxb-...` into Railway again and redeploy.

Editing a local manifest never changes the Slack app. Repeat manifest-save →
reinstall → token-copy → redeploy whenever scopes/features change.

### 2.6 Connect each user to Slack hosted MCP

Everyone running the real `/sequences` flow authorizes once at
`https://YOUR-SERVICE.up.railway.app/slack/install` (signed into the sandbox). The
callback stores the user token encrypted on `/data`. `/sequences demo` does not
need this. For judges, share the same install link; invite
`slackhack@salesforce.com` and `testing@devpost.com` as sandbox **Members**.

### 2.7 Docker check before first deploy

```powershell
docker build -t sequences-slack .
docker run --rm sequences-slack npm run mcp:demo -w @sequences/slack
```

Checks the production image without copying secrets locally. The image uses
`/usr/local/bin/chromium-no-sandbox`, wrapping system Chromium with the flags
required inside this root-run container.

---

## 3. Routine deploys (the runbook)

Railway service root = repo root. Root [`Dockerfile`](../../Dockerfile) installs
Node, Chromium, FFmpeg; root [`railway.json`](../../railway.json) selects the
Dockerfile builder, `/healthz` (300s timeout), one replica, restart-on-failure.
A correct deployment shows:

```text
commit: the commit intended for the sandbox
builder: DOCKERFILE   dockerfile: Dockerfile
health check: /healthz   replicas: 1   volume mount: /data
```

**Deploy with `railway up` from the monorepo root.** It uploads the committed
local tree; Railway builds it with the root Dockerfile. Do **not** rely on a
GitHub push to deploy (autodeploy is off). `link` the CLI once
(`railway link` → `Sequences Slack Hackathon` / `production` / `sequences-slack`).

### Deploy sequence

1. **Source gate** (and, before an important deploy, the monorepo CI gate —
   GitHub Actions tests the whole repo):

```powershell
git status --short
npm run typecheck --workspace @sequences/slack
npm run test --workspace @sequences/slack
npm run mcp:demo --workspace @sequences/slack
# before an important deploy:
npm run typecheck; npm test; npm run test:perf
```

2. **Commit locally, then publish to the correct Slack GitHub repository:**

```powershell
git add <intentional-files>
git commit -m "type(scope): concise change"
bash scripts/publish-public.sh "type(scope): concise change"
```

The publish script commits and pushes the standalone subset to
`https://github.com/vladimirhegai/Slack_Sequences.git` on `main`. **Do not use
`git push origin HEAD` from this monorepo as the Slack publication step.**

3. **Deploy the same committed tree to Railway** (from the repo root):

```powershell
railway up --detach --service sequences-slack --environment production `
  --message "Deploy committed local tree"
```

`railway up` uploads the **local tree**, so: run only from the repo root; commit
first (and ensure `git status --short` has no unintended files); never
`--path-as-root` for this monorepo. Railway keeps the current deployment serving
until the new build is healthy, so a broken build never takes the bot down. Plain
`railway redeploy` just restarts the same source (use it after a variables-only
change).

GitHub publish and Railway deploy are both required release steps:
`publish-public.sh` updates `Slack_Sequences`; `railway up` updates the live bot.

### Verify every deployment

```powershell
railway deployment list --limit 5
railway logs --lines 100
$baseUrl = "https://sequences-slack-production.up.railway.app"
Invoke-WebRequest "$baseUrl/healthz" | Select-Object StatusCode, Content
```

Expected: `HTTP server listening on 0.0.0.0:8080`,
`Sequences for Slack is running (Socket Mode)`, and `/healthz` → `200` / `ready`.
Then in Slack run `/sequences mcp-test`, `/sequences demo`, and the changed flow.
For OAuth / hosted-MCP changes, re-run `/slack/install` before the real test.

---

## 4. Failure taxonomy & recovery

Don't call every red mark a "Railway failure." GitHub Actions and Railway are
independent: CI tests the whole monorepo (incl. paused Forge/Sequences); Railway
only builds the Slack Docker image. A green Railway deploy and a red GitHub check
can coexist — and vice versa.

| Where it appears | What it means | First action |
| --- | --- | --- |
| GitHub Checks, job `phase1` | Actions test/typecheck failure | Reproduce the named command locally |
| Railway status `FAILED` during build | Docker/Railway build failed | Open build logs; confirm Dockerfile + commit |
| Railway `CRASHED` / restart loop | Image built but process exited | Inspect deploy logs + variables |
| `/healthz` → `503 starting` | HTTP alive; Socket Mode not ready | Check the matching `xapp`/`xoxb` pair |
| `/healthz` → `200 ready`, Slack flow fails | Runtime config problem | `/sequences mcp-test`, then logs |

### Slack runtime errors

- `not_in_channel`: `/invite @Sequences`.
- `missing_scope`: update manifest, reinstall, refresh bot token, redeploy.
- Connect prompt: complete `/slack/install` for that user.
- Planning fails: confirm `SLACK_SEQUENCES_PROVIDER` + its API key.
- Hosted MCP fails: confirm app MCP enablement, user scopes, redirect URL,
  `OPENAI_API_KEY`, per-user OAuth.
- Thumbnails work but MP4 fails: inspect Chromium, FFmpeg, Railway memory.
- Duplicate replies: another process is using the same Slack app tokens.

### Recovery

Wrong/old code: `railway status` → confirm `git rev-parse HEAD` is the intended
commit and `git status --short` is clean → re-run `railway up`. Wrong builder:
keep service root `/`, set config path
`/railway.json` + Dockerfile path `Dockerfile`, trigger a fresh deploy (don't
trust a Railpack success — it may omit Chromium/FFmpeg). Variable-only change:
`railway redeploy --service sequences-slack --environment production`. Exposed
credential: rotate at the provider, update Railway, redeploy, retest OAuth/Socket
Mode. Old failed deployment rows from setup (wrong branch, missing vars, trial
limits, Railpack attempts) do **not** mean the current deploy is unhealthy —
identify the newest by ID, source/commit, builder, status.

### Guardrails

One replica while state is file-backed; keep `/data` attached; sleeping/serverless
disabled; watch volume usage (encrypted tokens, projects, thumbnails, MP4s
persist and are not auto-cleaned); maintain Railway + provider usage alerts.

---

## 5. References

- [Slack hosted MCP overview](https://docs.slack.dev/ai/slack-mcp-server/) ·
  [sample-app setup](https://docs.slack.dev/ai/slack-mcp-server/developing/)
- [Slack Bolt Socket Mode](https://docs.slack.dev/tools/bolt-js/concepts/socket-mode/)
- [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles) ·
  [volumes](https://docs.railway.com/volumes) ·
  [health checks](https://docs.railway.com/deployments/healthchecks)
- [Railway variables & sealed secrets](https://docs.railway.com/variables) ·
  [CLI deploying](https://docs.railway.com/cli/deploying) ·
  [config as code](https://docs.railway.com/config-as-code)
- [Railway plans](https://docs.railway.com/pricing/plans) ·
  [cost control](https://docs.railway.com/pricing/cost-control)
