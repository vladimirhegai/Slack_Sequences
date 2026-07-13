# Slack demo ad

An isolated, deterministic source project for the hackathon demo film. It recreates the supplied Slack UI references as editable DOM with fictional content and uses one seekable GSAP master timeline.

```powershell
npx tsx apps/slack/demos/slack-ad/render.ts
npx tsx apps/slack/demos/slack-ad/render.ts --render
npx tsx apps/slack/demos/slack-ad/render.ts --render --resume
```

Outputs are regenerated under `apps/slack/demo-output/slack-ad-luna` and must not be committed. `--resume` preserves existing evidence, fills every missing/empty frame, recycles the browser periodically, and refuses to encode until all 810 frames are present. The source has no network or audio dependency.
