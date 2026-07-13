/**
 * Recipe contract — the sixth host-owned contract (Recipe Studio, RecipeV2).
 *
 * A recipe is a PROVEN motion pattern (markup + CSS + seek-safe GSAP motion)
 * exported from the operator's Recipe Studio after passing the full
 * deterministic gate. Live `/sequences` creates consume recipes at
 * **Level 1 — host instantiation**: the storyboard declares
 * `recipes:[{id,params}]` per scene, and the host injects the recipe's
 * fragment VERBATIM (param slots filled, mechanism untouchable) with the same
 * strip-and-reinject discipline as the cut/camera/component islands. The
 * author model authors *around* the fragment; it can never edit the
 * mechanism, because the host deletes and re-injects it from the library on
 * every repair pass.
 *
 * Why this exists (RECIPE_STUDIO_PLAN.md §1): model authors reliably produce
 * sparse, generic visuals and cannot re-derive intricate signature patterns
 * (word roulettes, iris fills, choreographed demos) from prose. A human (or a
 * strong CLI agent) produces the pattern once in the studio, proves it
 * through the existing gate, and the pipeline reuses it verbatim forever.
 *
 * The defense stack (plan §7.4):
 * 1. mechanism unreachable — Level 1 injection, host-owned markers;
 * 2. params schema-validated and deterministically repaired at parse
 *    (Sentinel L2: default/drop, degrade-never-veto — a bad declaration
 *    never burns a paid attempt);
 * 3. full gate parity — an instantiated recipe still passes every existing
 *    validator, audit, and browser pass;
 * 4. version fencing — a recipe proven against older kit/runtime versions is
 *    skipped at load with a "re-prove me" warning;
 * 5. content addressing — `fragmentHash` detects tampering/drift;
 * 6. bounded budget — ≤ MAX_RECIPES_PER_FILM instances, fragment size caps.
 *
 * Library location: `apps/slack/skills/sequences-recipes/<id>/` with
 * `recipe.json` (machine header), `recipe.md` (retrieval knowledge),
 * `fragment.html` (the instantiation unit), `demo.html` (the gated proof),
 * `preview/` (operator gallery). See studio/INTEGRATION.md for the seams.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DirectScene } from "./directComposition.ts";
import {
  COMPONENT_KIT_VERSION,
  COMPONENT_RUNTIME_VERSION,
  COMPONENT_KINDS,
  type ComponentKind,
} from "./componentContract.ts";
import { CAMERA_RUNTIME_VERSION } from "./cameraContract.ts";
import { CONTINUITY_RUNTIME_VERSION } from "./continuityGraph.ts";
import { CUT_RUNTIME_VERSION } from "./cutContract.ts";
import { INTERACTION_RUNTIME_VERSION } from "./interactionContract.ts";
import { TIME_RUNTIME_VERSION } from "./timeRamp.ts";
import { FX_RUNTIME_VERSION } from "./fxContract.ts";
import { CINEMA_KIT_VERSION } from "./cinemaKit.ts";
import {
  ENVIRONMENT_KIT_VERSION,
  ENVIRONMENT_RUNTIME_VERSION,
} from "./environmentContract.ts";
import { slackSequencesEnvRawValue } from "./featureFlags.ts";

export const RECIPE_FORMAT_VERSION = 2;
/** Prompt/DOM budget: at most this many recipe instances per film. */
export const MAX_RECIPES_PER_FILM = 2;
/** A fragment larger than this is a scene, not a recipe (the >60-node lesson). */
export const MAX_FRAGMENT_CHARS = 24_000;

const DEFAULT_RECIPES_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../skills/sequences-recipes",
);

/**
 * Library root resolution. `SLACK_SEQUENCES_RECIPES_DIR` exists for the
 * Recipe Studio gate: a workspace recipe that is not yet exported is staged
 * into a temp library dir and gated through the IDENTICAL injection +
 * validation path (including the MCP subprocess, which inherits the env) —
 * never a parallel studio-only pipeline. Production never sets it.
 */
function resolveRecipesRoot(): string {
  const override = slackSequencesEnvRawValue("SLACK_SEQUENCES_RECIPES_DIR");
  return override ? path.resolve(override) : DEFAULT_RECIPES_ROOT;
}

/* ------------------------------------------------------------- format */

export type RecipeParamKind =
  | "text" // human copy; HTML-escaped in markup, JS-escaped in motion
  | "number" // finite, clamped to min/max
  | "color-token" // var(--token) reference only — never a raw hex (brand safety)
  | "enum" // one of options
  | "part-ref"; // kebab-case data-part name

export interface RecipeParamSpec {
  name: string;
  kind: RecipeParamKind;
  description?: string;
  /** Default makes the param optional; a required param with no usable value drops the declaration. */
  default?: string | number;
  /** number params */
  min?: number;
  max?: number;
  /** text params — reading-floor audits depend on bounded copy. */
  maxChars?: number;
  /** enum params */
  options?: string[];
}

export interface RecipeEngineFences {
  /** Informational: the storyboard cache contract the recipe was proven under. */
  storyboardContract?: number;
  /** Load-bearing: runtime/kit versions the fragment was proven against. */
  kitVersions?: Partial<Record<
    | "componentKit"
    | "componentRuntime"
    | "cameraRuntime"
    | "continuityRuntime"
    | "environmentRuntime"
    | "environmentKit"
    | "cutRuntime"
    | "interactionRuntime"
    | "timeRuntime"
    | "fxRuntime"
    | "cinemaKit",
    number
  >>;
}

export interface RecipeManifest {
  format: number;
  id: string;
  title: string;
  description?: string;
  tags: string[];
  /** Case-insensitive regex sources scored against the brief at retrieval. */
  triggerPatterns: string[];
  durationWindow?: { minSec?: number; maxSec?: number };
  /** Component kinds the pattern pairs well with (retrieval overlap signal). */
  componentKinds?: ComponentKind[];
  params: RecipeParamSpec[];
  engine?: RecipeEngineFences;
  /** sha256 of fragment.html at export; drift = re-prove. */
  fragmentHash?: string;
  revision: number;
}

