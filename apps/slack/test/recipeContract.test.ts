import { describe, expect, it } from "vitest";
import {
  MAX_RECIPES_PER_FILM,
  injectRecipeContract,
  loadRecipeLibrary,
  normalizeStoryboardRecipeDeclarations,
  parseRecipeFragment,
  recipeRetrievalScore,
  reconcileRecipeDeclarations,
  resolveRecipePlan,
  stripRecipeMarkup,
  validateRecipeContract,
  validateRecipeManifest,
  type RecipeDefinition,
  type RecipeLibrary,
  type RecipeManifest,
} from "../src/engine/recipeContract.ts";
import { retrieveHyperframesSkillContext } from "../src/agent/skillContext.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";

/* ------------------------------------------------------------ fixtures */

function manifest(overrides: Partial<RecipeManifest> = {}): RecipeManifest {
  return {
    format: 2,
    id: "test-recipe",
    title: "Test recipe",
    tags: ["test"],
    triggerPatterns: ["test recipe"],
    params: [
      { name: "copy", kind: "text", maxChars: 24 },
      { name: "speed", kind: "number", min: 0.5, max: 3, default: 1 },
      { name: "accent", kind: "color-token", default: "var(--cinema-key)" },
    ],
    revision: 1,
    ...overrides,
  };
}

function definition(overrides: Partial<RecipeDefinition> = {}): RecipeDefinition {
  return {
    manifest: manifest(overrides.manifest ? {} : {}),
    markdown: "Use for tests.",
    fragmentMarkup:
      `<div class="tst" data-part="{{uid}}-hero" data-layout-important>` +
      `<span class="tst-copy">{{copy}}</span></div>`,
    fragmentMotion:
      `tl.fromTo('[data-part="' + uid + '-hero"]', { opacity: 0 }, ` +
      `{ opacity: 1, duration: {{speed}}, ease: "power3.out" }, start + 0.2);` +
      `\nvar label = "{{copy}}";`,
    fragmentStyle: `.tst { color: var(--rcp-accent, #fff); }`,
    dir: "",
    stale: false,
    staleReasons: [],
    ...overrides,
  };
}

function library(definitions: RecipeDefinition[] = [definition()]): RecipeLibrary {
  return {
    recipes: new Map(definitions.map((def) => [def.manifest.id, def])),
    version: "test",
    warnings: [],
  };
}

function scene(
  overrides: Partial<DirectScene> & Pick<DirectScene, "id" | "startSec" | "durationSec">,
): DirectScene {
  return { title: overrides.id, purpose: "test", ...overrides };
}

const SHELL = `<!doctype html>
<html><head><title>t</title><script src="gsap.min.js"></script></head>
<body>
<div id="root" data-composition-id="demo" data-width="1920" data-height="1080" data-duration="6">
<section id="stage" class="scene clip" data-scene="stage" data-start="0" data-duration="6" data-track-index="1">
<div data-region="hero-claim"><p>content</p></div>
</section>
</div>
<script>
window.__timelines = window.__timelines || {};
var tl = gsap.timeline({ paused: true });
tl.set("#stage", { opacity: 1 }, 0);
window.__timelines["demo"] = tl;
tl.seek(0);
</script>
</body></html>`;

/* -------------------------------------------------------- manifest/fragment */

describe("validateRecipeManifest", () => {
  it("accepts the fixture manifest", () => {
    expect(validateRecipeManifest(manifest())).toEqual([]);
  });

  it("rejects bad ids, empty triggers, unknown param kinds, and bad regexes", () => {
    const errors = validateRecipeManifest({
      format: 2,
      id: "Bad Id",
      title: "",
      tags: [],
      triggerPatterns: ["[unclosed"],
      params: [{ name: "x", kind: "mystery" }],
      revision: 0,
    });
    expect(errors.join("\n")).toMatch(/kebab-case/);
    expect(errors.join("\n")).toMatch(/title/);
    expect(errors.join("\n")).toMatch(/not a valid regex/);
    expect(errors.join("\n")).toMatch(/unknown kind/);
    expect(errors.join("\n")).toMatch(/revision/);
  });
});

