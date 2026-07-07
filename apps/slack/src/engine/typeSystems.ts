/**
 * Curated SaaS type systems — display + body + mono trios for a launch film.
 *
 * This is the integrated, embedded-only successor to the isolated
 * `vendor/font-pairing/` sandbox. That tool reached for 2026 Google-Fonts
 * families (Space Grotesk, Fraunces, Manrope, Sora, Plus Jakarta, IBM Plex Sans,
 * Newsreader, Bricolage) — none of which the HyperFrames renderer embeds, so at
 * render time they silently fell back to system generics. Here every family is
 * one the producer actually draws (see `EMBEDDED_FONTS` in brandTokens.ts /
 * skillContext.ts), so what the art director picks is what the film renders.
 *
 * Each system keeps the spirit of its vendor ancestor but maps the reach-font to
 * its nearest embedded equivalent (the same discipline framePresets.ts uses):
 * Space Grotesk→Outfit, Fraunces/Newsreader→Playfair Display, Manrope→Nunito,
 * Sora→Poppins, Bricolage→Archivo Black, IBM Plex Sans→Inter.
 *
 * Deterministic by construction: same brief → same shortlist. No network, no
 * model call, no failure mode. The AI in the loop is the frame-design director
 * already choosing over this safe menu.
 */

import { EMBEDDED_FONTS } from "./brandTokens.ts";

export interface TypeRole {
  /** An embedded family name (must be in EMBEDDED_FONTS). */
  family: string;
  /** The weights the film actually uses — kept tight to what the render embeds. */
  weights: number[];
}

export interface TypeSystem {
  id: string;
  name: string;
  /** One-line mood description shown to the director. */
  vibe: string;
  /** Mood keywords scored against the brief. */
  tags: string[];
  display: TypeRole;
  body: TypeRole;
  mono: TypeRole;
  /** Why this pairing works — one sentence of taste, shown to the director. */
  rationale: string;
}

/**
 * The roster. ~10 systems spanning the SaaS launch range, every family embedded.
 * Display faces are varied (Inter, Outfit, Playfair, Nunito, Poppins, Archivo
 * Black, Montserrat, Oswald) so the diversity guard always yields a real range.
 */
