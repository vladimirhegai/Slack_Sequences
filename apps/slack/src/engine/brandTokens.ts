/**
 * Deterministic brand-token extraction + colour/contrast utilities.
 *
 * Pulls the brand signals the context bot surfaces in its evidence pack —
 * colours (hex / rgb / named), fonts, a product URL, a logo asset — out of free
 * text, with NO model call. The frame designer then remaps a preset onto these
 * tokens. Pure functions only: same text in, same tokens out.
 */

/** The embedded families the renderer can actually draw (mirrors skillContext). */
export const EMBEDDED_FONTS = [
  "Montserrat", "Oswald", "League Gothic", "Archivo Black", "Space Mono",
  "IBM Plex Mono", "JetBrains Mono", "Source Code Pro", "Inter", "Roboto",
  "Open Sans", "Lato", "Nunito", "Poppins", "Outfit", "Playfair Display",
  "EB Garamond", "Noto Sans JP",
] as const;

/**
 * Map a brand's stated font to the nearest embedded family. Keys are lowercased.
 * Brand fonts the renderer can't embed must resolve to something it can, or the
 * frame.md would promise type the video can't deliver.
 */
const FONT_ALIASES: Record<string, string> = {
  // direct embedded names
  "montserrat": "Montserrat", "oswald": "Oswald", "league gothic": "League Gothic",
  "archivo black": "Archivo Black", "archivo": "Archivo Black", "space mono": "Space Mono",
  "ibm plex mono": "IBM Plex Mono", "jetbrains mono": "JetBrains Mono",
  "source code pro": "Source Code Pro", "inter": "Inter", "roboto": "Roboto",
  "open sans": "Open Sans", "lato": "Lato", "nunito": "Nunito", "poppins": "Poppins",
  "outfit": "Outfit", "playfair display": "Playfair Display", "playfair": "Playfair Display",
  "eb garamond": "EB Garamond", "garamond": "EB Garamond", "noto sans jp": "Noto Sans JP",
  // common brand fonts → nearest embedded
  "helvetica": "Inter", "helvetica neue": "Inter", "arial": "Inter", "system-ui": "Inter",
  "sf pro": "Inter", "sf pro display": "Inter", "-apple-system": "Inter", "segoe ui": "Inter",
  "futura": "Montserrat", "avenir": "Montserrat", "circular": "Poppins", "gilroy": "Poppins",
  "proxima nova": "Montserrat", "geist": "Outfit", "geist sans": "Outfit",
  "space grotesk": "Outfit", "hanken grotesk": "Outfit", "general sans": "Outfit",
  "satoshi": "Outfit", "cabinet grotesk": "Outfit", "sora": "Outfit", "manrope": "Inter",
  "work sans": "Inter", "dm sans": "Inter", "ibm plex sans": "Inter", "source sans pro": "Open Sans",
  "source sans 3": "Open Sans", "barlow": "Inter", "rubik": "Inter", "figtree": "Inter",
  "bebas neue": "League Gothic", "anton": "Archivo Black", "shrikhand": "Archivo Black",
  "georgia": "Playfair Display", "times": "Playfair Display", "times new roman": "Playfair Display",
  "newsreader": "Playfair Display", "bodoni moda": "Playfair Display", "bodoni": "Playfair Display",
  "libre baskerville": "EB Garamond", "baskerville": "EB Garamond", "source serif 4": "EB Garamond",
  "source serif pro": "EB Garamond", "lora": "EB Garamond", "merriweather": "EB Garamond",
  "fira code": "JetBrains Mono", "fira mono": "JetBrains Mono", "dm mono": "Space Mono",
  "roboto mono": "JetBrains Mono", "menlo": "JetBrains Mono", "monaco": "JetBrains Mono",
  "courier": "Space Mono", "courier new": "Space Mono", "consolas": "JetBrains Mono",
};

/** A handful of CSS named colours brands actually name in prose. */
const NAMED_COLORS: Record<string, string> = {
  black: "#000000", white: "#FFFFFF", red: "#FF0000", green: "#008000",
  blue: "#0000FF", navy: "#001F5C", teal: "#008080", purple: "#6B21A8",
  orange: "#F97316", pink: "#EC4899", yellow: "#FACC15", gold: "#D4AF37",
  coral: "#FF6F61", cyan: "#06B6D4", indigo: "#4F46E5", violet: "#7C3AED",
  magenta: "#D946EF", crimson: "#DC143C", emerald: "#10B981", lime: "#84CC16",
};

export interface BrandTokens {
  /** Chromatic accent candidate (most saturated non-neutral), if any. */
  accent?: string;
  /** Any strongly dark or light canvas signal, if the brand states one. */
  background?: string;
  /** All distinct colours found, brightest-first, normalized #RRGGBB. */
  colors: string[];
  /** Embedded font for headlines, if a brand font was found and mapped. */
  displayFont?: string;
  /** Embedded font for body, if found. */
  bodyFont?: string;
  /** Product URL, if present. */
  url?: string;
  /** Logo asset path/filename, if referenced. */
  logo?: string;
  /** Raw font names found (pre-mapping) for provenance display. */
  rawFonts: string[];
}

/* ----------------------------------------------------------------- colour */

export interface Rgb { r: number; g: number; b: number; }

