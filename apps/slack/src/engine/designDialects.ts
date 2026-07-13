/**
 * Motion-ready visual dialects distilled from the vendored DESIGN.md research.
 *
 * Presets answer broad mood (clean corporate, bold launch, crisp dev-tool).
 * Dialects answer the more specific design question: what kind of canvas,
 * typography, surface treatment, and motion character makes this film distinct?
 * Their ids and labels stay generic; source refs are provenance, not permission
 * to copy a brand mark, proprietary asset, or product UI.
 */

export type DesignTone = "crisp-saas" | "warm-startup" | "bold-launch";

export type TypographyPairingMode = "contrasting" | "single-family";
export type CanvasPolicyId =
  | "true-white"
  | "warm-paper"
  | "binary-solid"
  | "chapter-color"
  | "near-black"
  | "atmospheric-light";
export type ColorTopology = "single-accent" | "chapter-palette" | "monochrome";
export type MaterialProfile = "clean-flat" | "paper-flat" | "soft-elevated" | "cinematic";
export type BackgroundPolicyId =
  | "quiet-solid"
  | "gallery-alternation"
  | "paper-rules"
  | "chapter-block"
  | "image-stage"
  | "localized-mesh"
  | "ink-rail"
  | "precision-grid";

export interface BackgroundPolicy {
  id: BackgroundPolicyId;
  label: string;
  /** Concrete author-facing construction direction; never a placeholder. */
  direction: string;
}

export const BACKGROUND_POLICIES: readonly BackgroundPolicy[] = [
  {
    id: "quiet-solid",
    label: "Intentional solid field",
    direction:
      "Use one deliberate solid canvas for the shot. Hierarchy comes from type, scale, crop, and one structural surface step; do not add glow or texture from habit.",
  },
  {
    id: "gallery-alternation",
    label: "Gallery alternation",
    direction:
      "Alternate edge-to-edge light, parchment, and occasional dark product fields. The field change is the divider; keep hero imagery or one artifact on a generous pedestal.",
  },
  {
    id: "paper-rules",
    label: "Paper and rules",
    direction:
      "Build on a warm paper field with a sparse baseline, folio, or hairline rule. Keep the field flat and let editorial measure and typography create depth.",
  },
  {
    id: "chapter-block",
    label: "Solid chapter block",
    direction:
      "Give one scene or station one full-strength chapter color, separated from the next color by a neutral reset. Never show competing chapter fields in the same framing.",
  },
  {
    id: "image-stage",
    label: "Image-led stage",
    direction:
      "Use one project-local image or product render as the field, cropped around a declared text-safe zone. Move it only with a restrained 2–4% pan or scale drift.",
  },
  {
    id: "localized-mesh",
    label: "Localized mesh atmosphere",
    direction:
      "Use a project-local raster/SVG mesh or two bounded radial fields behind the hero, leaving a calm reading zone. Color is atmosphere, not a full-frame CSS gradient wash.",
  },
  {
    id: "ink-rail",
    label: "Ink field and editorial rail",
    direction:
      "Use a solid ink or near-black field with one structural rail, timestamp column, or hard rule. Saturated color appears as a bounded story block, never a soft wash.",
  },
  {
    id: "precision-grid",
    label: "Precision grid",
    direction:
      "Use a quiet technical field with one low-contrast grid or scan rule and a single local signal light. The grid must organize the shot, not decorate empty space.",
  },
] as const;

export interface DesignDialect {
  id: string;
  label: string;
  /** Internal research provenance; never rendered as visible brand copy. */
  sourceRefs: string[];
  preferredBasis: "light" | "dark" | "either";
  canvas: {
    id: CanvasPolicyId;
    allowPureWhite: boolean;
    allowPureBlack: boolean;
    allowSolidField: boolean;
    description: string;
  };
  colorTopology: ColorTopology;
  /** Seed used only when the job has no committed brand accent. */
  accent: string;
  palette: {
    bg?: string;
    surface?: string;
    text?: string;
    textMuted?: string;
    accentSoft?: string;
    atmosphere?: string;
    border?: string;
  };
  chapterColors?: string[];
  materialProfile: MaterialProfile;
  typeSystemId: string;
  typography: {
    pairingMode: TypographyPairingMode;
    displayWeight: string;
    bodyWeight: string;
    tracking: string;
    casing: string;
  };
  visualGrammar: string;
  motion: {
    macro: string;
    camera: string;
    micro: string;
    transitions: string;
  };
  backgroundPolicyIds: BackgroundPolicyId[];
  defaultBackgroundPolicyId: BackgroundPolicyId;
  rules: string[];
  tones: DesignTone[];
  keywords: string[];
}

