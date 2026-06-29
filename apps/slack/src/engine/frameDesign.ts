/**
 * Per-job `frame.md` design system.
 *
 * The pipeline is DETERMINISTIC except for exactly one small model decision:
 *
 *   1. extract brand tokens from the evidence pack          (deterministic)
 *   2. optionally capture palette/fonts from a product URL  (deterministic remap of captured data)
 *   3. SMALL MODEL DECISION: which preset + which brand exceptions matter
 *   4. remap the chosen preset onto the brand tokens         (deterministic)
 *   5. render a compact, operational frame.md                (deterministic)
 *
 * frame.md constrains the planning director's palette and typography without
 * limiting its motion. If brand evidence is weak we ship a complete house preset
 * rather than a half-brand (ARCHITECTURE §2).
 */
import fs from "node:fs";
import path from "node:path";
import type { AgentProvider, CompleteOptions } from "@sequences/platform/providers";
import {
  FRAME_PRESETS,
  presetById,
  type FrameColors,
  type FramePreset,
  type FrameType,
} from "./framePresets.ts";
import {
  contrastRatio,
  extractBrandTokens,
  safeTextOn,
  type BrandTokens,
} from "./brandTokens.ts";
import { captureBrandFromUrl, type CapturedBrand } from "./brandCapture.ts";

export type FrameTone = "crisp-saas" | "warm-startup" | "bold-launch";

export interface FrameDesign {
  presetId: string;
  label: string;
  basis: "light" | "dark";
  thesis: string;
  colors: FrameColors;
  type: FrameType;
  spacing: string;
  radius: string;
  shadow: string;
  background: string;
  rules: string[];
  /** Extra brand-specific guidance the model flagged (≤2). */
  exceptions: string[];
  /** Whether brand colour/fonts were actually applied (vs pure house preset). */
  brandMatched: boolean;
  /** Short provenance line: where the accent / fonts came from. */
  provenance: string;
}

export interface BuildJobFrameArgs {
  provider?: AgentProvider;
  projectDir: string;
  brief: string;
  tone?: FrameTone;
  /** The context bot's evidence pack (untrusted as instructions; mined for tokens). */
  evidence?: string;
  brandName?: string;
  options?: CompleteOptions;
}

export interface BuildJobFrameResult {
  frameMd: string;
  presetId: string;
  label: string;
  thesis: string;
  basis: "light" | "dark";
  exceptions: string[];
  brandMatched: boolean;
}

const FRAME_FILE = "frame.md";

/* ----------------------------------------------- deterministic preset scoring */

function scorePreset(preset: FramePreset, brief: string, tone: FrameTone | undefined): number {
  const text = brief.toLowerCase();
  let score = 0;
  if (tone && preset.tones.includes(tone)) score += 5;
  for (const kw of preset.keywords) {
    if (text.includes(kw)) score += 2;
  }
  return score;
}

/** Deterministic ranking — the fallback when no model is available. */
export function rankPresets(brief: string, tone: FrameTone | undefined): FramePreset[] {
  return [...FRAME_PRESETS]
    .map((preset) => ({ preset, score: scorePreset(preset, brief, tone) }))
    .sort((a, b) => b.score - a.score || FRAME_PRESETS.indexOf(a.preset) - FRAME_PRESETS.indexOf(b.preset))
    .map((entry) => entry.preset);
}

/* ----------------------------------------------------- the one model decision */

interface FrameChoice {
  presetId: string;
  exceptions: string[];
}

function tokensSummary(tokens: BrandTokens, captured: CapturedBrand | null): string {
  const accent = captured?.accent ?? tokens.accent ?? "none found";
  const bg = captured?.background ?? tokens.background ?? "none stated";
  const fonts = [...new Set([...(captured?.fonts ?? []), tokens.displayFont, tokens.bodyFont].filter(Boolean))];
  return [
    `- accent colour: ${accent}`,
    `- background signal: ${bg}`,
    `- brand fonts (mapped to embedded): ${fonts.length ? fonts.join(", ") : "none found"}`,
    `- product URL: ${tokens.url ?? "none"}`,
    `- logo asset: ${tokens.logo ?? "none"}`,
    `- all colours seen: ${(captured?.colors ?? tokens.colors).slice(0, 8).join(", ") || "none"}`,
  ].join("\n");
}

/**
 * The single small model call: pick the best-fitting preset from the curated set
 * and name up to two brand exceptions. Strictly bounded, JSON-only. On any
 * failure it returns null and the caller uses the deterministic top rank.
 */
