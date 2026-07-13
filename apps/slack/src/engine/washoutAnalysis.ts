/**
 * Pure screenshot-pixel evidence for high-key composition washout.
 *
 * WCAG text contrast answers whether one glyph is readable. This analysis asks
 * the wider art-direction question: is the frame's dominant field compressed
 * into a pale value band, and does the declared focal fail to separate from
 * that field? It consumes decoded RGBA pixels plus a screenshot-space focal
 * rectangle; browser capture/DOM lookup deliberately stay outside this module.
 */

export const COMPOSITION_WASHED_OUT_CODE = "composition_washed_out" as const;
export const WASHOUT_HISTOGRAM_BIN_COUNT = 64;

export interface CompositionWashoutThresholdsV1 {
  /** Median WCAG relative luminance required for a high-key field. */
  fieldMedianLuminanceMin: number;
  /** Pixel luminance counted as part of the dominant near-white band. */
  nearWhiteLuminanceMin: number;
  /** Minimum fraction of field pixels in that band. */
  nearWhiteFractionMin: number;
  /** Maximum field interquartile luminance range (p75 - p25). */
  fieldCoreDynamicRangeMax: number;
  /** Maximum contrast between mean focal and field luminance. */
  focalFieldContrastMax: number;
}

/**
 * Advisory-first calibration from the 2026-07-10 light-treatment corpus.
 * LedgerFlow/Threadline measured field medians of ~0.76-0.86, core ranges of
 * ~0.01-0.08, and focal/field contrast of ~1.03-1.25:1. Dark and golden frames
 * fail the high-key predicate before separation is considered.
 */
export const COMPOSITION_WASHOUT_THRESHOLDS: Readonly<CompositionWashoutThresholdsV1> =
  Object.freeze({
    fieldMedianLuminanceMin: 0.74,
    nearWhiteLuminanceMin: 0.68,
    nearWhiteFractionMin: 0.72,
    fieldCoreDynamicRangeMax: 0.12,
    focalFieldContrastMax: 1.3,
  });