/**
 * Eight deliberately different dialects. They translate reference-site taste
 * into video behavior instead of reproducing web chrome or trademarked assets.
 */
export const DESIGN_DIALECTS: readonly DesignDialect[] = [
  {
    id: "gallery-white",
    label: "Gallery White",
    sourceRefs: [
      "vendor/awesome-design-md/design-md/apple/DESIGN.md",
      "vendor/awesome-design-md/design-md/meta/DESIGN.md",
      "vendor/awesome-design-md/design-md/hp/DESIGN.md",
    ],
    preferredBasis: "light",
    canvas: {
      id: "true-white",
      allowPureWhite: true,
      allowPureBlack: true,
      allowSolidField: true,
      description: "True white and parchment are intentional product pedestals; black is reserved for a deliberate inverse field.",
    },
    colorTopology: "single-accent",
    accent: "#0066CC",
    palette: {
      bg: "#FFFFFF",
      surface: "#F5F5F7",
      text: "#1D1D1F",
      textMuted: "#515154",
      border: "#E0E0E0",
    },
    materialProfile: "clean-flat",
    typeSystemId: "signal",
    typography: {
      pairingMode: "single-family",
      displayWeight: "500–600",
      bodyWeight: "400",
      tracking: "tight display tracking; neutral readable body",
      casing: "sentence case",
    },
    visualGrammar:
      "Museum-gallery restraint: one artifact or product surface owns the frame, chrome recedes, and whitespace acts as the pedestal.",
    motion: {
      macro: "One confident product reveal or measured push; avoid busy multi-card choreography.",
      camera: "Slow pedestal push, short lateral gallery travel, or deliberate pull-back that reveals context once.",
      micro: "Independent 1–3% image/parallax drift, optical highlight travel, and compact 0.95 press feedback keep a held frame alive.",
      transitions: "Field alternation, clean match cuts, and restrained object carries; never decorative spins.",
    },
    backgroundPolicyIds: ["gallery-alternation", "quiet-solid", "image-stage"],
    defaultBackgroundPolicyId: "gallery-alternation",
    rules: [
      "Let one artifact dominate; supporting chrome must visibly recede.",
      "True white is an intentional canvas, not a missing background treatment.",
      "Reserve soft shadow for an image or artifact that needs physical weight, never generic card chrome.",
    ],
    tones: ["crisp-saas", "warm-startup"],
    keywords: ["product", "hardware", "device", "minimal", "precision", "clean", "gallery", "premium", "showcase"],
  },
  {
    id: "warm-coral",
    label: "Warm Coral",
    sourceRefs: [
      "vendor/awesome-design-md/design-md/airbnb/DESIGN.md",
      "vendor/awesome-design-md/design-md/intercom/DESIGN.md",
      "vendor/awesome-design-md/design-md/zapier/DESIGN.md",
    ],
    preferredBasis: "light",
    canvas: {
      id: "true-white",
      allowPureWhite: true,
      allowPureBlack: false,
      allowSolidField: true,
      description: "A generous white consumer canvas with warm ink and scarce coral action moments.",
    },
    colorTopology: "single-accent",
    accent: "#FF385C",
    palette: {
      bg: "#FFFFFF",
      surface: "#F7F7F7",
      text: "#222222",
      textMuted: "#6A6A6A",
      accentSoft: "#FFD9E0",
      border: "#DDDDDD",
    },
    materialProfile: "soft-elevated",
    typeSystemId: "warmth",
    typography: {
      pairingMode: "single-family",
      displayWeight: "500–700",
      bodyWeight: "400",
      tracking: "modestly tight display; open body",
      casing: "sentence case",
    },
    visualGrammar:
      "Friendly photo-led marketplace geometry: soft cards, pill search/action surfaces, circles, and one warm action voltage on abundant white.",
    motion: {
      macro: "A pill, card, or photo surface becomes the story anchor while related details develop around it.",
      camera: "Warm lateral browse, short push into the chosen result, then hold while its state resolves.",
      micro: "Photo crop drift, carousel progress, heart/orb acknowledgment, and quiet metadata movement may overlap beneath the primary action.",
      transitions: "Pill-to-bar or card-to-card silhouette rhymes, photo match cuts, and soft directional swipes.",
    },
    backgroundPolicyIds: ["quiet-solid", "image-stage", "gallery-alternation"],
    defaultBackgroundPolicyId: "quiet-solid",
    rules: [
      "Keep most of the frame white and ink; coral should identify the action, not tint everything.",
      "Use soft geometry consistently and let photography carry visual weight.",
      "One active selection wins; secondary badges and metadata remain calm.",
    ],
    tones: ["warm-startup", "crisp-saas"],
    keywords: ["marketplace", "travel", "customer", "community", "friendly", "consumer", "booking", "support", "people"],
  },
  {
    id: "paper-humanist",
    label: "Paper Humanist",
    sourceRefs: [
      "vendor/awesome-design-md/design-md/claude/DESIGN.md",
      "vendor/awesome-design-md/design-md/mastercard/DESIGN.md",
      "vendor/awesome-design-md/design-md/elevenlabs/DESIGN.md",
    ],
    preferredBasis: "light",
    canvas: {
      id: "warm-paper",
      allowPureWhite: false,
      allowPureBlack: false,
      allowSolidField: true,
      description: "Warm cream paper replaces sterile white; dark and coral fields are deliberate chapter accents.",
    },
    colorTopology: "single-accent",
    accent: "#CC785C",
    palette: {
      bg: "#F3F0E8",
      surface: "#FAF7F0",
      text: "#181715",
      textMuted: "#69645C",
      accentSoft: "#EAD6CB",
      border: "#D8D0C4",
    },
    materialProfile: "paper-flat",
    typeSystemId: "editorial",
    typography: {
      pairingMode: "contrasting",
      displayWeight: "300–500",
      bodyWeight: "400",
      tracking: "negative display tracking; relaxed reading measure",
      casing: "sentence case with sparse tracked eyebrows",
    },
    visualGrammar:
      "Humanist editorial pacing: cream paper, literary display type, asymmetric artifacts, circular crops, and sparse traced relationships.",
    motion: {
      macro: "A statement and one artifact share the frame; the artifact develops while the reading measure remains stable.",
      camera: "Slow editorial track or asymmetric push with generous arrival dwell, never a technical lunge.",
      micro: "Orbital connector drawing, gentle crop drift, folio movement, and small satellite acknowledgments keep paper scenes alive.",
      transitions: "Paper-band reveals, circle/object carries, and typographic match cuts with no glossy morphing.",
    },
    backgroundPolicyIds: ["paper-rules", "quiet-solid", "image-stage"],
    defaultBackgroundPolicyId: "paper-rules",
    rules: [
      "Keep display weight modest; character and scale create authority, not boldness.",
      "Use cream, ink, and one earthy accent before introducing any extra color.",
      "Prefer flat paper and hairlines; elevation is rare and diffuse.",
    ],
    tones: ["warm-startup", "crisp-saas"],
    keywords: ["story", "research", "human", "voice", "founder", "editorial", "thoughtful", "trust", "narrative"],
  },
  {
    id: "poster-signal",
    label: "Poster Signal",
    sourceRefs: [
      "vendor/awesome-design-md/design-md/vodafone/DESIGN.md",
      "vendor/awesome-design-md/design-md/nike/DESIGN.md",
      "vendor/awesome-design-md/design-md/ferrari/DESIGN.md",
    ],
    preferredBasis: "either",
    canvas: {
      id: "binary-solid",
      allowPureWhite: true,
      allowPureBlack: true,
      allowSolidField: true,
      description: "Full-strength white, black, or signal-red fields are deliberate poster surfaces, not defaults to soften.",
    },
    colorTopology: "single-accent",
    accent: "#E60000",
    palette: {
      bg: "#FFFFFF",
      surface: "#F2F2F2",
      text: "#171717",
      textMuted: "#5F5F5F",
      accentSoft: "#FFD9D9",
      border: "#171717",
    },
    materialProfile: "clean-flat",
    typeSystemId: "impact",
    typography: {
      pairingMode: "contrasting",
      displayWeight: "700–900",
      bodyWeight: "400",
      tracking: "tight display tracking; neutral utility copy",
      casing: "uppercase hero, sentence-case support",
    },
    visualGrammar:
      "Campaign-poster force: monumental cropped type, hard binary fields, editorial image crops, and one saturated signal color.",
    motion: {
      macro: "One oversized phrase or image crop crosses the frame with a decisive axis and hands off to a quieter proof layer.",
      camera: "Fast lateral runway, assertive push, or wide pull reveal; arrive cleanly without roll or bounce.",
      micro: "Tracked labels, rules, image crop drift, and small pill feedback continue beneath the hero move.",
      transitions: "Hard cuts, solid cover wipes, and typographic match cuts; avoid soft ambient dissolves.",
    },
    backgroundPolicyIds: ["quiet-solid", "chapter-block", "image-stage"],
    defaultBackgroundPolicyId: "quiet-solid",
    rules: [
      "Let one monumental phrase or crop own the frame.",
      "Use full-strength signal color as a field or action, never a timid glow.",
      "Keep supporting copy plain so the poster gesture retains authority.",
    ],
    tones: ["bold-launch"],
    keywords: ["campaign", "bold", "launch", "drop", "sports", "speed", "poster", "impact", "announce"],
  },
  {
    id: "color-block",
    label: "Color Block",
    sourceRefs: [
      "vendor/awesome-design-md/design-md/figma/DESIGN.md",
      "vendor/awesome-design-md/design-md/clay/DESIGN.md",
      "vendor/awesome-design-md/design-md/miro/DESIGN.md",
    ],
    preferredBasis: "light",
    canvas: {
      id: "chapter-color",
      allowPureWhite: true,
      allowPureBlack: true,
      allowSolidField: true,
      description: "Neutral white/ink bookends separate one full-frame chapter color at a time.",
    },
    colorTopology: "chapter-palette",
    accent: "#111111",
    palette: {
      bg: "#FFFFFF",
      surface: "#F5F5F3",
      text: "#111111",
      textMuted: "#515151",
      border: "#111111",
    },
    chapterColors: ["#C7F464", "#C9B8FF", "#FFD1C7", "#BFE8D0", "#FF8E72", "#20204A"],
    materialProfile: "clean-flat",
    typeSystemId: "signal",
    typography: {
      pairingMode: "single-family",
      displayWeight: "320–540",
      bodyWeight: "320–400",
      tracking: "tight large display; weight-led body hierarchy",
      casing: "sentence case with uppercase mono taxonomy",
    },
    visualGrammar:
      "Monochrome chrome interrupted by one oversized pastel story block per framing, like a deliberate poster or sticky note on a clean wall.",
    motion: {
      macro: "A chapter block takes over, develops one idea, then clears to neutral before the next color arrives.",
      camera: "Short lateral moves between poster-like blocks or a measured push into one block's product artifact.",
      micro: "Independent sticker, cursorless selection, rule, and product-fragment motion can overlap at quiet amplitudes.",
      transitions: "Solid block swaps, edge wipes, and clean shared-object carries; never blend multiple chapter colors into mud.",
    },
    backgroundPolicyIds: ["chapter-block", "quiet-solid"],
    defaultBackgroundPolicyId: "chapter-block",
    rules: [
      "Only one chapter color may dominate a framing; return to neutral between different colors.",
      "Color is the depth device, so chapter blocks stay flat and shadowless.",
      "Keep the interactive accent monochrome even while chapter fields rotate.",
    ],
    tones: ["bold-launch", "warm-startup"],
    keywords: ["design", "creative", "collaboration", "playful", "canvas", "workflow", "colorful", "brainstorm"],
  },
  {
    id: "broadsheet",
    label: "Broadsheet",
    sourceRefs: [
      "vendor/awesome-design-md/design-md/wired/DESIGN.md",
      "vendor/awesome-design-md/design-md/runwayml/DESIGN.md",
      "vendor/awesome-design-md/design-md/uber/DESIGN.md",
    ],
    preferredBasis: "light",
    canvas: {
      id: "binary-solid",
      allowPureWhite: true,
      allowPureBlack: true,
      allowSolidField: true,
      description: "Strict paper white and ink black are the design system; hairlines and type provide structure.",
    },
    colorTopology: "monochrome",
    accent: "#000000",
    palette: {
      bg: "#FFFFFF",
      surface: "#FFFFFF",
      text: "#000000",
      textMuted: "#666666",
      border: "#D9D9D9",
    },
    materialProfile: "paper-flat",
    typeSystemId: "editorial",
    typography: {
      pairingMode: "contrasting",
      displayWeight: "400",
      bodyWeight: "400",
      tracking: "tight serif display; neutral reading copy",
      casing: "editorial sentence case with compact uppercase metadata",
    },
    visualGrammar:
      "Printed-editorial rigor: square geometry, strong typographic measure, masthead-like bands, and hairline-separated story rows.",
    motion: {
      macro: "A headline, rule, or image column establishes the page, then the camera reads across or down it like an edited spread.",
      camera: "Planar pan, column track, or crop push; keep perspective flat and avoid glossy 3D treatment.",
      micro: "Rules draw, folios advance, image crops drift, and metadata ticks while the reading column remains stable.",
      transitions: "Page turns expressed as hard directional wipes, column matches, and ink/white register cuts.",
    },
    backgroundPolicyIds: ["quiet-solid", "paper-rules", "image-stage"],
    defaultBackgroundPolicyId: "paper-rules",
    rules: [
      "Use true black and white without tint when the binary contrast is the point.",
      "Keep surfaces square and flat; hairlines replace generic elevation.",
      "Display authority comes from face and measure at weight 400, not automatic boldness.",
    ],
    tones: ["crisp-saas", "bold-launch"],
    keywords: ["editorial", "report", "research", "news", "publication", "story", "magazine", "document"],
  },
  {
    id: "hazard-dark",
    label: "Hazard Dark",
    sourceRefs: [
      "vendor/awesome-design-md/design-md/theverge/DESIGN.md",
      "vendor/awesome-design-md/design-md/sanity/DESIGN.md",
      "vendor/awesome-design-md/design-md/sentry/DESIGN.md",
    ],
    preferredBasis: "dark",
    canvas: {
      id: "near-black",
      allowPureWhite: false,
      allowPureBlack: false,
      allowSolidField: true,
      description: "A solid warm near-black field supports bounded hazard-color story blocks and structural rails.",
    },
    colorTopology: "chapter-palette",
    accent: "#3CFFD0",
    palette: {
      bg: "#131313",
      surface: "#2D2D2D",
      text: "#FFFFFF",
      textMuted: "#A0A0A0",
      border: "#3CFFD0",
    },
    chapterColors: ["#3CFFD0", "#6B3CFF", "#FFD84A", "#FF5E8A", "#FF7A3D"],
    materialProfile: "clean-flat",
    typeSystemId: "condensed",
    typography: {
      pairingMode: "contrasting",
      displayWeight: "700–900",
      bodyWeight: "400–500",
      tracking: "compressed display; widely tracked uppercase metadata",
      casing: "condensed display plus uppercase mono taxonomy",
    },
    visualGrammar:
      "Dark editorial urgency: condensed display, solid hazard blocks, timestamp rails, and flat outlined surfaces instead of glow-heavy dev-tool chrome.",
    motion: {
      macro: "A signal block hits, locks to a rail or timeline, and hands the eye to the next evidence state.",
      camera: "Directional track along a rail, short whip between bounded story blocks, or decisive push into the active signal.",
      micro: "Timestamp ticks, rail progress, data deltas, and small block shifts overlap beneath the dominant signal.",
      transitions: "Hard register cuts, solid hazard wipes, and rail-aligned matches; no barrel roll or soft neon dissolve.",
    },
    backgroundPolicyIds: ["ink-rail", "chapter-block", "quiet-solid"],
    defaultBackgroundPolicyId: "ink-rail",
    rules: [
      "Use saturated color as a bounded signal block, not a full-canvas glow.",
      "Keep depth flat with borders and rails; avoid generic glassmorphism.",
      "One hazard block leads at a time even when the chapter palette rotates.",
    ],
    tones: ["bold-launch", "crisp-saas"],
    keywords: [
      "incident", "monitoring", "alert", "realtime", "timeline", "feed", "signal",
      "breaking", "urgent", "dev", "developer", "api", "cli", "deploy", "infra",
      "observability",
    ],
  },
  {
    id: "mesh-atmosphere",
    label: "Mesh Atmosphere",
    sourceRefs: [
      "vendor/awesome-design-md/design-md/stripe/DESIGN.md",
      "vendor/awesome-design-md/design-md/framer/DESIGN.md",
      "vendor/awesome-design-md/design-md/elevenlabs/DESIGN.md",
    ],
    preferredBasis: "light",
    canvas: {
      id: "atmospheric-light",
      allowPureWhite: true,
      allowPureBlack: false,
      allowSolidField: true,
      description: "A clean light canvas is interrupted by a bounded image/SVG mesh or pastel atmospheric field.",
    },
    colorTopology: "chapter-palette",
    accent: "#533AFD",
    palette: {
      bg: "#FFFFFF",
      surface: "#F6F9FC",
      text: "#0D253D",
      textMuted: "#61718A",
      accentSoft: "#D9D5FF",
      atmosphere: "#E9D8FF",
      border: "#DCE3EA",
    },
    chapterColors: ["#F5E9D4", "#F4C5A8", "#C8B8E0", "#A8C8E8", "#E8B8C4"],
    materialProfile: "soft-elevated",
    typeSystemId: "signal",
    typography: {
      pairingMode: "single-family",
      displayWeight: "300–400",
      bodyWeight: "300–400",
      tracking: "negative thin display tracking; tabular numeric discipline",
      casing: "sentence case with tiny uppercase eyebrows",
    },
    visualGrammar:
      "Airy financial/creative polish: thin display type, one bounded atmospheric mesh, and real product surfaces composited over a clean reading field.",
    motion: {
      macro: "The atmosphere opens a reading lane, then one product surface or metric moves through it with transactional clarity.",
      camera: "Smooth diagonal or lateral track with a gentle push into product proof; maintain a stable horizon.",
      micro: "Mesh crop drift, numeric alignment, chart growth, and small surface parallax overlap without turning into ambient breathing.",
      transitions: "Mesh-to-solid register shifts, soft object carries, and clean directional wipes; preserve canvas polarity.",
    },
    backgroundPolicyIds: ["localized-mesh", "image-stage", "quiet-solid"],
    defaultBackgroundPolicyId: "localized-mesh",
    rules: [
      "Keep atmospheric color bounded around a calm reading lane.",
      "Use thin display weight and tabular discipline instead of generic heavy SaaS type.",
      "Product proof stays crisp above the atmosphere; never blur the load-bearing UI.",
    ],
    tones: ["crisp-saas", "warm-startup", "bold-launch"],
    keywords: ["payments", "finance", "pricing", "creative", "media", "audio", "premium", "gradient", "atmosphere"],
  },
] as const;

