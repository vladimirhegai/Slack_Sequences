import { describe, expect, it } from "vitest";
import {
  assembleSlotComposition,
  attributeFindingsToScenes,
  extractSceneSlots,
} from "../src/engine/sceneSlots.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";

function scene(id: string, startSec: number, durationSec = 4): DirectScene {
  return { id, title: id, purpose: `show ${id}`, startSec, durationSec };
}

const TWO_SCENE_RESPONSE = [
  "<film_style>",
  ".stage{background:#0b0d12;color:#fff}.hero{font-size:96px}",
  "</film_style>",
  '<scene_html id="hero-open">',
  '<div class="hero" data-part="headline">Ship faster</div>',
  "</scene_html>",
  '<scene_script id="hero-open">',
  'tl.set("[data-scene=\\"hero-open\\"]", { opacity: 1 }, 0);',
  'tl.from("[data-part=\\"headline\\"]", { y: 40, opacity: 0, duration: 0.6 }, 0.2);',
  "</scene_script>",
  '<scene_html id="cta-close">',
  '<div class="hero" data-part="cta">Try it</div>',
  "</scene_html>",
  '<scene_script id="cta-close">',
  'tl.set("[data-scene=\\"cta-close\\"]", { opacity: 1 }, 4);',
  "</scene_script>",
].join("\n");

describe("extractSceneSlots", () => {
  it("parses the film style and per-scene html/script slots by id", () => {
    const parsed = extractSceneSlots(TWO_SCENE_RESPONSE);
    expect(parsed.truncated).toBe(false);
    expect(parsed.order).toEqual(["hero-open", "cta-close"]);
    expect(parsed.filmStyle).toContain(".hero{font-size:96px}");
    expect(parsed.scenes.get("hero-open")?.html).toContain('data-part="headline"');
    expect(parsed.scenes.get("hero-open")?.script).toContain("tl.from");
    expect(parsed.scenes.get("cta-close")?.html).toContain('data-part="cta"');
  });

  it("keeps completed slots and flags truncation when a slot never closes", () => {
    const truncated = [
      '<scene_html id="hero-open"><h1>Done</h1></scene_html>',
      '<scene_html id="cta-close"><p>cut off mid-scene…',
    ].join("\n");
    const parsed = extractSceneSlots(truncated);
    expect(parsed.truncated).toBe(true);
    expect(parsed.scenes.get("hero-open")?.html).toBe("<h1>Done</h1>");
    expect(parsed.scenes.has("cta-close")).toBe(false);
  });

  it("strips code fences from slot bodies", () => {
    const fenced = '<scene_html id="s">```html\n<div>ok</div>\n```</scene_html>';
    expect(extractSceneSlots(fenced).scenes.get("s")?.html).toBe("<div>ok</div>");
  });
});

