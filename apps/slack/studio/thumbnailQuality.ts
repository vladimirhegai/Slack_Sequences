import fs from "node:fs";
import path from "node:path";
import { decodePng } from "@hyperframes/engine/alpha-blit";

const SAMPLE_COLUMNS = 64;
const SAMPLE_ROWS = 36;
const TILE_COLUMNS = 8;
const TILE_ROWS = 6;

/**
 * Recipe thumbnails are review evidence, so merely writing a PNG is not a
 * successful gate. These deliberately low floors reject a flat/near-black
 * capture while preserving sparse dark title cards with a small but legible
 * lockup. The signals are brightness-independent: structure, not a light
 * treatment, is required.
 */
export const RECIPE_THUMBNAIL_QUALITY_FLOORS = {
  luminanceStdDev: 3.5,
  contrastingSampleFraction: 0.003,
  edgePairFraction: 0.004,
  activeTileCount: 2,
  contrastDistance: 30,
  edgeDistance: 24,
  activeTileLuminanceRange: 18,
  activeTileColorDistance: 45,
} as const;

export interface RecipeThumbnailPixels {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface RecipeThumbnailQuality {
  ok: boolean;
  sampleCount: number;
  luminanceMean: number;
  luminanceStdDev: number;
  contrastingSampleFraction: number;
  edgePairFraction: number;
  activeTileCount: number;
  activeTileTotal: number;
}

interface Sample {
  r: number;
  g: number;
  b: number;
  luminance: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function colorDistance(a: Sample, b: Pick<Sample, "r" | "g" | "b">): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

/** Analyze a bounded grid of pixels; full-resolution images never increase work. */
export function analyzeRecipeThumbnailPixels(
  image: RecipeThumbnailPixels,
): RecipeThumbnailQuality {
  if (
    !Number.isInteger(image.width) || image.width <= 0 ||
    !Number.isInteger(image.height) || image.height <= 0 ||
    image.data.length < image.width * image.height * 4
  ) {
    throw new Error("invalid RGBA thumbnail pixels");
  }
  const columns = Math.min(SAMPLE_COLUMNS, image.width);
  const rows = Math.min(SAMPLE_ROWS, image.height);
  const samples: Sample[] = [];
  for (let sampleY = 0; sampleY < rows; sampleY += 1) {
    const y = Math.min(
      image.height - 1,
      Math.floor(((sampleY + 0.5) * image.height) / rows),
    );
    for (let sampleX = 0; sampleX < columns; sampleX += 1) {
      const x = Math.min(
        image.width - 1,
        Math.floor(((sampleX + 0.5) * image.width) / columns),
      );
      const offset = (y * image.width + x) * 4;
      const alpha = image.data[offset + 3]! / 255;
      const r = Math.round(image.data[offset]! * alpha);
      const g = Math.round(image.data[offset + 1]! * alpha);
      const b = Math.round(image.data[offset + 2]! * alpha);
      samples.push({
        r,
        g,
        b,
        // Integer Rec. 709 approximation in display-byte space. Exact color
        // science is unnecessary here; only within-thumbnail variation matters.
        luminance: (54 * r + 183 * g + 19 * b) / 256,
      });
    }
  }

  const luminanceMean = samples.reduce((sum, sample) => sum + sample.luminance, 0) /
    samples.length;
  const luminanceStdDev = Math.sqrt(
    samples.reduce(
      (sum, sample) => sum + (sample.luminance - luminanceMean) ** 2,
      0,
    ) / samples.length,
  );
  const background = {
    r: median(samples.map((sample) => sample.r)),
    g: median(samples.map((sample) => sample.g)),
    b: median(samples.map((sample) => sample.b)),
  };
  const contrastingSampleCount = samples.filter(
    (sample) => colorDistance(sample, background) >=
      RECIPE_THUMBNAIL_QUALITY_FLOORS.contrastDistance,
  ).length;

  let edgePairs = 0;
  let edgePairCount = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const index = y * columns + x;
      for (const neighbor of [x > 0 ? index - 1 : -1, y > 0 ? index - columns : -1]) {
        if (neighbor < 0) continue;
        edgePairCount += 1;
        if (
          colorDistance(samples[index]!, samples[neighbor]!) >=
            RECIPE_THUMBNAIL_QUALITY_FLOORS.edgeDistance
        ) {
          edgePairs += 1;
        }
      }
    }
  }

