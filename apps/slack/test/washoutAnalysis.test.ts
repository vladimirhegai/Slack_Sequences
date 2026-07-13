import { describe, expect, it } from "vitest";
import {
  analyzeCompositionWashout,
  COMPOSITION_WASHED_OUT_CODE,
  COMPOSITION_WASHOUT_THRESHOLDS,
  type ScreenshotPixelRectV1,
} from "../src/engine/washoutAnalysis.ts";

function rgbaFrame(
  width: number,
  height: number,
  field: [number, number, number, number],
  focalRect: ScreenshotPixelRectV1,
  focal: [number, number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = x + 0.5 >= focalRect.left && x + 0.5 < focalRect.right &&
        y + 0.5 >= focalRect.top && y + 0.5 < focalRect.bottom;
      data.set(inside ? focal : field, (y * width + x) * 4);
    }
  }
  return data;
}

const width = 20;
const height = 12;
const focalRect = { left: 6, top: 3, right: 14, bottom: 9 };

describe("composition washout analysis", () => {
  it("emits one structured advisory for a compressed near-white frame", () => {
    const result = analyzeCompositionWashout({
      width,
      height,
      data: rgbaFrame(width, height, [235, 235, 235, 255], focalRect, [220, 220, 220, 255]),
      focalRect,
      time: 4.2,
      sceneId: "comparison",
      focalPart: "review-card",
    });

    expect(result.evidence).toMatchObject({
      version: 1,
      advisory: true,
      code: COMPOSITION_WASHED_OUT_CODE,
      measured: true,
      washedOut: true,
      frame: { width, height, pixelCount: width * height },
      context: { time: 4.2, sceneId: "comparison", focalPart: "review-card" },
      checks: {
        highKeyField: true,
        narrowFieldRange: true,
        lowFocalSeparation: true,
      },
      thresholds: COMPOSITION_WASHOUT_THRESHOLDS,
    });
    expect(result.evidence.field.pixelCount).toBe(192);
    expect(result.evidence.focal.pixelCount).toBe(48);
    expect(result.evidence.field.histogram.reduce((sum, count) => sum + count, 0)).toBe(192);
    expect(result.evidence.separation.meanContrastRatio).toBeLessThan(1.3);
    expect(result.finding).toMatchObject({
      code: "composition_washed_out",
      advisory: true,
      time: 4.2,
      sceneId: "comparison",
      focalPart: "review-card",
    });
    expect(result.finding?.message).toContain("high-key and compressed");
  });

  it("accepts a clean high-key field when the focal separates decisively", () => {
    const result = analyzeCompositionWashout({
      width,
      height,
      data: rgbaFrame(width, height, [245, 245, 245, 255], focalRect, [35, 35, 35, 255]),
      focalRect,
    });

    expect(result.evidence.checks.highKeyField).toBe(true);
    expect(result.evidence.checks.narrowFieldRange).toBe(true);
    expect(result.evidence.checks.lowFocalSeparation).toBe(false);
    expect(result.evidence.washedOut).toBe(false);
    expect(result.finding).toBeUndefined();
  });

  it("does not confuse a narrow dark treatment with near-white washout", () => {
    const result = analyzeCompositionWashout({
      width,
      height,
      data: rgbaFrame(width, height, [24, 26, 30, 255], focalRect, [34, 36, 42, 255]),
      focalRect,
    });

    expect(result.evidence.field.coreDynamicRange).toBeLessThanOrEqual(
      COMPOSITION_WASHOUT_THRESHOLDS.fieldCoreDynamicRangeMax,
    );
    expect(result.evidence.checks.highKeyField).toBe(false);
    expect(result.evidence.washedOut).toBe(false);
    expect(result.finding).toBeUndefined();
  });

  it("rejects a high-key field whose central histogram has real value range", () => {
    const data = rgbaFrame(
      width,
      height,
      [250, 250, 250, 255],
      focalRect,
      [230, 230, 230, 255],
    );
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const inside = x + 0.5 >= focalRect.left && x + 0.5 < focalRect.right &&
          y + 0.5 >= focalRect.top && y + 0.5 < focalRect.bottom;
        if (!inside && (x + y) % 2 === 0) {
          data.set([165, 165, 165, 255], (y * width + x) * 4);
        }
      }
    }
    const result = analyzeCompositionWashout({ width, height, data, focalRect });

    expect(result.evidence.field.coreDynamicRange).toBeGreaterThan(
      COMPOSITION_WASHOUT_THRESHOLDS.fieldCoreDynamicRangeMax,
    );
    expect(result.evidence.checks.narrowFieldRange).toBe(false);
    expect(result.evidence.washedOut).toBe(false);
  });

  it("keeps minority shadow tails diagnostic without letting them hide a pale dominant band", () => {
    const data = rgbaFrame(
      width,
      height,
      [235, 235, 235, 255],
      focalRect,
      [245, 245, 245, 255],
    );
    let fieldIndex = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const inside = x + 0.5 >= focalRect.left && x + 0.5 < focalRect.right &&
          y + 0.5 >= focalRect.top && y + 0.5 < focalRect.bottom;
        if (!inside && fieldIndex++ % 7 === 0) {
          data.set([105, 105, 105, 255], (y * width + x) * 4);
        }
      }
    }
    const result = analyzeCompositionWashout({ width, height, data, focalRect });

    expect(result.evidence.field.dynamicRange).toBeGreaterThan(0.5);
    expect(result.evidence.field.coreDynamicRange).toBeLessThanOrEqual(0.02);
    expect(result.evidence.washedOut).toBe(true);
  });

  it("returns unmeasured evidence when the focal leaves no stable field sample", () => {
    const fullFrame = { left: 0, top: 0, right: width, bottom: height };
    const result = analyzeCompositionWashout({
      width,
      height,
      data: rgbaFrame(width, height, [240, 240, 240, 255], fullFrame, [230, 230, 230, 255]),
      focalRect: fullFrame,
    });

    expect(result.evidence).toMatchObject({
      measured: false,
      washedOut: false,
      unmeasuredReason: "insufficient_field_pixels",
    });
    expect(result.finding).toBeUndefined();
  });

  it("rejects malformed RGBA buffers instead of manufacturing evidence", () => {
    expect(() => analyzeCompositionWashout({
      width: 4,
      height: 4,
      data: new Uint8Array(8),
      focalRect: { left: 1, top: 1, right: 3, bottom: 3 },
    })).toThrow(/needs at least 64 bytes/);
  });
});