describe("parseRecipeFragment", () => {
  it("extracts markup, motion, and optional style", () => {
    const parsed = parseRecipeFragment(
      `<style data-recipe-style>.x{}</style>\n` +
      `<template data-recipe-markup><div>{{a}}</div></template>\n` +
      `<script data-recipe-motion>tl.to({}, {});</script>`,
    );
    expect(parsed).toBeDefined();
    expect(parsed!.markup).toBe("<div>{{a}}</div>");
    expect(parsed!.motion).toBe("tl.to({}, {});");
    expect(parsed!.style).toBe(".x{}");
  });

  it("returns undefined when markup or motion is missing", () => {
    expect(parseRecipeFragment("<template data-recipe-markup>x</template>")).toBeUndefined();
  });
});

/* ------------------------------------------------- declarations + reconcile */

describe("normalizeStoryboardRecipeDeclarations", () => {
  it("accepts params as an array of {name,value} pairs (the schema form) and as a record", () => {
    const fromArray = normalizeStoryboardRecipeDeclarations([
      { version: 1, id: "test-recipe", params: [{ name: "copy", value: "Hi" }, { name: "speed", value: 2 }] },
    ]);
    expect(fromArray[0]!.params).toEqual({ copy: "Hi", speed: 2 });
    const fromRecord = normalizeStoryboardRecipeDeclarations([
      { version: 1, id: "test-recipe", params: { copy: "Hi" } },
    ]);
    expect(fromRecord[0]!.params).toEqual({ copy: "Hi" });
  });

  it("drops shapeless entries silently (parse-time tolerance)", () => {
    expect(normalizeStoryboardRecipeDeclarations([null, 4, { params: {} }])).toEqual([]);
  });
});

describe("reconcileRecipeDeclarations (the L2 governor)", () => {
  it("keeps a valid declaration, fills defaults, and clamps numbers", () => {
    const scenes = [scene({
      id: "stage", startSec: 0, durationSec: 6,
      recipes: [{ version: 1, id: "test-recipe", params: { copy: "Ship it", speed: 99 } }],
    })];
    const result = reconcileRecipeDeclarations(scenes, library());
    const kept = result.scenes[0]!.recipes!;
    expect(kept).toHaveLength(1);
    expect(kept[0]!.params).toEqual({
      copy: "Ship it",
      speed: 3, // clamped to max
      accent: "var(--cinema-key)", // default filled
    });
  });

  it("drops unknown and stale recipes with notes, never throwing", () => {
    const stale = definition({ stale: true, staleReasons: ["cutRuntime v1 -> v2"] });
    const scenes = [scene({
      id: "stage", startSec: 0, durationSec: 6,
      recipes: [
        { version: 1, id: "no-such-recipe", params: {} },
        { version: 1, id: "test-recipe", params: { copy: "x" } },
      ],
    })];
    const result = reconcileRecipeDeclarations(scenes, library([stale]));
    expect(result.scenes[0]!.recipes).toBeUndefined();
    expect(result.notes.join("\n")).toMatch(/not in the library/);
    expect(result.notes.join("\n")).toMatch(/stale/);
    expect(result.scenes[0]!.sentinelNormalizations?.length).toBeGreaterThan(0);
  });

  it("drops a declaration whose REQUIRED param has no usable value", () => {
    const scenes = [scene({
      id: "stage", startSec: 0, durationSec: 6,
      recipes: [{ version: 1, id: "test-recipe", params: { speed: 1 } }], // copy missing
    })];
    const result = reconcileRecipeDeclarations(scenes, library());
    expect(result.scenes[0]!.recipes).toBeUndefined();
    expect(result.notes.join("\n")).toMatch(/required param "copy"/);
  });

  it("rejects raw hexes for color-token params (brand safety) but accepts bare token names", () => {
    const scenes = [scene({
      id: "stage", startSec: 0, durationSec: 6,
      recipes: [{ version: 1, id: "test-recipe", params: { copy: "x", accent: "#ff0000" } }],
    })];
    const result = reconcileRecipeDeclarations(scenes, library());
    // Raw hex falls back to the default token.
    expect(result.scenes[0]!.recipes![0]!.params.accent).toBe("var(--cinema-key)");
    const bare = reconcileRecipeDeclarations([scene({
      id: "stage", startSec: 0, durationSec: 6,
      recipes: [{ version: 1, id: "test-recipe", params: { copy: "x", accent: "--brand-gold" } }],
    })], library());
    expect(bare.scenes[0]!.recipes![0]!.params.accent).toBe("var(--brand-gold)");
  });

  it("enforces the per-film budget across scenes, earliest first", () => {
    const declaration = { version: 1 as const, id: "test-recipe", params: { copy: "x" } };
    const scenes = [
      scene({ id: "a", startSec: 0, durationSec: 6, recipes: [declaration] }),
      scene({ id: "b", startSec: 6, durationSec: 6, recipes: [declaration] }),
      scene({ id: "c", startSec: 12, durationSec: 6, recipes: [declaration] }),
    ];
    const result = reconcileRecipeDeclarations(scenes, library());
    const kept = result.scenes.filter((entry) => entry.recipes?.length);
    expect(kept.map((entry) => entry.id)).toEqual(["a", "b"].slice(0, MAX_RECIPES_PER_FILM));
    expect(result.notes.join("\n")).toMatch(/budget/);
  });
});

