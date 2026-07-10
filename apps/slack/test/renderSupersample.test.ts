import { afterEach, describe, expect, it } from "vitest";
import {
  renderProducerOverrides,
  resolveSupersamplePlan,
  supersampleJobFields,
} from "../src/engine/render.ts";

const FLAG = "SLACK_SEQUENCES_RENDER_SUPERSAMPLE";
const saved = process.env[FLAG];

afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

describe("supersampled render gate (probe-audit render shakiness)", () => {
  it("probes native GPU acceleration and lets compatibility hints own capture mode", () => {
    expect(renderProducerOverrides("C:/chrome.exe")).toEqual({
      browserGpuMode: "auto",
      forceScreenshot: false,
      chromePath: "C:/chrome.exe",
    });
  });

  it("engages for the HD tier on the three canonical canvases", () => {
    delete process.env[FLAG];
    expect(resolveSupersamplePlan(1920, 1080, "high")).toEqual({
      outputResolution: "landscape-4k",
      width: 1920,
      height: 1080,
    });
    expect(resolveSupersamplePlan(1080, 1920, "high")?.outputResolution).toBe("portrait-4k");
    expect(resolveSupersamplePlan(1080, 1080, "high")?.outputResolution).toBe("square-4k");
  });

  it("stays off for draft/standard tiers by default (Railway memory)", () => {
    delete process.env[FLAG];
    expect(resolveSupersamplePlan(1920, 1080, "draft")).toBeUndefined();
    expect(resolveSupersamplePlan(1920, 1080, "standard")).toBeUndefined();
  });

  it("SLACK_SEQUENCES_RENDER_SUPERSAMPLE=1 forces every tier; =0 disables everywhere", () => {
    process.env[FLAG] = "1";
    expect(resolveSupersamplePlan(1920, 1080, "draft")).toBeDefined();
    process.env[FLAG] = "0";
    expect(resolveSupersamplePlan(1920, 1080, "high")).toBeUndefined();
  });

  it("declines non-canonical dimensions (no integer 2× resolution exists)", () => {
    delete process.env[FLAG];
    expect(resolveSupersamplePlan(1280, 720, "high")).toBeUndefined();
  });

  it("the master job forces SDR (the producer rejects HDR + outputResolution)", () => {
    const fields = supersampleJobFields({
      outputResolution: "landscape-4k",
      width: 1920,
      height: 1080,
    });
    expect(fields.outputResolution).toBe("landscape-4k");
    expect(fields.hdrMode).toBe("force-sdr");
    expect(typeof fields.crf).toBe("number");
  });
});
