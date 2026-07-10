/**
 * Deterministic, deliberately loose validation of authored HTML against the
 * per-job frame.md. It protects committed brand/font facts while treating the
 * rest of the frame as repairable art-direction guidance.
 */
import { EMBEDDED_FONTS, normalizeHex } from "./brandTokens.ts";

export interface FrameCompositionValidation {
  errors: string[];
  warnings: string[];
}

export interface ParsedFrame {
  brandMatched: boolean;
  accentCommitted: boolean;
  accent?: string;
  /** The frame's tinted canvas hex (semantic token table row). */
  canvas?: string;
  palette: string[];
  display?: string;
  body?: string;
  mono?: string;
}

export function parseFrame(frameMd: string): ParsedFrame {
  const metadata = frameMd.match(/<!--\s*sequences-frame:\s*(\{.*?\})\s*-->/s)?.[1];
  let brandMatched = false;
  let accentCommitted = false;
  if (metadata) {
    try {
      const parsed = JSON.parse(metadata) as {
        brandMatched?: unknown;
        accentCommitted?: unknown;
      };
      brandMatched = Boolean(parsed.brandMatched);
      accentCommitted = Boolean(parsed.accentCommitted);
    } catch {
      // A malformed metadata comment should not disable the remaining checks.
    }
  }
  const palette = [...frameMd.matchAll(/\|\s*`(#[0-9a-f]{6})`\s*\|/gi)]
    .map((match) => normalizeHex(match[1]!))
    .filter((value): value is string => Boolean(value));
  const font = (role: string): string | undefined =>
    frameMd.match(new RegExp(`\\*\\*${role}:\\*\\*\\s*([^\\r\\n]+)`, "i"))?.[1]?.trim();
  return {
    brandMatched,
    accentCommitted,
    accent: normalizeHex(
      frameMd.match(/\|\s*Committed accent\s*\|\s*`(#[0-9a-f]{6})`/i)?.[1] ?? "",
    ),
    canvas: normalizeHex(
      frameMd.match(/\|\s*Canvas\s*\|\s*`(#[0-9a-f]{6})`/i)?.[1] ?? "",
    ),
    palette: [...new Set(palette)],
    display: font("Display / headlines"),
    body: font("Body / UI"),
    mono: font("Mono / chrome / code"),
  };
}

const GENERIC_FONTS = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "system-ui",
  "cursive",
  "fantasy",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
]);

function authoredPrimaryFonts(html: string): string[] {
  const fonts: string[] = [];
  for (const match of html.matchAll(/font-family\s*:\s*([^;}\n]+)/gi)) {
    const value = match[1]!.trim();
    if (/^var\(/i.test(value)) continue;
    const primary = value.split(",")[0]!.trim().replace(/^['"]|['"]$/g, "");
    if (primary) fonts.push(primary);
  }
  return [...new Set(fonts)];
}

export function validateCompositionAgainstFrame(
  html: string,
  frameMd: string,
): FrameCompositionValidation {
  const frame = parseFrame(frameMd);
  const lowerHtml = html.toLowerCase();
  const errors: string[] = [];
  const warnings: string[] = [];
  const embedded = new Set(EMBEDDED_FONTS.map((font) => font.toLowerCase()));

  for (const font of authoredPrimaryFonts(html)) {
    const lower = font.toLowerCase();
    if (!embedded.has(lower) && !GENERIC_FONTS.has(lower)) {
      errors.push(
        `frame/font: primary font "${font}" is not embedded; use the frame.md typography`,
      );
    }
  }

  if (frame.accent && !lowerHtml.includes(frame.accent.toLowerCase())) {
    const finding =
      `frame/accent: composition does not use the committed frame accent ${frame.accent}`;
    if (frame.accentCommitted) errors.push(finding);
    else warnings.push(finding);
  }

  const usedPalette = frame.palette.filter((color) => lowerHtml.includes(color.toLowerCase()));
  if (usedPalette.length < Math.min(2, frame.palette.length)) {
    warnings.push(
      "frame/palette: composition uses fewer than two frame.md semantic palette anchors; " +
        "preserve the visual thesis while binding its canvas/text/accent system",
    );
  }

  for (const [role, font] of [
    ["display", frame.display],
    ["body", frame.body],
  ] as const) {
    if (font && !lowerHtml.includes(font.toLowerCase())) {
      warnings.push(`frame/type: ${role} family "${font}" from frame.md is not used`);
    }
  }

  return {
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  };
}
