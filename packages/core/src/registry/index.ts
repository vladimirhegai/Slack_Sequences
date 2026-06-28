/**
 * The registry — the single source of truth from code to prompt (plan §4.5).
 * `promptCatalog()` auto-generates the one-line summaries the agent planner
 * will see in Phase 1; it exists now so catalog text and implementations can
 * never drift apart.
 */
import { PRIMITIVES } from "./primitives.ts";
import { ARCHETYPES } from "./archetypes.ts";
import { PROFILES } from "./profiles.ts";
import { CAMERA_MOVES } from "./camera.ts";
import { TOKEN_SETS } from "./tokenSets.ts";
import { TRANSITION_PLUGINS } from "./transitions.ts";
import { z } from "zod";
import type { Project } from "../schema.ts";
import {
  DURATION_TOKENS,
  EASING_TOKEN_IDS,
  DISTANCE_TOKENS,
  STAGGER_TOKENS,
  SCALE_TOKENS,
  scaleFrames30,
} from "../tokens.ts";

export { PRIMITIVES } from "./primitives.ts";
export { ARCHETYPES } from "./archetypes.ts";
export { PROFILES } from "./profiles.ts";
export { CAMERA_MOVES, CAMERA_MOVE_IDS, type CameraMoveDef } from "./camera.ts";
export { TOKEN_SETS, type TokenSetPlugin } from "./tokenSets.ts";
export { TRANSITION_PLUGINS, type TransitionPlugin } from "./transitions.ts";
export * from "./types.ts";
export * from "./stepTemplate.ts";
export * from "./extensionBundle.ts";

export type ExtensionKind = "primitive" | "archetype" | "profile" | "camera" | "token-set" | "transition";

export interface RegistryExtension {
  id: string;
  type: ExtensionKind;
}

export interface PromptCatalogOptions {
  enabledIds?: Iterable<string> | null;
  fps?: number;
}

export function registryExtensions(): RegistryExtension[] {
  return [
    ...Object.values(PRIMITIVES).map((p) => ({ id: p.id, type: "primitive" as const })),
    ...Object.values(ARCHETYPES).map((a) => ({ id: a.id, type: "archetype" as const })),
    ...Object.values(PROFILES).map((p) => ({ id: p.id, type: "profile" as const })),
    ...Object.values(CAMERA_MOVES).map((m) => ({ id: m.id, type: "camera" as const })),
    ...Object.values(TOKEN_SETS).map((entry) => ({ id: entry.id, type: "token-set" as const })),
    ...Object.values(TRANSITION_PLUGINS).map((entry) => ({ id: entry.id, type: "transition" as const })),
  ];
}

export function primitiveParamsSchema(primitiveId: string): z.ZodType {
  const primitive = PRIMITIVES[primitiveId];
  if (!primitive) throw new Error(`unknown primitive: ${primitiveId}`);
  return z
    .object({
      duration: z.enum(["instant", "quick", "base", "relaxed", "slow", "dramatic"]).default(
        primitive.defaults.duration,
      ),
      easing: z.enum(EASING_TOKEN_IDS).default(primitive.defaults.easing),
      ...(primitive.defaults.distance
        ? { distance: z.enum(["nudge", "step", "travel", "sweep"]).default(primitive.defaults.distance) }
        : {}),
      ...(primitive.defaults.scale
        ? { scale: z.enum(["subtle", "pop", "hero"]).default(primitive.defaults.scale) }
        : {}),
    })
    .strict();
}

export interface RegistryManifestEntry {
  id: string;
  type: ExtensionKind;
  version: string;
  summary: string;
  thumbnail: string;
  source: "sequences" | "hyperframes";
  params?: Record<string, unknown>;
}

export function registryManifest(): { version: 1; entries: RegistryManifestEntry[] } {
  const entries: RegistryManifestEntry[] = [
    ...Object.values(PRIMITIVES).map((primitive) => ({
      id: primitive.id,
      type: "primitive" as const,
      version: "1.0.0",
      summary: primitive.summary,
      thumbnail: `thumbs/primitives/${primitive.id.replaceAll(".", "-")}.png`,
      source: "sequences" as const,
      params: {
        duration: primitive.defaults.duration,
        easing: primitive.defaults.easing,
        ...(primitive.defaults.distance ? { distance: primitive.defaults.distance } : {}),
        ...(primitive.defaults.scale ? { scale: primitive.defaults.scale } : {}),
      },
    })),
    ...Object.values(ARCHETYPES).map((entry) => ({
      id: entry.id,
      type: "archetype" as const,
      version: "1.0.0",
      summary: entry.summary,
      thumbnail: `thumbs/archetypes/${entry.id}.png`,
      source: entry.id === "stat-chart" ? ("hyperframes" as const) : ("sequences" as const),
    })),
    ...Object.values(PROFILES).map((entry) => ({
      id: entry.id,
      type: "profile" as const,
      version: "1.0.0",
      summary: entry.summary,
      thumbnail: `thumbs/profiles/${entry.id}.png`,
      source: "sequences" as const,
    })),
    ...Object.values(CAMERA_MOVES).map((entry) => ({
      id: entry.id,
      type: "camera" as const,
      version: "1.0.0",
      summary: entry.summary,
      thumbnail: `thumbs/camera/${entry.id}.png`,
      source: "sequences" as const,
    })),
    ...Object.values(TOKEN_SETS).map((entry) => ({
      id: entry.id,
      type: "token-set" as const,
      version: entry.version,
      summary: entry.summary,
      thumbnail: `thumbs/token-sets/${entry.id}.png`,
      source: "sequences" as const,
    })),
    ...Object.values(TRANSITION_PLUGINS).map((entry) => ({
      id: entry.id,
      type: "transition" as const,
      version: entry.version,
      summary: entry.summary,
      thumbnail: `thumbs/transitions/${entry.id.replaceAll(".", "-")}.png`,
      source: entry.source,
    })),
  ];
  return { version: 1, entries };
}

