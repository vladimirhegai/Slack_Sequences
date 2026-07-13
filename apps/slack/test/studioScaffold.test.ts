import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { buildRecipeDemoDraft } from "../studio/scaffold.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Recipe Studio proof scaffold", () => {
  it("keeps the generated-field proof slate readable beside one wallpaper stage", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-recipe-scaffold-"));
    roots.push(project);
    const draft = buildRecipeDemoDraft(project, {
      recipeId: "ambient-hero-opener",
      params: {},
    });
    const { document } = parseHTML(draft.html);
    const sources = Array.from(
      document.querySelectorAll<HTMLImageElement>("[data-env-wallpaper]"),
    )
      .map((image) => image.getAttribute("src") ?? "");

    expect(sources).toHaveLength(1);
    expect(new Set(sources).size).toBe(sources.length);
    expect(new Set(sources.map((source) => source.split("?", 1)[0])).size).toBe(1);
    expect(document.querySelector('[data-env-scene="slate"]')?.getAttribute(
      "data-sequences-environment",
    )).toBe("generated-field");
    expect(draft.html).toContain(".slate-card { position: relative; z-index: 2;");
    expect(draft.storyboard.find((scene) => scene.id === "slate")?.background)
      .toContain("Abstract end card");
  });
});