/* --------------------------------------------------------- instantiation */

describe("resolveRecipePlan (param fill + escaping)", () => {
  const declared = (params: Record<string, string | number>) => [scene({
    id: "stage", startSec: 2.5, durationSec: 6,
    recipes: reconcileRecipeDeclarations(
      [scene({ id: "stage", startSec: 2.5, durationSec: 6, recipes: [{ version: 1, id: "test-recipe", params }] })],
      library(),
    ).scenes[0]!.recipes!,
  })];

  it("fills context slots and HTML-escapes markup params", () => {
    const [instance] = resolveRecipePlan(declared({ copy: `<b>"hi" & bye</b>` }), library());
    expect(instance!.uid).toBe("stage-test-recipe");
    expect(instance!.markup).toContain('data-part="stage-test-recipe-hero"');
    expect(instance!.markup).toContain("&lt;b&gt;&quot;hi&quot; &amp; bye&lt;/b&gt;");
    expect(instance!.markup).not.toContain("<b>");
  });

  it("JS-escapes motion params so quotes and closing tags cannot break the script", () => {
    const [instance] = resolveRecipePlan(declared({ copy: `say "go" </script>` }), library());
    expect(instance!.motion).toContain('var label = "say \\"go\\" <\\/script>";');
    expect(instance!.motion).toContain("duration: 1,"); // number default, unquoted
  });
});

/* ------------------------------------------------------------- injection */

describe("injectRecipeContract (the sixth host-owned island)", () => {
  const scenes = reconcileRecipeDeclarations([scene({
    id: "stage", startSec: 0, durationSec: 6,
    recipes: [{ version: 1, id: "test-recipe", params: { copy: "Ship it" } }],
  })], library()).scenes;

  it("injects wrapper, style, and motion, and validation passes", () => {
    const result = injectRecipeContract(SHELL, scenes, library());
    expect(result.injected).toEqual(["stage-test-recipe"]);
    expect(result.html).toContain('data-sequences-recipe="test-recipe"');
    expect(result.html).toContain('data-sequences-recipe-style="test-recipe"');
    expect(result.html).toContain('/*<seq-recipe uid="stage-test-recipe">*/');
    // Motion lands BEFORE the timeline registration so tweens join the paused master.
    expect(result.html.indexOf("<seq-recipe")).toBeLessThan(
      result.html.indexOf('window.__timelines["demo"]'),
    );
    const validation = validateRecipeContract(result.html, scenes, library());
    expect(validation.errors).toEqual([]);
  });

  it("is idempotent and reverts author tampering on re-injection (mechanism unreachable)", () => {
    const first = injectRecipeContract(SHELL, scenes, library());
    const tampered = first.html.replace("Ship it", "HACKED MECHANISM");
    const second = injectRecipeContract(tampered, scenes, library());
    expect(second.html).toContain("Ship it");
    expect(second.html).not.toContain("HACKED MECHANISM");
    // Strip+reinject converges: a third pass is byte-identical.
    const third = injectRecipeContract(second.html, scenes, library());
    expect(third.html).toBe(second.html);
  });

  it("targets a declared data-region station when present", () => {
    const regionScenes = reconcileRecipeDeclarations([scene({
      id: "stage", startSec: 0, durationSec: 6,
      recipes: [{ version: 1, id: "test-recipe", region: "hero-claim", params: { copy: "x" } }],
    })], library()).scenes;
    const result = injectRecipeContract(SHELL, regionScenes, library());
    const regionIndex = result.html.indexOf('data-region="hero-claim"');
    const wrapperIndex = result.html.indexOf('data-sequences-recipe="test-recipe"');
    expect(regionIndex).toBeGreaterThan(-1);
    expect(wrapperIndex).toBeGreaterThan(regionIndex);
    // Wrapper sits before the region's own content.
    expect(wrapperIndex).toBeLessThan(result.html.indexOf("<p>content</p>"));
  });

  it("removes stale injections when declarations disappear", () => {
    const injected = injectRecipeContract(SHELL, scenes, library()).html;
    const cleared = injectRecipeContract(injected, [scene({ id: "stage", startSec: 0, durationSec: 6 })], library());
    expect(cleared.html).not.toContain("data-sequences-recipe=");
    expect(cleared.html).not.toContain("<seq-recipe");
  });
});

