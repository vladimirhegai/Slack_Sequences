# Setup — Sequences for Slack

Get the bot running in a Slack **sandbox/workspace** in ~5 minutes. The app uses
**Socket Mode**, so there's no public URL, tunnel, or request-URL to configure.

> Prereqs: Node ≥ 22.18, and (for previews) Chrome or Edge installed. MP4 export
> additionally needs FFmpeg — without it the bot degrades to thumbnails-only.

## 1. Install

```bash
# from the repo root
npm install
```

## 2. Create the Slack app from the manifest

1. Go to <https://api.slack.com/apps> → **Create New App** → **From a manifest**.
2. Pick your **sandbox** (or test) workspace.
3. Paste the contents of [manifest.json](manifest.json) and create the app.

The manifest declares everything the bot needs: the `/sequences` slash command,
the **🎬 Make a launch video** message shortcut, the bot scopes (`commands`,
`chat:write`, `channels:join`, `files:write`, `app_mentions:read`, `channels:history`,
`groups:history`), Socket Mode, and the `app_mention` event.

Already created the app? Open **App Manifest**, replace it with
[manifest.json](manifest.json), save, then **reinstall the app to the workspace**.
Slack does not add new OAuth scopes to an existing bot token until you reinstall.

## 3. Get the two tokens

- **App-level token** (Socket Mode): app settings → **Basic Information** →
  **App-Level Tokens** → generate a token with the **`connections:write`** scope.
  This is `SLACK_APP_TOKEN` (`xapp-…`).
- **Bot token**: **OAuth & Permissions** → **Install to Workspace** → copy the
  **Bot User OAuth Token**. This is `SLACK_BOT_TOKEN` (`xoxb-…`).

## 4. Configure `.env`

```bash
cp apps/slack/.env.example apps/slack/.env
# then fill in SLACK_BOT_TOKEN and SLACK_APP_TOKEN
```

`.env` is gitignored — never commit real tokens.

## 5. Run

```bash
npm run dev --workspace @sequences/slack
# → "⚡ Sequences for Slack is running (Socket Mode). Try /sequences"
```

In Slack, invite the bot to a channel (`/invite @Sequences`), then:

- **`/sequences demo`** — builds the curated *Relay v2* reel end-to-end (no modal,
  no model, no API key). The fastest way to confirm the whole pipeline works.
- **`/sequences`** — opens the modal to make a video from your own brief.
- **🎬 Make a launch video** (message → ⋯ → shortcuts) — drafts from a message.

The bot auto-joins public channels when `/sequences` is invoked. Private channels
still require `/invite @Sequences`. If Slack reports `not_in_channel` or
`missing_scope`, update from the manifest, reinstall the app, copy the refreshed
`xoxb-…` token into `.env`, and restart the process.

## 6. Verify without Slack (optional)

```bash
npm run demo  --workspace @sequences/slack   # model-free: applies the demo plan, writes real thumbnails
npm run smoke --workspace @sequences/slack -- "Relay v2: sub-100ms traces"   # full pipeline incl. a planning brain
npm run typecheck --workspace @sequences/slack
```

## Planning brain (only needed for non-demo paths)

`/sequences demo` needs no model. The modal/shortcut paths plan with a brain:
`claude-code-cli` (uses a Claude Code login, no key) by default, or set
`ANTHROPIC_API_KEY` to use `anthropic-api`. See [.env.example](.env.example).