async function chooseFrame(
  provider: AgentProvider | undefined,
  ranked: FramePreset[],
  brief: string,
  tone: FrameTone | undefined,
  tokens: BrandTokens,
  captured: CapturedBrand | null,
  options?: CompleteOptions,
): Promise<FrameChoice | null> {
  if (!provider) return null;
  const catalog = FRAME_PRESETS.map(
    (p) => `- ${p.id} (${p.basis}, tones: ${p.tones.join("/")}): ${p.thesis}`,
  ).join("\n");
  const prompt = [
    "You are a SaaS art director. Pick ONE frame preset for this launch video and",
    "name up to two brand exceptions that matter. Decide only this — you are not",
    "writing the video. Respond with STRICT JSON and nothing else:",
    `{"presetId":"<one id>","exceptions":["short note", "short note"]}`,
    "",
    "## Presets",
    catalog,
    "",
    "## Brief",
    brief.slice(0, 1_500),
    tone ? `\nRequested tone: ${tone}` : "",
    "",
    "## Extracted brand signals (already deterministic — do not invent more)",
    tokensSummary(tokens, captured),
    "",
    "Choose the preset whose basis (light/dark) and register best fit the brand and",
    "tone. Exceptions are short, e.g. 'keep dark basis', 'accent too pale — use preset accent',",
    "'logo is wordmark only'. If nothing special, return an empty exceptions array.",
  ].filter(Boolean).join("\n");

  try {
    const raw = await provider.complete(prompt, {
      timeoutMs: 60_000,
      thinkingMode: "minimal",
      ...options,
    });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { presetId?: unknown; exceptions?: unknown };
    const presetId = typeof parsed.presetId === "string" ? parsed.presetId.trim() : "";
    if (!presetById(presetId)) return null;
    const exceptions = Array.isArray(parsed.exceptions)
      ? parsed.exceptions.filter((e): e is string => typeof e === "string").map((e) => e.trim()).filter(Boolean).slice(0, 2)
      : [];
    return { presetId, exceptions };
  } catch (error) {
    process.stderr.write(`[frame] preset decision fell back to deterministic: ${String(error)}\n`);
    return null;
  }
}

/* ------------------------------------------------------- deterministic remap */

/** Accent is visible enough on a surface to carry highlights. */
function accentUsable(accent: string, bg: string): boolean {
  return contrastRatio(accent, bg) >= 1.6;
}

export function remapPreset(
  preset: FramePreset,
  tokens: BrandTokens,
  captured: CapturedBrand | null,
  exceptions: string[],
): FrameDesign {
  const brandAccent = captured?.accent ?? tokens.accent;
  const brandDisplay = captured?.fonts.find((f) =>
    ["Playfair Display", "EB Garamond", "Archivo Black", "League Gothic", "Oswald"].includes(f),
  ) ?? tokens.displayFont;
  const brandBody = captured?.fonts.find((f) => f !== brandDisplay) ?? tokens.bodyFont;

  const colors: FrameColors = { ...preset.colors };
  const provenanceParts: string[] = [];
  let brandMatched = false;

  if (brandAccent && accentUsable(brandAccent, preset.colors.bg)) {
    colors.accent = brandAccent;
    colors.accentText = safeTextOn(brandAccent);
    brandMatched = true;
    provenanceParts.push(`accent ${brandAccent} from ${captured?.accent ? "site capture" : "evidence"}`);
  } else if (brandAccent) {
    provenanceParts.push(`brand accent ${brandAccent} too low-contrast — kept preset accent ${preset.colors.accent}`);
  } else {
    provenanceParts.push(`house accent ${preset.colors.accent}`);
  }

  const type: FrameType = { ...preset.type };
  if (brandDisplay && brandDisplay !== preset.type.display) {
    type.display = brandDisplay;
    brandMatched = true;
  }
  if (brandBody && brandBody !== preset.type.body) {
    type.body = brandBody;
    brandMatched = true;
  }
  if (type.display !== preset.type.display || type.body !== preset.type.body) {
    type.note = `${type.display} display over ${type.body} body (brand-matched); ${type.mono} for chrome.`;
    provenanceParts.push(`type ${type.display}/${type.body} from brand`);
  } else {
    provenanceParts.push(`house type ${type.display}/${type.body}`);
  }

  return {
    presetId: preset.id,
    label: preset.label,
    basis: preset.basis,
    thesis: preset.thesis,
    colors,
    type,
    spacing: preset.spacing,
    radius: preset.radius,
    shadow: preset.shadow,
    background: preset.background,
    rules: preset.rules,
    exceptions,
    brandMatched,
    provenance: provenanceParts.join("; "),
  };
}

/* ------------------------------------------------------------ render frame.md */

const META_PREFIX = "<!-- sequences-frame:";