  let activeTileCount = 0;
  const tileColumns = Math.min(TILE_COLUMNS, columns);
  const tileRows = Math.min(TILE_ROWS, rows);
  for (let tileY = 0; tileY < tileRows; tileY += 1) {
    const startY = Math.floor((tileY * rows) / tileRows);
    const endY = Math.max(startY + 1, Math.floor(((tileY + 1) * rows) / tileRows));
    for (let tileX = 0; tileX < tileColumns; tileX += 1) {
      const startX = Math.floor((tileX * columns) / tileColumns);
      const endX = Math.max(
        startX + 1,
        Math.floor(((tileX + 1) * columns) / tileColumns),
      );
      let minLuminance = Number.POSITIVE_INFINITY;
      let maxLuminance = Number.NEGATIVE_INFINITY;
      let maxBackgroundDistance = 0;
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const sample = samples[y * columns + x]!;
          minLuminance = Math.min(minLuminance, sample.luminance);
          maxLuminance = Math.max(maxLuminance, sample.luminance);
          maxBackgroundDistance = Math.max(
            maxBackgroundDistance,
            colorDistance(sample, background),
          );
        }
      }
      if (
        maxLuminance - minLuminance >=
          RECIPE_THUMBNAIL_QUALITY_FLOORS.activeTileLuminanceRange ||
        maxBackgroundDistance >=
          RECIPE_THUMBNAIL_QUALITY_FLOORS.activeTileColorDistance
      ) {
        activeTileCount += 1;
      }
    }
  }

  const contrastingSampleFraction = contrastingSampleCount / samples.length;
  const edgePairFraction = edgePairCount ? edgePairs / edgePairCount : 0;
  const activeTileTotal = tileColumns * tileRows;
  return {
    ok:
      luminanceStdDev >= RECIPE_THUMBNAIL_QUALITY_FLOORS.luminanceStdDev &&
      contrastingSampleFraction >=
        RECIPE_THUMBNAIL_QUALITY_FLOORS.contrastingSampleFraction &&
      edgePairFraction >= RECIPE_THUMBNAIL_QUALITY_FLOORS.edgePairFraction &&
      activeTileCount >= Math.min(
        RECIPE_THUMBNAIL_QUALITY_FLOORS.activeTileCount,
        activeTileTotal,
      ),
    sampleCount: samples.length,
    luminanceMean,
    luminanceStdDev,
    contrastingSampleFraction,
    edgePairFraction,
    activeTileCount,
    activeTileTotal,
  };
}

export function inspectRecipeThumbnail(file: string): RecipeThumbnailQuality {
  return analyzeRecipeThumbnailPixels(decodePng(fs.readFileSync(file)));
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/** Return gate-ready errors while preserving every PNG for red-gate inspection. */
export function recipeThumbnailQualityErrors(files: string[]): string[] {
  if (!files.length) {
    return ["thumbnail quality: no representative thumbnails were generated"];
  }
  const errors: string[] = [];
  for (const file of files) {
    try {
      const quality = inspectRecipeThumbnail(file);
      if (quality.ok) continue;
      errors.push(
        `thumbnail quality: ${path.basename(file)} is near-blank/near-uniform ` +
          `(luma stddev ${quality.luminanceStdDev.toFixed(2)}, contrast ` +
          `${percent(quality.contrastingSampleFraction)}, edges ` +
          `${percent(quality.edgePairFraction)}, active tiles ` +
          `${quality.activeTileCount}/${quality.activeTileTotal})`,
      );
    } catch (error) {
      errors.push(
        `thumbnail quality: ${path.basename(file)} could not be inspected ` +
          `(${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
  return errors;
}