describe("assembleSlotComposition", () => {
  const storyboard = [scene("hero-open", 0), scene("cta-close", 4)];

  it("assembles a canonical document with host-owned wrappers and timeline", () => {
    const slots = extractSceneSlots(TWO_SCENE_RESPONSE);
    const { html, missingHtml, missingScript } = assembleSlotComposition({
      storyboard,
      slots,
      compositionId: "demo-slots",
    });
    expect(missingHtml).toEqual([]);
    expect(missingScript).toEqual([]);
    // Host owns the section wrappers with exact ids/timing.
    expect(html).toContain(
      '<section id="hero-open" class="scene clip" data-scene="hero-open" data-start="0" data-duration="4" data-track-index="1">',
    );
    expect(html).toContain('data-scene="cta-close" data-start="4" data-duration="4"');
    // Shared style, single paused timeline, host-owned registration.
    expect(html).toContain(".hero{font-size:96px}");
    expect(html).toContain("const tl = gsap.timeline({ paused: true });");
    expect(html).toContain('window.__timelines["demo-slots"] = tl;');
    // Each scene's statements run in their own function scope.
    expect(html).toMatch(/\(function \(tl\) \{[\s\S]*tl\.from[\s\S]*\}\)\(tl\);/);
    // Composition root carries the required attributes.
    expect(html).toMatch(/data-composition-id="demo-slots"[^>]*data-duration="8"/);
    // The author never authors the chassis tags itself.
    expect(html.match(/<section/g)?.length).toBe(2);
  });

  it("emits the host-owned stage floor and scene-window visibility (the sentinel-final-denseui fix)", () => {
    // A film style with NO structural rules — exactly what the failed live
    // probe's model returned. The host stage must position and reveal the
    // scenes regardless.
    const slots = extractSceneSlots(
      [
        "<film_style>.hero{font-size:96px;color:#fff}</film_style>",
        '<scene_html id="hero-open"><div class="hero">Ship</div></scene_html>',
        '<scene_script id="hero-open">tl.from(".hero", { y: 30, opacity: 0, duration: 0.5 }, 0.2);</scene_script>',
        '<scene_html id="cta-close"><div class="hero">Go</div></scene_html>',
        '<scene_script id="cta-close">tl.from(".hero", { scale: 0.9, duration: 0.5 }, 4.2);</scene_script>',
      ].join("\n"),
    );
    const { html } = assembleSlotComposition({ storyboard, slots, compositionId: "demo-slots" });
    // Stage floor: root sizing + absolute scene stacking + hidden baseline,
    // injected BEFORE the model's film style so the model may extend it but
    // positioning never depends on it.
    expect(html).toContain('<style id="sequences-slot-stage">');
    expect(html).toContain("#root{position:relative;width:1920px;height:1080px;overflow:hidden}");
    expect(html).toContain(".scene{position:absolute;inset:0;opacity:0}");
    expect(html.indexOf("sequences-slot-stage")).toBeLessThan(html.indexOf(".hero{font-size:96px"));
    // Host-owned visibility: reveal at data-start, clear at window end, for
    // every scene — emitted AFTER the authored scene blocks so host sets win
    // insertion-order ties at the window edges.
    expect(html).toContain('tl.set("[data-scene=\\"hero-open\\"]", { opacity: 1 }, 0);');
    expect(html).toContain('tl.set("[data-scene=\\"hero-open\\"]", { opacity: 0 }, 4);');
    expect(html).toContain('tl.set("[data-scene=\\"cta-close\\"]", { opacity: 1 }, 4);');
    expect(html).toContain('tl.set("[data-scene=\\"cta-close\\"]", { opacity: 0 }, 8);');
    expect(html.lastIndexOf("(function (tl)")).toBeLessThan(
      html.indexOf('tl.set("[data-scene=\\"hero-open\\"]"'),
    );
  });

  it("is byte-stable for fixed inputs (deterministic assembly)", () => {
    const slots = extractSceneSlots(TWO_SCENE_RESPONSE);
    const a = assembleSlotComposition({ storyboard, slots, compositionId: "demo-slots" });
    const b = assembleSlotComposition({ storyboard, slots, compositionId: "demo-slots" });
    expect(a.html).toBe(b.html);
  });

  it("reports scenes whose interior or script is missing", () => {
    const slots = extractSceneSlots('<scene_html id="hero-open"><h1>only</h1></scene_html>');
    const result = assembleSlotComposition({ storyboard, slots, compositionId: "demo-slots" });
    expect(result.missingHtml).toEqual(["cta-close"]);
    expect(result.missingScript).toEqual(["hero-open", "cta-close"]);
    // Present scenes still assemble; missing ones leave an empty (host) shell.
    expect(result.html).toContain("<h1>only</h1>");
    expect(result.html).toContain('data-scene="cta-close"');
  });
});

describe("attributeFindingsToScenes", () => {
  it("maps findings to the scene(s) they name, arrows to both sides", () => {
    const byScene = attributeFindingsToScenes(
      [
        'scene "risk-score" camera targets region "risk-ring" but no such region exists',
        "cut hero-open->cta-close incoming part is missing",
        "the film has no high-energy peak",
      ],
      ["hero-open", "cta-close", "risk-score", "risk"],
    );
    expect(byScene.get("risk-score")).toHaveLength(1);
    expect(byScene.get("hero-open")).toHaveLength(1);
    expect(byScene.get("cta-close")).toHaveLength(1);
    // A shorter id never matches inside a longer one.
    expect(byScene.has("risk")).toBe(false);
    // A film-level finding lands under the shared bucket.
    expect(byScene.get("__film__")).toHaveLength(1);
  });

  it("attributes colon-delimited finding signatures (the live failure-receipt shape)", () => {
    const byScene = attributeFindingsToScenes(
      [
        'component_root_missing:palette-ship:cmd-palette',
        "kit_markup_incomplete:stat-resolve",
        "cut_missing_incoming_part:dashboard-overwhelm->palette-ship:palette-input",
      ],
      ["palette-ship", "stat-resolve", "dashboard-overwhelm"],
    );
    expect(byScene.get("palette-ship")).toHaveLength(2);
    expect(byScene.get("stat-resolve")).toHaveLength(1);
    expect(byScene.get("dashboard-overwhelm")).toHaveLength(1);
    expect(byScene.has("__film__")).toBe(false);
  });
});
