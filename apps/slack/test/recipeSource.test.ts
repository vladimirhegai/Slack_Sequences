/**
 * Recipe source format — the agent-authored single-file library
 * (recipes/<id>.recipe.html, parsed by studio/recipeSource.ts).
 *
 * Guards the format seams: meta/doc extraction, fragment byte preservation
 * (the fragment IS what ships as fragment.html — hash-addressed), id/file
 * agreement, and the golden source staying loadable and in sync with the
 * exported library entry.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  listRecipeSources,
  loadRecipeSource,
  parseRecipeSource,
  RECIPE_SOURCES_DIR,
} from "../studio/recipeSource.ts";
import { loadRecipeLibrary, recipeFragmentHash } from "../src/engine/recipeContract.ts";

const VALID_META = {
  format: 2,
  id: "tmp-recipe",
  title: "A test recipe",
  tags: ["test"],
  triggerPatterns: ["test pattern"],
  params: [{ name: "headline", kind: "text", maxChars: 40, default: "Hi" }],
  revision: 1,
  demo: { durationSec: 5, params: { headline: "Hello" } },
  sanityBriefs: ["A brief with the test pattern in it."],
};

const FRAGMENT = `<style data-recipe-style>
  .rcp-tmp { color: var(--rcp-accent, #fff); }
</style>
<template data-recipe-markup>
  <div class="rcp-tmp" data-part="{{uid}}-hero">{{headline}}</div>
</template>
<script data-recipe-motion>
  tl.fromTo('[data-part="' + uid + '-hero"]', { opacity: 0 }, { opacity: 1, duration: 0.5 }, start + 0.2);
</script>
`;

function sourceFile(meta: unknown, doc = "# tmp-recipe\n\nDocs.\n"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-source-test-"));
  const file = path.join(dir, "tmp-recipe.recipe.html");
  fs.writeFileSync(
    file,
    `<script type="application/json" data-recipe-meta>\n${JSON.stringify(meta, null, 2)}\n</script>\n` +
      `<template data-recipe-doc>\n${doc}</template>\n` +
      FRAGMENT,
    "utf8",
  );
  return file;
}

describe("parseRecipeSource", () => {
  it("splits meta, doc, and fragment — fragment bytes exclude the studio blocks", () => {
    const source = parseRecipeSource(sourceFile(VALID_META));
    expect(source.id).toBe("tmp-recipe");
    expect(source.manifest.title).toBe("A test recipe");
    expect(source.demo.params).toEqual({ headline: "Hello" });
    expect(source.sanityBriefs).toHaveLength(1);
    expect(source.doc).toContain("# tmp-recipe");
    expect(source.fragment).toBe(FRAGMENT);
    expect(source.fragmentHash).toBe(recipeFragmentHash(FRAGMENT));
    // The studio blocks never leak into the exported fragment.
    expect(source.fragment).not.toContain("data-recipe-meta");
    expect(source.fragment).not.toContain("data-recipe-doc");
  });

  it("rejects an id/file-name mismatch and a missing motion section", () => {
    expect(() => parseRecipeSource(sourceFile({ ...VALID_META, id: "other-id" })))
      .toThrow(/must match the file name/);
    const file = sourceFile(VALID_META);
    fs.writeFileSync(
      file,
      fs.readFileSync(file, "utf8").replace(/<script data-recipe-motion>[\s\S]*?<\/script>\n/, ""),
      "utf8",
    );
    expect(() => parseRecipeSource(file)).toThrow(/data-recipe-motion/);
  });

  it("never accepts source-authored engine fences or fragment hashes", () => {
    const source = parseRecipeSource(
      sourceFile({ ...VALID_META, engine: { kitVersions: { fxRuntime: 99 } }, fragmentHash: "beef" }),
    );
    expect(source.manifest.engine).toBeUndefined();
    expect(source.manifest.fragmentHash).toBeUndefined();
  });

  it("rejects invalid meta JSON and a missing meta block with pointed errors", () => {
    const file = sourceFile(VALID_META);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"format": 2,', '"format": 2,,'), "utf8");
    expect(() => parseRecipeSource(file)).toThrow(/not valid JSON/);
    fs.writeFileSync(file, FRAGMENT, "utf8");
    expect(() => parseRecipeSource(file)).toThrow(/data-recipe-meta/);
  });
});

describe("the committed source library", () => {
  it("parses cleanly — every recipes/*.recipe.html is loadable", () => {
    const { sources, issues } = listRecipeSources();
    expect(issues).toEqual([]);
    expect(sources.length).toBeGreaterThan(0);
    expect(fs.existsSync(RECIPE_SOURCES_DIR)).toBe(true);
  });

  it("keeps the golden last-word-roulette source in byte-sync with the exported library fragment", () => {
    const source = loadRecipeSource("last-word-roulette");
    expect(source.demo.params).toBeTruthy();
    expect(source.sanityBriefs.length).toBeGreaterThan(0);
    const exported = loadRecipeLibrary({ refresh: true }).recipes.get("last-word-roulette");
    expect(exported, "golden recipe must exist in skills/sequences-recipes").toBeTruthy();
    expect(exported!.manifest.fragmentHash).toBe(source.fragmentHash);
  });
});
