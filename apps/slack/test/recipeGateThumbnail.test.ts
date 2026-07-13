import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { runRecipeGatePublication } from "../studio/gatePublication.ts";
import {
  analyzeRecipeThumbnailPixels,
  recipeThumbnailQualityErrors,
} from "../studio/thumbnailQuality.ts";

const WIDTH = 64;
const HEIGHT = 36;

function pixels(color: [number, number, number]): Uint8Array {
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let index = 0; index < WIDTH * HEIGHT; index += 1) {
    data[index * 4] = color[0];
    data[index * 4 + 1] = color[1];
    data[index * 4 + 2] = color[2];
    data[index * 4 + 3] = 255;
  }
  return data;
}

function fillRect(
  data: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number,
  color: [number, number, number],
): void {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      const offset = (py * WIDTH + px) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 255;
    }
  }
}

function analyze(data: Uint8Array) {
  return analyzeRecipeThumbnailPixels({ width: WIDTH, height: HEIGHT, data });
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return result;
}

/** Minimal non-interlaced RGBA encoder for file-boundary coverage. */
function encodePng(data: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines: Buffer[] = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    scanlines.push(Buffer.from([0]));
    scanlines.push(Buffer.from(data.subarray(y * WIDTH * 4, (y + 1) * WIDTH * 4)));
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(scanlines))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function treeDigest(root: string): string {
  const hash = createHash("sha256");
  const visit = (directory: string, relative: string): void => {
    if (!fs.existsSync(directory)) {
      hash.update(`missing:${relative}\0`);
      return;
    }
    hash.update(`directory:${relative}\0`);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const childRelative = path.join(relative, entry.name);
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(child, childRelative);
      else {
        const bytes = fs.readFileSync(child);
        hash.update(`file:${childRelative}:${bytes.length}\0`);
        hash.update(bytes);
      }
    }
  };
  for (const relative of ["composition", "revisions", path.join("build", "thumbs")]) {
    visit(path.join(root, relative), relative);
  }
  return hash.digest("hex");
}

