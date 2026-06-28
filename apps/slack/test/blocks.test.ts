import { describe, expect, it } from "vitest";
import { buildingBlocks, resultBlocks } from "../src/blocks.ts";

describe("Slack blocks", () => {
  it("escapes user-controlled mrkdwn in titles", () => {
    const [block] = buildingBlocks("<!channel>");
    expect(block).toMatchObject({
      text: { text: expect.stringContaining("&lt;!channel&gt;") },
    });
  });

  it("only exposes controls that are implemented end to end", () => {
    const blocks = resultBlocks({
      jobId: "job-1",
      title: "Relay",
      outline: "1. hook",
      lint: "lint: clean",
      hasVideo: false,
      usedMcp: false,
      provider: "claude-code-cli",
    });
    const actions = blocks.find((block) => block.type === "actions");

    expect(actions).toMatchObject({
      elements: [{ action_id: "revise_open" }],
    });
  });
});