export function registryExtensionIds(): string[] {
  return registryExtensions().map((entry) => entry.id);
}

export function enabledExtensionIds(project: Pick<Project, "extensions">): Set<string> {
  const all = registryExtensionIds();
  const configured = project.extensions?.enabled;
  if (configured === null || configured === undefined) return new Set(all);
  const known = new Set(all);
  return new Set(configured.filter((id) => known.has(id)));
}

function isCatalogEnabled(enabled: Set<string> | null, id: string): boolean {
  return enabled === null || enabled.has(id);
}

function enabledSetFrom(options: PromptCatalogOptions): Set<string> | null {
  return options.enabledIds === undefined || options.enabledIds === null
    ? null
    : new Set(options.enabledIds);
}

function pushEmptyIfNone(lines: string[], count: number): void {
  if (count === 0) lines.push("- (none enabled)");
}

export function promptCatalog(options: PromptCatalogOptions = {}): string {
  const enabled = enabledSetFrom(options);
  const fps = options.fps ?? 30;
  const lines: string[] = [];
  lines.push("## Motion primitives");
  let count = 0;
  for (const p of Object.values(PRIMITIVES).filter((p) => isCatalogEnabled(enabled, p.id))) {
    lines.push(`- ${p.id} [${p.kind}, ${p.tags.energy}/${p.tags.style}]: ${p.summary}`);
    count++;
  }
  pushEmptyIfNone(lines, count);
  lines.push("", "## Scene archetypes");
  count = 0;
  for (const a of Object.values(ARCHETYPES).filter((a) => isCatalogEnabled(enabled, a.id))) {
    const slots = Object.entries(a.slots)
      .map(([name, s]) => `${name}${s.required ? "*" : ""}:${s.kind}`)
      .join(", ");
    lines.push(
      `- ${a.id} (slots: ${slots}; layouts: ${a.layouts.join("/")}; ${scaleFrames30(a.duration.min, fps)}-${scaleFrames30(a.duration.max, fps)}f @${fps}fps): ${a.summary}`,
    );
    count++;
  }
  pushEmptyIfNone(lines, count);
  lines.push("", "## Motion profiles");
  count = 0;
  for (const p of Object.values(PROFILES).filter((p) => isCatalogEnabled(enabled, p.id))) {
    lines.push(`- ${p.id}: ${p.summary}`);
    count++;
  }
  pushEmptyIfNone(lines, count);
  lines.push("", "## Camera moves (scene-level, optional)");
  count = 0;
  for (const move of Object.values(CAMERA_MOVES).filter((move) => isCatalogEnabled(enabled, move.id))) {
    lines.push(`- ${move.id}: ${move.summary}`);
    count++;
  }
  pushEmptyIfNone(lines, count);
  lines.push("", "## Transitions");
  count = 0;
  for (const transition of Object.values(TRANSITION_PLUGINS).filter((entry) =>
    isCatalogEnabled(enabled, entry.id),
  )) {
    lines.push(`- ${transition.id}: ${transition.summary}`);
    count++;
  }
  pushEmptyIfNone(lines, count);
  lines.push("", "## Token-set plugins");
  count = 0;
  for (const tokenSet of Object.values(TOKEN_SETS).filter((entry) =>
    isCatalogEnabled(enabled, entry.id),
  )) {
    lines.push(`- ${tokenSet.id}@${tokenSet.version}: ${tokenSet.summary}`);
    count++;
  }
  pushEmptyIfNone(lines, count);
  lines.push(
    "",
    "## Tokens",
    `- durations (frames@${fps}): ${Object.entries(DURATION_TOKENS)
      .map(([k, v]) => `${k}=${scaleFrames30(v, fps)}`)
      .join(", ")}`,
    `- easings (role-typed, cross-role use is invalid): ${EASING_TOKEN_IDS.join(", ")}`,
    `- distances (frac of height): ${Object.entries(DISTANCE_TOKENS)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`,
    `- staggers (frames@${fps}): ${Object.entries(STAGGER_TOKENS)
      .map(([k, v]) => `${k}=${scaleFrames30(v, fps)}`)
      .join(", ")}`,
    `- scales: ${Object.entries(SCALE_TOKENS)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`,
  );
  return lines.join("\n");
}