export const TYPE_SYSTEMS: TypeSystem[] = [
  {
    id: "signal",
    name: "Signal",
    vibe: "The safe default — neutral, trustworthy, unmistakably modern product UI.",
    tags: [
      "neutral", "default", "product", "trustworthy", "clean", "modern", "saas",
      "ui", "minimal", "b2b", "dashboard", "professional", "platform",
    ],
    display: { family: "Inter", weights: [700, 900] },
    body: { family: "Inter", weights: [400, 700] },
    mono: { family: "JetBrains Mono", weights: [400, 700] },
    rationale:
      "Inter is the lingua franca of product UI — it never looks wrong on screen. One family across display and body reads as a single calm voice (the Linear/Vercel register); JetBrains Mono keeps terminals and stat readouts crisp.",
  },
  {
    id: "grotesk",
    name: "Grotesk",
    vibe: "Bold techy startup — geometric confidence up top, calm workhorse underneath.",
    tags: [
      "bold", "techy", "startup", "developer", "energetic", "geometric",
      "confident", "launch", "infra", "platform", "ai", "modern",
    ],
    display: { family: "Outfit", weights: [700, 900] },
    body: { family: "Inter", weights: [400, 700] },
    mono: { family: "JetBrains Mono", weights: [400, 700] },
    rationale:
      "Outfit's tight geometry reads as 'a startup that ships' (the closest embedded cousin to Space Grotesk); Inter body keeps long UI copy readable. Strong for dev-tool and infra launches.",
  },
  {
    id: "editorial",
    name: "Editorial",
    vibe: "Premium serif hero — an expressive title card, a literary reading face beneath.",
    tags: [
      "editorial", "premium", "expressive", "hero", "elegant", "sophisticated",
      "brand", "story", "magazine", "luxury", "announcement", "rebrand", "vision",
    ],
    display: { family: "Playfair Display", weights: [700, 900] },
    body: { family: "EB Garamond", weights: [400, 700] },
    mono: { family: "JetBrains Mono", weights: [400, 700] },
    rationale:
      "Playfair Display over EB Garamond is a true editorial serif pairing — it makes a hero lockup feel authored, not templated. Reach for it when the film has one big statement moment.",
  },
  {
    id: "warmth",
    name: "Warmth",
    vibe: "Humanist and friendly — approachable without being childish.",
    tags: [
      "friendly", "warm", "approachable", "human", "consumer", "welcoming",
      "soft", "onboarding", "community", "wellness", "support", "care",
    ],
    display: { family: "Nunito", weights: [700, 900] },
    body: { family: "Nunito", weights: [400, 700] },
    mono: { family: "Space Mono", weights: [400, 700] },
    rationale:
      "Nunito's rounded terminals feel warm at every weight, so one family carries both roles cleanly (the embedded stand-in for Manrope); Space Mono adds personality to code without going cold. Good for consumer and onboarding stories.",
  },
  {
    id: "pop",
    name: "Pop",
    vibe: "Playful and energetic — rounded, upbeat, made to bounce.",
    tags: [
      "playful", "energetic", "rounded", "consumer", "fun", "vibrant", "bounce",
      "social", "creative", "colorful", "delight", "mobile",
    ],
    display: { family: "Poppins", weights: [700, 900] },
    body: { family: "Inter", weights: [400, 700] },
    mono: { family: "Space Mono", weights: [400, 700] },
    rationale:
      "Poppins' open, buoyant caps love a springy pop/scale entrance (the embedded cousin to Sora); Inter body keeps it grown-up. Use it when the motion plan calls for playful beats.",
  },
  {
    id: "infra",
    name: "Infra",
    vibe: "Developer / technical — precise, engineered, terminal-forward.",
    tags: [
      "technical", "precise", "developer", "infra", "engineering", "terminal",
      "code", "cli", "devtool", "systems", "security", "data", "observability",
      "database", "deploy", "latency",
    ],
    display: { family: "Outfit", weights: [600, 800] },
    body: { family: "Inter", weights: [400, 700] },
    mono: { family: "IBM Plex Mono", weights: [400, 700] },
    rationale:
      "IBM Plex Mono is load-bearing here — code, metrics, and labels live in mono as a real developer surface; Outfit/Inter keep the marketing chrome quiet around it. Reads as serious engineering, not marketing.",
  },
  {
    id: "ledger",
    name: "Ledger",
    vibe: "Fintech trust — a refined serif header over a rigorous, number-crisp sans.",
    tags: [
      "trustworthy", "refined", "fintech", "serious", "finance", "enterprise",
      "legal", "authority", "established", "banking", "payments", "money",
    ],
    display: { family: "Playfair Display", weights: [500, 700] },
    body: { family: "Inter", weights: [400, 700] },
    mono: { family: "IBM Plex Mono", weights: [400, 700] },
    rationale:
      "A refined serif signals credibility and care; Inter keeps figures and tables crisp (set metrics with tabular discipline). The move for finance, security, and enterprise stories that must feel earned.",
  },
  {
    id: "impact",
    name: "Impact",
    vibe: "Big-display statement — heavy, chunky, unmissable.",
    tags: [
      "bold", "impact", "hero", "statement", "expressive", "loud", "display",
      "campaign", "manifesto", "punchy", "headline", "drop", "reveal", "hype",
    ],
    display: { family: "Archivo Black", weights: [400] },
    body: { family: "Inter", weights: [400, 700] },
    mono: { family: "JetBrains Mono", weights: [400, 700] },
    rationale:
      "Archivo Black fills the frame on a big title beat (the embedded stand-in for Bricolage's heavy display); keep it to the hero and let Inter run the rest so it never tires the eye.",
  },
  {
    id: "precision",
    name: "Precision",
    vibe: "Minimal geometric — calm, clean, Swiss-adjacent restraint.",
    tags: [
      "minimal", "geometric", "clean", "calm", "restrained", "swiss", "elegant",
      "quiet", "spacious", "premium", "apple", "design",
    ],
    display: { family: "Montserrat", weights: [700, 900] },
    body: { family: "Inter", weights: [400, 700] },
    mono: { family: "JetBrains Mono", weights: [400, 700] },
    rationale:
      "Montserrat is an even geometric sans with no gimmicks — perfect for calm, spacious layouts (the Apple-adjacent register) where motion and whitespace do the talking. Inter body keeps it grounded.",
  },
  {
    id: "condensed",
    name: "Condensed",
    vibe: "Tall condensed energy — news/sports/poster verticality.",
    tags: [
      "condensed", "news", "sports", "editorial", "tall", "poster", "energetic",
      "broadcast", "urgent", "headline", "kinetic",
    ],
    display: { family: "Oswald", weights: [400, 700] },
    body: { family: "Inter", weights: [400, 700] },
    mono: { family: "Space Mono", weights: [400, 700] },
    rationale:
      "Oswald's tall condensed caps stack big vertical statements and love kinetic type; Inter keeps the supporting copy plain so the display carries the volume.",
  },
];

