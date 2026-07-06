import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assembleSlotComposition,
  attributeFindingsToScenes,
  extractSceneSlots,
} from "../src/engine/sceneSlots.ts";
import {
  authorSlotDraft,
  slotScaffoldViolations,
} from "../src/engine/compositionRunner.ts";
import type { AgentProvider } from "@sequences/platform/providers";
import type { RetrievedSkillContext } from "../src/agent/skillContext.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";

function scene(id: string, startSec: number, durationSec = 4): DirectScene {
  return { id, title: id, purpose: `show ${id}`, startSec, durationSec };
}

const SKILLS: RetrievedSkillContext = {
  skillNames: [],
  blueprintIds: [],
  ruleIds: [],
  capabilityIds: [],
  registryVersion: "test",
  text: "",
};

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

describe("slotScaffoldViolations — only states the L2 reconcilers cannot fix", () => {
  const componentScene = (): DirectScene => ({
    ...scene("hero-open", 0),
    components: [{ version: 1, id: "deploy-btn", kind: "button", role: "hero" }],
  });

  it("flags a declared component with NO trace at all (root and kind both absent)", () => {
    const slots = extractSceneSlots(
      '<scene_html id="hero-open"><div class="hero">no component here</div></scene_html>' +
        '<scene_script id="hero-open">tl.set("[data-scene=\\"hero-open\\"]", {}, 0);</scene_script>',
    );
    const violations = slotScaffoldViolations([componentScene()], slots);
    expect(violations.get("hero-open")?.[0]).toContain('data-part="deploy-btn"');
  });

  it("leaves a kind-marked near-miss to the free L2 reconciler", () => {
    const slots = extractSceneSlots(
      '<scene_html id="hero-open"><div class="cmp cmp-button" data-component="button" data-part="wrong-name">Deploy</div></scene_html>',
    );
    expect(slotScaffoldViolations([componentScene()], slots).size).toBe(0);
  });

  it("flags a camera station only when the scene has FEWER stations than required", () => {
    const cameraScene: DirectScene = {
      ...scene("tour", 0, 8),
      camera: {
        version: 1,
        path: [
          { version: 1, move: "hold", toRegion: "hero-claim", startSec: 0, durationSec: 2 },
          { version: 1, move: "pan", toRegion: "metric-wall", startSec: 2, durationSec: 2 },
        ],
      },
    };
    const missingOne = extractSceneSlots(
      '<scene_html id="tour"><div data-camera-world style="width:3840px;height:1080px">' +
        '<div data-region="hero-claim">claim</div></div></scene_html>',
    );
    const violations = slotScaffoldViolations([cameraScene], missingOne);
    expect(violations.get("tour")?.some((note) => note.includes('data-region="metric-wall"'))).toBe(
      true,
    );
    // Same station COUNT under different names is the reconciler's near-miss.
    const renamed = extractSceneSlots(
      '<scene_html id="tour"><div data-camera-world style="width:3840px;height:1080px">' +
        '<div data-region="hero_claim">claim</div><div data-region="metrics">stats</div></div></scene_html>',
    );
    expect(slotScaffoldViolations([cameraScene], renamed).size).toBe(0);
  });

  it("never flags a scene whose interior is wholly missing (that is the truncation path)", () => {
    const slots = extractSceneSlots("<film_style>.x{}</film_style>");
    expect(slotScaffoldViolations([componentScene()], slots).size).toBe(0);
  });
});