export function normalizeHex(input: string): string | undefined {
  let hex = input.trim().toLowerCase();
  const named = NAMED_COLORS[hex];
  if (named) return named;
  const m = hex.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return undefined;
  hex = m[1]!;
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  return `#${hex.toUpperCase()}`;
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const ch = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/** WCAG contrast ratio between two colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** HSV saturation 0–1 — how chromatic (vs grey) a colour is. */
export function saturation(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/** Near-white / near-black / low-chroma greys are neutrals, not accents. */
export function isNeutral(hex: string): boolean {
  const l = luminance(hex);
  return saturation(hex) < 0.18 || l > 0.92 || l < 0.03;
}

/** Pick black or white text for legibility on a given surface. */
export function safeTextOn(surface: string): string {
  return contrastRatio("#FFFFFF", surface) >= contrastRatio("#111111", surface)
    ? "#FFFFFF"
    : "#111111";
}

/** Darken/lighten a colour toward black/white by a factor (0–1). */
export function shade(hex: string, factor: number, toward: "black" | "white"): string {
  const { r, g, b } = hexToRgb(hex);
  const t = toward === "white" ? 255 : 0;
  return rgbToHex({
    r: r + (t - r) * factor,
    g: g + (t - g) * factor,
    b: b + (t - b) * factor,
  });
}

/* -------------------------------------------------------------- extraction */

/** Strip a markdown/anchor URL down to its origin host for display. */
function cleanUrl(raw: string): string {
  return raw.replace(/[)\].,>"']+$/, "");
}

export function extractBrandTokens(evidence: string): BrandTokens {
  const text = evidence ?? "";

  // Colours: explicit hex first (most reliable), then rgb(), then named near a
  // "brand"/"color" cue. Count frequency so the dominant brand colour wins ties.
  const counts = new Map<string, number>();
  const bump = (hex?: string, by = 1) => {
    if (hex) counts.set(hex, (counts.get(hex) ?? 0) + by);
  };
  for (const m of text.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) {
    bump(normalizeHex(m[0]), 2);
  }
  for (const m of text.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g)) {
    bump(rgbToHex({ r: +m[1]!, g: +m[2]!, b: +m[3]! }), 2);
  }
  // Named colours only when near a brand/colour cue, to avoid "green energy" noise.
  for (const m of text.matchAll(
    /\b(?:brand|primary|accent|color|colour|theme)[^.\n]{0,40}?\b(black|white|red|green|blue|navy|teal|purple|orange|pink|yellow|gold|coral|cyan|indigo|violet|magenta|crimson|emerald|lime)\b/gi,
  )) {
    bump(NAMED_COLORS[m[1]!.toLowerCase()], 1);
  }

  const colors = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || luminance(b[0]) - luminance(a[0]))
    .map(([hex]) => hex);

  // Accent = most-frequent chromatic colour; background = a stated extreme.
  const chromatic = colors.filter((c) => !isNeutral(c));
  const accent = chromatic.sort((a, b) => (counts.get(b)! - counts.get(a)!) || (saturation(b) - saturation(a)))[0];
  const background = colors.find((c) => luminance(c) < 0.03 || luminance(c) > 0.95);

  // Fonts: scan for any known family name; map to embedded.
  const rawFonts: string[] = [];
  const mapped: string[] = [];
  const lower = text.toLowerCase();
  for (const [alias, embedded] of Object.entries(FONT_ALIASES)) {
    const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(lower)) {
      rawFonts.push(alias);
      if (!mapped.includes(embedded)) mapped.push(embedded);
    }
  }
  // Classify mapped fonts into display (serif/heavy) vs body (sans).
  const serifOrDisplay = new Set(["Playfair Display", "EB Garamond", "Archivo Black", "League Gothic", "Oswald"]);
  const displayFont = mapped.find((f) => serifOrDisplay.has(f));
  const bodyFont = mapped.find((f) => !serifOrDisplay.has(f) && f !== displayFont)
    ?? mapped.find((f) => f !== displayFont);

  // URL + logo.
  const urlMatch = text.match(/https?:\/\/[^\s)<>"']+/);
  const url = urlMatch ? cleanUrl(urlMatch[0]) : undefined;
  const logoMatch = text.match(/[^\s"'<>()]+logo[^\s"'<>()]*\.(?:svg|png|jpg|jpeg|webp)/i)
    ?? text.match(/[\w./-]+\.(?:svg|png)\b(?=[^.]{0,40}logo)/i);
  const logo = logoMatch ? logoMatch[0] : undefined;

  return {
    accent,
    background,
    colors,
    displayFont,
    bodyFont,
    url,
    logo,
    rawFonts: [...new Set(rawFonts)],
  };
}

/** Map an arbitrary font name to an embedded family (used by capture too). */
export function mapFontToEmbedded(name: string): string | undefined {
  const key = name.toLowerCase().replace(/['"]/g, "").trim();
  if (FONT_ALIASES[key]) return FONT_ALIASES[key];
  // Heuristic fallback by hint words.
  if (/serif|garamond|times|georgia|book/.test(key)) return "EB Garamond";
  if (/mono|code|console/.test(key)) return "JetBrains Mono";
  if (/grotesk|grotesque|geometric|sans/.test(key)) return "Outfit";
  return undefined;
}
