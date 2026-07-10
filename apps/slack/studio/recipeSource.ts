/**
 * Recipe sources — the agent-authored, single-file recipe library.
 *
 * A recipe is authored as ONE committed file, `apps/slack/recipes/<id>.recipe.html`
 * (see recipes/README.md for the authoring guide). Coding agents write these
 * files directly; the operator only views them (and their exported proofs) in
 * the studio. Each source file carries three regions:
 *
 *   <script type="application/json" data-recipe-meta>   manifest draft + demo
 *     params + retrieval sanity briefs (JSON — the machine header)
 *   <template data-recipe-doc>                          recipe.md markdown
 *     (the retrieval knowledge exported verbatim)
 *   everything else                                     the fragment — the
 *     exact bytes exported as fragment.html (style/markup/motion sections per
 *     src/engine/recipeContract.ts)
 *
 * The gate (`npm run recipes -- gate <id>`) and export
 * (`npm run recipes -- export <id>`) read ONLY this file; `.data/studio/<id>/`
 * is a derived, gitignored work dir and `skills/sequences-recipes/<id>/` is
 * the derived RecipeV2 export the live pipeline consumes — both regenerable,
 * neither hand-edited.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RECIPE_FORMAT_VERSION,
  loadRecipeLibrary,
  recipeFragmentHash,
  validateRecipeManifest,
  type RecipeManifest,
} from "../src/engine/recipeContract.ts";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The committed source library — one `<id>.recipe.html` per recipe. */
export const RECIPE_SOURCES_DIR = path.join(APP_DIR, "recipes");
export const RECIPE_SOURCE_SUFFIX = ".recipe.html";

/** Demo scaffold knobs + retrieval sanity briefs (source-only; never exported). */
export interface RecipeDemoSpec {
  params?: Record<string, string | number>;
  durationSec?: number;
  title?: string;
}

export interface RecipeSource {
  id: string;
  file: string;
  manifest: RecipeManifest;
  demo: RecipeDemoSpec;
  /** Briefs the exported recipe SHOULD match (export sanity check). */
  sanityBriefs: string[];
  /** recipe.md body (the data-recipe-doc block). */
  doc: string;
  /** The exact bytes exported as fragment.html. */
  fragment: string;
  fragmentHash: string;
}

export interface RecipeSourceIssue {
  file: string;
  errors: string[];
}

const META_BLOCK = /<script[^>]*\bdata-recipe-meta\b[^>]*>([\s\S]*?)<\/script>\r?\n?/;
const DOC_BLOCK = /<template[^>]*\bdata-recipe-doc\b[^>]*>\r?\n?([\s\S]*?)<\/template>\r?\n?/;

export function recipeSourceFile(id: string): string {
  return path.join(RECIPE_SOURCES_DIR, `${id}${RECIPE_SOURCE_SUFFIX}`);
}

/** Parse one source file; throws with every problem listed (agent-friendly). */
export function parseRecipeSource(file: string): RecipeSource {
  const raw = fs.readFileSync(file, "utf8");
  const idFromName = path.basename(file).slice(0, -RECIPE_SOURCE_SUFFIX.length);
  const errors: string[] = [];

  const metaMatch = raw.match(META_BLOCK);
  if (!metaMatch) {
    throw new Error(
      `${file}: missing <script type="application/json" data-recipe-meta> block`,
    );
  }
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(metaMatch[1]!) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `${file}: data-recipe-meta is not valid JSON — ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const docMatch = raw.match(DOC_BLOCK);
  if (!docMatch) errors.push("missing <template data-recipe-doc> block (the recipe.md body)");
  const doc = (docMatch?.[1] ?? "").trim() + "\n";

  // The fragment is the file minus the meta + doc blocks — comments included,
  // so a fragment's header comment survives into the exported fragment.html.
  const fragment = raw.replace(META_BLOCK, "").replace(DOC_BLOCK, "").replace(/^\s*\n/, "");

  // Split the studio-only fields off the manifest draft. `engine` fences and
  // `fragmentHash` are stamped at export from the CURRENT engine — a source
  // file never carries them.
  const {
    demo = {},
    sanityBriefs = [],
    engine: _engine,
    fragmentHash: _hash,
    ...manifestDraft
  } = meta as {
    demo?: RecipeDemoSpec;
    sanityBriefs?: string[];
    engine?: unknown;
    fragmentHash?: unknown;
  } & Record<string, unknown>;
  const manifest = { format: RECIPE_FORMAT_VERSION, revision: 1, ...manifestDraft } as RecipeManifest;
  errors.push(...validateRecipeManifest(manifest));
  if (manifest.id && manifest.id !== idFromName) {
    errors.push(`meta id "${manifest.id}" must match the file name ("${idFromName}")`);
  }
  for (const section of ["data-recipe-markup", "data-recipe-motion"]) {
    if (!fragment.includes(section)) errors.push(`fragment is missing its <${section}> section`);
  }
  if (!Array.isArray(sanityBriefs) || sanityBriefs.some((brief) => typeof brief !== "string")) {
    errors.push("sanityBriefs must be an array of strings");
  }
  if (errors.length) {
    throw new Error(`${file}:\n  - ${errors.join("\n  - ")}`);
  }
  return {
    id: manifest.id,
    file,
    manifest,
    demo,
    sanityBriefs,
    doc,
    fragment,
    fragmentHash: recipeFragmentHash(fragment),
  };
}

export function loadRecipeSource(id: string): RecipeSource {
  const file = recipeSourceFile(id);
  if (!fs.existsSync(file)) {
    throw new Error(
      `no recipe source "${id}" — expected ${file} (see apps/slack/recipes/README.md)`,
    );
  }
  return parseRecipeSource(file);
}

export interface RecipeSourceListing {
  sources: RecipeSource[];
  issues: RecipeSourceIssue[];
}

/** Every committed source, with per-file problems collected (never thrown). */
export function listRecipeSources(): RecipeSourceListing {
  const sources: RecipeSource[] = [];
  const issues: RecipeSourceIssue[] = [];
  if (!fs.existsSync(RECIPE_SOURCES_DIR)) return { sources, issues };
  const files = fs.readdirSync(RECIPE_SOURCES_DIR)
    .filter((name) => name.endsWith(RECIPE_SOURCE_SUFFIX))
    .sort();
  for (const name of files) {
    const file = path.join(RECIPE_SOURCES_DIR, name);
    try {
      sources.push(parseRecipeSource(file));
    } catch (error) {
      issues.push({
        file,
        errors: [(error instanceof Error ? error.message : String(error)).replace(`${file}:`, "").trim()],
      });
    }
  }
  return { sources, issues };
}

export interface RecipeSourceStatus {
  source: RecipeSource;
  /** The exported library entry, when one exists. */
  exported?: {
    revision: number;
    stale: boolean;
    staleReasons: string[];
    /** True when the exported fragment matches the source bytes. */
    inSync: boolean;
  };
}

/** Join sources against the exported library (what the live pipeline sees). */
export function recipeSourceStatuses(): { statuses: RecipeSourceStatus[]; issues: RecipeSourceIssue[] } {
  const { sources, issues } = listRecipeSources();
  const library = loadRecipeLibrary({ refresh: true });
  const statuses = sources.map((source) => {
    const exported = library.recipes.get(source.id);
    return {
      source,
      ...(exported
        ? {
            exported: {
              revision: exported.manifest.revision,
              stale: exported.stale,
              staleReasons: exported.staleReasons,
              inSync: exported.manifest.fragmentHash === source.fragmentHash,
            },
          }
        : {}),
    };
  });
  return { statuses, issues };
}
