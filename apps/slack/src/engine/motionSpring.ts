/**
 * Motion springs — the physics foundation of the pre-built asset system
 * (ASSETS.md). Asset animations must feel produced, not tweened: an expanding
 * badge lands with a real bounce, a settling card overshoots ~3% once, a snap
 * never overshoots at all. Instead of hand-tuned cubic-beziers per animation,
 * every asset animation names a damped-harmonic-oscillator spring
 * ({frequencyHz, dampingRatio}) and the host derives everything else:
 *
 * - the closed-form position curve x(t) with x(0)=0, x'(0)=0, x(∞)=1
 *   (underdamped ζ<1 → visible bounce; ζ=1 critically damped; ζ>1 sluggish);
 * - the natural duration (time to settle within SETTLE_EPSILON of rest) so
 *   a bouncier spring automatically plays longer;
 * - a normalized ease function (for GSAP `registerEase` in a film runtime);
 * - a CSS `linear()` easing string (for WAAPI/CSS in the Asset Lab webview).
 *
 * Everything here is a pure function of the config — deterministic bytes for
 * the same spring, the strip-and-reinject discipline's prerequisite.
 */

export interface SpringConfigV1 {
  /** Undamped natural frequency in Hz — how fast the motion wants to move. */
  frequencyHz: number;
  /**
   * Damping ratio ζ: <1 overshoots (lower = bouncier), 1 critically damped
   * (fastest possible no-overshoot), >1 overdamped (sluggish — rarely right).
   */
  dampingRatio: number;
}

/**
 * The house spring vocabulary. Assets name one of these per animation; a
 * bespoke {frequencyHz, dampingRatio} is allowed but should be rare — presets
 * keep the library's motion reading as one system.
 */
export const SPRING_PRESETS = {
  /** Two visible bounces — playful scale emphasis ("expand" style moves). */
  bounce: { frequencyHz: 2.6, dampingRatio: 0.38 },
  /** Fast attack, one ~12% overshoot — entrances on compact surfaces. */
  pop: { frequencyHz: 3.2, dampingRatio: 0.55 },
  /** One ~3% overshoot then rest — default for state/value changes. */
  settle: { frequencyHz: 3.0, dampingRatio: 0.82 },
  /** Critically damped and quick — position corrections, never bouncy. */
  snap: { frequencyHz: 5.0, dampingRatio: 1 },
  /** Soft, slow drift to rest — ambient/large-surface motion. */
  gentle: { frequencyHz: 1.6, dampingRatio: 0.9 },
} as const satisfies Record<string, SpringConfigV1>;

export type SpringPresetName = keyof typeof SPRING_PRESETS;

export type SpringRef = SpringPresetName | SpringConfigV1;

/** Rest is declared when the response stays within this of the target. */
const SETTLE_EPSILON = 0.001;
/** Physical bounds keeping any config solvable and film-scaled. */
const FREQUENCY_HZ_MIN = 0.25;
const FREQUENCY_HZ_MAX = 12;
const DAMPING_MIN = 0.12;
const DAMPING_MAX = 2;
const SETTLE_SEC_MAX = 6;

export function resolveSpring(ref: SpringRef): SpringConfigV1 {
  const config = typeof ref === "string" ? SPRING_PRESETS[ref] : ref;
  return {
    frequencyHz: Math.min(FREQUENCY_HZ_MAX, Math.max(FREQUENCY_HZ_MIN, config.frequencyHz)),
    dampingRatio: Math.min(DAMPING_MAX, Math.max(DAMPING_MIN, config.dampingRatio)),
  };
}

/**
 * Closed-form unit step response at time t (seconds): 0 at t=0, →1 at rest,
 * overshooting 1 when underdamped. Exact physics, no integration drift.
 */
export function springPosition(ref: SpringRef, tSec: number): number {
  const { frequencyHz, dampingRatio: zeta } = resolveSpring(ref);
  if (tSec <= 0) return 0;
  const omega = 2 * Math.PI * frequencyHz;
  if (zeta < 1) {
    const omegaD = omega * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-zeta * omega * tSec);
    return 1 - decay * (Math.cos(omegaD * tSec) + ((zeta * omega) / omegaD) * Math.sin(omegaD * tSec));
  }
  if (zeta === 1) {
    return 1 - Math.exp(-omega * tSec) * (1 + omega * tSec);
  }
  const root = Math.sqrt(zeta * zeta - 1);
  const r1 = -omega * (zeta - root);
  const r2 = -omega * (zeta + root);
  return 1 + (r2 * Math.exp(r1 * tSec) - r1 * Math.exp(r2 * tSec)) / (r1 - r2);
}

/**
 * The spring's natural duration: the LAST time the response leaves the
 * ±SETTLE_EPSILON band around rest (scanned at 1ms — exact enough for motion,
 * deterministic, and correct for both oscillating and monotonic responses).
 */
export function springSettleSec(ref: SpringRef): number {
  const config = resolveSpring(ref);
  const stepSec = 0.001;
  let lastOutside = 0;
  for (let t = 0; t <= SETTLE_SEC_MAX; t += stepSec) {
    if (Math.abs(1 - springPosition(config, t)) > SETTLE_EPSILON) lastOutside = t;
  }
  return Math.round((lastOutside + stepSec) * 1000) / 1000;
}

/**
 * Normalized ease over the spring's natural duration: ease(0)=0, ease(1)=1
 * exactly (the residual epsilon is normalized out so an end state is honest),
 * with mid-course values free to overshoot 1. Shaped for GSAP registerEase.
 */
export function springEase(ref: SpringRef): (progress: number) => number {
  const config = resolveSpring(ref);
  const durationSec = springSettleSec(config);
  const terminal = springPosition(config, durationSec) || 1;
  return (progress: number): number => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    return springPosition(config, progress * durationSec) / terminal;
  };
}

/** Evenly-spaced ease samples (count points, first 0, last 1). */
export function springSamples(ref: SpringRef, count = 48): number[] {
  const ease = springEase(ref);
  const points = Math.max(8, Math.round(count));
  return Array.from({ length: points }, (_, i) =>
    Math.round(ease(i / (points - 1)) * 10000) / 10000,
  );
}

/**
 * CSS `linear()` easing string for WAAPI/CSS consumers (the Asset Lab).
 * `linear()` outputs may exceed 1, so overshoot survives the encoding —
 * unlike any cubic-bezier approximation.
 */
export function springLinearEasing(ref: SpringRef, count = 48): string {
  const samples = springSamples(ref, count);
  const last = samples.length - 1;
  const stops = samples.map((value, i) => {
    const pct = Math.round((i / last) * 10000) / 100;
    return i === 0 ? `${value}` : `${value} ${pct}%`;
  });
  return `linear(${stops.join(", ")})`;
}
