/**
 * Provider-agnostic plan pipeline with memoization and direction derivation.
 */
import {
  buildPlanPrompt,
  contentHash,
  deriveDirections,
  extractJsonObject,
  parsePlan,
  planToCommands,
  tightenPlanCopy,
  type Direction,
  type Plan,
  type Project,
  type ProjectStore,
} from "@sequences/core";
import {
  PROVIDERS,
  type AgentProvider,
  type CompleteOptions,
  type ProviderId,
} from "@sequences/platform/providers";

export interface PlanRunResult {
  provider: ProviderId;
  plan: Plan;
  raw: string;
}

const PLAN_CACHE = new Map<string, PlanRunResult>();

export async function requestPlanWith(
  provider: AgentProvider,
  brief: string,
  project: Project,
  options: CompleteOptions = {},
): Promise<PlanRunResult> {
  if (!brief.trim()) throw new Error("brief is empty");
  const cacheKey = contentHash({
    provider: provider.id,
    brief: brief.trim(),
    brand: project.brand,
    assets: project.assets.map((asset) => ({
      id: asset.id,
      contentHash: asset.contentHash,
      metadata: asset.metadata,
    })),
    extensions: project.extensions,
    fps: project.meta.fps,
    // Model + thinking effort change the plan the brain returns, so switching
    // either on the same brief must miss the cache rather than silently reuse
    // the prior model's plan. (apiKey is deliberately never hashed.)
    model: options.model?.trim() || null,
    thinkingMode: options.thinkingMode && options.thinkingMode !== "auto" ? options.thinkingMode : null,
  });
  const cacheable = Object.values(PROVIDERS).includes(provider);
  const cached = cacheable ? PLAN_CACHE.get(cacheKey) : undefined;
  if (cached) return structuredClone(cached);
  const prompt = buildPlanPrompt(brief, project);
  const raw = await provider.complete(prompt, { ...options, cacheHint: cacheKey });
  const plan = tightenPlanCopy(parsePlan(extractJsonObject(raw), { project }));
  const result = { provider: provider.id, plan, raw };
  if (cacheable) PLAN_CACHE.set(cacheKey, structuredClone(result));
  return result;
}

export async function requestPlan(
  providerId: ProviderId,
  brief: string,
  project: Project,
  options: CompleteOptions = {},
): Promise<PlanRunResult> {
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`unknown provider "${providerId}"`);
  return requestPlanWith(provider, brief, project, options);
}

export async function requestDirections(
  providerId: ProviderId,
  brief: string,
  project: Project,
  options: CompleteOptions = {},
): Promise<{ provider: ProviderId; directions: Direction[] }> {
  const base = await requestPlan(providerId, brief, project, options);
  return { provider: providerId, directions: deriveDirections(base.plan, project) };
}

export async function runPlan(
  providerId: ProviderId,
  brief: string,
  store: ProjectStore,
  options: CompleteOptions = {},
): Promise<PlanRunResult> {
  const result = await requestPlan(providerId, brief, store.project, options);
  const batch = planToCommands(store.project, result.plan);
  const outcome = store.apply(batch, "agent");
  if (!outcome.ok) {
    const issues = outcome.errors.map((error) => `${error.path}: ${error.message}`).join("; ");
    throw new Error(`plan failed project validation — ${issues}`);
  }
  return result;
}
