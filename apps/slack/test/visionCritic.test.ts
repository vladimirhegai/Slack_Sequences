import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DirectBrowserQaResult } from "../src/engine/layoutInspector.ts";
import {
  cleanCriticSkipAllowed,
  visionCriticEnabled,
  visionCriticImages,
  visionCriticPromptLines,
  visionCriticReviewInputs,
} from "../src/engine/runner/visionCritic.ts";
import {
  ANTHROPIC_VISION_CRITIC_MODEL,
  OPENAI_VISION_CRITIC_MODEL,
  OPENROUTER_VISION_CRITIC_MODEL,
  visionCriticModelRoute,
} from "../src/engine/modelPolicy.ts";

const digest = (base64: string): string => createHash("sha256")
  .update(Buffer.from(base64, "base64"))
  .digest("hex");

const roots: string[] = [];

const qa = (blocking = true): DirectBrowserQaResult => ({
  ok: true,
  strictOk: false,
  samples: [],
  issues: [],
  errors: [],
  warnings: [],
  visionCriticEvidence: {
    version: 1,
    draftHash: "draft",
    evidenceHash: "evidence",
    stripPngBase64: "strip",
    stripSha256: digest("strip"),
    stripPath: "build/qa/temporal/strip.png",
    manifestPath: "build/qa/critic/evidence.json",
    ...(blocking ? { blockingPngBase64: "blocking" } : {}),
    ...(blocking ? { blockingSha256: digest("blocking") } : {}),
    ...(blocking ? { blockingPath: "build/qa/temporal/blocking.png" } : {}),
    stripTimes: [1],
    blockingTimes: blocking ? [1.2] : [],
  },
});

const qaWithImmutableFiles = (blocking = true): DirectBrowserQaResult => {
  const result = qa(blocking);
  const evidence = result.visionCriticEvidence!;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vision-critic-files-"));
  roots.push(root);
  const generation = path.join(root, "build", "qa", "critic", "evidence");
  fs.mkdirSync(generation, { recursive: true });
  evidence.stripPath = path.join(generation, "strip.png");
  evidence.manifestPath = path.join(generation, "evidence.json");
  fs.writeFileSync(evidence.stripPath, Buffer.from(evidence.stripPngBase64, "base64"));
  if (blocking) {
    evidence.blockingPath = path.join(generation, "blocking.png");
    fs.writeFileSync(
      evidence.blockingPath,
      Buffer.from(evidence.blockingPngBase64!, "base64"),
    );
  }
  return result;
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
});

describe("WS-I vision critic evidence", () => {
  it("pins native image requests to audited multimodal models", () => {
    expect(visionCriticModelRoute({ id: "openrouter-api" })).toMatchObject({
      available: true,
      model: OPENROUTER_VISION_CRITIC_MODEL,
      thinkingMode: "minimal",
    });
    expect(visionCriticModelRoute({ id: "openai-api" })).toMatchObject({
      available: true,
      model: OPENAI_VISION_CRITIC_MODEL,
    });
    expect(visionCriticModelRoute({ id: "anthropic-api" })).toMatchObject({
      available: true,
      model: ANTHROPIC_VISION_CRITIC_MODEL,
    });
  });

  it("does not infer image capability from API transport alone", () => {
    expect(visionCriticModelRoute({ id: "deepseek-api" })).toMatchObject({
      available: false,
    });
    expect(visionCriticModelRoute({ id: "openmodel-api" })).toMatchObject({
      available: false,
    });
  });

  it("passes the strip and blocking sheet as native PNG inputs", () => {
    expect(visionCriticImages(qa())).toEqual([
      { mimeType: "image/png", base64: "strip" },
      { mimeType: "image/png", base64: "blocking" },
    ]);
    expect(visionCriticPromptLines(2).join(" ")).toContain("value hierarchy");
  });

  it("degrades to the strip and respects the independent kill switch", () => {
    expect(cleanCriticSkipAllowed()).toBe(true);
    expect(visionCriticImages(qa(false))).toHaveLength(1);
    vi.stubEnv("SLACK_SEQUENCES_VISION_CRITIC", "0");
    expect(visionCriticEnabled()).toBe(false);
    expect(cleanCriticSkipAllowed()).toBe(true);
    expect(visionCriticImages(qa())).toEqual([]);
    expect(visionCriticPromptLines(0)).toEqual([]);
  });

  it("refuses native bytes that do not match their evidence digest", () => {
    const tampered = qa();
    tampered.visionCriticEvidence!.stripSha256 = "0".repeat(64);
    expect(visionCriticImages(tampered)).toEqual([]);

    const blockingTampered = qa();
    blockingTampered.visionCriticEvidence!.blockingSha256 = "0".repeat(64);
    expect(visionCriticReviewInputs(
      { id: "openrouter-api", kind: "api" },
      blockingTampered,
    ).transport).toBe("unavailable");

    const partialBlocking = qa();
    delete partialBlocking.visionCriticEvidence!.blockingPath;
    expect(visionCriticReviewInputs(
      { id: "openrouter-api", kind: "api" },
      partialBlocking,
    ).transport).toBe("unavailable");
  });

  it("uses native API images and explicit read-only paths for capable CLIs", () => {
    const api = visionCriticReviewInputs(
      { id: "openrouter-api", kind: "api" },
      qa(),
    );
    expect(api.transport).toBe("native");
    expect(api.images).toHaveLength(2);
    const fileQa = qaWithImmutableFiles();
    const cli = visionCriticReviewInputs(
      { id: "claude-code-cli", kind: "cli" },
      fileQa,
    );
    expect(cli.transport).toBe("read-files");
    expect(cli.images).toEqual([]);
    expect(cli.promptLines.join(" "))
      .toContain(JSON.stringify(fileQa.visionCriticEvidence!.stripPath));
    expect(visionCriticReviewInputs(
      { id: "codex-cli", kind: "cli" },
      qaWithImmutableFiles(false),
    ).transport).toBe("read-files");
    expect(visionCriticReviewInputs(
      { id: "antigravity-cli", kind: "cli" },
      fileQa,
    ).transport).toBe("unavailable");
  });

  it("rejects missing or non-regular immutable PNG paths for read-files CLIs", () => {
    const missing = qaWithImmutableFiles();
    fs.rmSync(missing.visionCriticEvidence!.blockingPath!);
    expect(visionCriticReviewInputs(
      { id: "claude-code-cli", kind: "cli" },
      missing,
    ).transport).toBe("unavailable");

    const directory = qaWithImmutableFiles(false);
    fs.rmSync(directory.visionCriticEvidence!.stripPath);
    fs.mkdirSync(directory.visionCriticEvidence!.stripPath);
    expect(visionCriticReviewInputs(
      { id: "codex-cli", kind: "cli" },
      directory,
    ).transport).toBe("unavailable");
  });

  it("rejects tampered strip or optional blocking files for read-files CLIs", () => {
    const stripTampered = qaWithImmutableFiles();
    fs.writeFileSync(stripTampered.visionCriticEvidence!.stripPath, "tampered");
    expect(visionCriticReviewInputs(
      { id: "claude-code-cli", kind: "cli" },
      stripTampered,
    ).transport).toBe("unavailable");

    const blockingTampered = qaWithImmutableFiles();
    fs.writeFileSync(blockingTampered.visionCriticEvidence!.blockingPath!, "tampered");
    expect(visionCriticReviewInputs(
      { id: "codex-cli", kind: "cli" },
      blockingTampered,
    ).transport).toBe("unavailable");
  });
});
