import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  STUDIO_CATALOGS,
  buildCatalogScaffold,
  writeCatalogScaffold,
} from "../studio/catalogScaffold.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Studio catalog scaffolds", () => {
  it("provides a deterministic starter and skill route for every product tab", () => {
    for (const catalog of STUDIO_CATALOGS) {
      const scaffold = buildCatalogScaffold(catalog, `proof-${catalog}`);
      expect(scaffold.content, catalog).toContain(`proof-${catalog}`);
      expect(scaffold.skill, catalog).toBe(`studio/skills/studio-${catalog}/SKILL.md`);
    }
  });

  it("writes recipes to their source directory and other drafts to ignored data", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-catalog-"));
    roots.push(root);
    const recipe = writeCatalogScaffold(root, buildCatalogScaffold("recipes", "fast-proof"));
    const plugin = writeCatalogScaffold(root, buildCatalogScaffold("plugins", "proof-stack"));
    expect(recipe).toBe(path.join(root, "recipes", "fast-proof.recipe.html"));
    expect(plugin).toContain(path.join(".data", "studio", "scaffolds", "plugins"));
    expect(() => writeCatalogScaffold(root, buildCatalogScaffold("recipes", "fast-proof")))
      .toThrow(/refusing to overwrite/);
  });

  it("rejects unknown catalogs and unsafe ids", () => {
    expect(() => buildCatalogScaffold("widgets", "good-id")).toThrow(/unknown catalog/);
    expect(() => buildCatalogScaffold("camera", "Bad Id")).toThrow(/lower kebab-case/);
  });
});
