/**
 * Deterministic design tools for frame.md.
 *
 * These functions do not choose an art direction. They turn a bounded creative
 * proposal into render-safe colour, type, and layout tokens, and report every
 * repair they make. The model chooses the mood; this module owns the boring
 * guarantees: valid hex, contrast, embedded fonts, and sane spatial ranges.
 */
import {
  EMBEDDED_FONTS,
  contrastRatio,
  hexToRgb,
  luminance,
  normalizeHex,
  safeTextOn,
  shade,
} from "./brandTokens.ts";
import type { FrameBasis, FrameColors, FrameType } from "./framePresets.ts";

export type ColorHarmony = "monochromatic" | "analogous" | "complementary" | "split-complementary";
export type NeutralTemperature = "cool" | "neutral" | "warm";
export type ContrastCharacter = "soft" | "balanced" | "crisp";
export type AccentUsage = "restrained" | "balanced" | "bold";
export type Density = "airy" | "balanced" | "dense";
export type SpacingRhythm = "compact" | "balanced" | "cinematic";
export type CornerCharacter = "square" | "crisp" | "soft" | "pill-accented";
export type DepthCharacter = "flat" | "bordered" | "elevated" | "atmospheric";

export interface PaletteIntent {
  basis: FrameBasis;
  harmony: ColorHarmony;
  temperature: NeutralTemperature;
  contrast: ContrastCharacter;
  accentUsage: AccentUsage;
  /** Optional model-proposed semantic colours. Invalid/unsafe values are repaired. */
  proposed?: Partial<FrameColors> & { accentSoft?: string; atmosphere?: string };
}

export interface GeneratedPalette extends FrameColors {
  /** Low-energy tint for panels, glows, charts, and selection fields. */
  accentSoft: string;
  /** Harmony colour for atmospheric use only, never a competing CTA accent. */
  atmosphere: string;
}

export interface LayoutIntent {
  density: Density;
  spacing: SpacingRhythm;
  corners: CornerCharacter;
  depth: DepthCharacter;
}

export interface LayoutSystem {
  density: Density;
  spacing: string;
  radius: string;
  shadow: string;
  tokens: {
    edge: number;
    region: number;
    element: number;
    micro: number;
    radius: number;
  };
}

export interface ToolResult<T> {
  value: T;
  repairs: string[];
}

interface Hsl { h: number; s: number; l: number; }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rgbToHsl(hex: string): Hsl {
  const { r, g, b } = hexToRgb(hex);
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === rr) h = 60 * (((gg - bb) / delta) % 6);
    else if (max === gg) h = 60 * ((bb - rr) / delta + 2);
    else h = 60 * ((rr - gg) / delta + 4);
  }
  if (h < 0) h += 360;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h, s: s * 100, l: l * 100 };
}

