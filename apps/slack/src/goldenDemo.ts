import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WebClient } from "@slack/web-api";

export const GOLDEN_DEMO_VIDEO_FILENAME = "sequences-for-slack-golden-ad.mp4";

/** The checked-in, QA-approved film used only by the model-free demo command. */
export function goldenDemoVideoPath(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../demo-output/slack-ad-luna/slack-ad-luna-with-audio.mp4",
  );
}

/** Upload the approved golden film directly; no authoring, plan, or render. */
export async function uploadGoldenDemo(client: WebClient, channel: string): Promise<void> {
  const file = goldenDemoVideoPath();
  if (!fs.existsSync(file)) {
    throw new Error("The packaged Sequences for Slack golden demo is unavailable on this deployment.");
  }
  await client.files.uploadV2({
    channel_id: channel,
    file,
    filename: GOLDEN_DEMO_VIDEO_FILENAME,
    initial_comment: ":sparkles: *Sequences for Slack* — the golden launch ad.",
  });
}
