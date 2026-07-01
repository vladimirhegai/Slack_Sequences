import type {
  AgentProvider,
  CompleteOptions,
} from "@sequences/platform/providers";

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