function hslToHex({ h, s, l }: Hsl): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 100) / 100;
  const ll = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let rgb: [number, number, number];
  if (hh < 60) rgb = [c, x, 0];
  else if (hh < 120) rgb = [x, c, 0];
  else if (hh < 180) rgb = [0, c, x];
  else if (hh < 240) rgb = [0, x, c];
  else if (hh < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const part = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${part(rgb[0])}${part(rgb[1])}${part(rgb[2])}`.toUpperCase();
}

function harmonyHue(hue: number, harmony: ColorHarmony): number {
  if (harmony === "analogous") return hue + 32;
  if (harmony === "complementary") return hue + 180;
  if (harmony === "split-complementary") return hue + 150;
  return hue;
}

function temperatureHue(accentHue: number, temperature: NeutralTemperature): number {
  if (temperature === "warm") return 38;
  if (temperature === "cool") return 218;
  return accentHue;
}

function ensureContrast(
  color: string,
  surface: string,
  minimum: number,
  toward: "black" | "white",
): string {
  let candidate = color;
  for (let i = 0; i < 20 && contrastRatio(candidate, surface) < minimum; i += 1) {
    candidate = shade(candidate, 0.08, toward);
  }
  return candidate;
}

function safeTextAcross(candidate: string, surfaces: string[], minimum: number): string {
  if (surfaces.every((surface) => contrastRatio(candidate, surface) >= minimum)) return candidate;
  const choices = ["#111111", "#FFFFFF"];
  return choices.sort((a, b) => {
    const scoreA = Math.min(...surfaces.map((surface) => contrastRatio(a, surface)));
    const scoreB = Math.min(...surfaces.map((surface) => contrastRatio(b, surface)));
    return scoreB - scoreA;
  })[0]!;
}

function proposedHex(value: string | undefined): string | undefined {
  return value ? normalizeHex(value) : undefined;
}

/**
 * Generate a semantic palette from creative intent, then accept safe exact
 * proposals role-by-role. Brand accent hue remains authoritative when present.
 */
export function generatePalette(
  accentInput: string,
  intent: PaletteIntent,
): ToolResult<GeneratedPalette> {
  const repairs: string[] = [];
  const normalizedAccent = normalizeHex(accentInput) ?? "#3B82F6";
  const accentHsl = rgbToHsl(normalizedAccent);
  const neutralHue = temperatureHue(accentHsl.h, intent.temperature);
  const chroma = intent.temperature === "neutral" ? 5 : 10;
  const crisp = intent.contrast === "crisp";
  const soft = intent.contrast === "soft";
  const light = intent.basis === "light";

  const bg = hslToHex({
    h: neutralHue,
    s: chroma,
    l: light ? (crisp ? 98 : soft ? 94 : 96.5) : (crisp ? 5 : soft ? 11 : 7.5),
  });
  const surface = hslToHex({
    h: neutralHue,
    s: chroma + 2,
    l: light ? (soft ? 98 : 100) : (soft ? 17 : 13),
  });
  const textSeed = hslToHex({ h: neutralHue, s: chroma + 3, l: light ? 10 : 95 });
  const mutedSeed = hslToHex({ h: neutralHue, s: chroma + 1, l: light ? 40 : 66 });
  const text = ensureContrast(textSeed, bg, 7, light ? "black" : "white");
  const textMuted = ensureContrast(mutedSeed, bg, 4.5, light ? "black" : "white");
  let accent = normalizedAccent;
  if (contrastRatio(accent, bg) < 1.8) {
    const adjusted = ensureContrast(accent, bg, 1.8, light ? "black" : "white");
    repairs.push(`adjusted functional accent ${accent} → ${adjusted} to remain visible on the ${intent.basis} canvas`);
    accent = adjusted;
  }

  const accentSoft = hslToHex({
    h: accentHsl.h,
    s: clamp(
      accentHsl.s * (intent.accentUsage === "restrained" ? 0.38 : intent.accentUsage === "bold" ? 0.72 : 0.55),
      14,
      72,
    ),
    l: light
      ? intent.accentUsage === "bold" ? 86 : intent.accentUsage === "restrained" ? 94 : 91
      : intent.accentUsage === "bold" ? 24 : intent.accentUsage === "restrained" ? 16 : 19,
  });
  const atmosphere = hslToHex({
    h: harmonyHue(accentHsl.h, intent.harmony),
    s: clamp(
      accentHsl.s * (intent.accentUsage === "restrained" ? 0.32 : intent.accentUsage === "bold" ? 0.75 : 0.55),
      12,
      76,
    ),
    l: light
      ? intent.accentUsage === "bold" ? 82 : intent.accentUsage === "restrained" ? 91 : 86
      : intent.accentUsage === "bold" ? 25 : intent.accentUsage === "restrained" ? 15 : 20,
  });
  const border = hslToHex({
    h: neutralHue,
    s: chroma + 3,
    l: light ? (crisp ? 72 : 84) : (crisp ? 31 : 24),
  });

  const palette: GeneratedPalette = {
    bg,
    surface,
    text,
    textMuted,
    accent,
    accentText: safeTextOn(accent),
    accentSoft,
    atmosphere,
    border,
    positive: light ? "#087A55" : "#54C994",
    negative: light ? "#B42335" : "#F08080",
  };

  const proposal = intent.proposed ?? {};
  const surfaceRoles = ["bg", "surface"] as const;
  for (const role of surfaceRoles) {
    const proposed = proposedHex(proposal[role]);
    if (proposal[role] && !proposed) repairs.push(`ignored invalid proposed ${role} colour`);
    if (proposed) palette[role] = proposed;
  }
  const blackPair = Math.min(contrastRatio("#111111", palette.bg), contrastRatio("#111111", palette.surface));
  const whitePair = Math.min(contrastRatio("#FFFFFF", palette.bg), contrastRatio("#FFFFFF", palette.surface));
  if (Math.max(blackPair, whitePair) < 7) {
    repairs.push(`repaired proposed surface ${palette.surface}; canvas and surface could not share accessible primary text`);
    palette.surface = surface;
  }
  // The brand hue is committed. A proposal can refine it only when it is the
  // same hue family; otherwise it is treated as an attempted second brand.
  const proposedAccent = proposedHex(proposal.accent);
  if (proposedAccent) {
    const hueDistance = Math.abs(rgbToHsl(proposedAccent).h - accentHsl.h);
    const circularDistance = Math.min(hueDistance, 360 - hueDistance);
    if (circularDistance <= 18) palette.accent = proposedAccent;
    else repairs.push(`ignored proposed accent ${proposedAccent}; committed brand hue is ${normalizedAccent}`);
  }
  for (const role of ["accentSoft", "atmosphere", "border", "positive", "negative"] as const) {
    const proposed = proposedHex(proposal[role]);
    if (proposal[role] && !proposed) repairs.push(`ignored invalid proposed ${role} colour`);
    if (proposed) palette[role] = proposed;
  }

  const proposedText = proposedHex(proposal.text);
  palette.text = safeTextAcross(proposedText ?? palette.text, [palette.bg, palette.surface], 7);
  if (proposedText && palette.text !== proposedText) repairs.push(`repaired proposed text ${proposedText}; it did not reach 7:1 on both primary surfaces`);

  const proposedMuted = proposedHex(proposal.textMuted);
  palette.textMuted = safeTextAcross(proposedMuted ?? palette.textMuted, [palette.bg, palette.surface], 4.5);
  if (proposedMuted && palette.textMuted !== proposedMuted) repairs.push(`repaired proposed muted text ${proposedMuted}; it did not reach 4.5:1`);

  if (contrastRatio(palette.accent, palette.bg) < 1.8) {
    const adjusted = ensureContrast(
      palette.accent,
      palette.bg,
      1.8,
      luminance(palette.bg) > 0.5 ? "black" : "white",
    );
    repairs.push(`adjusted proposed accent ${palette.accent} → ${adjusted} for focal visibility`);
    palette.accent = adjusted;
  }
  palette.accentText = safeTextOn(palette.accent);
  return { value: palette, repairs };
}

const FONT_KIND: Record<string, "sans" | "serif" | "display" | "mono" | "cjk"> = {
  Montserrat: "sans", Oswald: "display", "League Gothic": "display",
  "Archivo Black": "display", "Space Mono": "mono", "IBM Plex Mono": "mono",
  "JetBrains Mono": "mono", "Source Code Pro": "mono", Inter: "sans",
  Roboto: "sans", "Open Sans": "sans", Lato: "sans", Nunito: "sans",
  Poppins: "sans", Outfit: "sans", "Playfair Display": "serif",
  "EB Garamond": "serif", "Noto Sans JP": "cjk",
};

export function validateTypography(
  proposal: Partial<FrameType>,
  fallback: FrameType,
  committed: { display?: string; body?: string },
): ToolResult<FrameType> {
  const repairs: string[] = [];
  const embedded = new Set<string>(EMBEDDED_FONTS);
  const pick = (role: "display" | "body" | "mono", proposed: string | undefined, base: string): string => {
    const committedFont = committed[role as "display" | "body"];
    if (committedFont) return committedFont;
    if (proposed && embedded.has(proposed)) return proposed;
    if (proposed) repairs.push(`replaced unavailable ${role} font "${proposed}" with embedded "${base}"`);
    return base;
  };
  const display = pick("display", proposal.display, fallback.display);
  let body = pick("body", proposal.body, fallback.body);
  let mono = pick("mono", proposal.mono, fallback.mono);
  if (FONT_KIND[mono] !== "mono") {
    repairs.push(`replaced non-mono chrome font "${mono}" with JetBrains Mono`);
    mono = "JetBrains Mono";
  }
  if (display === body && !committed.display && !committed.body) {
    body = FONT_KIND[display] === "serif" ? "Inter" : "EB Garamond";
    repairs.push(`separated display/body roles by replacing duplicate body font with ${body}`);
  }
  const displayKind = FONT_KIND[display] ?? "display";
  const bodyKind = FONT_KIND[body] ?? "sans";
  return {
    value: {
      display,
      body,
      mono,
      note: proposal.note?.trim().slice(0, 240)
        || `${display} (${displayKind}) over ${body} (${bodyKind}); ${mono} for code, data, and chrome.`,
    },
    repairs,
  };
}

export function generateLayout(intent: LayoutIntent): LayoutSystem {
  const spacingFactor = intent.spacing === "compact" ? 0.8 : intent.spacing === "cinematic" ? 1.28 : 1;
  const densityFactor = intent.density === "dense" ? 0.85 : intent.density === "airy" ? 1.18 : 1;
  const edge = Math.round(72 * spacingFactor * densityFactor);
  const region = Math.round(40 * spacingFactor * densityFactor);
  const element = Math.round(24 * spacingFactor);
  const micro = Math.round(12 * spacingFactor);
  const radius = intent.corners === "square" ? 0 : intent.corners === "crisp" ? 6 : 14;
  const radiusText = intent.corners === "pill-accented"
    ? "8px content surfaces; pills reserved for controls, tags, and CTA chrome"
    : `${radius}px primary radius${radius === 0 ? "; hard rectangular geometry" : ""}`;
  const shadow = intent.depth === "flat"
    ? "No shadows; use scale, rules, and color fields for separation."
    : intent.depth === "bordered"
      ? "No soft shadows; 1–2px tinted borders and surface contrast create depth."
      : intent.depth === "elevated"
        ? "One restrained elevation level (0 12px 40px rgba(0,0,0,.18)); never stack shadow styles."
        : "Depth comes from localized radial light, grain, and foreground/background separation; shadows are subordinate.";
  return {
    density: intent.density,
    spacing: `${intent.spacing}, ${intent.density}: ${edge}px frame edge, ${region}px region, ${element}px element, ${micro}px micro gaps. Use these as a rhythm, not a universal grid.`,
    radius: radiusText,
    shadow,
    tokens: { edge, region, element, micro, radius },
  };
}

/** Agent-readable tool contract embedded in the bounded frame-design call. */
export function frameToolInstructions(): string {
  return [
    "Deterministic tools will execute after your proposal:",
    "- palette: derives semantic neutrals from the committed accent + basis + harmony + temperature; checks 7:1 primary text, 4.5:1 muted text, and 1.8:1 focal accent visibility.",
    "- exact proposed semantic hex values are accepted when valid; unsafe text is repaired; a proposed accent outside ±18° of the brand hue is rejected.",
    `- typography: only these embedded families survive: ${EMBEDDED_FONTS.join(", ")}.`,
    "- spacing: your density/spacing/corner/depth choices become bounded pixel tokens for a 1920×1080 frame.",
    "- every repair is written into frame.md provenance. Prefer a strong coherent choice over conservative defaults.",
  ].join("\n");
}
