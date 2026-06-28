# Deploying Sequences for Slack

The hackathon deployment path: the Bolt app runs in **Socket Mode**, uses Slack's
**hosted MCP server** for workspace context, and uses the internal **Sequences MCP
server** for video execution. It is packaged as a single Docker image (Chromium +
FFmpeg + Node) and deployed to **Railway**.

> **Authoritative variable names live here and in
> [`.env.railway.example`](.env.railway.example).** They must match the code
> exactly — `SLACK_STATE_SECRET`, `SLACK_TOKEN_ENCRYPTION_KEY`,
> `SLACK_SEQUENCES_DATA_DIR`. There is **no** `SLACK_SIGNING_SECRET` (Socket Mode
> doesn't use one) and you never set `PORT` (Railway injects it).

## Two workspaces, one codebase

We run the same code in two places with **different tokens** — never two copies
with the same `xoxb`/`xapp`:

| Where | Slack workspace | How it runs | Tokens |
| --- | --- | --- | --- |
| **Local (VS Code)** | your normal Sequences **workspace** | `npm run dev` | `apps/slack/.env` (gitignored) |
| **Railway** | the Sequences **sandbox** | this Docker image | Railway dashboard variables |

Local `.env` only needs `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` to iterate with
`/sequences demo`. The full `/sequences` create flow needs a public OAuth callback,
so it effectively runs on Railway (or behind a tunnel). Copy
[`.env.example`](.env.example) → `apps/slack/.env` for local;
[`.env.railway.example`](.env.railway.example) is the paste-ready Railway set.

## Railway

`railway.json` already pins the builder (Dockerfile), `/healthz` health check,
single replica, and restart policy — so those aren't manual steps. You still do:

1. **New Project → Deploy from GitHub repo →** the Sequences repo. Keep the root
   directory `/`. Railway auto-detects the root `Dockerfile`; add no custom build
   or start command.
2. **Settings → Networking → Generate Domain.** Copy it (e.g.
   `https://sequences-slack-production.up.railway.app`). This is your
   `PUBLIC_BASE_URL`.
3. **Variables → Raw Editor →** paste [`.env.railway.example`](.env.railway.example)
   and fill every value (use the domain from step 2 in `PUBLIC_BASE_URL` and
   `SLACK_REDIRECT_URI`).
4. **Settings → Volumes → Add Volume**, mount path `/data`. The encrypted user
   tokens, job map, projects, and renders live here and must survive redeploys.
   (Keep one replica — these stores are file-backed; `railway.json` sets this.)
5. **Deploy.** Watch the logs for `HTTP server listening`, then `⚡️ Sequences …
   running` once the Socket Mode connection is up.

Give it **≥2 GB RAM** (4 GB is safer for 1080p Chromium rendering).

### Generate the two secrets

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # SLACK_STATE_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # SLACK_TOKEN_ENCRYPTION_KEY
```

### Which variables are required

- **Always:** `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_CLIENT_ID`,
  `SLACK_CLIENT_SECRET`, `PUBLIC_BASE_URL`, `SLACK_REDIRECT_URI`,
  `SLACK_STATE_SECRET`, `SLACK_TOKEN_ENCRYPTION_KEY`.
- **For the real create flow:** `OPENAI_API_KEY` (Slack hosted-MCP retrieval) **and**
  a planning provider — `SLACK_SEQUENCES_PROVIDER=anthropic-api` + `ANTHROPIC_API_KEY`
  (the key-free `claude-code-cli` provider can't log in inside a container).
- **Baked into the image:** `NODE_ENV`, `HOST`, `SLACK_SEQUENCES_DATA_DIR=/data`,
  `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`, `PRODUCER_LOW_MEMORY_MODE=true`.

## Slack app settings (sandbox app)

1. **App Manifest →** paste [`manifest.json`](manifest.json) → Save. (Editing the
   file locally does not sync to Slack.)
2. **Agents & AI Apps →** enable **Slack Model Context Protocol (MCP) Server**.
3. **OAuth & Permissions → Redirect URLs →** add the exact `SLACK_REDIRECT_URI`
   value, then **Save URLs**.
4. **Reinstall to Workspace**, approve, then re-copy the **Bot User OAuth Token**
   into Railway as `SLACK_BOT_TOKEN` (new scopes only fully apply after reinstall).
5. Do **not** configure **Features → MCP Servers** — that is the opposite
   direction (Slackbot calling a public MCP server we'd publish), not this flow.
6. **Per-user MCP install:** open `https://YOUR-SERVICE.up.railway.app/slack/install`
   once as each demo user and approve. The app receives the user token at
   `/slack/oauth_redirect` and stores it encrypted — you never copy it by hand.

## Verify

- `https://YOUR-SERVICE.up.railway.app/healthz` returns `ready` (it returns
  `starting` with HTTP 503 until the Slack socket connects).
- In a **public** channel (or after `/invite @Sequences` in a private one):
  - `/sequences mcp-test` runs a self-check and posts a pass/warn/fail board for
    every service (Slack API, Sequences MCP engine, render host, planning brain,
    hosted MCP, token encryption, data dir) — the fastest "is it healthy?" signal.
  - `/sequences demo` renders without any user OAuth (deterministic fallback).
  - `/sequences` after `/slack/install` creates a real video; the result shows a
    **Slack context (hosted MCP)** receipt and a Sequences MCP build trace.

> The image runs as **root** by design (no `USER` directive): Railway mounts the
> `/data` volume root-owned, and headless Chromium needs root + `--no-sandbox`
> (injected via a wrapper at `/usr/local/bin/chromium-no-sandbox`). Nothing to
> configure — it's baked into the `Dockerfile`.

## Test the image locally (optional, before pushing)

With Docker Desktop running:

```powershell
docker build -t sequences-slack .
docker run --rm -p 3000:3000 --env-file apps/slack/.env sequences-slack
# then: curl http://localhost:3000/healthz
```

Use `apps/slack/.env` (or a filled copy of `.env.railway.example`) as the
`--env-file`. This is the same image Railway builds.