export interface RecipeDefinition {
  manifest: RecipeManifest;
  /** recipe.md — the retrievable knowledge injected beside blueprints. */
  markdown: string;
  /** <template data-recipe-markup> contents with {{param}} slots. */
  fragmentMarkup: string;
  /** <script data-recipe-motion> contents: statements over tl/root/start/duration/uid. */
  fragmentMotion: string;
  /** <style data-recipe-style> contents (optional). */
  fragmentStyle: string;
  dir: string;
  /** True when a version fence drifted — retrieval and instantiation skip it. */
  stale: boolean;
  staleReasons: string[];
}

export interface RecipeLibrary {
  recipes: Map<string, RecipeDefinition>;
  /** Content hash over every manifest+fragment — the `recipesVersion` cache key. */
  version: string;
  warnings: string[];
}

/** Typed per-scene storyboard declaration (mirrors the other scene intents). */
export interface RecipeDeclarationV1 {
  version: 1;
  id: string;
  /** Optional data-region station to inject into (camera-world scenes). */
  region?: string;
  params: Record<string, string | number>;
}

/* ---------------------------------------------------------- fences */

export function currentEngineFences(): Required<Pick<RecipeEngineFences, "kitVersions">> {
  return {
    kitVersions: {
      componentKit: COMPONENT_KIT_VERSION,
      componentRuntime: COMPONENT_RUNTIME_VERSION,
      cameraRuntime: CAMERA_RUNTIME_VERSION,
      continuityRuntime: CONTINUITY_RUNTIME_VERSION,
      environmentRuntime: ENVIRONMENT_RUNTIME_VERSION,
      environmentKit: ENVIRONMENT_KIT_VERSION,
      cutRuntime: CUT_RUNTIME_VERSION,
      interactionRuntime: INTERACTION_RUNTIME_VERSION,
      timeRuntime: TIME_RUNTIME_VERSION,
      fxRuntime: FX_RUNTIME_VERSION,
      cinemaKit: CINEMA_KIT_VERSION,
    },
  };
}

function fenceDrift(manifest: RecipeManifest): string[] {
  const drifted: string[] = [];
  const current = currentEngineFences().kitVersions;
  for (const [name, provenAgainst] of Object.entries(manifest.engine?.kitVersions ?? {})) {
    const now = current[name as keyof typeof current];
    if (typeof provenAgainst === "number" && typeof now === "number" && provenAgainst !== now) {
      drifted.push(`${name} v${provenAgainst} -> v${now}`);
    }
  }
  return drifted;
}

/* ---------------------------------------------------------- parsing */

export function validateRecipeManifest(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== "object") return ["recipe.json must be an object"];
  const manifest = value as Record<string, unknown>;
  if (manifest.format !== RECIPE_FORMAT_VERSION) {
    errors.push(`recipe.json format must be ${RECIPE_FORMAT_VERSION}`);
  }
  if (typeof manifest.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(manifest.id)) {
    errors.push("recipe id must be stable kebab-case");
  }
  if (typeof manifest.title !== "string" || !manifest.title.trim()) {
    errors.push("recipe title is required");
  }
  if (!Array.isArray(manifest.triggerPatterns) || manifest.triggerPatterns.length === 0) {
    errors.push("triggerPatterns must be a non-empty array of regex sources");
  } else {
    for (const pattern of manifest.triggerPatterns) {
      if (typeof pattern !== "string") {
        errors.push("triggerPatterns entries must be strings");
        continue;
      }
      try {
        new RegExp(pattern, "i");
      } catch {
        errors.push(`triggerPattern is not a valid regex: ${pattern}`);
      }
    }
  }
  if (!Array.isArray(manifest.params)) {
    errors.push("params must be an array (possibly empty)");
  } else {
    for (const param of manifest.params as unknown[]) {
      const spec = param as Partial<RecipeParamSpec> | null;
      if (!spec || typeof spec.name !== "string" || !/^[a-zA-Z][\w-]*$/.test(spec.name)) {
        errors.push("every param needs a word-shaped name");
        continue;
      }
      if (!["text", "number", "color-token", "enum", "part-ref"].includes(spec.kind as string)) {
        errors.push(`param "${spec.name}" has unknown kind "${String(spec.kind)}"`);
      }
      if (spec.kind === "enum" && (!Array.isArray(spec.options) || !spec.options.length)) {
        errors.push(`enum param "${spec.name}" needs options[]`);
      }
    }
  }
  if (Array.isArray(manifest.componentKinds)) {
    for (const kind of manifest.componentKinds) {
      if (!COMPONENT_KINDS.has(kind as ComponentKind)) {
        errors.push(`componentKinds names unknown kind "${String(kind)}"`);
      }
    }
  }
  if (typeof manifest.revision !== "number" || manifest.revision < 1) {
    errors.push("revision must be a positive number");
  }
  return errors;
}

/**
 * Extract the three fragment sections. HTML comments are stripped FIRST so a
 * fragment's own documentation may mention the section tags without the
 * mention being parsed as the section (the golden fragment's header comment
 * did exactly that). Returns undefined when markup or motion is missing.
 */
export function parseRecipeFragment(
  raw: string,
): { markup: string; motion: string; style: string } | undefined {
  const source = raw.replace(/<!--[\s\S]*?-->/g, "");
  const markup = source.match(
    /<template\b[^>]*\bdata-recipe-markup\b[^>]*>([\s\S]*?)<\/template>/i,
  )?.[1];
  const motion = source.match(
    /<script\b[^>]*\bdata-recipe-motion\b[^>]*>([\s\S]*?)<\/script>/i,
  )?.[1];
  const style = source.match(
    /<style\b[^>]*\bdata-recipe-style\b[^>]*>([\s\S]*?)<\/style>/i,
  )?.[1];
  if (markup === undefined || motion === undefined) return undefined;
  return { markup: markup.trim(), motion: motion.trim(), style: (style ?? "").trim() };
}

export function recipeFragmentHash(fragmentSource: string): string {
  return createHash("sha256").update(fragmentSource.replace(/\r\n/g, "\n")).digest("hex");
}

