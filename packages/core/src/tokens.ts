/**
 * The token lattice (T1 — token-quantized motion space).
 *
 * Every numeric that affects motion or style anywhere in Sequences is a named
 * token defined here. Raw numbers in a scene graph are a validation error by
 * construction: the zod schemas enumerate these token ids, so an agent (or a
 * human) literally cannot express an off-lattice value.
 *
 * NOTE FOR TUNERS: the master plan schedules "two full days of watching
 * renders" to tune these by eye. The values below are reasonable first-pass
 * choices, not final taste. Change values here — never bypass the lattice.
 */

export const FPS = 30;

/** Durations in frames @30fps. */
export const DURATION_TOKENS = {
  instant: 6,
  quick: 10,
  base: 16,
  relaxed: 24,
  slow: 36,
  dramatic: 54,
} as const;
export type DurationToken = keyof typeof DURATION_TOKENS;
export const DURATION_TOKEN_IDS = Object.keys(DURATION_TOKENS) as DurationToken[];

/** Ordered fastest → slowest, used by the solver/linter to step durations. */
export const DURATION_ORDER: DurationToken[] = [
  "instant",
  "quick",
  "base",
  "relaxed",
  "slow",
  "dramatic",
];

/**
 * Role-typed easings (review amendment): `enter.*` are fast-out/slow-settle,
 * `exit.*` are slow-out/fast-in, `move.*` near-linear middle. Primitives may
 * only reference easings of their own role — enforced by each primitive's
 * params schema, and double-checked by the linter's easing-whitelist rule.
 *
 * `kind: "bezier"` easings are registered at runtime via GSAP CustomEase under
 * the sanitized `runtimeName` (no dots — GSAP's ease-string parser treats dots
 * as ease-family separators). `kind: "gsap"` easings are native GSAP strings.
 */
export const EASING_TOKENS = {
  "enter.snap": { kind: "bezier", curve: "0.2,0.9,0.3,1", runtimeName: "seqEnterSnap" },
  "enter.glide": { kind: "bezier", curve: "0.35,0,0.15,1", runtimeName: "seqEnterGlide" },
  "enter.settle": { kind: "bezier", curve: "0.26,1.12,0.42,1", runtimeName: "seqEnterSettle" },
  "enter.springSoft": { kind: "gsap", value: "elastic.out(1,0.75)" },
  "exit.swift": { kind: "bezier", curve: "0.5,0,0.8,0.5", runtimeName: "seqExitSwift" },
  "exit.fade": { kind: "gsap", value: "power1.in" },
  "move.glide": { kind: "bezier", curve: "0.4,0.05,0.6,0.95", runtimeName: "seqMoveGlide" },
  "linear.mech": { kind: "gsap", value: "none" },
} as const;
export type EasingToken = keyof typeof EASING_TOKENS;
export const EASING_TOKEN_IDS = Object.keys(EASING_TOKENS) as EasingToken[];

export type EasingRole = "enter" | "exit" | "move" | "linear";
export function easingRole(token: EasingToken): EasingRole {
  return token.split(".")[0] as EasingRole;
}
export const ENTER_EASINGS = EASING_TOKEN_IDS.filter((t) => easingRole(t) === "enter");
export const EXIT_EASINGS = EASING_TOKEN_IDS.filter((t) => easingRole(t) === "exit");
export const MOVE_EASINGS = EASING_TOKEN_IDS.filter(
  (t) => easingRole(t) === "move" || easingRole(t) === "linear",
);

/** Distances as a fraction of the frame's smaller dimension (height @16:9). */
export const DISTANCE_TOKENS = {
  nudge: 0.02,
  step: 0.06,
  travel: 0.14,
  sweep: 0.4,
} as const;
export type DistanceToken = keyof typeof DISTANCE_TOKENS;
export const DISTANCE_TOKEN_IDS = Object.keys(DISTANCE_TOKENS) as DistanceToken[];

/** Staggers in frames. */
export const STAGGER_TOKENS = {
  tight: 2,
  base: 4,
  loose: 7,
} as const;
export type StaggerToken = keyof typeof STAGGER_TOKENS;
export const STAGGER_TOKEN_IDS = Object.keys(STAGGER_TOKENS) as StaggerToken[];

/** Scale factors. */
export const SCALE_TOKENS = {
  subtle: 1.03,
  pop: 1.12,
  hero: 1.35,
} as const;
export type ScaleToken = keyof typeof SCALE_TOKENS;
export const SCALE_TOKEN_IDS = Object.keys(SCALE_TOKENS) as ScaleToken[];

/** Blur radii in px (at 1080p design resolution). */
export const BLUR_TOKENS = {
  soft: 8,
  heavy: 24,
} as const;
export type BlurToken = keyof typeof BLUR_TOKENS;

/** Primitive-only style/geometry constants. Kept here so emitters stay token-pure. */
export const PRIMITIVE_STYLE_TOKENS = {
  maskRevealOffsetPercent: 110,
  charRisePercent: 80,
  countRevealDuration: "quick" as DurationToken,
  glowBlur: "heavy" as BlurToken,
  underlineYPercent: 95,
  underlineThicknessEm: 0.08,
} as const;

/**
 * Type scale in px at the 1920×1080 design resolution. The compiler scales
 * proportionally for other resolutions.
 */
export const TYPE_TOKENS = {
  mega: { size: 220, weight: 800, lineHeight: 1.0, tracking: "-0.02em" },
  display: { size: 120, weight: 800, lineHeight: 1.05, tracking: "-0.02em" },
  headline: { size: 84, weight: 700, lineHeight: 1.1, tracking: "-0.01em" },
  title: { size: 56, weight: 700, lineHeight: 1.15, tracking: "0" },
  body: { size: 38, weight: 500, lineHeight: 1.35, tracking: "0" },
  caption: { size: 28, weight: 500, lineHeight: 1.3, tracking: "0.02em" },
} as const;
export type TypeToken = keyof typeof TYPE_TOKENS;
export const TYPE_TOKEN_IDS = Object.keys(TYPE_TOKENS) as TypeToken[];

/** Semantic brand color slots. Values live in the project's BrandKit. */
export const COLOR_TOKEN_IDS = ["primary", "surface", "text", "muted", "accent"] as const;
export type ColorToken = (typeof COLOR_TOKEN_IDS)[number];

/** Solver defaults (review amendments baked in). */
export const CHOREO_DEFAULTS = {
  /** Next entrance begins at 65% of the previous entrance's duration. */
  overlapBudget: 0.65,
  /** Max layers with overlapping active animation windows. */
  simultaneityCap: 3,
  /** Minimum hold (duration token) after last entrance before first exit. */
  settleGap: "quick" as DurationToken,
  stagger: "base" as StaggerToken,
} as const;

export function framesToSeconds(frames: number, fps: number = FPS): number {
  // Round to ms precision so emitted HTML is stable across platforms.
  return Math.round((frames / fps) * 1000) / 1000;
}

/** Scale a duration authored in the 30fps token lattice to project frames. */
export function scaleFrames30(frames: number, fps: number): number {
  return Math.max(1, Math.round((frames * fps) / FPS));
}
