import type { AgentProvider } from "@sequences/platform/providers";
import type {
  DirectCompositionDraft,
  DirectScene,
} from "./directComposition.ts";
import {
  parseInteractionPlan,
  type InteractionIntentV1,
  type InteractionPath,
} from "./interactionContract.ts";

interface InteractionPatch {
  mode: "interaction-patch";
  interactionId: string;
  changes: Partial<Pick<
    InteractionIntentV1,
    | "startSec"
    | "arriveSec"
    | "pressSec"
    | "releaseSec"
    | "holdUntilSec"
    | "from"
    | "path"
    | "bend"
    | "ease"
    | "aimX"
    | "aimY"
    | "offsetX"
    | "offsetY"
    | "hitInsetPx"
    | "cursorScale"
    | "targetScale"
  >>;
}

interface StructuralRoute {
  mode: "structural";
}

type DirectRevisionRoute = InteractionPatch | StructuralRoute;

const ROUTABLE_CURSOR_REQUEST =
  /\b(cursor|pointer|click|press|ripple|hover|drag|aim|target|path|arc|approach|slower|faster)\b/i;

function lightModel(provider: AgentProvider): string | undefined {
  const configured = process.env.SLACK_SEQUENCES_LIGHT_MODEL?.trim();
  if (configured) return configured;
  return provider.id === "openrouter-api"
    ? "deepseek/deepseek-v4-flash"
    : provider.id === "deepseek-api"
      ? "deepseek-v4-flash"
      : undefined;
}

function parseRoute(raw: string): DirectRevisionRoute {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { mode: "structural" };
  const value = JSON.parse(match[0]) as Record<string, unknown>;
  if (
    value.mode !== "interaction-patch" ||
    typeof value.interactionId !== "string" ||
    !value.changes ||
    typeof value.changes !== "object" ||
    Array.isArray(value.changes)
  ) {
    return { mode: "structural" };
  }
  const input = value.changes as Record<string, unknown>;
  const changes: InteractionPatch["changes"] = {};
  for (const key of [
    "startSec",
    "arriveSec",
    "pressSec",
    "releaseSec",
    "holdUntilSec",
    "bend",
    "aimX",
    "aimY",
    "offsetX",
    "offsetY",
    "hitInsetPx",
    "cursorScale",
    "targetScale",
  ] as const) {
    if (typeof input[key] === "number" && Number.isFinite(input[key])) {
      changes[key] = input[key];
    }
  }
  if (
    typeof input.path === "string" &&
    ["direct", "arc", "human"].includes(input.path)
  ) {
    changes.path = input.path as InteractionPath;
  }
  if (
    typeof input.from === "string" &&
    (input.from.startsWith("frame:") || input.from.startsWith("part:"))
  ) {
    changes.from = input.from as InteractionIntentV1["from"];
  }
  if (typeof input.ease === "string" && input.ease.trim()) {
    changes.ease = input.ease.trim();
  }
  return Object.keys(changes).length
    ? {
        mode: "interaction-patch",
        interactionId: value.interactionId,
        changes,
      }
    : { mode: "structural" };
}

function sceneForInteraction(
  scenes: DirectScene[],
  id: string,
): { scene: DirectScene; interaction: InteractionIntentV1 } | undefined {
  for (const scene of scenes) {
    const interaction = scene.interactions?.find((entry) => entry.id === id);
    if (interaction) return { scene, interaction };
  }
  return undefined;
}

function safePatchedInteraction(
  scenes: DirectScene[],
  patch: InteractionPatch,
): InteractionIntentV1 | undefined {
  const found = sceneForInteraction(scenes, patch.interactionId);
  if (!found) return undefined;
  const value: InteractionIntentV1 = {
    ...found.interaction,
    ...patch.changes,
  };
  const end = value.holdUntilSec ?? value.releaseSec ?? value.arriveSec;
  const sceneEnd = found.scene.startSec + found.scene.durationSec;
  if (
    value.startSec < found.scene.startSec ||
    value.arriveSec <= value.startSec ||
    end > sceneEnd ||
    value.aimX < 0 ||
    value.aimX > 1 ||
    value.aimY < 0 ||
    value.aimY > 1 ||
    (value.pressSec !== undefined && value.pressSec - value.arriveSec < 0.08) ||
    (value.releaseSec !== undefined &&
      (value.pressSec === undefined || value.releaseSec <= value.pressSec))
  ) {
    return undefined;
  }
  return value;
}

function replaceInteractionIsland(
  html: string,
  interactions: InteractionIntentV1[],
): string | undefined {
  const pattern =
    /(<script\b[^>]*\bid\s*=\s*(["'])sequences-interactions\2[^>]*>)([\s\S]*?)(<\/script>)/i;
  if (!pattern.test(html)) return undefined;
  const payload = JSON.stringify({ version: 1, interactions });
  return html.replace(pattern, `$1${payload}$4`);
}

/**
 * Cheap, bounded route for cursor timing/path/aim changes. It never edits HTML
 * structure or CSS; uncertain/invalid output returns null and the caller falls
 * back to the primary structural author.
 */
export async function tryDirectInteractionRevision(
  provider: AgentProvider,
  instruction: string,
  current: DirectCompositionDraft,
): Promise<DirectCompositionDraft | null> {
  const plan = parseInteractionPlan(current.html).plan;
  if (
    !ROUTABLE_CURSOR_REQUEST.test(instruction) ||
    !plan?.interactions.length
  ) {
    return null;
  }
  const model = lightModel(provider);
  if (!model) return null;
  const prompt = [
    "You route one revision against an existing deterministic cursor interaction plan.",
    "Return JSON only. Use interaction-patch only when the request can be expressed",
    "by changing timing, path, approach, ease, normalized aim/offset, hit inset,",
    "or press scale on exactly one existing interaction. Otherwise return structural.",
    'Shape: {"mode":"interaction-patch","interactionId":"existing-id","changes":{...}}',
    'or {"mode":"structural"}. Never choose a different target or invent an id.',
    "",
    `Instruction: ${instruction}`,
    `Interactions: ${JSON.stringify(plan.interactions)}`,
  ].join("\n");
  let route: DirectRevisionRoute;
  try {
    const raw = await provider.complete(prompt, {
      model,
      thinkingMode: "none",
      maxTokens: 1_024,
      timeoutMs: 60_000,
      responseFormat: { type: "json_object" },
    });
    route = parseRoute(raw);
  } catch {
    return null;
  }
  if (route.mode !== "interaction-patch") return null;
  const patched = safePatchedInteraction(current.storyboard, route);
  if (!patched) return null;
  const scenes = current.storyboard.map((scene) => ({
    ...scene,
    ...(scene.interactions
      ? {
          interactions: scene.interactions.map((interaction) =>
            interaction.id === patched.id ? patched : interaction
          ),
        }
      : {}),
  }));
  const interactions = scenes.flatMap((scene) => scene.interactions ?? []);
  const html = replaceInteractionIsland(current.html, interactions);
  return html ? { html, storyboard: scenes } : null;
}
