import { describe, expect, it } from "vitest";
import {
  buildAssetBriefModal,
  buildCreateModal,
  buildingBlocks,
  errorBlocks,
  resultBlocks,
  storyboardReadyBlocks,
  thinkingStepsBlocks,
} from "../src/blocks.ts";

describe("Slack blocks", () => {
  it("keeps the launch modal aligned with the current short-commercial workflow", () => {
    const modal = buildCreateModal({ channel: "C123" });
    const length = modal.blocks?.find((block) => "block_id" in block && block.block_id === "length");
    const product = modal.blocks?.find((block) => "block_id" in block && block.block_id === "product");
    const whatShipped = modal.blocks?.find(
      (block) => "block_id" in block && block.block_id === "what_shipped",
    );
    const serialized = JSON.stringify(modal);

    expect(modal.callback_id).toBe("create_video");
    expect(length).toMatchObject({
      element: {
        initial_option: { value: "15" },
        options: expect.arrayContaining([
          expect.objectContaining({ value: "15" }),
          expect.objectContaining({ value: "30" }),
        ]),
      },
    });
    expect(product).not.toHaveProperty("element.initial_value");
    expect(whatShipped).not.toHaveProperty("element.initial_value");
    expect(serialized).toContain("permission-scoped Slack context");
    expect(serialized).toContain("Trusted facts, CTA, or constraints");
  });

  it("preserves shortcut prefills without emitting empty initial values", () => {
    const modal = buildCreateModal({
      channel: "C123",
      product: "Sequences",
      whatShipped: "Launch briefs now return an MP4 in Slack.",
    });

    expect(JSON.stringify(modal)).toContain('"initial_value":"Sequences"');
    expect(JSON.stringify(modal)).toContain('"initial_value":"Launch briefs now return an MP4 in Slack."');
    expect(JSON.stringify(buildCreateModal({ channel: "C123" }))).not.toContain('"initial_value":""');
  });

  it("keeps the asset intake modal valid and documents the canonical assets command", () => {
    const modal = buildAssetBriefModal({ channel: "C123", userId: "U123", teamId: "T123" });
    const images = modal.blocks?.find((block) => "block_id" in block && block.block_id === "images");

    expect(modal.callback_id).toBe("asset_brief");
    expect(images).toMatchObject({
      type: "input",
      element: {
        type: "file_input",
        action_id: "value",
        filetypes: ["png", "jpg", "jpeg", "webp"],
        max_files: 5,
      },
    });
    expect(JSON.stringify(modal)).toContain("/sequences assets clear");
  });

  it("escapes user-controlled mrkdwn in titles", () => {
    const [block] = buildingBlocks("<!channel>");
    expect(block).toMatchObject({
      text: { text: expect.stringContaining("&lt;!channel&gt;") },
    });
  });

  it("uses a non-rendering marker above storyboard uploads", () => {
    const text = JSON.stringify(storyboardReadyBlocks("Relay"));
    expect(text).toContain("storyboard ready");
    expect(text).toContain("Storyboard preview below");
    expect(text).not.toContain("Rendering the video");
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
    expect(headline("unavailable")).toContain("Couldn't render");
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
    expect(text).toContain("`submit_plan` ok 42ms");
    expect(text).toContain("`render` local fallback 81ms");
    expect(text).toContain("Agent context");
    expect(text).toContain("`/product-launch-video`");
    expect(text).toContain("Reply in this thread to revise");
    expect(text).toContain("job `job-1`");
  });

  it("includes the forensic job id in fallback and error messages", () => {
    const fallback = JSON.stringify(resultBlocks({
      jobId: "job-fallback-1",
      title: "Relay",
      outline: "1. proof",
      lint: "lint: clean",
      videoStage: "ready",
      usedMcp: false,
      provider: "Luna",
      fallback: { stage: "luna-repair", reason: "timeline_contract: exact timeline absent" },
      canRetryCreate: true,
    }));
    expect(fallback).toContain("Safe fallback");
    expect(fallback).toContain("job-fallback-1");
    expect(fallback).toContain("timeline_contract: exact timeline absent");
    expect(fallback).toContain("Retry Luna create");
    expect(fallback).toContain("retry_create");
    expect(fallback).toContain("revise the published proof film");
    expect(fallback).not.toContain("reply here to retry");
    const fallbackWithoutSavedBrief = JSON.stringify(resultBlocks({
      jobId: "job-old-fallback",
      title: "Relay",
      outline: "1. proof",
      lint: "lint: clean",
      videoStage: "ready",
      usedMcp: false,
      provider: "Luna",
      fallback: { stage: "luna-repair" },
    }));
    expect(fallbackWithoutSavedBrief).toContain("Run `/sequences` for a fresh model-authored attempt");
    expect(fallbackWithoutSavedBrief).not.toContain("retry_create");
    expect(JSON.stringify(errorBlocks("Relay", "worker unreachable", "job-error-1")))
      .toContain("job-error-1");
  });

  it("offers a fresh-create retry only when a failed job saved its brief", () => {
    const retryable = JSON.stringify(errorBlocks(
      "Relay",
      "worker unreachable",
      "job-error-1",
      { retryCreate: true },
    ));
    const oldJob = JSON.stringify(errorBlocks("Relay", "worker unreachable", "job-old-1"));

    expect(retryable).toContain("Nothing was published");
    expect(retryable).toContain("fresh Luna build from the saved brief");
    expect(retryable).toContain('"action_id":"retry_create"');
    expect(oldJob).not.toContain("retry_create");
    expect(oldJob).toContain("run `/sequences` again");
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

  it("labels a rejected tool step as failed instead of unavailable", () => {
    const text = JSON.stringify(thinkingStepsBlocks("Relay", [
      { tool: "submit_composition", state: "failed", durationMs: 42 },
    ]));
    expect(text).toContain("failed");
    expect(text).not.toContain("unavailable");
  });

  it("appends the ETA countdown line to thinking steps when provided", () => {
    const withEta = JSON.stringify(thinkingStepsBlocks("Relay", [
      { tool: "submit_plan", state: "running" },
    ], "~45s remaining"));
    const withoutEta = JSON.stringify(thinkingStepsBlocks("Relay", [
      { tool: "submit_plan", state: "running" },
    ]));

    expect(withEta).toContain("~45s remaining");
    expect(withoutEta).not.toContain("remaining");
  });

  it("shows the model-stage receipt trail only when debug receipts are passed", () => {
    const base = {
      jobId: "job-1",
      title: "Relay",
      outline: "1. hook",
      lint: "lint: clean",
      videoStage: "ready" as const,
      usedMcp: false,
      provider: "openrouter-api",
    };
    const withDebug = JSON.stringify(resultBlocks({
      ...base,
      debugStages: [
        { stage: "frame-design", status: "succeeded", durationMs: 4_200 },
        { stage: "storyboard-plan", status: "succeeded", durationMs: 61_000, attempts: 2 },
        { stage: "source-author", status: "failed", durationMs: 12_000, attempts: 3 },
      ],
    }));
    const withoutDebug = JSON.stringify(resultBlocks(base));

    expect(withDebug).toContain("Debug — model stage receipts");
    expect(withDebug).toContain("`storyboard-plan` · 2 attempts · 61s");
    expect(withDebug).toContain(":x: `source-author` · 3 attempts · 12s");
    // Clean first passes show no attempt count noise.
    expect(withDebug).toContain("`frame-design` · 4.2s");
    expect(withoutDebug).not.toContain("Debug — model stage receipts");
  });

  it("shows a render countdown on the rendering headline when provided", () => {
    const section = resultBlocks({
      jobId: "job-1",
      title: "Relay",
      outline: "1. hook",
      lint: "lint: clean",
      videoStage: "rendering",
      usedMcp: false,
      provider: "openrouter-api",
      renderEtaLabel: "~60s remaining",
    })[0];
    const text = section?.type === "section" && section.text?.type === "mrkdwn" ? section.text.text : "";
    expect(text).toContain("Rendering the video... (~60s remaining)");
  });
});
