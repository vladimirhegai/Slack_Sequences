# Hackathon rules — Slack Agent Builder Challenge (agent brief)

A compact, agent-readable summary of the hackathon we're building for. For the
*product* plan, see [SLACK_PLAN.md](SLACK_PLAN.md).

## The facts

- **Event:** Slack Agent Builder Challenge (Devpost, managed for Salesforce/Slack).
- **Deadline:** **Jul 13, 2026 @ 8:00pm EDT** (~16 days). Online, public.
- **Prize pool:** $42,000 cash + Dreamforce 2026 tickets, swag, features.
- **Eligibility:** 18+, only specific countries/territories (check full rules).
- **Team:** up to 4 people.

## What you must build

An app that uses **at least one** of these three technologies **and** fits **at
least one** track.

**The three technologies (pick ≥1):**
1. **Slack AI capabilities & Agent Builder** — built-in AI, starter templates (HR/IT/Sales/Support).
2. **MCP (Model Context Protocol) server integration** — connect external tools/data/reasoning to a Slack agent.
3. **Real-Time Search (RTS) API** — surface fresh in-workspace context on demand.

**The tracks (fit ≥1):**
- **New Slack Agent** — automate workflows / connect systems / surface insights.
- **Slack Agent for Good** — real social-impact problem (accessibility, education, sustainability, public health, nonprofits…); must explain measurable impact.
- **Slack Agent for Organizations** — submit (or significantly update) a **Slack Marketplace** app *before the deadline*; requires a Slack **App ID**.

## Our positioning (decided)

> **Sequences for Slack** → **New Slack Agent** track, powered by **MCP server
> integration**. We expose Sequences' video engine as MCP tools the Slack agent
> drives. This is the cleanest, strongest fit and uses a required tech in a way
> that "wouldn't be possible without it."

Also in reach (no extra tracks needed — these are bonus prizes judged across all
entries): **Best Technological Implementation**, **Most Innovative**, **Best UX**.
RTS API is an optional stretch (e.g. pull live launch context from a channel).

## What to submit

- Text description (features + functionality).
- **~3-minute demo video** showing the working project (first 60 seconds matter
  most — judges spend ~5–7 min/project).
- **Architecture diagram.**
- **URL to your Slack developer sandbox**, with access granted to
  **`slackhack@salesforce.com`** and **`testing@devpost.com`**.
- (Organizations track only) Slack **App ID** proving Marketplace submission.

## Judging criteria (optimize all four)

1. **Technological Implementation** — quality software; meaningfully uses ≥1 of
   the three techs; clean code.
2. **Design** — UX thought-through; balanced frontend + backend.
3. **Potential Impact** — on the Slack community and beyond.
4. **Quality of the Idea** — creative, unique, improves on what exists.

## What wins (from the brief's "Inspiration")

- Solve a **real, specific workflow problem inside Slack** — not a generic
  chatbot wrapped in a Slack UI.
- Use a required tech in a way that **wouldn't be possible without it**.
- Show **clear impact / adoption potential**.
- Ship a **polished demo video**.

## Required setup / resources

- **Slack Developer Program** → unlocks a free **sandbox** workspace (required).
- **Bolt SDK** (we use **JavaScript** — [apps/slack](.)).
- **Slack CLI** (`slack create agent`), **Block Kit** for rich UI.
- Docs: Slack Platform docs, MCP integration, RTS API, Marketplace guidelines.
- Community: `#slack-agent-builder-challenge` in the Slack Community.

## Our compliance checklist

- [ ] Joined Slack Developer Program; sandbox provisioned.
- [ ] App uses **MCP** (≥1 required tech) — ✅ by design.
- [ ] Fits **New Slack Agent** track — ✅.
- [ ] Demo video (~3 min) recorded.
- [ ] Architecture diagram exported.
- [ ] Sandbox URL shared with `slackhack@salesforce.com` + `testing@devpost.com`.
- [ ] Devpost submission filled in before **Jul 13, 2026 8pm EDT**.