export interface ScreenshotPixelRectV1 {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CompositionWashoutInputV1 {
  width: number;
  height: number;
  /** Row-major RGBA bytes. Non-opaque pixels are composited over white. */
  data: ArrayLike<number>;
  /** Screenshot-pixel coordinates, normally a scaled DOM focal rect. */
  focalRect: ScreenshotPixelRectV1;
  time?: number;
  sceneId?: string;
  focalPart?: string;
}

export interface LuminanceHistogramEvidenceV1 {
  pixelCount: number;
  /** 64 equal-width bins over WCAG relative luminance [0, 1]. */
  histogram: number[];
  mean: number;
  p05: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  /** Broad p95-p05 value range, retained as a diagnostic. */
  dynamicRange: number;
  /** Robust p75-p25 range used by the calibrated washout decision. */
  coreDynamicRange: number;
  nearWhiteFraction: number;
}

export interface CompositionWashoutEvidenceV1 {
  version: 1;
  advisory: true;
  code: typeof COMPOSITION_WASHED_OUT_CODE;
  measured: boolean;
  washedOut: boolean;
  frame: { width: number; height: number; pixelCount: number };
  focalRect: ScreenshotPixelRectV1;
  context?: { time?: number; sceneId?: string; focalPart?: string };
  field: LuminanceHistogramEvidenceV1;
  focal: LuminanceHistogramEvidenceV1;
  separation: {
    meanLuminanceDelta: number;
    medianLuminanceDelta: number;
    meanContrastRatio: number;
    medianContrastRatio: number;
  };
  thresholds: CompositionWashoutThresholdsV1;
  checks: {
    highKeyField: boolean;
    narrowFieldRange: boolean;
    lowFocalSeparation: boolean;
  };
  /** Present only when one region is too small for a stable comparison. */
  unmeasuredReason?: "insufficient_focal_pixels" | "insufficient_field_pixels";
}

export interface CompositionWashedOutFindingV1 {
  code: typeof COMPOSITION_WASHED_OUT_CODE;
  advisory: true;
  time: number;
  sceneId?: string;
  focalPart?: string;
  message: string;
  fixHint: string;
}

export interface CompositionWashoutAnalysisV1 {
  evidence: CompositionWashoutEvidenceV1;
  finding?: CompositionWashedOutFindingV1;
}

interface HistogramAccumulator {
  count: number;
  sum: number;
  nearWhiteCount: number;
  histogram: number[];
}

const SRGB_TO_LINEAR = Array.from({ length: 256 }, (_, value) => {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
});

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizedRect(
  rect: ScreenshotPixelRectV1,
  width: number,
  height: number,
): ScreenshotPixelRectV1 {
  const rawLeft = finiteOr(rect.left, 0);
  const rawRight = finiteOr(rect.right, 0);
  const rawTop = finiteOr(rect.top, 0);
  const rawBottom = finiteOr(rect.bottom, 0);
  return {
    left: round(clamp(Math.min(rawLeft, rawRight), 0, width), 3),
    top: round(clamp(Math.min(rawTop, rawBottom), 0, height), 3),
    right: round(clamp(Math.max(rawLeft, rawRight), 0, width), 3),
    bottom: round(clamp(Math.max(rawTop, rawBottom), 0, height), 3),
  };
}

function byte(value: number | undefined): number {
  return Math.round(clamp(Number.isFinite(value) ? value! : 0, 0, 255));
}

function relativeLuminance(data: ArrayLike<number>, offset: number): number {
  const alphaByte = byte(data[offset + 3]);
  const alpha = alphaByte / 255;
  const composite = (channel: number | undefined): number =>
    alphaByte === 255 ? byte(channel) : Math.round(byte(channel) * alpha + 255 * (1 - alpha));
  const red = SRGB_TO_LINEAR[composite(data[offset])]!;
  const green = SRGB_TO_LINEAR[composite(data[offset + 1])]!;
  const blue = SRGB_TO_LINEAR[composite(data[offset + 2])]!;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function accumulator(): HistogramAccumulator {
  return {
    count: 0,
    sum: 0,
    nearWhiteCount: 0,
    histogram: Array.from({ length: WASHOUT_HISTOGRAM_BIN_COUNT }, () => 0),
  };
}

function addLuminance(target: HistogramAccumulator, luminance: number): void {
  target.count += 1;
  target.sum += luminance;
  if (luminance >= COMPOSITION_WASHOUT_THRESHOLDS.nearWhiteLuminanceMin) {
    target.nearWhiteCount += 1;
  }
  const bin = Math.min(
    WASHOUT_HISTOGRAM_BIN_COUNT - 1,
    Math.floor(clamp(luminance, 0, 1) * WASHOUT_HISTOGRAM_BIN_COUNT),
  );
  target.histogram[bin] = (target.histogram[bin] ?? 0) + 1;
}

function histogramPercentile(target: HistogramAccumulator, fraction: number): number {
  if (target.count === 0) return 0;
  const rank = Math.floor((target.count - 1) * clamp(fraction, 0, 1));
  let cumulative = 0;
  for (let bin = 0; bin < target.histogram.length; bin += 1) {
    cumulative += target.histogram[bin] ?? 0;
    if (cumulative > rank) return (bin + 0.5) / WASHOUT_HISTOGRAM_BIN_COUNT;
  }
  return 1;
}

function finishHistogram(target: HistogramAccumulator): LuminanceHistogramEvidenceV1 {
  const p05 = histogramPercentile(target, 0.05);
  const p25 = histogramPercentile(target, 0.25);
  const p50 = histogramPercentile(target, 0.5);
  const p75 = histogramPercentile(target, 0.75);
  const p95 = histogramPercentile(target, 0.95);
  return {
    pixelCount: target.count,
    histogram: target.histogram,
    mean: round(target.count ? target.sum / target.count : 0),
    p05: round(p05),
    p25: round(p25),
    p50: round(p50),
    p75: round(p75),
    p95: round(p95),
    dynamicRange: round(p95 - p05),
    coreDynamicRange: round(p75 - p25),
    nearWhiteFraction: round(target.count ? target.nearWhiteCount / target.count : 0),
  };
}

function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Build advisory evidence and, only when every calibrated predicate agrees, a
 * single `composition_washed_out` finding. High-key, low-range, and weak focal
 * separation are conjunctive so clean white fields with a decisive dark focal
 * remain valid.
 */
export function analyzeCompositionWashout(
  input: CompositionWashoutInputV1,
): CompositionWashoutAnalysisV1 {
  if (!Number.isInteger(input.width) || input.width <= 0 ||
      !Number.isInteger(input.height) || input.height <= 0) {
    throw new RangeError("washout analysis requires positive integer width and height");
  }
  const expectedBytes = input.width * input.height * 4;
  if (!Number.isFinite(input.data.length) || input.data.length < expectedBytes) {
    throw new RangeError(`washout RGBA buffer needs at least ${expectedBytes} bytes`);
  }

  const focalRect = normalizedRect(input.focalRect, input.width, input.height);
  const fieldAccumulator = accumulator();
  const focalAccumulator = accumulator();
  for (let y = 0; y < input.height; y += 1) {
    for (let x = 0; x < input.width; x += 1) {
      const luminance = relativeLuminance(input.data, (y * input.width + x) * 4);
      const insideFocal = x + 0.5 >= focalRect.left && x + 0.5 < focalRect.right &&
        y + 0.5 >= focalRect.top && y + 0.5 < focalRect.bottom;
      addLuminance(insideFocal ? focalAccumulator : fieldAccumulator, luminance);
    }
  }

  const field = finishHistogram(fieldAccumulator);
  const focal = finishHistogram(focalAccumulator);
  const totalPixels = input.width * input.height;
  const minimumFocalPixels = Math.max(4, Math.ceil(totalPixels * 0.001));
  const minimumFieldPixels = Math.max(16, Math.ceil(totalPixels * 0.05));
  const unmeasuredReason = focal.pixelCount < minimumFocalPixels
    ? "insufficient_focal_pixels" as const
    : field.pixelCount < minimumFieldPixels
    ? "insufficient_field_pixels" as const
    : undefined;
  const measured = unmeasuredReason === undefined;
  const separation = {
    meanLuminanceDelta: round(Math.abs(field.mean - focal.mean)),
    medianLuminanceDelta: round(Math.abs(field.p50 - focal.p50)),
    meanContrastRatio: round(contrastRatio(field.mean, focal.mean)),
    medianContrastRatio: round(contrastRatio(field.p50, focal.p50)),
  };
  const checks = {
    highKeyField: measured &&
      field.p50 >= COMPOSITION_WASHOUT_THRESHOLDS.fieldMedianLuminanceMin &&
      field.nearWhiteFraction >= COMPOSITION_WASHOUT_THRESHOLDS.nearWhiteFractionMin,
    narrowFieldRange: measured &&
      field.coreDynamicRange <= COMPOSITION_WASHOUT_THRESHOLDS.fieldCoreDynamicRangeMax,
    lowFocalSeparation: measured &&
      separation.meanContrastRatio <= COMPOSITION_WASHOUT_THRESHOLDS.focalFieldContrastMax,
  };
  const washedOut = checks.highKeyField && checks.narrowFieldRange && checks.lowFocalSeparation;
  const context = input.time !== undefined || input.sceneId || input.focalPart
    ? {
        ...(input.time !== undefined ? { time: input.time } : {}),
        ...(input.sceneId ? { sceneId: input.sceneId } : {}),
        ...(input.focalPart ? { focalPart: input.focalPart } : {}),
      }
    : undefined;
  const evidence: CompositionWashoutEvidenceV1 = {
    version: 1,
    advisory: true,
    code: COMPOSITION_WASHED_OUT_CODE,
    measured,
    washedOut,
    frame: { width: input.width, height: input.height, pixelCount: totalPixels },
    focalRect,
    ...(context ? { context } : {}),
    field,
    focal,
    separation,
    thresholds: { ...COMPOSITION_WASHOUT_THRESHOLDS },
    checks,
    ...(unmeasuredReason ? { unmeasuredReason } : {}),
  };
  if (!washedOut) return { evidence };

  return {
    evidence,
    finding: {
      code: COMPOSITION_WASHED_OUT_CODE,
      advisory: true,
      time: Number.isFinite(input.time) ? input.time! : 0,
      ...(input.sceneId ? { sceneId: input.sceneId } : {}),
      ...(input.focalPart ? { focalPart: input.focalPart } : {}),
      message:
        `The rendered field is high-key and compressed (median ${(field.p50 * 100).toFixed(1)}%, ` +
        `core range ${(field.coreDynamicRange * 100).toFixed(1)}%, ` +
        `${(field.nearWhiteFraction * 100).toFixed(1)}% near-white), while focal/field ` +
        `separation is only ${separation.meanContrastRatio.toFixed(2)}:1.`,
      fixHint:
        "Choose the denser light-treatment dialect or deepen the existing field/surface value " +
        "roles around the focal. Preserve the committed hue family and readable text; do not " +
        "solve this with a whole-frame dark overlay.",
    },
  };
}