describe("Recipe Studio representative-thumbnail quality gate", () => {
  it("rejects flat black and flat light captures independent of treatment", () => {
    expect(analyze(pixels([1, 1, 2])).ok).toBe(false);
    expect(analyze(pixels([242, 242, 242])).ok).toBe(false);
  });

  it("rejects a low-amplitude black gradient and a lone decorative pixel", () => {
    const gradient = pixels([3, 4, 5]);
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        const offset = (y * WIDTH + x) * 4;
        const shift = Math.floor((x / WIDTH) * 4);
        gradient[offset] = 3 + shift;
        gradient[offset + 1] = 4 + shift;
        gradient[offset + 2] = 5 + shift;
      }
    }
    expect(analyze(gradient).ok).toBe(false);

    const lonePixel = pixels([2, 3, 5]);
    fillRect(lonePixel, WIDTH - 2, 1, 1, 1, [220, 220, 220]);
    const result = analyze(lonePixel);
    expect(result.ok).toBe(false);
    expect(result.activeTileCount).toBeLessThan(2);
  });

  it("accepts a dark frame with a visibly composed card, type, and accent", () => {
    const data = pixels([5, 7, 11]);
    fillRect(data, 10, 6, 44, 25, [15, 21, 30]);
    fillRect(data, 16, 12, 27, 3, [116, 123, 132]);
    fillRect(data, 16, 18, 35, 1, [43, 51, 62]);
    fillRect(data, 16, 24, 18, 1, [174, 126, 35]);
    const result = analyze(data);
    expect(result).toMatchObject({ ok: true, activeTileTotal: 48 });
    expect(result.activeTileCount).toBeGreaterThanOrEqual(2);
  });

  it("accepts a sparse dark title card when its small lockup is legible", () => {
    const data = pixels([11, 15, 20]);
    fillRect(data, 23, 15, 18, 2, [174, 126, 35]);
    fillRect(data, 19, 19, 27, 3, [188, 194, 202]);
    const result = analyze(data);
    expect(result.ok).toBe(true);
    expect(result.contrastingSampleFraction).toBeLessThan(0.06);
  });

  it("turns missing and decoded uniform PNG evidence into gate errors", () => {
    expect(recipeThumbnailQualityErrors([])).toEqual([
      "thumbnail quality: no representative thumbnails were generated",
    ]);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-thumb-quality-"));
    try {
      const file = path.join(dir, "uniform.png");
      // File inspection exercises the exact decoder used by gateRecipe.
      fs.writeFileSync(file, encodePng(pixels([1, 1, 2])));
      const errors = recipeThumbnailQualityErrors([file]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/uniform\.png is near-blank\/near-uniform/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("restores the last green publication byte-for-byte after a thumbnail-quality red", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-gate-rollback-"));
    try {
      fs.mkdirSync(path.join(projectDir, "composition", "assets"), { recursive: true });
      fs.writeFileSync(path.join(projectDir, "composition", "index.html"), "green html\n");
      fs.writeFileSync(path.join(projectDir, "composition", "manifest.json"), "green manifest\n");
      fs.writeFileSync(path.join(projectDir, "composition", "assets", "green.bin"),
        Buffer.from([0, 1, 2, 3]));
      fs.mkdirSync(path.join(projectDir, "revisions", "0001"), { recursive: true });
      fs.writeFileSync(path.join(projectDir, "revisions", "0001", "index.html"), "green revision\n");
      fs.mkdirSync(path.join(projectDir, "build", "thumbs"), { recursive: true });
      fs.writeFileSync(path.join(projectDir, "build", "thumbs", "green.png"),
        Buffer.from([9, 8, 7]));
      const before = treeDigest(projectDir);

      const result = await runRecipeGatePublication(
        projectDir,
        async () => {
          fs.rmSync(path.join(projectDir, "composition"), { recursive: true, force: true });
          fs.mkdirSync(path.join(projectDir, "composition"), { recursive: true });
          fs.writeFileSync(path.join(projectDir, "composition", "index.html"), "red candidate\n");
          fs.mkdirSync(path.join(projectDir, "revisions", "0002"), { recursive: true });
          fs.writeFileSync(path.join(projectDir, "revisions", "0002", "index.html"), "red revision\n");
          fs.rmSync(path.join(projectDir, "build", "thumbs"), { recursive: true, force: true });
          fs.mkdirSync(path.join(projectDir, "build", "thumbs"), { recursive: true });
          fs.writeFileSync(path.join(projectDir, "build", "thumbs", "red.png"),
            Buffer.from([1, 1, 1]));
          return "red.png";
        },
        () => ["thumbnail quality: red.png is near-blank/near-uniform"],
      );

      expect(result.errors).toHaveLength(1);
      expect(treeDigest(projectDir)).toBe(before);
      expect(fs.existsSync(path.join(projectDir, "revisions", "0002"))).toBe(false);
      expect(fs.readFileSync(path.join(projectDir, "composition", "index.html"), "utf8"))
        .toBe("green html\n");
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("removes a first-ever red publication instead of leaving a preview behind", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-gate-first-red-"));
    try {
      await runRecipeGatePublication(
        projectDir,
        async () => {
          for (const relative of ["composition", path.join("revisions", "0001"), path.join("build", "thumbs")]) {
            fs.mkdirSync(path.join(projectDir, relative), { recursive: true });
          }
          fs.writeFileSync(path.join(projectDir, "composition", "index.html"), "red candidate\n");
          fs.writeFileSync(path.join(projectDir, "revisions", "0001", "index.html"), "red revision\n");
          fs.writeFileSync(path.join(projectDir, "build", "thumbs", "red.png"), "red thumbnail\n");
          return "red.png";
        },
        () => ["thumbnail quality: red.png is near-blank/near-uniform"],
      );

      expect(fs.existsSync(path.join(projectDir, "composition"))).toBe(false);
      expect(fs.existsSync(path.join(projectDir, "revisions"))).toBe(false);
      expect(fs.existsSync(path.join(projectDir, "build", "thumbs"))).toBe(false);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
