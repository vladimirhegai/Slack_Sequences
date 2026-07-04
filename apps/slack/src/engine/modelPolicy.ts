import type {
  AgentProvider,
  CompleteOptions,
} from "@sequences/platform/providers";

/*
 * Model-experiment findings (2026-07-03, 9-config matrix, one fixed 18s
 * "Ledgerline" brief, live OpenRouter runs; quality > price/speed per policy):
 *
 * Storyboard axis (author fixed at DeepSeek v4 Pro):
 * - GLM 5.2 medium (default):   PASS 613s — but 3 component beats, missed a
 *   requested kind, and high variance: identical configs failed in 3 later
 *   runs, always dying in the reasoning-stripped retry chain. Both retry-chain
 *   causes were fixed in response (morph-twin prompt rule; validation retries
 *   now keep configured reasoning).
 * - tencent/hy3-preview medium: PASS 512s — 16/16 moments bound, 7 component
 *   beats, covered ALL requested kinds, at ~1/10 GLM price; weaker spatial
 *   worlds (0 multi-station) and slightly noisier QA. The benched storyboard
 *   alternative: promote only after it repeats across several briefs.
 * - GLM high:                    FAIL (quality, 3 rejections).
 * - minimax/minimax-m3 high:     storyboard ok after retries; downstream
 *   repair rewrote the locked scene graph → FAIL.
 * - deepseek-v4-pro high:        planned camera regions/components its own
 *   author could not bind → FAIL.
 * - moonshotai/kimi-k2.7-code:   endpoint 400s on reasoning:none (now handled
 *   by the minimal-reasoning floor) — quality unknown.
 *
 * Author axis (storyboard fixed at GLM medium): kimi-k2.7 truncated at the
 * output ceiling twice and took 2x wall-clock → FAIL; dsv4pro-max-reasoning
 * and flash-high runs got no signal (their storyboard stage failed first).
 * DeepSeek v4 Pro with reasoning off remains the author default.
 */
export const OPENROUTER_CREATIVE_MODEL = "z-ai/glm-5.2";
export const OPENROUTER_PRODUCTION_MODEL = "deepseek/deepseek-v4-pro";
export const OPENROUTER_LIGHT_MODEL = "deepseek/deepseek-v4-flash";

/**
 * Small decisions with disproportionate visual impact belong to the creative
 * director. A call-specific override wins, then the shared creative override;
 * `primary` deliberately returns control to the provider's production model.
 */
export function creativeModel(
  provider: AgentProvider,
  callOverride?: string,
): string | undefined {
  const requested = callOverride?.trim() || process.env.SLACK_SEQUENCES_CREATIVE_MODEL?.trim();
  if (requested?.toLowerCase() === "primary") return undefined;
  if (requested) return requested;
  return provider.id === "openrouter-api" ? OPENROUTER_CREATIVE_MODEL : undefined;
}

export function creativeThinkingMode(
  provider: AgentProvider,
  model: string | undefined,
): CompleteOptions["thinkingMode"] {
  return provider.id === "openrouter-api" && model === OPENROUTER_CREATIVE_MODEL
    ? "high"
    : "none";
}

const THINKING_MODES: ReadonlySet<string> = new Set([
  "auto", "none", "enabled", "minimal", "low", "medium", "high", "xhigh", "max",
]);

/**
 * Operator override for a stage's reasoning effort (model-experimentation and
 * production tuning knob). Unset or unrecognized values keep the stage's
 * built-in default, so the knob can never break a deploy.
 */
export function thinkingOverride(
  envName: string,
): CompleteOptions["thinkingMode"] | undefined {
  const raw = process.env[envName]?.trim().toLowerCase();
  return raw && THINKING_MODES.has(raw)
    ? (raw as CompleteOptions["thinkingMode"])
    : undefined;
}

/**
 * Second-opinion storyboard model. When the primary storyboard model exhausts
 * its bounded attempts (validation rejections OR transient route exhaustion),
 * one rescue pass runs on a *different* model before the deterministic
 * fallback film is allowed to ship: a fresh draw from an independent model
 * recovers far more often than a fourth try of a model that is systematically
 * missing the contract, and an unrelated upstream route sidesteps a provider
 * slowdown. Default is the benched 2026-07-03 alternative (tencent/hy3-preview:
 * 16/16 moments bound, all requested component kinds, ~1/10 GLM price).
 * Override with SLACK_SEQUENCES_STORYBOARD_RESCUE_MODEL; "0"/"none"/"off"
 * disables the rung.
 */
export const OPENROUTER_STORYBOARD_RESCUE_MODEL = "tencent/hy3-preview";

export function storyboardRescueModel(
  provider: AgentProvider,
  primaryModel: string | undefined,
): string | undefined {
  const raw = process.env.SLACK_SEQUENCES_STORYBOARD_RESCUE_MODEL?.trim();
  if (raw && ["0", "none", "off"].includes(raw.toLowerCase())) return undefined;
  const chosen = raw ||
    (provider.id === "openrouter-api" ? OPENROUTER_STORYBOARD_RESCUE_MODEL : undefined);
  if (!chosen || chosen === primaryModel) return undefined;
  return chosen;
}

/** Full source and structural repairs stay on the configured production brain. */
export function productionModel(provider: AgentProvider): string | undefined {
  if (provider.id !== "openrouter-api") return undefined;
  return process.env.SEQUENCES_OPENROUTER_MODEL?.trim() ||
    OPENROUTER_PRODUCTION_MODEL;
}

/**
 * Flash is reserved for bounded helper work whose output is both tiny and
 * deterministically rejectable. It is never selected for taste or full source.
 */
export function lightModel(provider: AgentProvider): string | undefined {
  const configured = process.env.SLACK_SEQUENCES_LIGHT_MODEL?.trim();
  if (configured?.toLowerCase() === "primary") return undefined;
  if (configured) return configured;
  return provider.id === "openrouter-api"
    ? OPENROUTER_LIGHT_MODEL
    : provider.id === "deepseek-api"
      ? "deepseek-v4-flash"
      : undefined;
}
