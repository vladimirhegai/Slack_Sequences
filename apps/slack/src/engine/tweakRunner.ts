import {
  CommandSchema,
  extractJsonObject,
  matchZeroTokenTweak,
  type Command,
  type Project,
  type ProjectStore,
  type TweakContext,
} from "@sequences/core";
import {
  completeProviderRequest,
  PROVIDERS,
  type CompleteOptions,
  type ProviderId,
} from "@sequences/platform/providers";

export interface TweakResult {
  mode: "zero-token" | "model";
  commands: Command[];
  explanation: string;
  provider?: ProviderId;
}

function parseCommands(input: unknown): Command[] {
  const raw = Array.isArray(input)
    ? input
    : input && typeof input === "object" && Array.isArray((input as { commands?: unknown }).commands)
      ? (input as { commands: unknown[] }).commands
      : [];
  if (raw.length === 0) throw new Error("tweak model returned no commands");
  return raw.map((command, index) => {
    const parsed = CommandSchema.safeParse(command);
    if (!parsed.success) {
      throw new Error(
        `commands[${index}] invalid: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      );
    }
    return command as Command;
  });
}

export async function requestTweak(
  providerId: ProviderId | null,
  text: string,
  project: Project,
  context: TweakContext = {},
  options: CompleteOptions = {},
  guidance = "",
): Promise<TweakResult> {
  const deterministic = matchZeroTokenTweak(project, text, context);
  if (deterministic) {
    return {
      mode: "zero-token",
      commands: deterministic.commands,
      explanation: deterministic.explanation,
    };
  }
  if (!providerId) throw new Error("tweak needs a provider because the zero-token matcher was unsure");
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`unknown provider "${providerId}"`);
  const scene =
    project.scenes.find((candidate) => candidate.id === context.sceneId) ?? project.scenes[0];
  const raw = await completeProviderRequest(
    provider,
    {
      cacheHint: "sequences-tweak-v1",
      messages: [
        {
          role: "system",
          content:
            [
              'Translate the tweak into the smallest valid Sequences command list. Return JSON only: {"commands":[...]}.',
              guidance,
            ].filter(Boolean).join("\n\n"),
        },
        {
          role: "user",
          content: [
            `Tweak: ${text}`,
            `Selected scene: ${scene ? JSON.stringify(scene) : "(none)"}`,
            `Selected layer: ${context.layerId ?? "(none)"}`,
            `Project profile: ${project.motionProfile}`,
          ].join("\n"),
        },
      ],
      tools: [
        {
          name: "apply_commands",
          description: "Apply typed Sequences commands",
          inputSchema: {
            type: "object",
            properties: { commands: { type: "array", items: { type: "object" }, minItems: 1 } },
            required: ["commands"],
          },
        },
      ],
      toolChoice: "apply_commands",
    },
    options,
  );
  return {
    mode: "model",
    commands: parseCommands(extractJsonObject(raw)),
    explanation: `translated by ${providerId}`,
    provider: providerId,
  };
}

export async function runTweak(
  providerId: ProviderId | null,
  text: string,
  store: ProjectStore,
  context: TweakContext = {},
  options: CompleteOptions = {},
): Promise<TweakResult> {
  const result = await requestTweak(providerId, text, store.project, context, options);
  const command: Command =
    result.commands.length === 1 ? result.commands[0]! : { type: "Batch", commands: result.commands };
  const outcome = store.apply(command, result.mode === "zero-token" ? "user" : "agent");
  if (!outcome.ok) {
    throw new Error(outcome.errors.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  return result;
}