/** Every family named above must be one the renderer embeds. */
export function typeSystemFamiliesAreEmbedded(): boolean {
  const embedded = new Set<string>(EMBEDDED_FONTS);
  return TYPE_SYSTEMS.every(
    (system) =>
      embedded.has(system.display.family) &&
      embedded.has(system.body.family) &&
      embedded.has(system.mono.family),
  );
}

export function typeSystemById(id: string): TypeSystem | undefined {
  return TYPE_SYSTEMS.find((system) => system.id === id);
}

interface ScoredSystem {
  system: TypeSystem;
  score: number;
  matchedTags: string[];
}

/** Word-boundary tag match so "ai" doesn't fire inside "captain". */
function scoreSystem(system: TypeSystem, lowerText: string): { score: number; matchedTags: string[] } {
  let score = 0;
  const matchedTags: string[] = [];
  for (const tag of system.tags) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`);
    if (!re.test(lowerText)) continue;
    score += tag.includes(" ") ? 2 : 1;
    matchedTags.push(tag);
  }
  // An explicitly named family is a strong signal.
  for (const role of [system.display, system.body, system.mono]) {
    if (lowerText.includes(role.family.toLowerCase())) score += 3;
  }
  return { score, matchedTags };
}

/**
 * The top `n` type systems for a brief, most relevant first. A diversity guard
 * avoids returning two systems that share a display face, so the shortlist
 * always spans a range of looks; an empty/no-match brief returns the roster's
 * own order (a sensible varied default). Deterministic.
 */
export function pickTypeSystems(brief: string, n = 5): TypeSystem[] {
  const lower = (brief ?? "").toLowerCase();
  const scored: ScoredSystem[] = TYPE_SYSTEMS.map((system, index) => ({
    system,
    ...scoreSystem(system, lower),
    index,
  })).sort((a, b) =>
    b.score - a.score ||
    TYPE_SYSTEMS.indexOf(a.system) - TYPE_SYSTEMS.indexOf(b.system),
  );

  const picked: TypeSystem[] = [];
  const usedDisplay = new Set<string>();
  for (const entry of scored) {
    if (picked.length >= n) break;
    if (usedDisplay.has(entry.system.display.family)) continue;
    picked.push(entry.system);
    usedDisplay.add(entry.system.display.family);
  }
  // Backfill by rank if the diversity guard left the shortlist short.
  for (const entry of scored) {
    if (picked.length >= n) break;
    if (!picked.includes(entry.system)) picked.push(entry.system);
  }
  return picked;
}

/** Compact one-liner for the art-direction prompt. */
export function typeSystemLine(system: TypeSystem): string {
  const heavy = (role: TypeRole) => Math.max(...role.weights);
  const light = (role: TypeRole) => Math.min(...role.weights);
  return (
    `- ${system.id} (${system.vibe}) — display ${system.display.family} ${heavy(system.display)}, ` +
    `body ${system.body.family} ${light(system.body)}, mono ${system.mono.family} ${light(system.mono)}`
  );
}

/** The shortlist block handed to the frame-design director for one brief. */
export function typeSystemShortlist(brief: string, n = 5): string {
  return pickTypeSystems(brief, n).map(typeSystemLine).join("\n");
}

/** Partial FrameType from a chosen system (used when no brand font is committed). */
export function typeSystemToFrameType(system: TypeSystem): {
  display: string;
  body: string;
  mono: string;
  note: string;
} {
  return {
    display: system.display.family,
    body: system.body.family,
    mono: system.mono.family,
    note: system.rationale,
  };
}
