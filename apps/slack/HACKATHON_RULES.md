# Hackathon rules — Slack Agent Builder Challenge

Concise project guidance based on the official Devpost challenge and Slack
resources. Recheck the official rules before submission:
<https://slackhack.devpost.com/rules>.

## Facts

- Submission deadline: July 13, 2026 at 5:00 PM PDT / 8:00 PM EDT.
- Online, public challenge managed by Devpost for Salesforce/Slack.
- Entrants must be eligible under the official country, age, and organization
  rules.
- Teams may contain up to four eligible people.
- New Slack Agent and Agent for Good entries must be newly created projects.

## Required technology and track

The app must meaningfully use at least one:

1. Slack AI capabilities and Agent Builder;
2. MCP server integration;
3. Real-Time Search API.

It must enter one track:

- **New Slack Agent**
- **Slack Agent for Good**
- **Slack Agent for Organizations**

Sequences enters **New Slack Agent**.

## Sequences' MCP positioning

The primary qualifying integration is Slack's hosted MCP server. Sequences uses
it to retrieve current, permission-scoped workspace context on behalf of the
invoking Slack user. Video mutations, previews, and rendering are additionally
isolated behind internal Sequences MCP tools.

Railway hosts the Bolt/OAuth/render application. Slack hosts
`https://mcp.slack.com/mcp`. Sequences currently does not publish a Railway
`/mcp` endpoint for Slackbot.

This is a stronger and more accurate story than presenting the internal stdio
process as an external Slackbot integration.

## Submission requirements

- Select the New Slack Agent track.
- Provide a text description of features and functionality.
- Provide a public demonstration video under three minutes that shows the
  working project.
- Provide an architecture diagram showing the implemented system.
- Provide the Slack developer sandbox URL.
- Invite `slackhack@salesforce.com` and `testing@devpost.com` to that sandbox as
  Members so they can test the complete flow.
- Do not include confidential information, unauthorized third-party trademarks,
  copyrighted music, or other material you lack permission to use.

The Slack Marketplace and App ID requirements apply to the Organizations track,
not this New Slack Agent submission.

## Judging criteria

All four are equally important:

1. Technological Implementation
2. Design
3. Potential Impact
4. Quality of the Idea

The demo should make the workflow obvious in its first minute: a real release
thread becomes a polished video draft, then a human revises and shares it
without leaving Slack.

## Required setup

- Slack Developer Program membership and a provisioned developer sandbox.
- A new internal Slack app installed in that sandbox.
- Bolt for JavaScript and Block Kit.
- Slack hosted MCP enabled for the app.
- A live Railway deployment and test instructions for each judge.

The Slack CLI and Agent Builder templates are optional resources, not
requirements for this Bolt/Socket Mode implementation.

## Compliance checklist

- [ ] Every entrant joined the Devpost hackathon and is eligible.
- [ ] Project is newly created for the New Slack Agent track.
- [ ] Slack Developer Program joined and sandbox provisioned.
- [ ] Sandbox app uses Slack hosted MCP in the real create flow.
- [ ] Railway deployment is live and `/healthz` returns `ready`.
- [ ] Both judge accounts are sandbox Members.
- [ ] Judge instructions include the per-user `/slack/install` link.
- [ ] Demo video is public, working, and under three minutes.
- [ ] Architecture diagram depicts current implementation, not target ideas.
- [ ] Assets, fonts, music, logos, and screenshots have acceptable provenance.
- [ ] Devpost submission is complete before July 13, 2026 at 8:00 PM EDT.
