# Slack Agent Builder Challenge — submission compliance audit

Originally audited 2026-07-10 and refreshed 2026-07-12 against the public
[official rules](https://slackhack.devpost.com/rules),
[challenge overview](https://slackhack.devpost.com/), and
[official FAQ](https://slackhack.devpost.com/details/faq-slackagent-builder).
The live overview/FAQ still show a **2026-07-13 5:00 PM PDT** deadline, require
a live Slack developer-sandbox URL, require both judge accounts as Members,
and request an approximately three-minute working-project video plus an
architecture diagram. This is an engineering checklist, not legal advice.
Recheck the live pages immediately before submission because rules may change.

## Result

The architecture and Railway hosting model are compatible with the published
rules. Railway is ordinary application hosting; no rule requires a particular
cloud, requires the repository to be the running host, or prohibits keeping a
submitted service online during judging. The rules instead require the project
to install and run consistently, match the video/text description, and remain
testable in the supplied Slack developer sandbox.

The project is not submission-ready until the owner actions below are complete.

## Requirement audit

| requirement | evidence in this workspace | status / action |
|---|---|---|
| Submit by 2026-07-13 5:00 PM PDT | Official Rules §1 | Owner must submit before the sponsor clock deadline. |
| Eligible entrant/team | Not discoverable from source | Owner must confirm age, residence, employer/conflict, team registration, and team size ≤4. |
| New Slack Agent track | Slack manifest and new app architecture | Correct intended track. Do not select Organizations unless Marketplace requirements are completed. |
| Uses a required Slack technology | `src/slackMcpContext.ts` calls Slack-hosted `https://mcp.slack.com/mcp` with permission-scoped user OAuth | Meets the MCP-integration route. Describe this accurately; the internal stdio Sequences MCP is additional plumbing, not the qualifying Slack integration. |
| Installs and runs consistently | Slack app manifest + Bolt Socket Mode + Railway service | Architecture is valid. Live `/healthz` returned `200 ready` on 2026-07-12. Run the full sandbox flow again after the final deployment. |
| Approximately 3-minute working demo | New editable 27s Slack ad source under `demos/slack-ad/` | The FAQ says judges are not required to watch beyond three minutes. Front-load the strongest material, stay at or below 3:00, and show `/sequences` functioning in the real sandbox; the ad alone is only supporting proof. |
| Public video host | Not yet uploaded | Upload final video publicly to YouTube, Vimeo, Facebook Video, or Youku and verify logged-out playback. |
| Architecture diagram | `submission/architecture.svg` | Export/upload this visual; update it if deployment boundaries change. |
| Sandbox URL and judge access | Railway URL is not the requested sandbox URL | Submit the `*.slack.com` developer-sandbox URL. Invite `slackhack@salesforce.com` and `testing@devpost.com` as Members at org level and confirm both appear. |
| End-to-end test access | `/slack/install` supplies per-user hosted-MCP OAuth | Testing instructions must give the install URL, `/sequences mcp-test`, `/sequences demo`, and a small real-create brief. Verify a fresh member can complete OAuth. |
| Original work / authorized integrations | Source history, open-source licenses, Slack/OpenAI/Codex/Railway integrations; historical OpenRouter route | Retain license notices. Confirm current service terms permit the calls and submitted output. |
| No sensitive information | Slack context is permission-scoped; demo assets include a local sandbox screenshot | Use fictional demo messages/initials and mask personal avatars/names. Never show tokens, Railway variables, private channels, or real customer content. |
| Trademark/copyright safety | Slack UI/logo is necessary to show the Slack project | Use Slack assets according to the [Slack Media Kit](https://slack.com/media-kit) and brand guidance; do not imply endorsement. The rules' trademark wording is broad, so ask the official hackathon Slack channel to confirm the planned sponsor-logo end card. Use no unlicensed music. |

## Railway and the submission deadline

The published rules define a submission period and a later judging period, but
do not publish a source-code freeze mechanism or say that a hosted service must
be turned off after the deadline. Keeping Railway online is necessary because
judges receive sandbox access and the project must run consistently.

To eliminate any appearance of post-deadline feature work:

1. Commit and publish the exact final source to `Slack_Sequences/main`.
2. Create an immutable annotated tag such as `hackathon-submission-2026-07-13`.
3. Deploy that same committed tree with `railway up`; record commit hash,
   Railway deployment ID, deployment timestamp, and `/healthz` result.
4. Save the final Devpost text, architecture image, video URL, and test
   instructions beside the tagged source.
5. During judging, do not deploy features or polish. If availability requires
   an emergency fix, make the smallest fix, preserve the original tag, and add
   a dated incident note describing exactly what changed and why.

This evidence is stronger than attempting to prove a negative. Railway's
deployment history plus the immutable public tag establishes which build was
submitted and which build judges were intended to test.

## Current operational gaps rechecked on 2026-07-12

- Railway is online and `/healthz` returned `200 ready` on 2026-07-12, but its
  latest successful deployment is still `d6a4c279-2fb1-4a06-b7a1-a410617af9a5`
  from 2026-07-07. The public repository's `main` currently resolves to
  `0a6c59bae6f679db6e17b6ffc4a82e68bca857f2`, while the local development
  branch contains later July-12 stabilization work. Final source must be
  committed, intentionally published, deployed, and sandbox-tested.
- Judge membership cannot be verified from source. Confirm both accounts at
  the Slack organization member list, not merely one workspace screen.
- The repository cannot prove that each judge completed per-user hosted-MCP
  OAuth. Provide the install link in testing instructions and test it with a
  fresh member account before submission.
- The final public video and Devpost submission do not yet exist.
- The sponsor-logo/trademark ambiguity should be confirmed in the official
  hackathon Slack channel before locking the end card.
- The current engineering sprint stops at the first runtime-valid,
  human-acceptable MP4 and keeps a known-good backup. Do not delay submission
  chasing advisory QA residue or an open-ended probe chain.

## Final freeze record

Fill this immediately after the final publish/deploy:

```text
Submission time (PDT):
Monorepo commit:
Slack_Sequences commit:
Git tag:
Railway deployment ID:
Railway deployment time:
/healthz checked at:
Sandbox URL:
Judge members confirmed at:
Public video URL:
Devpost submission URL:
Emergency changes during judging: none / link to incident note
```