describe("validateRecipeContract (host-plumbing self-check)", () => {
  const scenes = reconcileRecipeDeclarations([scene({
    id: "stage", startSec: 0, durationSec: 6,
    recipes: [{ version: 1, id: "test-recipe", params: { copy: "x" } }],
  })], library()).scenes;

  it("reports a missing island and missing motion", () => {
    const result = validateRecipeContract(SHELL, scenes, library());
    expect(result.errors.join("\n")).toMatch(/recipe_island_missing/);
    expect(result.errors.join("\n")).toMatch(/recipe_motion_missing/);
  });

  it("reports a declaration that has no library entry", () => {
    const orphan = [scene({
      id: "stage", startSec: 0, durationSec: 6,
      recipes: [{ version: 1, id: "ghost", params: {} }],
    })];
    const result = validateRecipeContract(SHELL, orphan, library());
    expect(result.errors.join("\n")).toMatch(/recipe_unknown/);
  });
});

describe("stripRecipeMarkup", () => {
  it("removes nested-div wrappers without eating surrounding content", () => {
    const html = `<p>before</p><div class="seq-recipe" data-sequences-recipe="x" data-recipe-uid="u">` +
      `<div><div>deep</div></div></div><p>after</p>`;
    expect(stripRecipeMarkup(html)).toBe("<p>before</p><p>after</p>");
  });
});

/* ----------------------------------------------- the shipped golden library */

describe("the shipped library (skills/sequences-recipes)", () => {
  it("loads cleanly with the golden last-word-roulette recipe, not stale", () => {
    const shipped = loadRecipeLibrary({ refresh: true });
    expect(shipped.warnings).toEqual([]);
    const golden = shipped.recipes.get("last-word-roulette");
    expect(golden).toBeDefined();
    expect(golden!.stale).toBe(false);
    expect(golden!.fragmentMotion).toContain("settleSec");
    expect(validateRecipeManifest(golden!.manifest)).toEqual([]);
  });

  it("scores roulette-flavored briefs and stays silent on unrelated ones", () => {
    const golden = loadRecipeLibrary().recipes.get("last-word-roulette")!;
    const hit = recipeRetrievalScore(
      golden.manifest,
      "Hook where the headline cycles through words like a slot machine and lands on 'shipped'",
    );
    const miss = recipeRetrievalScore(
      golden.manifest,
      "A calm dashboard walkthrough with a table filter and CSV export",
    );
    expect(hit).toBeGreaterThan(0);
    expect(miss).toBe(0);
  });

  it("surfaces through live retrieval with the declare-by-default instruction", () => {
    const skills = retrieveHyperframesSkillContext(
      "create",
      "Launch film hook: the hero copy spins through options like a roulette before the final word locks.",
    );
    expect(skills.recipeIds).toContain("last-word-roulette");
    expect(skills.text).toContain("Proven recipes (host-instantiated");
    expect(skills.text).toContain('"recipes":[');
    expect(skills.recipesVersion).not.toBe("off");
  });

  it("still exposes the library index when nothing matches (opt-in stays possible)", () => {
    const skills = retrieveHyperframesSkillContext(
      "create",
      "A quiet product tour of the settings page with three toggles.",
    );
    expect(skills.recipeIds).toEqual([]);
    expect(skills.text).toContain("Recipe library index");
  });
});