/* ---------------------------------------------------------- library */

let libraryCache: { root: string; library: RecipeLibrary } | undefined;

export function recipesRootDir(): string {
  return resolveRecipesRoot();
}

/** The canonical shipped library dir (ignores the studio staging override). */
export function defaultRecipesRootDir(): string {
  return DEFAULT_RECIPES_ROOT;
}

/**
 * Load every recipe under skills/sequences-recipes/. Malformed recipes are
 * skipped with a warning, stale (fence-drifted / hash-drifted) recipes load
 * flagged so the studio can show "re-prove me" while live retrieval and
 * instantiation skip them. Cached per process; the studio passes
 * `refresh: true` after an export.
 */
export function loadRecipeLibrary(options: { refresh?: boolean } = {}): RecipeLibrary {
  const root = resolveRecipesRoot();
  if (libraryCache && libraryCache.root === root && !options.refresh) {
    return libraryCache.library;
  }
  const recipes = new Map<string, RecipeDefinition>();
  const warnings: string[] = [];
  const hash = createHash("sha256");
  if (fs.existsSync(root)) {
    const entries = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const name of entries) {
      const dir = path.join(root, name);
      const manifestFile = path.join(dir, "recipe.json");
      const fragmentFile = path.join(dir, "fragment.html");
      if (!fs.existsSync(manifestFile) || !fs.existsSync(fragmentFile)) {
        warnings.push(`recipe "${name}" is missing recipe.json or fragment.html — skipped`);
        continue;
      }
      let manifest: RecipeManifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as RecipeManifest;
      } catch (error) {
        warnings.push(
          `recipe "${name}" has unparseable recipe.json — skipped ` +
            `(${error instanceof Error ? error.message : String(error)})`,
        );
        continue;
      }
      const manifestErrors = validateRecipeManifest(manifest);
      if (manifestErrors.length) {
        warnings.push(`recipe "${name}" is invalid — skipped: ${manifestErrors.join("; ")}`);
        continue;
      }
      if (manifest.id !== name) {
        warnings.push(`recipe dir "${name}" declares id "${manifest.id}" — skipped (must match)`);
        continue;
      }
      const fragmentSource = fs.readFileSync(fragmentFile, "utf8");
      if (fragmentSource.length > MAX_FRAGMENT_CHARS) {
        warnings.push(`recipe "${name}" fragment exceeds ${MAX_FRAGMENT_CHARS} chars — skipped`);
        continue;
      }
      const fragment = parseRecipeFragment(fragmentSource);
      if (!fragment) {
        warnings.push(
          `recipe "${name}" fragment.html is missing its data-recipe-markup template ` +
            `or data-recipe-motion script — skipped`,
        );
        continue;
      }
      const staleReasons = fenceDrift(manifest);
      if (
        manifest.fragmentHash &&
        manifest.fragmentHash !== recipeFragmentHash(fragmentSource)
      ) {
        staleReasons.push("fragment.html drifted from its exported qaEvidence hash");
      }
      const markdownFile = path.join(dir, "recipe.md");
      recipes.set(manifest.id, {
        manifest,
        markdown: fs.existsSync(markdownFile) ? fs.readFileSync(markdownFile, "utf8").trim() : "",
        fragmentMarkup: fragment.markup,
        fragmentMotion: fragment.motion,
        fragmentStyle: fragment.style,
        dir,
        stale: staleReasons.length > 0,
        staleReasons,
      });
      hash.update(manifest.id).update(JSON.stringify(manifest)).update(fragmentSource);
    }
  }
  const library: RecipeLibrary = {
    recipes,
    version: recipes.size ? hash.digest("hex").slice(0, 16) : "empty",
    warnings,
  };
  libraryCache = { root, library };
  for (const warning of library.warnings) {
    process.stderr.write(`[recipes] ${warning}\n`);
  }
  return library;
}

/* ---------------------------------------------------- storyboard parse */

/**
 * Parse-time shape normalization (tolerant, like the other scene intents):
 * accepts `params` as `{name: value}` or `[{name, value}]` (the strict
 * JSON-schema-friendly form the planner is taught).
 */
export function normalizeStoryboardRecipeDeclarations(value: unknown): RecipeDeclarationV1[] {
  if (!Array.isArray(value)) return [];
  const declarations: RecipeDeclarationV1[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id) continue;
    const params: Record<string, string | number> = {};
    if (Array.isArray(raw.params)) {
      for (const entry of raw.params) {
        if (!entry || typeof entry !== "object") continue;
        const pair = entry as Record<string, unknown>;
        if (typeof pair.name !== "string") continue;
        if (typeof pair.value === "string" || typeof pair.value === "number") {
          params[pair.name] = pair.value;
        }
      }
    } else if (raw.params && typeof raw.params === "object") {
      for (const [name, paramValue] of Object.entries(raw.params as Record<string, unknown>)) {
        if (typeof paramValue === "string" || typeof paramValue === "number") {
          params[name] = paramValue;
        }
      }
    }
    declarations.push({
      version: 1,
      id,
      ...(typeof raw.region === "string" && raw.region.trim()
        ? { region: raw.region.trim() }
        : {}),
      params,
    });
  }
  return declarations;
}