describe("authorSlotDraft — script-aware continuation + scene-scoped scaffold repair", () => {
  const roots: string[] = [];
  beforeEach(() => {
    vi.stubEnv("SLACK_SEQUENCES_HEDGED_REQUESTS", "0");
  });
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });
  const tempDir = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slot-draft-"));
    roots.push(dir);
    return dir;
  };
  const providerOf = (responses: string[]): { provider: AgentProvider; complete: ReturnType<typeof vi.fn> } => {
    const complete = vi.fn();
    for (const value of responses) complete.mockResolvedValueOnce(value);
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    return { provider, complete };
  };
  const storyboard = (): DirectScene[] => [scene("hero-open", 0), scene("cta-close", 4)];
  const argsOf = (sb: DirectScene[]) => ({
    brief: "Launch Relay",
    projectDir: tempDir(),
    skills: SKILLS,
    lockedStoryboard: sb,
  });
  const htmlSlot = (id: string, body: string): string =>
    `<scene_html id="${id}">${body}</scene_html>`;
  const scriptSlot = (id: string, body: string): string =>
    `<scene_script id="${id}">${body}</scene_script>`;

  it("re-requests a scene whose <scene_script> is missing (previously assembled silently static)", async () => {
    const sb = storyboard();
    const first = [
      "<film_style>.hero{color:#fff}</film_style>",
      htmlSlot("hero-open", '<div class="hero">Ship</div>'),
      scriptSlot("hero-open", 'tl.from(".hero", { opacity: 0, duration: 0.4 }, 0.2);'),
      htmlSlot("cta-close", '<div class="hero">Go</div>'),
      // No cta-close script: before the fix this assembled into a scene that
      // never moved and nothing re-requested it.
    ].join("\n");
    const second = [
      htmlSlot("cta-close", '<div class="hero">Go</div>'),
      scriptSlot("cta-close", 'tl.from(".hero", { scale: 0.9, duration: 0.4 }, 4.2);'),
    ].join("\n");
    const { provider, complete } = providerOf([first, second]);

    const result = await authorSlotDraft(provider, argsOf(sb), "PROMPT", {});

    expect(complete).toHaveBeenCalledTimes(2);
    const continuation = complete.mock.calls[1]![0] as string;
    expect(continuation).toContain('id="cta-close"');
    expect(continuation).not.toContain('<scene_html id="hero-open">');
    expect(result.draft.html).toContain("scale: 0.9");
  });

  it("throws when a script is still missing after the continuation round", async () => {
    const sb = storyboard();
    const first = [
      htmlSlot("hero-open", "<h1>a</h1>"),
      scriptSlot("hero-open", "tl.set('#x', {}, 0);"),
      htmlSlot("cta-close", "<h1>b</h1>"),
    ].join("\n");
    const { provider } = providerOf([first, "no slots here", "still nothing"]);
    await expect(authorSlotDraft(provider, argsOf(sb), "PROMPT", {})).rejects.toThrow(
      /missing <scene_script>/,
    );
  });

  it("scene-scoped scaffold repair: a dropped component root re-requests ONLY that scene with findings and the previous interior", async () => {
    const sb: DirectScene[] = [
      {
        ...scene("hero-open", 0),
        components: [{ version: 1, id: "deploy-btn", kind: "button", role: "hero" }],
      },
      scene("cta-close", 4),
    ];
    const first = [
      "<film_style>.hero{color:#fff}</film_style>",
      // The hero scene came back with NO trace of the declared button.
      htmlSlot("hero-open", '<div class="hero">Ship faster</div>'),
      scriptSlot("hero-open", 'tl.from(".hero", { opacity: 0, duration: 0.4 }, 0.2);'),
      htmlSlot("cta-close", '<div class="hero">Go</div>'),
      scriptSlot("cta-close", 'tl.from(".hero", { scale: 0.9, duration: 0.4 }, 4.2);'),
    ].join("\n");
    const repaired = [
      htmlSlot(
        "hero-open",
        '<div class="hero">Ship faster</div>' +
          '<button class="cmp cmp-button" data-component="button" data-part="deploy-btn">Deploy</button>',
      ),
      scriptSlot("hero-open", 'tl.from(".hero", { opacity: 0, duration: 0.4 }, 0.2);'),
    ].join("\n");
    const { provider, complete } = providerOf([first, repaired]);

    const result = await authorSlotDraft(provider, argsOf(sb), "PROMPT", {});

    expect(complete).toHaveBeenCalledTimes(2);
    const repairPrompt = complete.mock.calls[1]![0] as string;
    expect(repairPrompt).toContain("Host-contract findings");
    expect(repairPrompt).toContain('data-part="deploy-btn"');
    // Minimal-edit baseline: the model's own defective interior rides along.
    expect(repairPrompt).toContain('<previous_scene_html id="hero-open">');
    expect(repairPrompt).not.toContain('<scene_html id="cta-close">');
    expect(result.draft.html).toContain('data-part="deploy-btn"');
  });

  it("a clean slot response costs exactly one call (no repair round fires)", async () => {
    const sb = storyboard();
    const clean = [
      "<film_style>.hero{color:#fff}</film_style>",
      htmlSlot("hero-open", "<h1>a</h1>"),
      scriptSlot("hero-open", "tl.set('#a', {}, 0);"),
      htmlSlot("cta-close", "<h1>b</h1>"),
      scriptSlot("cta-close", "tl.set('#b', {}, 4);"),
    ].join("\n");
    const { provider, complete } = providerOf([clean]);
    await authorSlotDraft(provider, argsOf(sb), "PROMPT", {});
    expect(complete).toHaveBeenCalledTimes(1);
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
