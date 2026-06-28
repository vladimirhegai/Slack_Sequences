/**
 * The `.seqext` bundle — what Forge publishes and Sequences installs (FORGE.md
 * §1, §8). The bundle is pure data: a manifest (identity + semantic Brief the
 * planner reads) and a spec (token-pure StepTemplate skeleton + knobs + tokens +
 * slots + relationships). This module owns the schema, install-time validation,
 * and turning a bundle back into a registry-shaped `MotionPrimitive`. File IO
 * lives in the app layer; the engine stays zero-IO.
 */
import { z } from "zod";
import {
  DurationTokenSchema,
  ScaleTokenSchema,
} from "../schema.ts";
import { DISTANCE_TOKEN_IDS, EASING_TOKEN_IDS } from "../tokens.ts";
import {
  collectIdentifiers,
  EMIT_ENV_NAMES,
  templatePrimitive,
  type StepTemplate,
} from "./stepTemplate.ts";
import { PRIMITIVES } from "./primitives.ts";
import type { MotionPrimitive } from "./types.ts";

const TemplateValueSchema = z.union([z.number(), z.boolean(), z.string()]);
const TemplateVarsSchema = z.record(z.string(), TemplateValueSchema);
const LetSchema = z.record(z.string(), z.string()).optional();

const FromToTemplateSchema = z.object({
  kind: z.literal("fromTo"),
  target: z.string(),
  from: TemplateVarsSchema,
  to: TemplateVarsSchema,
  durationSec: TemplateValueSchema,
  ease: TemplateValueSchema,
  atSec: TemplateValueSchema,
  let: LetSchema,
});
const ToTemplateSchema = z.object({
  kind: z.literal("to"),
  target: z.string(),
  vars: TemplateVarsSchema,
  durationSec: TemplateValueSchema,
  ease: TemplateValueSchema,
  atSec: TemplateValueSchema,
  let: LetSchema,
});
const SetTemplateSchema = z.object({
  kind: z.literal("set"),
  target: z.string(),
  vars: TemplateVarsSchema,
  atSec: TemplateValueSchema,
  let: LetSchema,
});
const CustomTemplateSchema = z.object({
  kind: z.literal("custom"),
  code: z.string(),
  easesUsed: z.array(TemplateValueSchema),
  let: LetSchema,
});

export const StepTemplateSchema = z.discriminatedUnion("kind", [
  FromToTemplateSchema,
  ToTemplateSchema,
  SetTemplateSchema,
  CustomTemplateSchema,
]);

const DistanceTokenSchema = z.enum(DISTANCE_TOKEN_IDS);
const EasingTokenSchema = z.enum(EASING_TOKEN_IDS);

/** A public, agent-tunable parameter. For P0 a knob is just a named token range;
 *  the planner picks a token id, so plans stay token-pure. */
export const KnobSchema = z.object({
  name: z.string(),
  description: z.string().default(""),
  kind: z.enum(["duration", "easing", "distance", "scale", "number"]),
  /** Default value (token id, or a number for `number` knobs). */
  default: z.union([z.string(), z.number()]),
});

export const MediaSlotSchema = z.object({
  name: z.string(),
  mediaKind: z.enum(["image", "video", "svg", "lottie"]),
  aspect: z.string().optional(),
  placeholder: z.string().optional(),
});

export const SeqextManifestSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/, "bundle ids are alphanumeric/dot/dash/underscore"),
  type: z.literal("primitive").default("primitive"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "semver"),
  summary: z.string().min(20),
  tags: z.object({
    energy: z.enum(["calm", "punchy"]),
    style: z.enum(["organic", "mechanical"]),
  }),
  library: z
    .object({
      family: z.string().optional(),
      subject: z.string().optional(),
      action: z.string().optional(),
      technique: z.array(z.string()).default([]),
      register: z.string().optional(),
      context: z.array(z.string()).default([]),
    })
    .optional(),
  source: z.literal("forge").default("forge"),
  hfPin: z.string().optional(),
});