function coerceParam(
  spec: RecipeParamSpec,
  value: string | number | undefined,
): { value?: string | number; note?: string } {
  const fallback = (): { value?: string | number; note?: string } => {
    if (spec.default !== undefined) {
      return {
        value: spec.default,
        note: value === undefined ? undefined : `param "${spec.name}" reset to its default`,
      };
    }
    return value === undefined
      ? { note: `required param "${spec.name}" is missing` }
      : { note: `required param "${spec.name}" has an unusable value` };
  };
  if (value === undefined) return fallback();
  switch (spec.kind) {
    case "text": {
      const text = String(value).trim();
      if (!text) return fallback();
      const capped = spec.maxChars && text.length > spec.maxChars
        ? text.slice(0, spec.maxChars).trimEnd()
        : text;
      return {
        value: capped,
        ...(capped !== text ? { note: `param "${spec.name}" copy capped to ${spec.maxChars} chars` } : {}),
      };
    }
    case "number": {
      const num = Number(value);
      if (!Number.isFinite(num)) return fallback();
      const clamped = Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, num));
      return {
        value: clamped,
        ...(clamped !== num ? { note: `param "${spec.name}" clamped to ${clamped}` } : {}),
      };
    }
    case "color-token": {
      // Brand safety: only frame.md token references — never raw hexes — so an
      // instantiated recipe is automatically on-brand for any job.
      const text = String(value).trim();
      const bare = text.match(/^--[a-z][a-z0-9-]*$/i)?.[0];
      if (bare) return { value: `var(${bare})` };
      if (/^var\(--[a-z][a-z0-9-]*\)$/i.test(text)) return { value: text };
      return fallback();
    }
    case "enum": {
      const text = String(value).trim();
      if (spec.options?.includes(text)) return { value: text };
      return fallback();
    }
    case "part-ref": {
      const text = String(value).trim();
      if (/^[a-z][a-z0-9-]*$/.test(text)) return { value: text };
      return fallback();
    }
  }
}

export interface RecipeReconcileResult {
  scenes: DirectScene[];
  /** Human-readable normalization notes (also appended to scene.sentinelNormalizations). */
  notes: string[];
}

const DASHBOARD_CHART_KINDS = new Set<ComponentKind>([
  "chart-bars",
  "chart-line",
  "progress-ring",
]);

/**
 * A recipe with this component signature is a complete dashboard surface, not
 * a decorative layer. If the scene already owns either the dashboard-grid
 * generator or the same authored app-window/metric/chart signature, injecting
 * the frozen fragment would render a second primary window beside it.
 *
 * This intentionally does not infer from prose or from one overlapping kind:
 * an app-window alone is ambiguous and remains eligible for recipe adoption.
 */
function duplicatesExistingPrimaryDashboard(
  scene: DirectScene,
  manifest: RecipeManifest,
): boolean {
  const recipeKinds = new Set(manifest.componentKinds ?? []);
  const recipeIsDashboard =
    recipeKinds.has("app-window") &&
    recipeKinds.has("stat-card") &&
    [...DASHBOARD_CHART_KINDS].some((kind) => recipeKinds.has(kind));
  if (!recipeIsDashboard) return false;
  if ((scene.plugins ?? []).some((plugin) => plugin.kind === "dashboard-grid")) return true;
  const sceneKinds = new Set((scene.components ?? []).map((component) => component.kind));
  return sceneKinds.has("app-window") &&
    sceneKinds.has("stat-card") &&
    [...DASHBOARD_CHART_KINDS].some((kind) => sceneKinds.has(kind));
}

/**
 * Sentinel L2 governor over declared recipes — deterministic repair, zero paid
 * attempts, degrade-never-veto (the dropUnusableGradeShifts precedent):
 * - unknown / stale recipe → declaration dropped with a note;
 * - over-budget (> MAX_RECIPES_PER_FILM instances) → earliest declarations win;
 * - duplicate id in one scene → first wins;
 * - full dashboard recipe + existing primary dashboard/plugin surface → authored surface wins;
 * - param violations → default / clamp / drop-param; a REQUIRED param with no
 *   usable value drops the whole declaration (the fragment would render a
 *   literal "{{slot}}" otherwise).
 * The recipe knowledge already reached the planner via retrieval (Level 0), so
 * a dropped declaration degrades to knowledge-level influence, never a veto.
 */
export function reconcileRecipeDeclarations(
  scenes: DirectScene[],
  library: RecipeLibrary = loadRecipeLibrary(),
): RecipeReconcileResult {
  const notes: string[] = [];
  let budget = MAX_RECIPES_PER_FILM;
  const reconciled = scenes.map((scene) => {
    if (!scene.recipes?.length) return scene;
    const kept: RecipeDeclarationV1[] = [];
    const sceneNotes: string[] = [];
    const seen = new Set<string>();
    for (const declaration of scene.recipes) {
      const recipe = library.recipes.get(declaration.id);
      if (!recipe) {
        sceneNotes.push(`recipe "${declaration.id}" is not in the library — declaration dropped`);
        continue;
      }
      if (recipe.stale) {
        sceneNotes.push(
          `recipe "${declaration.id}" is stale (${recipe.staleReasons.join(", ")}) — ` +
            `declaration dropped; re-prove it in the studio`,
        );
        continue;
      }
      if (duplicatesExistingPrimaryDashboard(scene, recipe.manifest)) {
        sceneNotes.push(
          `recipe "${declaration.id}" duplicates an existing primary dashboard surface — ` +
            `declaration absorbed; the authored/plugin surface wins`,
        );
        continue;
      }
      if (seen.has(declaration.id)) {
        sceneNotes.push(`recipe "${declaration.id}" declared twice in one scene — first wins`);
        continue;
      }
      if (budget <= 0) {
        sceneNotes.push(
          `recipe "${declaration.id}" exceeds the ${MAX_RECIPES_PER_FILM}-per-film budget — dropped`,
        );
        continue;
      }
      const params: Record<string, string | number> = {};
      let dropDeclaration: string | undefined;
      for (const spec of recipe.manifest.params) {
        const coerced = coerceParam(spec, declaration.params[spec.name]);
        if (coerced.note) sceneNotes.push(`recipe "${declaration.id}": ${coerced.note}`);
        if (coerced.value === undefined) {
          dropDeclaration = spec.name;
          break;
        }
        params[spec.name] = coerced.value;
      }
      if (dropDeclaration) {
        sceneNotes.push(
          `recipe "${declaration.id}" dropped — no usable value for required param "${dropDeclaration}"`,
        );
        continue;
      }
      const window = recipe.manifest.durationWindow;
      if (
        (window?.minSec !== undefined && scene.durationSec < window.minSec) ||
        (window?.maxSec !== undefined && scene.durationSec > window.maxSec)
      ) {
        sceneNotes.push(
          `recipe "${declaration.id}" runs outside its proven ${window?.minSec ?? 0}-` +
            `${window?.maxSec ?? "∞"}s window in a ${scene.durationSec}s scene (advisory)`,
        );
      }
      seen.add(declaration.id);
      budget -= 1;
      kept.push({ version: 1, id: declaration.id, ...(declaration.region ? { region: declaration.region } : {}), params });
    }
    if (!sceneNotes.length && kept.length === scene.recipes.length) {
      return { ...scene, recipes: kept };
    }
    notes.push(...sceneNotes.map((note) => `${scene.id}: ${note}`));
    return {
      ...scene,
      ...(kept.length ? { recipes: kept } : { recipes: undefined }),
      ...(sceneNotes.length
        ? {
            sentinelNormalizations: [
              ...(scene.sentinelNormalizations ?? []),
              ...sceneNotes.map((note) => `recipe-reconcile: ${note}`),
            ],
          }
        : {}),
    };
  });
  return { scenes: reconciled, notes };
}

