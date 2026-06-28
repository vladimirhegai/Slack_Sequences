import { describe, expect, it } from "vitest";
import { buildingBlocks, resultBlocks, thinkingStepsBlocks } from "../src/blocks.ts";

describe("Slack blocks", () => {
  it("escapes user-controlled mrkdwn in titles", () => {
    const [block] = buildingBlocks("<!channel>");
    expect(block).toMatchObject({
      text: { text: expect.stringContaining("&lt;!channel&gt;") },
    });
  });

  const actionIds = (
    videoStage: "rendering" | "ready" | "unavailable",
    renderQuality: "draft" | "high" = "draft",
  ) => {
    const blocks = resultBlocks({
      jobId: "job-1",
      title: "Relay",
      outline: "1. hook",
      lint: "lint: clean",
      videoStage,
      usedMcp: false,
      provider: "claude-code-cli",
      renderQuality,
    });
    const actions = blocks.find((block) => block.type === "actions");
    return actions && actions.type === "actions"
      ? actions.elements.map((el) => ("action_id" in el ? el.action_id : ""))
      : [];
  };

  it("offers revise + undo before the video is ready, but not share", () => {
    expect(actionIds("rendering")).toEqual(["revise_open", "undo_apply"]);
  });

  it("offers approve & share only once the video is ready", () => {
    expect(actionIds("ready")).toEqual(["revise_open", "undo_apply", "render_hd", "approve_open"]);
    expect(actionIds("ready", "high")).toEqual(["revise_open", "undo_apply", "approve_open"]);
    expect(actionIds("unavailable")).toEqual(["revise_open", "undo_apply"]);
  });

  it("walks the headline through the two delivery tiers", () => {
    const base = {
      jobId: "job-1",
      title: "Relay",
      outline: "1. hook",
      lint: "lint: clean",
      usedMcp: false,
      provider: "claude-code-cli",
    } as const;
    const headline = (stage: "rendering" | "ready" | "unavailable") => {
      const section = resultBlocks({ ...base, videoStage: stage })[0];
      return section?.type === "section" && section.text?.type === "mrkdwn" ? section.text.text : "";
    };

    expect(headline("rendering")).toContain("Rendering the video");
    expect(headline("ready")).toContain("is ready");
    expect(headline("unavailable")).toContain("Couldn’t render");
  });

  it("shows an argument-free final build trace and retrieved skill context", () => {
    const blocks = resultBlocks({
      jobId: "job-1",
      title: "Relay",
      outline: "1. hook",
      lint: "lint: clean",
      videoStage: "ready",
      usedMcp: true,
      provider: "claude-code-cli",
      toolCalls: [
        { tool: "submit_plan", status: "succeeded", durationMs: 42 },
        { tool: "render", status: "fallback", durationMs: 81 },
      ],
      skillsUsed: ["hyperframes", "product-launch-video"],
    });
    const text = JSON.stringify(blocks);

    expect(text).toContain("Build trace");
    expect(text).toContain("`submit_plan` ✓ 42ms");
    expect(text).toContain("`render` ↪ local fallback 81ms");
    expect(text).toContain("Agent context");
    expect(text).toContain("`/product-launch-video`");
    expect(text).toContain("Reply in this thread to revise");
  });

  it("renders incremental thinking-step states", () => {
    const text = JSON.stringify(thinkingStepsBlocks("Relay", [
      { tool: "submit_plan", state: "succeeded", durationMs: 42 },
      { tool: "render_preview", state: "fallback", durationMs: 81 },
      { tool: "render", state: "running", quality: "high" },
    ]));

    expect(text).toContain("Thinking steps for");
    expect(text).toContain("`submit_plan`");
    expect(text).toContain("local fallback");
    expect(text).toContain("Render video (high)");
  });
});
