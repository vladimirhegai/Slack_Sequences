/**
 * Curated SaaS-fit frame presets — the house design systems a launch job starts
 * from before bounded art direction and deterministic validation.
 *
 * These are distilled from the vendored HyperFrames `frame-presets/` taste
 * library (skills/hyperframes-creative/frame-presets/), but expressed here in a
 * compact, operational shape and — crucially — using ONLY the fonts the renderer
 * actually embeds (see agent/skillContext.ts EMBEDDED_FONTS). The upstream FRAME.md
 * files reach for Space Grotesk / Newsreader / Bodoni Moda / Shrikhand etc., which
 * would silently fall back to system generics at render time. Each preset below
 * keeps the source's colour + composition DNA but maps its type to embedded
 * families, so what the director writes is what the renderer draws.
 *
 * A preset is taste inspiration, never a license to copy a trademark: no real
 * customer marks, logos, or proprietary assets live here.
 */

export type FrameBasis = "light" | "dark";

/** Semantic fallback colour roles; final pairings are validated by frameTools. */
export interface FrameColors {
  /** The scene canvas / ground. */
  bg: string;
  /** Raised content surface (cards, panels). */
  surface: string;
  /** Primary reading text on `bg`/`surface`. */
  text: string;
  /** Secondary / supporting text. */
  textMuted: string;
  /** The single committed accent hue. */
  accent: string;
  /** Text that is legible when placed ON the accent (CTA labels). */
  accentText: string;
  /** Hairline / border colour. */
  border: string;
  /** Directional-positive (inline only). */
  positive: string;
  /** Directional-negative (inline only). */
  negative: string;
}

export interface FrameType {
  /** Display / headline family (embedded). */
  display: string;
  /** Body / UI family (embedded). */
  body: string;
  /** Mono / chrome family (embedded). */
  mono: string;
  /** One-line pairing rationale shown in frame.md. */
  note: string;
}

export interface FramePreset {
  id: string;
  label: string;
  basis: FrameBasis;
  /** One-sentence visual thesis. */
  thesis: string;
  colors: FrameColors;
  type: FrameType;
  /** Spacing / radius / shadow / density operational rules. */
  spacing: string;
  radius: string;
  shadow: string;
  /** Background family the director should build from (never a flat fill). */
  background: string;
  /** ≤5 do/don't rules that define the system's restraint. */
  rules: string[];
  /** Tone affinities (matches the create-modal Tone enum) used for scoring. */
  tones: Array<"crisp-saas" | "warm-startup" | "bold-launch">;
  /** Keyword affinities used by the deterministic selector / model shortlist. */
  keywords: string[];
}

/**
 * Five presets spanning the SaaS launch range: clean B2B, dark premium, editorial,
 * bold launch, and crisp dev-tool. Light/dark and serif/sans/mono are all covered
 * so the deterministic fallback remains coherent whatever the source brand.
 */