/* ------------------------------------------------------- instantiation */

export interface ResolvedRecipeInstance {
  uid: string;
  recipeId: string;
  sceneId: string;
  region?: string;
  markup: string;
  motion: string;
  style: string;
  styleId: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeJsString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/`/g, "\\`")
    .replace(/\r?\n/g, "\\n")
    .replace(/<\/(script)/gi, "<\\/$1");
}

function fillSlots(
  template: string,
  params: Record<string, string | number>,
  escape: (value: string) => string,
): string {
  return template.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (whole, name: string) => {
    const value = params[name];
    if (value === undefined) return whole; // surfaced by validateRecipeContract
    return typeof value === "number" ? String(value) : escape(value);
  });
}

/**
 * Resolve every declared recipe into its param-filled, injectable form. Pure
 * function of the locked storyboard + library — deterministic by construction.
 * Context slots available to every fragment: {{uid}}, {{sceneId}}, {{start}},
 * {{duration}} (numbers in composition seconds).
 */
export function resolveRecipePlan(
  scenes: DirectScene[],
  library: RecipeLibrary = loadRecipeLibrary(),
): ResolvedRecipeInstance[] {
  const instances: ResolvedRecipeInstance[] = [];
  for (const scene of scenes) {
    for (const [index, declaration] of (scene.recipes ?? []).entries()) {
      const recipe = library.recipes.get(declaration.id);
      if (!recipe || recipe.stale) continue; // reconcile owns the note
      const uid = `${scene.id}-${declaration.id}${index ? `-${index + 1}` : ""}`;
      const context: Record<string, string | number> = {
        ...declaration.params,
        uid,
        sceneId: scene.id,
        start: Math.round(scene.startSec * 100) / 100,
        duration: Math.round(scene.durationSec * 100) / 100,
      };
      instances.push({
        uid,
        recipeId: declaration.id,
        sceneId: scene.id,
        ...(declaration.region ? { region: declaration.region } : {}),
        markup: fillSlots(recipe.fragmentMarkup, context, escapeHtml),
        motion: fillSlots(recipe.fragmentMotion, context, escapeJsString),
        style: recipe.fragmentStyle,
        styleId: `sequences-recipe-style-${declaration.id}`,
      });
    }
  }
  return instances;
}

/* ----------------------------------------------------------- injection */

