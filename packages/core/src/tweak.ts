import type { Command } from "./commands.ts";
import type { Project } from "./schema.ts";
import { DURATION_ORDER, TYPE_TOKEN_IDS, type DurationToken, type TypeToken } from "./tokens.ts";

export interface TweakContext {
  sceneId?: string;
  layerId?: string;
}

export interface TweakMatch {
  confidence: number;
  commands: Command[];
  explanation: string;
}

function selected(project: Project, context: TweakContext) {
  const scene =
    project.scenes.find((candidate) => candidate.id === context.sceneId) ?? project.scenes[0];
  return { scene, layerId: context.layerId ?? "headline" };
}

function nextType(current: TypeToken, direction: 1 | -1): TypeToken {
  const index = TYPE_TOKEN_IDS.indexOf(current);
  return TYPE_TOKEN_IDS[Math.max(0, Math.min(TYPE_TOKEN_IDS.length - 1, index + direction))]!;
}

function durationStep(value: number, direction: 1 | -1): number {
  const factor = direction > 0 ? 1.2 : 0.82;
  return Math.max(15, Math.min(1800, Math.round(value * factor)));
}

/**
 * Deterministic keyword→command matcher for common editor phrasing.
 * Returns null when the wording is ambiguous so a cheap model can take over.
 */
export function matchZeroTokenTweak(
  project: Project,
  text: string,
  context: TweakContext = {},
): TweakMatch | null {
  const query = text.trim().toLowerCase();
  if (!query) return null;
  const { scene, layerId } = selected(project, context);
  if (!scene) return null;
  const override = scene.overrides[layerId];
  const currentType = (override?.typeToken ?? "headline") as TypeToken;

  if (/\b(bigger|larger|increase (?:the )?size|make .* huge)\b/.test(query)) {
    return {
      confidence: 0.96,
      commands: [
        {
          type: "SetLayerStyle",
          sceneId: scene.id,
          layerId,
          typeToken: nextType(currentType, -1),
        },
      ],
      explanation: `made ${scene.id}/${layerId} one type token larger`,
    };
  }
  if (/\b(smaller|decrease (?:the )?size|less huge)\b/.test(query)) {
    return {
      confidence: 0.96,
      commands: [
        {
          type: "SetLayerStyle",
          sceneId: scene.id,
          layerId,
          typeToken: nextType(currentType, 1),
        },
      ],
      explanation: `made ${scene.id}/${layerId} one type token smaller`,
    };
  }
  if (/\b(slower|more breathing room|hold longer|linger)\b/.test(query)) {
    return {
      confidence: 0.94,
      commands: [
        {
          type: "SetSceneDuration",
          sceneId: scene.id,
          durationFrames: durationStep(scene.durationFrames, 1),
        },
      ],
      explanation: `extended ${scene.id}`,
    };
  }
  if (/\b(faster|quicker|snappier|shorter)\b/.test(query)) {
    return {
      confidence: 0.94,
      commands: [
        {
          type: "SetSceneDuration",
          sceneId: scene.id,
          durationFrames: durationStep(scene.durationFrames, -1),
        },
      ],
      explanation: `shortened ${scene.id}`,
    };
  }
  if (/\b(more punch|punchier|bolder|launch energy|more energy)\b/.test(query)) {
    return {
      confidence: 0.95,
      commands: [{ type: "SetMotionProfile", profile: "bold-launch" }],
      explanation: "switched to bold-launch",
    };
  }
  if (/\b(softer|warmer|calmer|gentler)\b/.test(query)) {
    return {
      confidence: 0.95,
      commands: [{ type: "SetMotionProfile", profile: "warm-startup" }],
      explanation: "switched to warm-startup",
    };
  }
  if (/\b(crisper|cleaner|more precise|saasier)\b/.test(query)) {
    return {
      confidence: 0.95,
      commands: [{ type: "SetMotionProfile", profile: "crisp-saas" }],
      explanation: "switched to crisp-saas",
    };
  }
  if (/\b(crossfade|cross fade|dissolve)\b/.test(query)) {
    return {
      confidence: 0.97,
      commands: [{ type: "SetTransition", afterSceneId: scene.id, kind: "crossFade" }],
      explanation: `set a crossfade after ${scene.id}`,
    };
  }
  if (/\b(hard cut|straight cut|no transition)\b/.test(query)) {
    return {
      confidence: 0.97,
      commands: [{ type: "SetTransition", afterSceneId: scene.id, kind: "cutHold" }],
      explanation: `set a cut after ${scene.id}`,
    };
  }
  if (/\b(wipe)\b/.test(query)) {
    return {
      confidence: 0.95,
      commands: [{ type: "SetTransition", afterSceneId: scene.id, kind: "wipeDirectional" }],
      explanation: `set a wipe after ${scene.id}`,
    };
  }
  if (/\b(push transition|slide push)\b/.test(query)) {
    return {
      confidence: 0.95,
      commands: [{ type: "SetTransition", afterSceneId: scene.id, kind: "slidePush" }],
      explanation: `set a slide-push after ${scene.id}`,
    };
  }
  if (/\b(accent|highlight)\b/.test(query) && /\b(text|headline|copy)\b/.test(query)) {
    return {
      confidence: 0.9,
      commands: [{ type: "SetLayerStyle", sceneId: scene.id, layerId, colorToken: "accent" }],
      explanation: `changed ${scene.id}/${layerId} to accent`,
    };
  }
  if (/\b(pop|pulse|emphasize|emphasis)\b/.test(query)) {
    const primitive = query.includes("glow") || query.includes("pulse")
      ? "emphasis.pulseGlow"
      : "emphasis.pop";
    return {
      confidence: 0.9,
      commands: [{ type: "AddMotion", sceneId: scene.id, layerId, phase: "emphasis", primitive }],
      explanation: `added ${primitive} to ${scene.id}/${layerId}`,
    };
  }
  if (/\b(remove|clear|drop)\b.*\b(emphasis|pulse|pop|glow)\b/.test(query)) {
    return {
      confidence: 0.92,
      commands: [{ type: "RemoveMotion", sceneId: scene.id, layerId, phase: "emphasis" }],
      explanation: `removed emphasis from ${scene.id}/${layerId}`,
    };
  }
  if (/\b(center|centred|centered)\b/.test(query)) {
    return {
      confidence: 0.84,
      commands: [{ type: "SetSceneLayout", sceneId: scene.id, layout: "center" }],
      explanation: `centered ${scene.id}`,
    };
  }
  return null;
}