export const FRAME_PRESETS: FramePreset[] = [
  {
    id: "clean-corporate",
    label: "Clean Corporate",
    basis: "light",
    thesis:
      "Consulting-grade restraint: a warm light canvas, one saturated accent carrying every highlight, and a tight grey ladder. Data-dense without crowding.",
    colors: {
      bg: "#FDFAF3",
      surface: "#FFFFFF",
      text: "#111418",
      textMuted: "#5B6066",
      accent: "#1E2BFA",
      accentText: "#FFFFFF",
      border: "#E4E0D4",
      positive: "#059669",
      negative: "#DC2626",
    },
    type: {
      display: "Outfit",
      body: "Inter",
      mono: "IBM Plex Mono",
      note: "Outfit (geometric display + numerals) over Inter body; IBM Plex Mono for chrome/labels.",
    },
    spacing: "Generous: 60–120px padding, 24–40px gaps. Content balanced, never edge-to-edge.",
    radius: "Soft: 10–14px cards, 100px pill chrome, 6px bars.",
    shadow: "None on content — tinted surfaces and 1.5px borders do the lift. The only depth signal is restraint.",
    background:
      "Near-solid warm field with a faint accent-tinted panel or 3×3 dot grid on cover/closing only; content frames stay clean.",
    rules: [
      "Let the accent carry every highlight (eyebrow, numeral, CTA, bar); headlines stay near-black.",
      "Use tinted surfaces + hairline borders for depth — never drop shadows on content.",
      "Keep all chrome pill-shaped; exactly one solid accent CTA per closing frame.",
      "No second accent hue; positive/negative only on inline directional change.",
      "Don't center everything with equal weight — lean left on cover/data, pin metadata to edges.",
    ],
    tones: ["crisp-saas", "warm-startup"],
    keywords: [
      "b2b", "enterprise", "saas", "dashboard", "analytics", "platform", "data",
      "metric", "report", "finance", "professional", "corporate", "consulting",
    ],
  },
  {
    id: "dark-premium",
    label: "Dark Premium",
    basis: "dark",
    thesis:
      "An editorial, warm near-black stage with a single warm accent and a serif display. Confident, expensive, unhurried — the register of a flagship launch.",
    colors: {
      bg: "#141413",
      surface: "#1F1E1B",
      text: "#FAF9F5",
      textMuted: "#A8A49B",
      accent: "#CC785C",
      accentText: "#141413",
      border: "#2C2A26",
      positive: "#5FB78F",
      negative: "#E08977",
    },
    type: {
      display: "Playfair Display",
      body: "Inter",
      mono: "JetBrains Mono",
      note: "Playfair Display (serif display) over Inter body; JetBrains Mono kickers. Serif on dark reads premium.",
    },
    spacing: "Cinematic: 80–160px margins, big negative space, one focal idea per frame.",
    radius: "Restrained: 8–12px surfaces, full-round avatars/dots, square hairlines.",
    shadow: "Soft elevation (0 4px 24px rgba(0,0,0,0.35)) on raised surfaces; warm accent glow as atmosphere only.",
    background:
      "Warm near-black ground with a slow radial glow toward the accent and oversized ghost wordmark at 4–7% opacity. Never flat #000.",
    rules: [
      "Tint neutrals warm — never pure #000 or cold grey; the warmth is the premium signal.",
      "Serif display only for hero lines; keep body and chrome sans/mono for legibility.",
      "One warm accent, used sparingly for the single most important mark per frame.",
      "Hold frames longer; let slow ambient motion breathe rather than constant movement.",
      "Avoid neon, gradient text, and cyan-on-dark — they cheapen the dark stage instantly.",
    ],
    tones: ["bold-launch", "warm-startup"],
    keywords: [
      "premium", "launch", "flagship", "brand", "rebrand", "luxury", "announce",
      "vision", "story", "cinematic", "editorial", "design", "studio",
    ],
  },
  {
    id: "editorial",
    label: "Editorial",
    basis: "light",
    thesis:
      "A magazine-grade light layout: serif headlines, generous measure, one grounded accent. Thoughtful and human — for narrative, founder, or community launches.",
    colors: {
      bg: "#EFE7D4",
      surface: "#F6F1E4",
      text: "#1A1A17",
      textMuted: "#6A6453",
      accent: "#2E4A2A",
      accentText: "#EFE7D4",
      border: "#D8CFB8",
      positive: "#2E7D52",
      negative: "#B23A3A",
    },
    type: {
      display: "Playfair Display",
      body: "EB Garamond",
      mono: "JetBrains Mono",
      note: "Playfair Display headlines over EB Garamond body — a true editorial serif pairing; JetBrains Mono for labels.",
    },
    spacing: "Wide editorial measure: 80–140px margins, body capped ~60ch, asymmetric two-column splits.",
    radius: "Minimal: 4–8px, mostly square. The restraint reads as print.",
    shadow: "None — the look is flat print. Depth comes from rules, measure, and type scale.",
    background:
      "Warm paper field with a faint baseline grid or single hairline rule; oversized serif quote-mark on quote frames.",
    rules: [
      "Serif headlines with negative tracking; let one hero line dominate at 4–7× body.",
      "Pair serif display with serif/sans body across a clear boundary — never two sans.",
      "One earthy accent, grounded not bright; use it for the rule, kicker, and one mark.",
      "Lean on whitespace and a strong baseline — don't fill the frame to prove density.",
      "Mono labels and folios only; keep the body warm and readable, never uppercase runs.",
    ],
    tones: ["warm-startup", "crisp-saas"],
    keywords: [
      "story", "founder", "community", "blog", "newsletter", "content", "writing",
      "editorial", "magazine", "human", "mission", "manifesto", "thought",
    ],
  },
  {
    id: "bold-launch",
    label: "Bold Launch",
    basis: "light",
    thesis:
      "Poster energy: oversized heavy display, one hot accent, high contrast. Built to stop the scroll for a loud, confident announcement.",
    colors: {
      bg: "#FFFFFF",
      surface: "#F5F2EF",
      text: "#1C1410",
      textMuted: "#6B5F57",
      accent: "#D8000F",
      accentText: "#FFFFFF",
      border: "#1C1410",
      positive: "#0B8A3A",
      negative: "#D8000F",
    },
    type: {
      display: "Archivo Black",
      body: "Inter",
      mono: "Space Mono",
      note: "Archivo Black (heavy poster display) over Inter body; Space Mono for tags. Massive scale jump is the point.",
    },
    spacing: "Tight, punchy: hero type at 70–90% frame width, content pinned to edges, hard structural blocks.",
    radius: "Square or near-square (0–4px); the hard edge is part of the poster attitude.",
    shadow: "Optional flat offset block-shadow (e.g. 8px 8px 0) on the hero only — a graphic device, never soft blur.",
    background:
      "High-contrast field (white or accent block) with oversized ghost numerals/type and bold structural rules. Color-block splits welcome.",
    rules: [
      "Go big: one oversized heavy headline per frame, scaled far beyond the body.",
      "One hot accent at full saturation; pair it only with near-black and white.",
      "Use hard cuts and structural color blocks — energy comes from contrast, not gradients.",
      "Keep body type small and plain so the display does all the shouting.",
      "Don't soften it — avoid pastel tints, soft blurs, and timid spacing.",
    ],
    tones: ["bold-launch"],
    keywords: [
      "launch", "bold", "big", "announce", "campaign", "ad", "promo", "energy",
      "consumer", "viral", "social", "drop", "reveal", "hype",
    ],
  },
  {
    id: "crisp-dev",
    label: "Crisp Dev-Tool",
    basis: "dark",
    thesis:
      "Cool dark precision for developer tools: terminal-adjacent, mono-accented, exact. Reads as fast, technical, and trustworthy.",
    colors: {
      bg: "#0B0F14",
      surface: "#121821",
      text: "#E6EDF3",
      textMuted: "#8B98A6",
      accent: "#3B82F6",
      accentText: "#0B0F14",
      border: "#1E2733",
      positive: "#3FB950",
      negative: "#F85149",
    },
    type: {
      display: "Outfit",
      body: "Inter",
      mono: "JetBrains Mono",
      note: "Outfit display over Inter UI; JetBrains Mono is load-bearing — code, metrics, and chrome all live in mono.",
    },
    spacing: "Precise: 48–96px padding, 8px-grid alignment, dense but ordered. Code/terminal cards as hero surfaces.",
    radius: "Tight: 6–10px surfaces, 4px inputs/chips. Crisp, consistent corners.",
    shadow: "Subtle (0 2px 12px rgba(0,0,0,0.4)) on cards; localized accent glow on the focal element only.",
    background:
      "Cool near-black with a faint dot/line grid and a single radial accent glow. Never a banding linear gradient.",
    rules: [
      "Let mono do real work — code, metrics, and labels read as a developer surface, not decoration.",
      "Tint neutrals cool toward the accent; keep one electric accent for the focal mark.",
      "Use a faint grid and crisp 8px alignment — precision is the brand.",
      "Localized radial glow only; no full-screen linear gradients (they band under H.264).",
      "Don't decorate for its own sake — every element should read as functional/technical.",
    ],
    tones: ["crisp-saas", "bold-launch"],
    keywords: [
      "dev", "developer", "api", "cli", "sdk", "code", "terminal", "infra",
      "observability", "database", "deploy", "latency", "performance", "open source", "devtool",
    ],
  },
];

export function presetById(id: string): FramePreset | undefined {
  return FRAME_PRESETS.find((preset) => preset.id === id);
}