export const SeqextSpecSchema = z.object({
  primitiveKind: z.enum(["enter", "exit", "emphasis", "continuous"]),
  defaults: z.object({
    duration: DurationTokenSchema,
    easing: EasingTokenSchema,
    distance: DistanceTokenSchema.optional(),
    scale: ScaleTokenSchema.optional(),
  }),
  needsMask: z.boolean().optional(),
  /** Tokens minted by this bundle (resolved values referenced by the skeleton). */
  tokens: z.record(z.string(), z.union([z.number(), z.string()])).default({}),
  knobs: z.array(KnobSchema).default([]),
  slots: z.array(MediaSlotSchema).default([]),
  relationships: z
    .object({
      pairsWith: z.array(z.string()).default([]),
      conflictsWith: z.array(z.string()).default([]),
    })
    .default({ pairsWith: [], conflictsWith: [] }),
  guardrails: z.array(z.string()).default([]),
  skeleton: z.array(StepTemplateSchema).min(1),
});

export const SeqextBundleSchema = z.object({
  manifest: SeqextManifestSchema,
  spec: SeqextSpecSchema,
});

export type SeqextManifest = z.infer<typeof SeqextManifestSchema>;
export type SeqextSpec = z.infer<typeof SeqextSpecSchema>;
export type SeqextBundle = z.infer<typeof SeqextBundleSchema>;

export interface BundleValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Install-time gate (FORGE.md §10.2). Proves a bundle is well-formed AND every
 * identifier its skeleton references resolves against the emit environment plus
 * the tokens/knobs it declares — so the engine can never interpret a template
 * that reaches for an undefined value at render time.
 */
export function validateBundle(raw: unknown): BundleValidation {
  const parsed = SeqextBundleSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const bundle = parsed.data;
  const errors: string[] = [];

  const declared = new Set<string>([
    ...EMIT_ENV_NAMES,
    ...Object.keys(bundle.spec.tokens),
    ...bundle.spec.knobs.map((k) => k.name),
  ]);
  const used = collectIdentifiers(bundle.spec.skeleton as StepTemplate[]);
  for (const id of used) {
    if (!declared.has(id)) {
      errors.push(
        `skeleton references undefined identifier '${id}' (not in emit env, tokens, or knobs)`,
      );
    }
  }

  if (!bundle.manifest.id.startsWith(`${bundle.spec.primitiveKind}.`)) {
    errors.push(
      `bundle id '${bundle.manifest.id}' should be prefixed with its primitiveKind '${bundle.spec.primitiveKind}.'`,
    );
  }

  return { ok: errors.length === 0, errors };
}

/** Build a registry-shaped MotionPrimitive from a (validated) bundle. */
export function bundleToPrimitive(bundle: SeqextBundle): MotionPrimitive {
  return templatePrimitive({
    id: bundle.manifest.id,
    kind: bundle.spec.primitiveKind,
    summary: bundle.manifest.summary,
    tags: bundle.manifest.tags,
    defaults: bundle.spec.defaults,
    needsMask: bundle.spec.needsMask,
    constants: bundle.spec.tokens,
    skeleton: bundle.spec.skeleton as StepTemplate[],
  });
}

/**
 * In-memory "install" (FORGE.md §10.1): validate a bundle and register it into
 * the live primitive registry so the unchanged compiler / solver / validator /
 * preview path treats it as a first-class primitive. This is the seam the
 * Forge app uses to preview an authored extension through the real engine.
 * Returns the registered primitive; throws if the bundle is invalid.
 */
export function installBundle(raw: unknown): MotionPrimitive {
  const result = validateBundle(raw);
  if (!result.ok) throw new Error(`invalid .seqext bundle: ${result.errors.join("; ")}`);
  const bundle = SeqextBundleSchema.parse(raw);
  const primitive = bundleToPrimitive(bundle);
  PRIMITIVES[primitive.id] = primitive;
  return primitive;
}

/** Remove a previously installed bundle primitive (undo an install). */
export function uninstallBundlePrimitive(id: string): void {
  delete PRIMITIVES[id];
}
