import fs from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { WebClient } from "@slack/web-api";
import {
  GOLDEN_DEMO_VIDEO_FILENAME,
  goldenDemoVideoPath,
  uploadGoldenDemo,
} from "../src/goldenDemo.ts";

describe("golden Slack demo delivery", () => {
  it("uploads the exact approved ad without authoring or rendering", async () => {
    const uploadV2 = vi.fn(async () => ({}));
    const client = { files: { uploadV2 } } as unknown as WebClient;
    const file = goldenDemoVideoPath();
    expect(createHash("sha256").update(fs.readFileSync(file)).digest("hex")).toBe(
      "1525d7b0e9b2625bd6d8cb09fa4dc4ae42f80267aa79337f1f492ddfb0fc6354",
    );

    await uploadGoldenDemo(client, "C123");

    expect(uploadV2).toHaveBeenCalledOnce();
    expect(uploadV2).toHaveBeenCalledWith(expect.objectContaining({
      channel_id: "C123",
      file,
      filename: GOLDEN_DEMO_VIDEO_FILENAME,
    }));
  });
});
