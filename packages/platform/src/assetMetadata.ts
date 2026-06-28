import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { Asset } from "@sequences/core";

export function sha256File(file: string): string {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

export function contentAssetId(contentHash: string): string {
  return `asset-${contentHash.slice(0, 16)}`;
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
};

function pngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buffer[offset + 1]!;
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) break;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function svgMetadata(text: string): {
  width?: number;
  height?: number;
  dominantColors: string[];
  ocrText?: string;
} {
  const svg = text.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const width = Number(svg.match(/\bwidth=["']?([\d.]+)/i)?.[1]);
  const height = Number(svg.match(/\bheight=["']?([\d.]+)/i)?.[1]);
  const viewBox = svg.match(/\bviewBox=["']([^"']+)/i)?.[1]?.trim().split(/\s+/).map(Number);
  const colors = [
    ...text.matchAll(/(?:fill|stroke)=["'](#[0-9a-f]{6})["']/gi),
    ...text.matchAll(/(?:fill|stroke)\s*:\s*(#[0-9a-f]{6})/gi),
  ].map((match) => match[1]!.toUpperCase());
  const words = [...text.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)]
    .map((match) => match[1]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
  return {
    ...(Number.isFinite(width) && width > 0
      ? { width: Math.round(width) }
      : viewBox?.[2] && viewBox[2] > 0
        ? { width: Math.round(viewBox[2]) }
        : {}),
    ...(Number.isFinite(height) && height > 0
      ? { height: Math.round(height) }
      : viewBox?.[3] && viewBox[3] > 0
        ? { height: Math.round(viewBox[3]) }
        : {}),
    dominantColors: [...new Set(colors)].slice(0, 8),
    ...(words ? { ocrText: words.slice(0, 4000) } : {}),
  };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Lightweight PNG sampler for RGB/RGBA, 8-bit, non-interlaced screenshots. */
function pngDominantColors(buffer: Buffer): string[] {
  try {
    if (buffer.readUInt8(24) !== 8 || ![2, 6].includes(buffer.readUInt8(25)) || buffer.readUInt8(28) !== 0) {
      return [];
    }
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    const channels = buffer.readUInt8(25) === 6 ? 4 : 3;
    const chunks: Buffer[] = [];
    let offset = 8;
    while (offset + 12 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.toString("ascii", offset + 4, offset + 8);
      if (type === "IDAT") chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
      offset += 12 + length;
      if (type === "IEND") break;
    }
    const raw = zlib.inflateSync(Buffer.concat(chunks));
    const stride = width * channels;
    const rows: Buffer[] = [];
    let cursor = 0;
    for (let y = 0; y < height; y++) {
      const filter = raw[cursor++]!;
      const row = Buffer.alloc(stride);
      const prev = rows[y - 1];
      for (let x = 0; x < stride; x++) {
        const value = raw[cursor++]!;
        const left = x >= channels ? row[x - channels]! : 0;
        const up = prev?.[x] ?? 0;
        const upperLeft = x >= channels ? (prev?.[x - channels] ?? 0) : 0;
        row[x] =
          filter === 0
            ? value
            : filter === 1
              ? value + left
              : filter === 2
                ? value + up
                : filter === 3
                  ? value + Math.floor((left + up) / 2)
                  : value + paeth(left, up, upperLeft);
      }
      rows.push(row);
    }
    const buckets = new Map<string, number>();
    const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 4096)));
    for (let y = 0; y < height; y += step) {
      const row = rows[y]!;
      for (let x = 0; x < width; x += step) {
        const i = x * channels;
        if (channels === 4 && row[i + 3]! < 32) continue;
        const quantize = (value: number) => Math.min(255, Math.round(value / 32) * 32);
        const rgb = [quantize(row[i]!), quantize(row[i + 1]!), quantize(row[i + 2]!)];
        const key = `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
    }
    return [...buckets.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([color]) => color);
  } catch {
    return [];
  }
}

function ffprobeMetadata(file: string): Partial<Asset["metadata"]> {
  const ffmpeg = process.env.SEQUENCES_FFMPEG_PATH;
  const candidate = ffmpeg
    ? path.join(path.dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe")
    : process.platform === "win32"
      ? "ffprobe.exe"
      : "ffprobe";
  try {
    const output = execFileSync(
      candidate,
      ["-v", "error", "-show_entries", "format=duration:stream=width,height", "-of", "json", file],
      { encoding: "utf8", timeout: 10_000, windowsHide: true },
    );
    const parsed = JSON.parse(output) as {
      format?: { duration?: string };
      streams?: Array<{ width?: number; height?: number }>;
    };
    const stream = parsed.streams?.find((item) => item.width || item.height);
    const durationSec = Number(parsed.format?.duration);
    return {
      ...(stream?.width ? { width: stream.width } : {}),
      ...(stream?.height ? { height: stream.height } : {}),
      ...(Number.isFinite(durationSec) && durationSec >= 0 ? { durationSec } : {}),
    };
  } catch {
    return {};
  }
}

export function extractAssetMetadata(
  file: string,
  kind: Asset["kind"],
): Asset["metadata"] {
  const stat = fs.statSync(file);
  const ext = path.extname(file).toLowerCase();
  const base = {
    mimeType: MIME[ext] ?? "application/octet-stream",
    bytes: stat.size,
    dominantColors: [] as string[],
    cacheHint: `${stat.size}:${Math.round(stat.mtimeMs)}`,
  };
  if (ext === ".svg") {
    return { ...base, ...svgMetadata(fs.readFileSync(file, "utf8")) };
  }
  if (ext === ".png") {
    const buffer = fs.readFileSync(file);
    return {
      ...base,
      ...(pngDimensions(buffer) ?? {}),
      dominantColors: pngDominantColors(buffer),
    };
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return { ...base, ...(jpegDimensions(fs.readFileSync(file)) ?? {}) };
  }
  if (kind === "video" || kind === "audio") return { ...base, ...ffprobeMetadata(file) };
  return base;
}
