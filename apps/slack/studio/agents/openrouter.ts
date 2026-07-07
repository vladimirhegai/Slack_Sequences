/**
 * Recipe Studio — OpenRouter in-process agent (plan §6.2).
 *
 * Reuses the platform provider client and `modelPolicy` model ids (never forks
 * the prompt FILES — the studio composes a chat prompt from the shared context
 * in `context.ts`). GLM (creative) is the critic/planner; DeepSeek Flash is the
 * cheap light model. It returns ADVICE the operator can act on (or paste to a
 * CLI agent) — it does not edit workspace files; the CLI agents own file-first
 * authoring (plan §6.3). Vision-capable models receive attached ref images as
 * native multimodal parts; others degrade honestly to a notes-only badge.
 */
import { PROVIDERS } from "@sequences/platform/providers";
import type { CompleteOptions } from "@sequences/platform/providers";
import {
  OPENROUTER_CREATIVE_MODEL,
  OPENROUTER_LIGHT_MODEL,
} from "../../src/engine/modelPolicy.ts";
import { composeAgentContext } from "./context.ts";

export type OpenRouterModel = "glm" | "deepseek-flash";

const MODEL_ID: Record<OpenRouterModel, string> = {
  glm: OPENROUTER_CREATIVE_MODEL,
  "deepseek-flash": OPENROUTER_LIGHT_MODEL,
};

// GLM 5.2 and DeepSeek chat models on OpenRouter are text-first here; we pass
// images only when we believe the model can see them, else degrade honestly.
const VISION_CAPABLE: Record<OpenRouterModel, boolean> = {
  glm: true,
  "deepseek-flash": false,
};

export interface OpenRouterTurn {
  reply: string;
  model: string;
  visionDropped: boolean;
}

export async function runOpenRouterTurn(
  id: string,
  message: string,
  model: OpenRouterModel,
  images: Array<{ mimeType: string; base64: string }> = [],
): Promise<OpenRouterTurn> {
  const provider = PROVIDERS["openrouter-api"];
  if (!provider) throw new Error("openrouter-api provider not registered");
  const context = composeAgentContext(id);
  const prompt = [
    "You are a motion-design critic and planner inside the Recipe Studio. The",
    "operator is building a short SaaS launch film / recipe. Give SPECIFIC,",
    "actionable advice tied to the gate findings and the workspace state below —",
    "concrete scene/component/camera/timing changes, not generalities. When the",
    "operator wants file edits made for them, tell them to switch to the Claude",
    "CLI agent (it edits the workspace directly).",
    "",
    context,
    "",
    "## Operator",
    message,
  ].join("\n");
  const canSee = VISION_CAPABLE[model] && images.length > 0;
  const options: CompleteOptions = {
    model: MODEL_ID[model],
    thinkingMode: model === "glm" ? "medium" : "low",
    maxTokens: 2048,
    ...(canSee ? { images } : {}),
  };
  const reply = await provider.complete(prompt, options);
  return { reply, model: MODEL_ID[model], visionDropped: images.length > 0 && !canSee };
}
