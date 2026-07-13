import type {
  AgentProvider,
  CompleteOptions,
} from "@sequences/platform/providers";
import {
  slackSequencesEnvRawValue,
  type SlackSequencesEnvName,
} from "./featureFlags.ts";

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
 * Frozen image-input routes for the visual continuity critic. These are kept
 * separate from the creative/source overrides because those stages are
 * intentionally allowed to select text-only models. In particular, an
 * OpenRouter request with images must never fall through to
 * `SEQUENCES_OPENROUTER_MODEL` or the GLM storyboard default.
 *
 * OpenRouter documents Gemini 3.1 Flash Lite as accepting text, image, video,
 * audio, and PDF inputs. The other two entries pin the multimodal defaults
 * already used by their platform providers. Unknown API providers are denied
 * rather than inheriting an unverified source model; the caller's existing
 * critic fail-safe then keeps the pre-critique draft.
 */
export const OPENROUTER_VISION_CRITIC_MODEL = "google/gemini-3.1-flash-lite";
export const OPENAI_VISION_CRITIC_MODEL = "gpt-5.1-mini";
export const ANTHROPIC_VISION_CRITIC_MODEL = "claude-sonnet-4-6";

export type VisionCriticModelRoute =
  | {
      available: true;
      model: string;
      thinkingMode: CompleteOptions["thinkingMode"];
    }
  | {
      available: false;
      reason: string;
    };

/**
 * Select an explicitly audited image-input model for a native-image critic
 * request. This function deliberately reads no shared model configuration:
 * operator-selected storyboard and source models have no implied multimodal
 * capability.
 */
export function visionCriticModelRoute(
  provider: Pick<AgentProvider, "id">,
): VisionCriticModelRoute {
  if (provider.id === "openrouter-api") {
    return {
      available: true,
      model: OPENROUTER_VISION_CRITIC_MODEL,
      // This model's documented thinking floor is minimal.
      thinkingMode: "minimal",
    };
  }
  if (provider.id === "openai-api") {
    return {
      available: true,
      model: OPENAI_VISION_CRITIC_MODEL,
      // The OpenAI adapter supports low/medium/high; "minimal" would clamp up.
      thinkingMode: "low",
    };
  }
  if (provider.id === "anthropic-api") {
    return {
      available: true,
      model: ANTHROPIC_VISION_CRITIC_MODEL,
      thinkingMode: "none",
    };
  }
  return {
    available: false,
    reason: `provider ${provider.id} has no audited native image-input critic model`,
  };
}

/**
 * Small decisions with disproportionate visual impact belong to the creative
 * director. A call-specific override wins, then the shared creative override;
 * `primary` deliberately returns control to the provider's production model.
 */
export function creativeModel(
  provider: AgentProvider,
  callOverride?: string,
): string | undefined {
  const requested = callOverride?.trim() ||
    slackSequencesEnvRawValue("SLACK_SEQUENCES_CREATIVE_MODEL")?.trim();
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
  envName: SlackSequencesEnvName,
): CompleteOptions["thinkingMode"] | undefined {
  const raw = slackSequencesEnvRawValue(envName)?.trim().toLowerCase();
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
  const raw = slackSequencesEnvRawValue("SLACK_SEQUENCES_STORYBOARD_RESCUE_MODEL")?.trim();
  if (raw && ["0", "none", "off"].includes(raw.toLowerCase())) return undefined;
  const chosen = raw ||
    (provider.id === "openrouter-api" ? OPENROUTER_STORYBOARD_RESCUE_MODEL : undefined);
  if (!chosen || chosen === primaryModel) return undefined;
  return chosen;
}

/**
 * Second-opinion SOURCE model — storyboard-rescue parity for the author
 * stage. Both recorded whole-film fallbacks (2026-07-04) died at
 * source-author after the primary model failed every bounded attempt, so one
 * full-context pass on an independent model runs before the deterministic
 * fallback is allowed: it costs one extra call ONLY on the path that
 * currently wastes the entire run. Override with
 * SLACK_SEQUENCES_SOURCE_RESCUE_MODEL; "0"/"none"/"off" disables the rung.
 */
export const OPENROUTER_SOURCE_RESCUE_MODEL = "tencent/hy3-preview";

export function sourceRescueModel(
  provider: AgentProvider,
  primaryModel: string | undefined,
): string | undefined {
  const raw = slackSequencesEnvRawValue("SLACK_SEQUENCES_SOURCE_RESCUE_MODEL")?.trim();
  if (raw && ["0", "none", "off"].includes(raw.toLowerCase())) return undefined;
  const chosen = raw ||
    (provider.id === "openrouter-api" ? OPENROUTER_SOURCE_RESCUE_MODEL : undefined);
  if (!chosen || chosen === primaryModel) return undefined;
  return chosen;
}

/**
 * The source-rescue rung's reasoning effort. Full-document emission keeps the
 * author default (reasoning off — the budget belongs to source, not
 * deliberation); the override exists for model experiments.
 */
export function sourceRescueThinkingMode(): CompleteOptions["thinkingMode"] {
  return thinkingOverride("SLACK_SEQUENCES_SOURCE_RESCUE_THINKING") ?? "none";
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
  const configured = slackSequencesEnvRawValue("SLACK_SEQUENCES_LIGHT_MODEL")?.trim();
  if (configured?.toLowerCase() === "primary") return undefined;
  if (configured) return configured;
  return provider.id === "openrouter-api"
    ? OPENROUTER_LIGHT_MODEL
    : provider.id === "deepseek-api"
      ? "deepseek-v4-flash"
      : undefined;
}