const MOTION_OPEN = (uid: string) => `/*<seq-recipe uid="${uid}">*/`;
const MOTION_CLOSE = `/*</seq-recipe>*/`;
const MOTION_BLOCK_PATTERN = /\/\*<seq-recipe uid="[^"]*">\*\/[\s\S]*?\/\*<\/seq-recipe>\*\/\n?/g;
const STYLE_BLOCK_PATTERN =
  /<style\b[^>]*\bdata-sequences-recipe-style\s*=\s*(["'])[^"']*\1[^>]*>[\s\S]*?<\/style>\n?/gi;

/** Remove every injected recipe markup wrapper (balanced-div scan — fragments nest divs). */
export function stripRecipeMarkup(html: string): string {
  let result = html;
  for (;;) {
    const open = /<div\b[^>]*\bdata-sequences-recipe\s*=\s*(["'])[^"']*\1[^>]*>/i.exec(result);
    if (!open) break;
    const tagEnd = open.index + open[0].length;
    const scanner = /<div\b|<\/div\s*>/gi;
    scanner.lastIndex = tagEnd;
    let depth = 1;
    let end = -1;
    for (let match = scanner.exec(result); match; match = scanner.exec(result)) {
      depth += match[0].startsWith("</") ? -1 : 1;
      if (depth === 0) {
        end = match.index + match[0].length;
        break;
      }
    }
    if (end < 0) {
      // Unbalanced wrapper (should be impossible for host-injected markup):
      // drop from the wrapper open to end of its line to stay convergent.
      end = tagEnd;
    }
    result = result.slice(0, open.index) + result.slice(end);
  }
  return result.replace(/\n[ \t]*\n[ \t]*\n/g, "\n\n");
}

function sceneOpenTag(html: string, sceneId: string): { index: number; end: number } | undefined {
  const pattern = new RegExp(
    `<([a-z][\\w:-]*)\\b[^>]*\\bid\\s*=\\s*(["'])${sceneId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\2[^>]*>`,
    "i",
  );
  const match = pattern.exec(html);
  if (!match) return undefined;
  return { index: match.index, end: match.index + match[0].length };
}

/**
 * Inject (strip + re-inject) every resolved recipe instance:
 * - markup: a host-marked wrapper prepended inside the target scene section
 *   (or inside its declared data-region station when present) — re-injected
 *   VERBATIM from the library on every repair pass, so the mechanism is
 *   unreachable to the author model, exactly like the other host islands;
 * - style: one <style data-sequences-recipe-style> per recipe id in <head>;
 * - motion: an IIFE over (tl, root) between comment markers, anchored before
 *   the timeline registration (and before SequencesTime.wrap when a ramp
 *   already wrapped it — recipe tweens must exist before the master wraps).
 * Must run BEFORE the time-wrap rewrite (the LAST injection — gotcha #2).
 */
export function injectRecipeContract(
  html: string,
  scenes: DirectScene[],
  library: RecipeLibrary = loadRecipeLibrary(),
): { html: string; injected: string[] } {
  const instances = resolveRecipePlan(scenes, library);
  const hadInjections =
    /data-sequences-recipe\s*=/.test(html) || MOTION_BLOCK_PATTERN.test(html);
  MOTION_BLOCK_PATTERN.lastIndex = 0;
  if (!instances.length && !hadInjections) return { html, injected: [] };
  let result = stripRecipeMarkup(html)
    .replace(MOTION_BLOCK_PATTERN, "")
    .replace(STYLE_BLOCK_PATTERN, "");
  const injected: string[] = [];
  const styleInjected = new Set<string>();
  // The host wrapper must be layout-neutral in ANY hosting scene (flex, grid,
  // absolute worlds): display:contents hands the fragment its natural place.
  if (instances.length && !/data-sequences-recipe-style\s*=\s*(["'])seq-recipe-base\1/.test(result)) {
    const baseStyle =
      `<style data-sequences-host="1" data-sequences-recipe-style="seq-recipe-base" ` +
      `id="sequences-recipe-style-base">.seq-recipe{display:contents}</style>\n`;
    result = /<\/head>/i.test(result)
      ? result.replace(/<\/head>/i, `${baseStyle}</head>`)
      : baseStyle + result;
  }
  for (const instance of instances) {
    const scene = sceneOpenTag(result, instance.sceneId);
    if (!scene) continue; // validateRecipeContract reports recipe_scene_missing
    let anchorEnd = scene.end;
    if (instance.region) {
      const regionPattern = new RegExp(
        `<[a-z][\\w:-]*\\b[^>]*\\bdata-region\\s*=\\s*(["'])${instance.region.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1[^>]*>`,
        "gi",
      );
      regionPattern.lastIndex = scene.end;
      const region = regionPattern.exec(result);
      // Region binding is best-effort: a missing station degrades to the scene
      // root (screen-locked) rather than dropping the proven pattern.
      if (region) anchorEnd = region.index + region[0].length;
    }
    const wrapper =
      `\n<div class="seq-recipe" data-sequences-host="1" ` +
      `data-sequences-recipe="${instance.recipeId}" data-recipe-uid="${instance.uid}">` +
      `${instance.markup}</div>`;
    result = result.slice(0, anchorEnd) + wrapper + result.slice(anchorEnd);
    if (instance.style && !styleInjected.has(instance.styleId)) {
      const styleTag =
        `<style data-sequences-host="1" data-sequences-recipe-style="${instance.recipeId}" ` +
        `id="${instance.styleId}">\n${instance.style}\n</style>\n`;
      result = /<\/head>/i.test(result)
        ? result.replace(/<\/head>/i, `${styleTag}</head>`)
        : styleTag + result;
      styleInjected.add(instance.styleId);
    }
    injected.push(instance.uid);
  }
  if (injected.length) {
    // One motion anchor for all instances: immediately before the registration
    // statement (or the time-wrap that replaced it), inside the same inline
    // script, so the tweens join the same paused timeline the runtimes compile
    // into. The timeline variable name mirrors the compile-call injections.
    const timelineName = result.match(
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(/,
    )?.[1];
    const anchor =
      /var __seqWarped = SequencesTime\.wrap\s*\(/.exec(result) ??
      /window\.__timelines\s*\[[^\]]+\]\s*=\s*[A-Za-z_$][\w$]*\s*;/.exec(result);
    if (timelineName && anchor) {
      const motion = instances
        .filter((instance) => injected.includes(instance.uid))
        .map((instance) =>
          `${MOTION_OPEN(instance.uid)}\n` +
          `(function(tl, root, start, duration, uid){\n${instance.motion}\n})(` +
          `${timelineName}, document.querySelector("[data-composition-id]"), ` +
          `${scenes.find((scene) => scene.id === instance.sceneId)?.startSec ?? 0}, ` +
          `${scenes.find((scene) => scene.id === instance.sceneId)?.durationSec ?? 0}, ` +
          `"${instance.uid}");\n${MOTION_CLOSE}\n`,
        )
        .join("");
      result = result.slice(0, anchor.index) + motion + result.slice(anchor.index);
    }
  }
  return { html: result, injected };
}

/* ----------------------------------------------------------- validation */

/**
 * Host-plumbing self-check (the validateFxContract disposition): these codes
 * are reachable only if the injection seam breaks or a declaration survived
 * reconciliation without a library entry — never as routine authoring
 * findings, because the host injects and the L2 governor drops the rest.
 */
export function validateRecipeContract(
  html: string,
  scenes: DirectScene[],
  library: RecipeLibrary = loadRecipeLibrary(),
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const scene of scenes) {
    for (const declaration of scene.recipes ?? []) {
      const recipe = library.recipes.get(declaration.id);
      if (!recipe) {
        errors.push(
          `recipe_unknown: scene "${scene.id}" declares recipe "${declaration.id}" ` +
            `which is not in the library (reconciliation should have dropped it)`,
        );
        continue;
      }
      if (recipe.stale) {
        warnings.push(
          `recipe "${declaration.id}" is stale (${recipe.staleReasons.join(", ")}) — ` +
            `it was skipped at instantiation`,
        );
        continue;
      }
      const uidPattern = new RegExp(
        `data-recipe-uid\\s*=\\s*(["'])${scene.id}-${declaration.id}[^"']*\\1`,
        "i",
      );
      if (!uidPattern.test(html)) {
        errors.push(
          `recipe_island_missing: scene "${scene.id}" declared recipe ` +
            `"${declaration.id}" but its host-injected markup wrapper is absent`,
        );
      }
      const motionPattern = new RegExp(
        `<seq-recipe uid="${scene.id}-${declaration.id}`,
      );
      if (!motionPattern.test(html)) {
        errors.push(
          `recipe_motion_missing: scene "${scene.id}" declared recipe ` +
            `"${declaration.id}" but its host-injected motion block is absent`,
        );
      }
    }
  }
  // An unfilled slot means a context param name drifted — visible as literal
  // {{name}} in the shipped DOM. Host bug, so it blocks.
  const unfilled = stripNonRecipeContent(html).match(/\{\{\s*[\w-]+\s*\}\}/g);
  if (unfilled?.length) {
    errors.push(
      `recipe_slot_unfilled: injected recipe content still carries literal ` +
        `slot(s) ${[...new Set(unfilled)].join(", ")}`,
    );
  }
  return { errors, warnings };
}

/** Only recipe-injected regions may legitimately carry {{slot}} braces. */
function stripNonRecipeContent(html: string): string {
  const kept: string[] = [];
  const wrapperPattern = /data-recipe-uid\s*=\s*(["'])([^"']*)\1/g;
  for (let match = wrapperPattern.exec(html); match; match = wrapperPattern.exec(html)) {
    const start = html.lastIndexOf("<div", match.index);
    if (start < 0) continue;
    const scanner = /<div\b|<\/div\s*>/gi;
    scanner.lastIndex = html.indexOf(">", match.index) + 1;
    let depth = 1;
    for (let step = scanner.exec(html); step; step = scanner.exec(html)) {
      depth += step[0].startsWith("</") ? -1 : 1;
      if (depth === 0) {
        kept.push(html.slice(start, step.index));
        break;
      }
    }
  }
  const motionBlocks = html.match(MOTION_BLOCK_PATTERN) ?? [];
  MOTION_BLOCK_PATTERN.lastIndex = 0;
  return kept.join("\n") + motionBlocks.join("\n");
}

/* ------------------------------------------------------------ retrieval */

/**
 * Score a recipe against a brief: trigger patterns are the strong signal,
 * tags/title words and component-kind mentions add overlap. Used by
 * skillContext retrieval (cap MAX_RECIPES_PER_FILM) and by the studio export
 * wizard's retrieval sanity check.
 */
export function recipeRetrievalScore(manifest: RecipeManifest, query: string): number {
  const lower = query.toLowerCase();
  let score = 0;
  for (const pattern of manifest.triggerPatterns) {
    try {
      if (new RegExp(pattern, "i").test(query)) score += 3;
    } catch {
      // invalid patterns already warned at load
    }
  }
  for (const tag of manifest.tags ?? []) {
    if (tag && lower.includes(tag.toLowerCase())) score += 1;
  }
  for (const kind of manifest.componentKinds ?? []) {
    if (lower.includes(kind)) score += 1;
  }
  return score;
}

export const RECIPE_AUTO_DECLARE_SCORE = 6;

export interface RecipeAutoDeclareResult {
  scenes: DirectScene[];
  declared: Array<{ recipeId: string; sceneId: string; score: number }>;
  /** Existing or prospective auto declarations absorbed by an owned primary surface. */
  absorbed: Array<{ recipeId: string; sceneId: string }>;
}

function appendRecipeNormalization(scene: DirectScene, note: string): DirectScene {
  if (scene.sentinelNormalizations?.includes(note)) return scene;
  return {
    ...scene,
    sentinelNormalizations: [...(scene.sentinelNormalizations ?? []), note],
  };
}

function primaryDashboardRecipeNormalization(recipeId: string): string {
  return `recipe-auto-declare: absorbed primary-surface duplicate "${recipeId}"; ` +
    `the authored/plugin dashboard wins`;
}

function briefProductName(query: string): string | undefined {
  const value = query.match(/^Product:\s*(.+)$/im)?.[1]?.trim();
  return value && value.length <= 80 ? value : undefined;
}

/**
 * High-confidence, degrade-never-veto recipe adoption (WS-G1). Only recipes
 * whose every parameter has a safe manifest default are eligible; the host
 * never guesses required creative copy. Existing non-conflicting declarations
 * win, an already-owned primary dashboard wins over a duplicate recipe, the
 * film cap remains authoritative, and scene choice is deterministic.
 */
export function autoDeclareHighConfidenceRecipes(
  scenes: DirectScene[],
  recipes: RecipeDefinition[],
  query: string,
  minimumScore = RECIPE_AUTO_DECLARE_SCORE,
): RecipeAutoDeclareResult {
  const definitions = new Map(recipes.map((recipe) => [recipe.manifest.id, recipe]));
  const absorbed: Array<{ recipeId: string; sceneId: string }> = [];
  const blockedRecipeIds = new Set<string>();
  let changed = false;
  // Cached plans created before this governor can already contain the injected
  // declaration. Absorb it before the existing-id/budget checks, then block it
  // from being auto-added again in the same replay.
  const next = scenes.map((scene) => {
    if (!scene.recipes?.length) return scene;
    const removed: string[] = [];
    const kept = scene.recipes.filter((declaration) => {
      const recipe = definitions.get(declaration.id);
      if (!recipe || !duplicatesExistingPrimaryDashboard(scene, recipe.manifest)) return true;
      absorbed.push({ recipeId: declaration.id, sceneId: scene.id });
      blockedRecipeIds.add(declaration.id);
      removed.push(declaration.id);
      changed = true;
      return false;
    });
    if (!removed.length) return scene;
    let normalized: DirectScene = {
      ...scene,
      ...(kept.length ? { recipes: kept } : { recipes: undefined }),
    };
    for (const recipeId of removed) {
      normalized = appendRecipeNormalization(
        normalized,
        primaryDashboardRecipeNormalization(recipeId),
      );
    }
    return normalized;
  });
  const existing = new Set(
    [...blockedRecipeIds, ...next.flatMap((scene) =>
      (scene.recipes ?? []).map((declaration) => declaration.id)
    )],
  );
  let remaining = Math.max(
    0,
    MAX_RECIPES_PER_FILM - next.reduce((count, scene) => count + (scene.recipes?.length ?? 0), 0),
  );
  if (!remaining) return { scenes: changed ? next : scenes, declared: [], absorbed };
  const eligible = recipes
    .map((recipe) => ({ recipe, score: recipeRetrievalScore(recipe.manifest, query) }))
    .filter(({ recipe, score }) =>
      !recipe.stale && !existing.has(recipe.manifest.id) && score >= minimumScore &&
      recipe.manifest.params.every((param) => param.default !== undefined)
    )
    .sort((a, b) => b.score - a.score || a.recipe.manifest.id.localeCompare(b.recipe.manifest.id));
  const declared: Array<{ recipeId: string; sceneId: string; score: number }> = [];
  for (const { recipe, score } of eligible) {
    if (!remaining) break;
    const window = recipe.manifest.durationWindow;
    const candidates = next
      .map((scene, index) => {
        const durationEligible =
          (window?.minSec === undefined || scene.durationSec >= window.minSec) &&
          (window?.maxSec === undefined || scene.durationSec <= window.maxSec);
        if (!durationEligible || (scene.recipes?.length ?? 0) >= MAX_RECIPES_PER_FILM) return undefined;
        const kinds = new Set((scene.components ?? []).map((component) => component.kind));
        const componentOverlap = (recipe.manifest.componentKinds ?? [])
          .filter((kind) => kinds.has(kind)).length;
        const sceneText = [scene.title, scene.purpose, scene.foreground, scene.background]
          .filter(Boolean).join(" ");
        const localScore = recipeRetrievalScore(recipe.manifest, sceneText);
        return { index, rank: componentOverlap * 4 + localScore, startSec: scene.startSec };
      })
      .filter((entry): entry is { index: number; rank: number; startSec: number } => Boolean(entry))
      .sort((a, b) => b.rank - a.rank || a.startSec - b.startSec || a.index - b.index);
    const target = candidates[0];
    if (!target) continue;
    const targetScene = next[target.index]!;
    if (duplicatesExistingPrimaryDashboard(targetScene, recipe.manifest)) {
      absorbed.push({ recipeId: recipe.manifest.id, sceneId: targetScene.id });
      const normalized = appendRecipeNormalization(
        targetScene,
        primaryDashboardRecipeNormalization(recipe.manifest.id),
      );
      if (normalized !== targetScene) {
        next[target.index] = normalized;
        changed = true;
      }
      continue;
    }
    const product = briefProductName(query);
    const params = Object.fromEntries(
      recipe.manifest.params.map((param) => [
        param.name,
        param.name === "product" && param.kind === "text" && product &&
            (!param.maxChars || product.length <= param.maxChars)
          ? product
          : param.default!,
      ]),
    );
    const scene: DirectScene = {
      ...targetScene,
      recipes: [
        ...(targetScene.recipes ?? []),
        { version: 1, id: recipe.manifest.id, params },
      ],
    };
    next[target.index] = scene;
    declared.push({ recipeId: recipe.manifest.id, sceneId: scene.id, score });
    existing.add(recipe.manifest.id);
    remaining -= 1;
    changed = true;
  }
  return { scenes: changed ? next : scenes, declared, absorbed };
}

/** Cut markdown to a budget at a paragraph boundary (never mid-sentence). */
function trimMarkdownToBudget(markdown: string, budget: number): string {
  if (markdown.length <= budget) return markdown;
  const slice = markdown.slice(0, budget);
  const paragraphEnd = slice.lastIndexOf("\n\n");
  return (paragraphEnd > budget * 0.5 ? slice.slice(0, paragraphEnd) : slice).trimEnd() + "\n…";
}

/**
 * The planner-facing teaching block for retrieved recipes. Recipes are
 * host-instantiated proven patterns, so the instruction is deliberately
 * strong: when one matches the brief, declaring it is the DEFAULT — the
 * planner may decline only when it genuinely conflicts with the brief.
 *
 * `markdownBudget` bounds each recipe's doc inside the block: the skill
 * context is a fixed window shared with blueprints/motion rules, and an
 * unbounded recipe.md (they grow with every authored recipe) would push the
 * craft reference past the final trim. Param slots + the declaration example
 * are never trimmed — they are the executable part.
 */
export function recipePlanningVocabulary(
  recipes: RecipeDefinition[],
  options: { markdownBudget?: number } = {},
): string {
  if (!recipes.length) return "";
  const markdownBudget = options.markdownBudget ?? Infinity;
  const blocks = recipes.map((recipe) => {
    const params = recipe.manifest.params.map((param) => {
      const constraint =
        param.kind === "enum"
          ? param.options?.join("|")
          : param.kind === "number"
            ? `${param.min ?? "-∞"}..${param.max ?? "∞"}`
            : param.kind === "text" && param.maxChars
              ? `≤${param.maxChars} chars`
              : param.kind;
      return `  - ${param.name} (${param.kind}${constraint && constraint !== param.kind ? `: ${constraint}` : ""})` +
        `${param.default !== undefined ? ` default ${JSON.stringify(param.default)}` : " REQUIRED"}` +
        `${param.description ? ` — ${param.description}` : ""}`;
    });
    const example = {
      version: 1,
      id: recipe.manifest.id,
      params: recipe.manifest.params.slice(0, 4).map((param) => ({
        name: param.name,
        value: param.default ?? (param.kind === "number" ? 1 : "…"),
      })),
    };
    return [
      `<recipe id="${recipe.manifest.id}">`,
      Number.isFinite(markdownBudget)
        ? trimMarkdownToBudget(recipe.markdown || recipe.manifest.title, markdownBudget)
        : recipe.markdown || recipe.manifest.title,
      "",
      `Param slots:`,
      ...params,
      `Declare inside the target shot as:`,
      `"recipes":[${JSON.stringify(example)}]`,
      `</recipe>`,
    ].join("\n");
  });
  return [
    "## Proven recipes (host-instantiated — DECLARE these, do not re-derive them)",
    "A recipe is a signature motion pattern already proven through the full",
    "deterministic gate. When one below matches this brief, declaring it is the",
    "DEFAULT: add it to the matching shot's \"recipes\" array and fill its param",
    "slots from the brief. The host injects the proven markup+motion verbatim —",
    "declaring a recipe costs zero authoring budget and cannot fail QA the way",
    "a re-derived imitation can. Plan the rest of the shot AROUND it (the",
    "recipe owns its own focal moment; give it breathing room). Decline a",
    "recipe only when it genuinely conflicts with the brief. Budget: at most",
    `${MAX_RECIPES_PER_FILM} recipe instances per film.`,
    "",
    ...blocks,
  ].join("\n");
}