export function designDialectById(id: string): DesignDialect | undefined {
  return DESIGN_DIALECTS.find((dialect) => dialect.id === id);
}

export function backgroundPolicyById(id: string): BackgroundPolicy | undefined {
  return BACKGROUND_POLICIES.find((policy) => policy.id === id);
}

export function backgroundPolicyForDialect(
  dialect: DesignDialect,
  requested?: string,
): BackgroundPolicy {
  const requestedPolicy = requested ? backgroundPolicyById(requested) : undefined;
  if (requestedPolicy && dialect.backgroundPolicyIds.includes(requestedPolicy.id)) {
    return requestedPolicy;
  }
  return backgroundPolicyById(dialect.defaultBackgroundPolicyId)!;
}

function scoreDialect(
  dialect: DesignDialect,
  brief: string,
  tone: DesignTone | undefined,
): number {
  const text = brief.toLowerCase();
  let score = tone && dialect.tones.includes(tone) ? 4 : 0;
  for (const keyword of dialect.keywords) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(text)) score += 2;
  }
  return score;
}

/** Deterministic visual-dialect ranking and model-failure fallback. */
export function rankDesignDialects(
  brief: string,
  tone: DesignTone | undefined,
): DesignDialect[] {
  return [...DESIGN_DIALECTS]
    .map((dialect) => ({ dialect, score: scoreDialect(dialect, brief, tone) }))
    .sort((a, b) =>
      b.score - a.score || DESIGN_DIALECTS.indexOf(a.dialect) - DESIGN_DIALECTS.indexOf(b.dialect)
    )
    .map(({ dialect }) => dialect);
}

/** Backward-compatible direct callers get a coherent dialect even without a brief. */
export function defaultDialectForPreset(presetId: string): DesignDialect {
  const id = presetId === "dark-premium"
    ? "hazard-dark"
    : presetId === "editorial"
      ? "broadsheet"
      : presetId === "bold-launch"
        ? "poster-signal"
        : presetId === "crisp-dev"
          ? "hazard-dark"
          : "gallery-white";
  return designDialectById(id)!;
}

export function dialectCatalogLine(dialect: DesignDialect): string {
  return (
    `- ${dialect.id} (${dialect.preferredBasis}; ${dialect.canvas.id}; ` +
    `${dialect.colorTopology}; ${dialect.materialProfile}; type ${dialect.typography.pairingMode}` +
    `/${dialect.typeSystemId}; backgrounds ${dialect.backgroundPolicyIds.join("/")}): ` +
    dialect.visualGrammar
  );
}