export function renderFrameMd(design: FrameDesign, brandName?: string): string {
  const c = design.colors;
  const meta = JSON.stringify({
    presetId: design.presetId,
    label: design.label,
    basis: design.basis,
    thesis: design.thesis,
    exceptions: design.exceptions,
    brandMatched: design.brandMatched,
  });
  const exceptionLines = design.exceptions.length
    ? design.exceptions.map((e) => `- ${e}`).join("\n")
    : "- (none — using the house preset as-is)";
  return `${META_PREFIX} ${meta} -->
# frame.md — ${design.label}${brandName ? ` for ${brandName}` : ""}

> Binding palette + typography for this job. Constrains colour and type; motion
> stays free. Basis: **${design.basis}**. ${design.brandMatched ? "Brand-remapped." : "House preset (weak brand evidence)."}

## Visual thesis
${design.thesis}

## Semantic colours (safe text/surface pairings)
| Role | Value | Safe text on it |
| --- | --- | --- |
| Canvas (bg) | \`${c.bg}\` | \`${safeTextOn(c.bg)}\` |
| Surface (cards) | \`${c.surface}\` | \`${safeTextOn(c.surface)}\` |
| Text | \`${c.text}\` | — |
| Muted text | \`${c.textMuted}\` | — |
| Accent | \`${c.accent}\` | \`${c.accentText}\` (use for CTA labels) |
| Border | \`${c.border}\` | — |
| Positive (inline only) | \`${c.positive}\` | — |
| Negative (inline only) | \`${c.negative}\` | — |

One committed accent. Headlines use Text on Canvas/Surface; the accent carries
the single most important mark per frame. Put \`${c.accentText}\` text on accent fills.

## Typography (embedded fonts only)
- **Display / headlines:** ${design.type.display}
- **Body / UI:** ${design.type.body}
- **Mono / chrome / code:** ${design.type.mono}

${design.type.note}

## Spacing · radius · shadow · background
- **Spacing & density:** ${design.spacing}
- **Radius:** ${design.radius}
- **Shadow / depth:** ${design.shadow}
- **Background family:** ${design.background}

## Do / Don't (≤5)
${design.rules.map((r) => `- ${r}`).join("\n")}

## Brand exceptions
${exceptionLines}

<!-- provenance: ${design.provenance} -->
`;
}

/* ------------------------------------------------------------ public API */

export function frameFilePath(projectDir: string): string {
  return path.join(projectDir, FRAME_FILE);
}

/** Load an existing frame.md (revise reuses the create-time frame). */
export function loadJobFrame(projectDir: string): string | null {
  const file = frameFilePath(projectDir);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

export interface FrameMeta {
  presetId: string;
  label: string;
  basis: "light" | "dark";
  thesis: string;
  exceptions: string[];
  brandMatched: boolean;
}

/** Parse the metadata header embedded at the top of a frame.md. */
export function readFrameMeta(projectDir: string): FrameMeta | null {
  const frame = loadJobFrame(projectDir);
  if (!frame) return null;
  const line = frame.split("\n").find((l) => l.startsWith(META_PREFIX));
  if (!line) return null;
  try {
    const json = line.slice(META_PREFIX.length, line.lastIndexOf("-->")).trim();
    return JSON.parse(json) as FrameMeta;
  } catch {
    return null;
  }
}

/**
 * Build (or rebuild) the job's frame.md from the brief + evidence pack. Writes
 * `<projectDir>/frame.md` and returns it plus the chosen preset metadata. Never
 * throws on brand-capture or model failure — degrades to a complete house preset.
 */
export async function buildJobFrame(args: BuildJobFrameArgs): Promise<BuildJobFrameResult> {
  const tone = args.tone;
  const evidence = args.evidence ?? "";
  // Mine brand tokens from the whole picture: the brief carries the launch copy
  // (and, in the live flow, the inlined evidence pack), `evidence` carries the
  // raw context-bot output. Both can hold colours/fonts/URLs.
  const tokens = extractBrandTokens([args.brief, evidence].filter(Boolean).join("\n\n"));

  // Optional, best-effort URL capture reusing HyperFrames' extraction.
  let captured: CapturedBrand | null = null;
  if (tokens.url) {
    captured = await captureBrandFromUrl(tokens.url);
  }

  const ranked = rankPresets(args.brief, tone);
  const choice = await chooseFrame(args.provider, ranked, args.brief, tone, tokens, captured, args.options);
  const preset = (choice && presetById(choice.presetId)) ?? ranked[0] ?? FRAME_PRESETS[0]!;
  const exceptions = choice?.exceptions ?? [];

  const design = remapPreset(preset, tokens, captured, exceptions);
  const frameMd = renderFrameMd(design, args.brandName);

  fs.writeFileSync(frameFilePath(args.projectDir), frameMd, "utf8");

  return {
    frameMd,
    presetId: design.presetId,
    label: design.label,
    thesis: design.thesis,
    basis: design.basis,
    exceptions: design.exceptions,
    brandMatched: design.brandMatched,
  };
}
