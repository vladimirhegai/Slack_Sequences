import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProviderOutputTruncatedError,
  type AgentProvider,
} from "@sequences/platform/providers";
import {
  applyCompositionRepair,
  inferStoryboardPlanRequirements,
  normalizeWorldLayout,
  parseCompositionResponse,
  parseStoryboardResponse,
  quarantineFailedInteractions,
  reconcileInteractionTargets,
  requestDirectComposition,
  requestStoryboardPlan,
} from "../src/engine/compositionRunner.ts";
import {
  commitDirectComposition,
  hasDirectComposition,
  isFloatingPointClipOverlap,
  loadDirectComposition,
  undoDirectComposition,
  validateDirectComposition,
  type DirectCompositionDraft,
} from "../src/engine/directComposition.ts";
import { inspectDirectComposition } from "../src/engine/layoutInspector.ts";
import { initializeProject } from "../src/engine/projectTemplates.ts";
import { buildJobFrame } from "../src/engine/frameDesign.ts";
import { injectCinemaKit } from "../src/engine/cinemaKit.ts";
import { injectCameraRuntimeTag } from "../src/engine/cameraContract.ts";
import { injectComponentKit } from "../src/engine/componentContract.ts";
import { buildFallbackComposition } from "../src/engine/fallbackComposition.ts";

/** Every published draft carries the host-injected runtimes and kits. */
function withHostInjections(html: string): string {
  return injectCinemaKit(injectComponentKit(injectCameraRuntimeTag(html)));
}

vi.mock("../src/engine/layoutInspector.ts", () => ({
  inspectDirectComposition: vi.fn(async () => ({
    ok: true,
    strictOk: true,
    samples: [0, 2, 4, 6, 8],
    issues: [],
    errors: [],
    warnings: [],
  })),
}));

const roots: string[] = [];

beforeEach(() => {
  // The small-agent shape hint rides in parallel with the concept pass and
  // would shift these call-count-sensitive specs; it has its own test file.
  vi.stubEnv("SLACK_SEQUENCES_SHAPE_HINT", "0");
});

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("floating-point clip-overlap filter", () => {
  const finding = (message: string) => ({
    code: "overlapping_clips_same_track",
    severity: "error" as const,
    message,
  });

  it("drops the IEEE-754 phantom overlap that burned the 2026-07-03 live create", () => {
    expect(isFloatingPointClipOverlap(finding(
      "Track 1: clip ending at 11.600000000000001s overlaps with clip starting at 11.6s. " +
        "Overlapping clips on the same track cause rendering conflicts.",
    ))).toBe(true);
  });

  it("keeps genuine overlaps and unrelated findings", () => {
    expect(isFloatingPointClipOverlap(finding(
      "Track 1: clip ending at 12.4s overlaps with clip starting at 11.6s. " +
        "Overlapping clips on the same track cause rendering conflicts.",
    ))).toBe(false);
    expect(isFloatingPointClipOverlap({
      code: "timed_element_missing_clip_class",
      severity: "error" as const,
      message: "clip ending at 11.600000000000001s overlaps with clip starting at 11.6s",
    })).toBe(false);
  });
});

describe("world-layout station map normalization", () => {
  it("keeps valid stations and drops junk entry-by-entry", () => {
    expect(normalizeWorldLayout([
      { region: "hero-claim", cell: [0, 0] },
      { region: "metric-wall", cell: [1, 0] },
      { region: "Bad Region", cell: [0, 1] }, // not kebab-case
      { region: "too-far", cell: [3, 0] }, // out of range
      { region: "fractional", cell: [0.5, 0] }, // not an integer
      { region: "metric-wall", cell: [0, -1] }, // duplicate region
      { region: "same-cell", cell: [1, 0] }, // duplicate cell
      "junk",
    ], true)).toEqual([
      { region: "hero-claim", cell: [0, 0] },
      { region: "metric-wall", cell: [1, 0] },
    ]);
  });

  it("drops the map entirely without a camera path or when malformed", () => {
    expect(normalizeWorldLayout([{ region: "hero", cell: [0, 0] }], false)).toEqual([]);
    expect(normalizeWorldLayout({ region: "hero" }, true)).toEqual([]);
    expect(normalizeWorldLayout(undefined, true)).toEqual([]);
  });
});

describe("deterministic interaction target reconciliation", () => {
  const interaction = {
    version: 1 as const,
    id: "click-signal",
    sceneId: "one",
    cursorId: "pointer",
    targetPart: "active-signal-node",
    action: "click" as const,
    startSec: 1,
    arriveSec: 2,
    from: "frame:bottom-right" as const,
    path: "human" as const,
    aimX: 0.5,
    aimY: 0.5,
    feedback: "none" as const,
  };

  it("binds a missing semantic target to the one exact element id", () => {
    const source =
      '<section data-scene="one"><div data-part="signal-node"></div>' +
      '<div id="active-signal-node" data-part="signal-node"></div>' +
      '<div data-part="signal-node"></div></section>';
    const result = reconcileInteractionTargets(source, [interaction]);
    expect(result.repairs).toBe(1);
    expect(result.html).toContain(
      'id="active-signal-node" data-part="active-signal-node"',
    );
  });

  it("keeps genuinely ambiguous semantic candidates untouched", () => {
    const source =
      '<section data-scene="one"><div data-part="signal-node-left"></div>' +
      '<div data-part="signal-node-right"></div></section>';
    const result = reconcileInteractionTargets(source, [interaction]);
    expect(result).toEqual({ html: source, repairs: 0 });
  });

  it("never borrows a plausible target from a different scene", () => {
    const source =
      '<section data-scene="one"><div data-part="other"></div></section>' +
      '<section data-scene="two"><div id="active-signal-node" data-part="signal-node"></div></section>';
    const result = reconcileInteractionTargets(source, [interaction]);
    expect(result).toEqual({ html: source, repairs: 0 });
  });

  it("makes an exact id the unique target when the authored part was duplicated", () => {
    const source =
      '<section data-scene="one"><div data-part="active-signal-node"></div>' +
      '<div id="active-signal-node" data-part="active-signal-node"></div></section>';
    const result = reconcileInteractionTargets(source, [interaction]);
    expect(result.repairs).toBe(1);
    expect(result.html).toContain('data-part="active-signal-node-aux-1"');
    expect(result.html.match(/data-part="active-signal-node"/g)).toHaveLength(1);
  });
});

function projectDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-direct-test-"));
  roots.push(dir);
  initializeProject(dir, { name: "Relay", brandName: "Relay", seedScreenshot: true });
  return dir;
}

describe("deterministic direct fallback", () => {
  it("builds a statically valid flow-first composition from untrusted brief text", async () => {
    const dir = projectDir();
    const fallback = buildFallbackComposition({
      product: 'RADAR <script>alert("x")</script>',
      whatShipped: "One operational view & faster decisions",
      audience: "product teams",
      lengthSec: 20,
    });
    const validation = await validateDirectComposition(dir, fallback);
    expect(validation.errors).toEqual([]);
    expect(fallback.html).toContain("layout-editorial-left");
    expect(fallback.html).toContain("data-camera-world");
    expect(fallback.html).toContain("layout-center-stack");
    expect(fallback.html).not.toContain("<script>alert");
  });
});

function draft(accent = "#8b5cf6"): DirectCompositionDraft {
  return {
    storyboard: [
      {
        id: "hook",
        title: "The trace arrives",
        purpose: "Open on the release",
        startSec: 0,
        durationSec: 4,
        blueprint: "kinetic-type-beats",
        rules: ["kinetic-beat-slam"],
        outgoingCut: "The violet rail continues",
      },
      {
        id: "payoff",
        title: "One-click rollback",
        purpose: "Land the product payoff",
        startSec: 4,
        durationSec: 4,
        blueprint: "cta-morph-press",
        rules: ["physics-press-reaction"],
        outgoingCut: "Hold on the CTA",
      },
    ],
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=1920, height=1080">
  <script src="gsap.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #08090d; }
    #root { --space-safe: 72px; position: relative; width: 1920px; height: 1080px; overflow: hidden; color: #f8fafc; font-family: Inter, Arial, sans-serif; }
    .scene { position: absolute; inset: 0; display: grid; place-items: center; opacity: 0; }
    .panel { width: 1320px; padding: 96px; border: 1px solid ${accent}; border-radius: 40px; background: #10131d; }
    h1 { margin: 0; font-size: 124px; line-height: .95; }
    p { margin: 28px 0 0; font-size: 42px; color: ${accent}; }
  </style>
</head>
<body>
  <main id="root" data-composition-id="relay-launch" data-width="1920" data-height="1080" data-duration="8">
    <section id="hook" class="scene clip" data-scene="hook" data-start="0" data-duration="4" data-track-index="1">
      <div class="panel" data-layout-important data-layout-anchor="frame:center"><h1 id="hook-title">Trace the impossible.</h1><p>Relay v2</p></div>
    </section>
    <section id="payoff" class="scene clip" data-scene="payoff" data-start="4" data-duration="4" data-track-index="1">
      <div class="panel" data-layout-important data-layout-anchor="frame:center"><h1 id="payoff-title">Rollback in one click.</h1><p>Ship with nerve.</p></div>
    </section>
  </main>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.set("#hook", { opacity: 1 }, 0);
    tl.set("#hook", { opacity: 0 }, 3.99);
    tl.set("#payoff", { opacity: 1 }, 4);
    tl.set("#payoff", { opacity: 0 }, 8);
    tl.fromTo("#hook-title", { y: 90, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: "power3.out" }, 0.2);
    tl.fromTo("#payoff-title", { scale: 0.82, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.7, ease: "back.out(1.6)" }, 4.2);
    window.__timelines["relay-launch"] = tl;
  </script>
</body>
</html>`,
  };
}

function response(value: DirectCompositionDraft): string {
  return `<storyboard_json>${JSON.stringify(value.storyboard)}</storyboard_json>
<index_html>${value.html}</index_html>`;
}

function patchResponse(search: string, replace: string): string {
  return `<patches_json>${JSON.stringify([{ search, replace }])}</patches_json>`;
}

function skills() {
  return {
    skillNames: [],
    blueprintIds: [],
    ruleIds: [],
    capabilityIds: [],
    registryVersion: "test",
    text: "",
  };
}

function storyboard(): DirectCompositionDraft["storyboard"] {
  return [
    {
      id: "problem-signal",
      title: "Signal",
      purpose: "Expose the launch problem",
      incomingIdea: "A noisy trace arrives",
      foreground: "Diagonal trace rail and split headline",
      background: "Dark grid with violet atmosphere",
      cameraIntent: "Locked wide frame with a short lateral push",
      continuityAnchor: "The violet trace exits frame right",
      outgoingCut: "Match the trace into the product rail",
      startSec: 0,
      durationSec: 3,
      blueprint: "kinetic-type-beats",
      capabilityIds: ["grain-overlay"],
    },
    {
      id: "product-proof",
      title: "Proof",
      purpose: "Show the product resolving the trace",
      incomingIdea: "The trace becomes a product route",
      foreground: "Product window with highlighted rollback path",
      background: "Offset technical grid and metadata",
      cameraIntent: "Push through the product window toward the action",
      continuityAnchor: "The action button becomes the final lockup chip",
      outgoingCut: "Scale-match the action into the brand close",
      startSec: 3,
      durationSec: 3,
      blueprint: "cursor-ui-demo",
      capabilityIds: ["ui-3d-reveal"],
    },
    {
      id: "brand-close",
      title: "Close",
      purpose: "Resolve on the launch promise",
      incomingIdea: "The action becomes the brand promise",
      foreground: "Asymmetric logo lockup and CTA rail",
      background: "Quiet violet field with registration marks",
      cameraIntent: "Settle from a close crop into a held wide lockup",
      continuityAnchor: "The CTA rail holds for the end frame",
      outgoingCut: "End on a clean held frame",
      startSec: 6,
      durationSec: 3,
      blueprint: "logo-assemble-lockup",
      capabilityIds: ["logo-outro"],
    },
  ];
}

describe("direct HyperFrames composition", () => {
  it("parses the bounded author response contract", () => {
    const value = draft();
    expect(parseCompositionResponse(response(value))).toEqual(value);
  });

  it("accepts timeline registration through a statically bound composition id", async () => {
    const dir = projectDir();
    const value = draft();
    value.html = value.html.replace(
      'window.__timelines["relay-launch"] = tl;',
      'const compId = "relay-launch"; window.__timelines[compId] = tl;',
    );
    const validation = await validateDirectComposition(dir, value);
    expect(validation.errors).toEqual([]);
  });

  it("normalizes model-authored display/visibility tweens before static validation", async () => {
    const dir = projectDir();
    const value = draft();
    value.html = value.html
      .replace(
        'tl.set("#hook", { opacity: 1 }, 0);',
        'tl.set("#hook", { display: "grid", visibility: "visible" }, 0);',
      )
      .replace(
        'tl.set("#hook", { opacity: 0 }, 3.99);',
        'tl.set("#hook", { display: "none" }, 3.99);',
      )
      .replace(
        'tl.fromTo("#payoff-title", { scale: 0.82, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.7, ease: "back.out(1.6)" }, 4.2);',
        'tl.fromTo("#payoff-title", { scale: 0.82, visibility: "hidden" }, { scale: 1, visibility: "visible", duration: 0.7, ease: "back.out(1.6)" }, 4.2);',
      );
    const complete = vi.fn().mockResolvedValue(response(value));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };

    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: value.storyboard,
    });

    expect(result.attempts).toBe(1);
    expect(result.draft.html).toContain('tl.set("#hook", { opacity: 1 }, 0);');
    expect(result.draft.html).toContain('tl.set("#hook", { opacity: 0 }, 3.99);');
    expect(result.draft.html).toContain(
      'tl.fromTo("#payoff-title", { opacity: 0, scale: 0.82 }, { opacity: 1, scale: 1, duration: 0.7, ease: "back.out(1.6)" }, 4.2);',
    );
    expect(result.draft.html).not.toMatch(
      /(?:\.(?:to|from|fromTo|set)|gsap\.(?:to|from|fromTo|set))\s*\([^;]{0,1000}\b(?:display|visibility)\s*:/is,
    );
  });

  it("deduplicates declared component data-part bindings before validation", async () => {
    const dir = projectDir();
    const value = draft();
    value.storyboard[1]!.components = [{
      version: 1,
      id: "error-chart-card",
      kind: "chart-line",
      region: "chart-zone",
      role: "hero",
    }];
    value.storyboard[1]!.beats = [{
      version: 1,
      id: "error-chart-draw",
      sceneId: "payoff",
      component: "error-chart-card",
      kind: "chart",
      atSec: 4.5,
      durationSec: 1,
    }];
    value.html = value.html.replace(
      '<div class="panel" data-layout-important data-layout-anchor="frame:center"><h1 id="payoff-title">Rollback in one click.</h1><p>Ship with nerve.</p></div>',
      '<div class="panel cmp cmp-chart-line" data-component="chart-line" data-part="error-chart-card" data-layout-important data-layout-anchor="frame:center">' +
        '<svg><path data-part="error-chart-card"></path><circle data-part="error-chart-card"></circle></svg>' +
        '<h1 id="payoff-title">Rollback in one click.</h1><p>Ship with nerve.</p></div>',
    );
    const complete = vi.fn().mockResolvedValue(response(value));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };

    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: value.storyboard,
    });

    const scene = result.draft.html.match(
      /<section[^>]*data-scene="payoff"[\s\S]*?<\/section>/,
    )?.[0] ?? "";
    expect(scene.match(/data-part="error-chart-card"/g)).toHaveLength(1);
    expect(scene).toContain('data-part="error-chart-card-aux-1"');
    expect(scene).toContain('data-part="error-chart-card-aux-2"');
    expect(scene).toContain('data-region="chart-zone"');
    expect(result.attempts).toBe(1);
  });

  it("reports a truncated response as a token-limit problem, not a missing tag", () => {
    const value = draft();
    // The model opened the first tag but ran out of output budget before closing it.
    const truncated = `<storyboard_json>${JSON.stringify(value.storyboard)}`;
    expect(() => parseCompositionResponse(truncated)).toThrow(/truncated/i);
    expect(() => parseCompositionResponse(truncated)).toThrow(/token limit/i);
  });

  it("still reports a genuinely absent tag as missing", () => {
    expect(() => parseCompositionResponse("no tags here at all")).toThrow(/missing <storyboard_json>/);
  });

  it("recovers a bare HTML document when the index_html wrapper is dropped", () => {
    const value = draft();
    // After compact repairs the author often returns the document with no wrapper.
    const raw = `<storyboard_json>${JSON.stringify(value.storyboard)}</storyboard_json>\n${value.html}`;
    expect(parseCompositionResponse(raw)).toEqual(value);
  });

  it("recovers a ```html-fenced bare HTML document", () => {
    const value = draft();
    const raw =
      `<storyboard_json>${JSON.stringify(value.storyboard)}</storyboard_json>\n` +
      "```html\n" + value.html + "\n```";
    expect(parseCompositionResponse(raw).html).toBe(value.html);
  });

  it("reports an unclosed index_html wrapper as truncation, not bare recovery", () => {
    const value = draft();
    const raw =
      `<storyboard_json>${JSON.stringify(value.storyboard)}</storyboard_json>\n` +
      `<index_html>${value.html.slice(0, 200)}`;
    expect(() => parseCompositionResponse(raw)).toThrow(/truncated/i);
  });

  it("reports a genuinely absent HTML document as missing index_html", () => {
    const value = draft();
    const raw = `<storyboard_json>${JSON.stringify(value.storyboard)}</storyboard_json>\nno html here`;
    expect(() => parseCompositionResponse(raw)).toThrow(/missing <index_html>/);
  });

  it("validates a storyboard-first cut graph before source authoring", () => {
    const plan = storyboard();
    const parsed = parseStoryboardResponse(
      `<storyboard_json>${JSON.stringify(plan)}</storyboard_json>`,
    );
    expect(parsed).toEqual(plan);
    expect(() => parseStoryboardResponse(
      `<storyboard_json>${JSON.stringify(plan.slice(0, 2))}</storyboard_json>`,
    )).toThrow(/3-10 distinct shots/);
  });

  it("turns explicit component/camera direction into blocking plan coverage", () => {
    const requirements = inferStoryboardPlanRequirements(
      "Use one large spatial UI world with camera pushes and pans, object-match cuts, " +
        "and component beats for search, command palette, table, stat card, terminal, " +
        "toast, progress, and chart.",
      18,
    );
    expect(requirements).toMatchObject({
      targetDurationSec: 18,
      minRequestedComponentKinds: 6,
      minComponentBeats: 8,
      minCameraMoves: 2,
      requireMultiStationWorld: true,
      requireObjectMatch: true,
    });
    expect(requirements.requestedComponentKinds).toHaveLength(8);
    expect(() =>
      parseStoryboardResponse(JSON.stringify(storyboard()), requirements)
    ).toThrow(/motion-native product components/);
    expect(() =>
      parseStoryboardResponse(JSON.stringify(storyboard()), requirements)
    ).toThrow(/spatial camera choreography/);
  });

  it("never demands more component kinds than the brief names", () => {
    const requirements = inferStoryboardPlanRequirements(
      "Show motion-native components: the search bar morphs into a command " +
        "palette, plus a stat card with the key metric.",
      16,
    );
    expect(requirements.requestedComponentKinds).toHaveLength(3);
    // The floor is capped at the requested count so the brief stays satisfiable.
    expect(requirements.minRequestedComponentKinds).toBe(3);
  });

  it("keeps typed boundary cuts and degrades unusable ones before source authoring", () => {
    const plan = storyboard();
    plan[0]!.cut = { version: 1, style: "cut-left", travelPx: 9999 };
    plan[1]!.cut = {
      version: 1,
      style: "object-match",
      focalPartOut: "the-action-button",
      // focalPartIn missing → unusable, must degrade to no cut, not fail
    };
    plan[2]!.cut = { version: 1, style: "hard" };
    const parsed = parseStoryboardResponse(JSON.stringify(plan));
    expect(parsed[0]?.cut).toEqual({ version: 1, style: "cut-left", travelPx: 420 });
    expect(parsed[1]?.cut).toBeUndefined();
    expect(parsed[2]?.cut).toEqual({ version: 1, style: "hard" });
  });

  it("recovers a planner ripple omission before source authoring", () => {
    const plan = storyboard();
    plan[1]!.interactions = [{
      version: 1,
      id: "product-click",
      sceneId: plan[1]!.id,
      cursorId: "pointer",
      targetPart: "primary-action",
      action: "click",
      startSec: 3.2,
      arriveSec: 3.5,
      pressSec: 3.6,
      releaseSec: 3.75,
      from: "frame:bottom-right",
      path: "human",
      aimX: 0.5,
      aimY: 0.5,
      feedback: "press-ripple",
    }];
    const parsed = parseStoryboardResponse(JSON.stringify(plan));
    expect(parsed[1]?.interactions?.[0]?.ripplePart).toBe("primary-action-ripple");
  });

  it("makes duplicate planner interaction ids unique before source authoring", () => {
    const plan = storyboard();
    const shared = {
      version: 1 as const,
      id: "shared-click",
      cursorId: "pointer",
      targetPart: "primary-action",
      action: "click" as const,
      startSec: 3.2,
      arriveSec: 3.5,
      pressSec: 3.6,
      releaseSec: 3.75,
      from: "frame:bottom-right" as const,
      path: "human" as const,
      aimX: 0.5,
      aimY: 0.5,
      feedback: "press" as const,
    };
    plan[1]!.interactions = [{ ...shared, sceneId: plan[1]!.id }];
    plan[2]!.interactions = [{
      ...shared,
      sceneId: plan[2]!.id,
      startSec: 6.2,
      arriveSec: 6.5,
      pressSec: 6.6,
      releaseSec: 6.75,
    }];
    const parsed = parseStoryboardResponse(JSON.stringify(plan));
    expect(parsed[1]?.interactions?.[0]?.id).toBe("shared-click");
    expect(parsed[2]?.interactions?.[0]?.id).toBe("shared-click-2");
  });

  it("normalizes out-of-order planner interaction timing inside its scene", () => {
    const plan = storyboard();
    plan[1]!.spatialIntent = {
      version: 1,
      focalPart: "a live, updating metric: 'Incidents -99.7%'",
      composition: "Metric-led product proof",
      relationships: [],
    };
    plan[1]!.interactions = [{
      version: 1,
      id: "bad-timing-click",
      sceneId: "wrong-scene",
      cursorId: "pointer",
      targetPart: "the 'Get Live View' CTA button",
      action: "click",
      startSec: 3.2,
      arriveSec: 4.4,
      pressSec: 4.1,
      releaseSec: 3.9,
      holdUntilSec: 99,
      from: "nowhere" as never,
      path: "custom",
      aimX: 4,
      aimY: -2,
      feedback: "press-ripple",
      ripplePart: "the CTA button surface",
    }];
    const parsed = parseStoryboardResponse(JSON.stringify(plan));
    const interaction = parsed[1]?.interactions?.[0];
    expect(interaction).toBeDefined();
    expect(parsed[1]?.spatialIntent?.focalPart).toBe(
      "a-live-updating-metric-incidents-99-7",
    );
    expect(interaction?.sceneId).toBe("product-proof");
    expect(interaction?.targetPart).toBe("the-get-live-view-cta-button");
    expect(interaction?.from).toBe("frame:bottom-right");
    expect(interaction?.path).toBe("human");
    expect(interaction?.aimX).toBe(0.85);
    expect(interaction?.aimY).toBe(0.15);
    expect(interaction?.arriveSec).toBeGreaterThan(interaction!.startSec);
    expect(interaction?.pressSec).toBeGreaterThanOrEqual(interaction!.arriveSec + 0.08);
    expect(interaction?.releaseSec).toBeGreaterThan(interaction!.pressSec!);
    expect(interaction?.holdUntilSec).toBeLessThanOrEqual(6);
    expect(interaction?.ripplePart).toBe("the-get-live-view-cta-button-ripple");
  });

  it("drops unusable optional planner metadata instead of failing the video", () => {
    const plan = storyboard();
    plan[1]!.spatialIntent = {
      version: 1,
      focalPart: "",
      composition: "",
      relationships: [],
    };
    plan[1]!.interactions = [{
      version: 1,
      id: "missing-target",
      sceneId: plan[1]!.id,
      cursorId: "pointer",
      targetPart: "",
      action: "click",
      startSec: 3.2,
      arriveSec: 3.5,
      pressSec: 3.6,
      releaseSec: 3.8,
      from: "frame:center",
      path: "human",
      aimX: 0.5,
      aimY: 0.5,
      feedback: "press",
    }];
    const parsed = parseStoryboardResponse(JSON.stringify(plan));
    expect(parsed[1]?.spatialIntent).toBeUndefined();
    expect(parsed[1]?.interactions).toBeUndefined();
  });

  it("recovers a bare or fenced storyboard array when the model omits the wrapper", () => {
    const plan = storyboard();
    // Flash-tier planners routinely ignore the <storyboard_json> wrapper.
    expect(parseStoryboardResponse(JSON.stringify(plan))).toEqual(plan);
    expect(
      parseStoryboardResponse("Here is the plan:\n```json\n" + JSON.stringify(plan) + "\n```"),
    ).toEqual(plan);
  });

  it("parses a provider-native structured storyboard object", () => {
    const plan = storyboard();
    expect(parseStoryboardResponse(JSON.stringify({ storyboard: plan }))).toEqual(plan);
  });

  it("accepts a plan whose moment gaps are provable from its own typed evidence", () => {
    // The 2026-07-04 live fallback root cause: GLM plans with rich typed
    // beats/camera kept getting vetoed on marginal moment-spacing gaps the
    // plan itself could prove. The host now fills that paperwork instead of
    // burning retries on it.
    const moment = (sceneId: string, id: string, atSec: number) => ({
      version: 1 as const,
      id,
      sceneId,
      atSec,
      title: `Moment ${id}`,
      visualState: `state ${id}`,
      change: `change ${id}`,
      motionIntent: "reveal",
      importance: "supporting" as const,
    });
    const plan = [
      {
        id: "signal",
        title: "Signal",
        purpose: "Expose the problem",
        incomingIdea: "Noise arrives",
        foreground: "Split headline over a trace rail",
        background: "Dark grid",
        cameraIntent: "Locked wide",
        continuityAnchor: "The trace exits right",
        outgoingCut: "Zoom through the trace into the product",
        startSec: 0,
        durationSec: 5,
        cut: { version: 1, style: "zoom-through" },
        components: [{ version: 1, id: "sig-stat", kind: "stat-card" }],
        beats: [{
          version: 1,
          id: "sig-count",
          sceneId: "signal",
          component: "sig-stat",
          kind: "count",
          atSec: 4,
        }],
        moments: [moment("signal", "signal-m1", 0.3), moment("signal", "signal-m2", 2.0)],
      },
      {
        id: "proof",
        title: "Proof",
        purpose: "Show the product",
        incomingIdea: "The trace becomes a route",
        foreground: "Product window",
        background: "Technical grid",
        cameraIntent: "Pan across the metric wall",
        continuityAnchor: "The route lands in the window",
        outgoingCut: "Hard cut to the close",
        startSec: 5,
        durationSec: 5,
        cut: { version: 1, style: "hard" },
        camera: {
          version: 1,
          path: [{
            version: 1,
            move: "pan",
            toRegion: "metric-wall",
            startSec: 7.8,
            durationSec: 1.2,
          }],
        },
        moments: [moment("proof", "proof-m1", 5.3), moment("proof", "proof-m2", 7.0)],
      },
      {
        id: "close",
        title: "Close",
        purpose: "Resolve the promise",
        incomingIdea: "The route becomes the brand",
        foreground: "Logo lockup",
        background: "Quiet field",
        cameraIntent: "Settle into a held wide",
        continuityAnchor: "The lockup holds",
        outgoingCut: "End on a held frame",
        startSec: 10,
        durationSec: 5,
        moments: [moment("close", "close-m1", 10.3), moment("close", "close-m2", 12.0)],
      },
    ];
    const parsed = parseStoryboardResponse(JSON.stringify({ storyboard: plan }));
    const moments = parsed.flatMap((scene) => scene.moments ?? []);
    // Declared moments alone leave two >2.6s dead intervals; the typed beat
    // (4.0s) and camera arrival (9.0s) fill them deterministically.
    expect(moments.map((entry) => entry.id)).toContain("signal-auto-1");
    expect(moments.map((entry) => entry.id)).toContain("proof-auto-1");
    expect(moments).toHaveLength(8);
  });

  it("drops unknown optional capability citations instead of aborting the film", () => {
    const plan = storyboard();
    plan[0]!.capabilityIds = ["dashboard"];
    const parsed = parseStoryboardResponse(JSON.stringify({ storyboard: plan }));
    expect(parsed[0]?.capabilityIds).toEqual([]);
  });

  it("reports an unclosed storyboard tag as truncation, not a missing wrapper", () => {
    const plan = storyboard();
    expect(() => parseStoryboardResponse(`<storyboard_json>${JSON.stringify(plan)}`)).toThrow(
      /truncated/i,
    );
  });

  it("still reports a genuinely absent storyboard as missing", () => {
    expect(() => parseStoryboardResponse("no array anywhere in this prose")).toThrow(
      /missing <storyboard_json>/,
    );
  });

  it("runs the bounded concept pass before the storyboard and feeds its artifact in", async () => {
    const dir = projectDir();
    const concept = {
      thesis: "One trace becomes one route",
      narrativePressure: "Noise until the product resolves it",
      energyCurve: "staccato open → build → warm resolve",
      motif: "the violet trace rail",
      colorArc: "cold → neutral → warm",
      creativeRisk: "held stillness before the close",
    };
    const complete = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(concept))
      .mockResolvedValueOnce(`<storyboard_json>${JSON.stringify(storyboard())}</storyboard_json>`);
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    await requestStoryboardPlan(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
    });
    expect(complete).toHaveBeenCalledTimes(2);
    const conceptOptions = complete.mock.calls[0]?.[1] as {
      thinkingMode?: string;
      model?: string;
      responseFormat?: { json_schema?: { name?: string } };
    };
    expect(conceptOptions).toMatchObject({
      thinkingMode: "high",
      model: "z-ai/glm-5.2",
    });
    expect(conceptOptions.responseFormat?.json_schema?.name).toBe("sequences_concept");
    const storyboardPrompt = complete.mock.calls[1]?.[0] as string;
    expect(storyboardPrompt).toContain("<concept_json>");
    expect(storyboardPrompt).toContain("the violet trace rail");
    // The concept artifact is cached independently for retryable stages.
    expect(fs.existsSync(path.join(dir, "planning", "concept.json"))).toBe(true);
  });

  it("routes storyboard expansion to reasoning-enabled GLM 5.2 at medium effort", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    const dir = projectDir();
    const complete = vi.fn().mockResolvedValue(
      `<storyboard_json>${JSON.stringify(storyboard())}</storyboard_json>`,
    );
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    await requestStoryboardPlan(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
    });
    const options = complete.mock.calls[0]?.[1] as {
      maxTokens?: number;
      thinkingMode?: string;
      model?: string;
      responseFormat?: { type?: string; json_schema?: { name?: string } };
    };
    expect(options).toMatchObject({
      maxTokens: 30_720,
      thinkingMode: "medium",
      model: "z-ai/glm-5.2",
    });
    expect(options.responseFormat).toMatchObject({
      type: "json_schema",
      json_schema: { name: "sequences_storyboard" },
    });
  });

  it("streams the reasoning storyboard so long GLM thinking does not look idle", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    const dir = projectDir();
    const complete = vi.fn(async () => {
      throw new Error("non-streaming transport should not be used");
    });
    const streamComplete = vi.fn(async () =>
      JSON.stringify({ storyboard: storyboard() })
    );
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "streaming planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
      streamComplete,
    };
    await expect(requestStoryboardPlan(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
    })).resolves.toEqual(storyboard());
    expect(complete).not.toHaveBeenCalled();
    expect(streamComplete).toHaveBeenCalledTimes(1);
    const streamOptions = (streamComplete.mock.calls as unknown[][])[0]?.[1];
    expect(streamOptions).toMatchObject({
      model: "z-ai/glm-5.2",
      thinkingMode: "medium",
      maxTokens: 30_720,
    });
  });

  it("uses a separate storyboard model only when the operator explicitly configures one", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    vi.stubEnv("SLACK_SEQUENCES_STORYBOARD_MODEL", "operator/structured-planner");
    const dir = projectDir();
    const complete = vi.fn().mockResolvedValue(
      `<storyboard_json>${JSON.stringify(storyboard())}</storyboard_json>`,
    );
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    await requestStoryboardPlan(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
    });
    expect(complete.mock.calls[0]?.[1]).toMatchObject({
      model: "operator/structured-planner",
      maxTokens: 6_144,
      thinkingMode: "none",
    });
  });

  it("lets operators keep the primary authoring model for storyboard work", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    vi.stubEnv("SLACK_SEQUENCES_STORYBOARD_MODEL", "primary");
    const dir = projectDir();
    const complete = vi.fn().mockResolvedValue(
      `<storyboard_json>${JSON.stringify(storyboard())}</storyboard_json>`,
    );
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    await requestStoryboardPlan(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
    });
    expect(complete.mock.calls[0]?.[1]).toMatchObject({
      maxTokens: 6_144,
      thinkingMode: "none",
    });
    expect((complete.mock.calls[0]?.[1] as { model?: string }).model).toBeUndefined();
  });

  it("retries the storyboard pass through a transient provider timeout", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    const dir = projectDir();
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    });
    const complete = vi.fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(`<storyboard_json>${JSON.stringify(storyboard())}</storyboard_json>`);
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const plan = await requestStoryboardPlan(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(plan).toEqual(storyboard());
  });

  it("retries an empty streamed completion from the provider", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    const dir = projectDir();
    const streamComplete = vi.fn()
      .mockRejectedValueOnce(new Error("OpenRouter returned an empty completion"))
      .mockResolvedValueOnce(JSON.stringify({ storyboard: storyboard() }));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete: vi.fn(),
      streamComplete,
    };
    const plan = await requestStoryboardPlan(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
    });
    expect(streamComplete).toHaveBeenCalledTimes(2);
    expect(plan).toEqual(storyboard());
  });

  it("recovers a truncated reasoning storyboard with lower effort", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    const dir = projectDir();
    const complete = vi.fn()
      .mockRejectedValueOnce(
        new ProviderOutputTruncatedError("OpenRouter", 30_720, '{"storyboard":['),
      )
      .mockResolvedValueOnce(JSON.stringify({ storyboard: storyboard() }));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const plan = await requestStoryboardPlan(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
    });
    expect(plan).toEqual(storyboard());
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0]?.[1]).toMatchObject({
      maxTokens: 30_720,
      thinkingMode: "medium",
    });
    expect(complete.mock.calls[1]?.[1]).toMatchObject({
      maxTokens: 8_192,
      thinkingMode: "none",
    });
  });

  it("retries an upstream idle timeout inside the same source attempt", async () => {
    const dir = projectDir();
    const complete = vi.fn()
      .mockRejectedValueOnce(new Error("OpenRouter completion failed: Upstream idle timeout exceeded"))
      .mockResolvedValueOnce(response(draft()));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: draft().storyboard,
    });
    expect(result.attempts).toBe(1);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("streams long source authoring when the provider supports it", async () => {
    const dir = projectDir();
    const complete = vi.fn(async () => {
      throw new Error("non-streaming source transport should not be used");
    });
    const streamComplete = vi.fn(async () => response(draft()));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "streaming author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
      streamComplete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: draft().storyboard,
    });
    expect(result.attempts).toBe(1);
    expect(complete).not.toHaveBeenCalled();
    expect(streamComplete).toHaveBeenCalledTimes(1);
    expect((streamComplete.mock.calls as unknown[][])[0]?.[1]).toMatchObject({
      model: "deepseek/deepseek-v4-pro",
      thinkingMode: "none",
    });
  });

  it("surfaces an actionable message when storyboard timeouts exhaust retries", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    const dir = projectDir();
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    });
    const complete = vi.fn().mockRejectedValue(timeout);
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    await expect(
      requestStoryboardPlan(provider, { brief: "Launch Relay", projectDir: dir, skills: skills() }),
    ).rejects.toThrow(/planning model kept timing out/i);
    // 3 transport retries on the primary rung, then 3 on the rescue rung —
    // a transient slowdown gets one shot at an independent upstream route
    // before the stage surfaces the actionable timeout message.
    expect(complete).toHaveBeenCalledTimes(6);
    expect(complete.mock.calls[3]?.[1]).toMatchObject({
      model: "tencent/hy3-preview",
    });
  }, 25_000);

  it("hands a systematically rejected storyboard to the rescue model with findings", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    const dir = projectDir();
    const complete = vi.fn(async (_prompt: string, options?: { model?: string }) =>
      options?.model === "tencent/hy3-preview"
        ? `<storyboard_json>${JSON.stringify(storyboard())}</storyboard_json>`
        : "no array anywhere in this prose");
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const attempts = { count: 0 };
    const plan = await requestStoryboardPlan(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      attempts,
    });
    expect(plan).toEqual(storyboard());
    // 3 primary attempts with findings, then the rescue rung recovers.
    expect(complete).toHaveBeenCalledTimes(4);
    expect(attempts.count).toBe(4);
    const rescueCall = complete.mock.calls[3] as [string, { model?: string; thinkingMode?: string }];
    expect(rescueCall[1]).toMatchObject({
      model: "tencent/hy3-preview",
      thinkingMode: "medium",
    });
    expect(rescueCall[0]).toContain("Previous attempt rejected");
  });

  it("retries a rejected storyboard with findings, then surfaces the content error", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    const dir = projectDir();
    const complete = vi.fn().mockResolvedValue("no array anywhere in this prose");
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    await expect(
      requestStoryboardPlan(provider, { brief: "Launch Relay", projectDir: dir, skills: skills() }),
    ).rejects.toThrow(/missing <storyboard_json>/);
    // The bounded artifact gets findings-driven retries on the primary rung
    // (3) and the rescue rung (2); transport-level retries never fire for
    // content errors.
    expect(complete).toHaveBeenCalledTimes(5);
    expect(complete.mock.calls[1]?.[0]).toContain("Previous attempt rejected");
    expect(complete.mock.calls[3]?.[1]).toMatchObject({ model: "tencent/hy3-preview" });
  });

  it("keeps the rescue rung off when the operator disables it", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    vi.stubEnv("SLACK_SEQUENCES_STORYBOARD_RESCUE_MODEL", "none");
    const dir = projectDir();
    const complete = vi.fn().mockResolvedValue("no array anywhere in this prose");
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    await expect(
      requestStoryboardPlan(provider, { brief: "Launch Relay", projectDir: dir, skills: skills() }),
    ).rejects.toThrow(/missing <storyboard_json>/);
    expect(complete).toHaveBeenCalledTimes(3);
  });

  it("applies bounded exact repair patches without regenerating the composition", () => {
    const value = draft();
    const repaired = applyCompositionRepair(
      patchResponse("border: 1px solid #8b5cf6", "border: 1px solid #22d3ee"),
      value,
    );
    expect(repaired.storyboard).toBe(value.storyboard);
    expect(repaired.html).toContain("#22d3ee");
    expect(repaired.html).toContain("#8b5cf6");
  });

  it("parses provider-native structured repair patches without decorative tags", () => {
    const value = draft();
    const repaired = applyCompositionRepair(
      JSON.stringify({
        patches: [{
          search: "border: 1px solid #8b5cf6",
          replace: "border: 1px solid #22d3ee",
        }],
      }),
      value,
    );
    expect(repaired.html).toContain("#22d3ee");
  });

  it("recovers a bare repair array surrounded by model prose", () => {
    const value = draft();
    const repaired = applyCompositionRepair(
      `Here are the edits:\n${JSON.stringify([{
        search: "border: 1px solid #8b5cf6",
        replace: "border: 1px solid #22d3ee",
      }])}`,
      value,
    );
    expect(repaired.html).toContain("#22d3ee");
  });

  it("recovers a complete HTML document returned by a model that ignored patch mode", () => {
    const value = draft();
    const replacement = value.html.replace(
      "border: 1px solid #8b5cf6",
      "border: 1px solid #22d3ee",
    );
    const repaired = applyCompositionRepair(
      `I rewrote the document instead:\n${replacement}`,
      value,
    );
    expect(repaired.storyboard).toBe(value.storyboard);
    expect(repaired.html).toContain("#22d3ee");
  });

  it("applies a repair patch whose search reflowed whitespace", () => {
    const value = draft();
    // The model reproduced the rule but with collapsed/extra spacing — the most
    // common reason an exact indexOf patch misses. The substantive characters are
    // identical, so a whitespace-flexible match still applies it uniquely.
    const repaired = applyCompositionRepair(
      patchResponse(
        "h1 {   margin: 0;  font-size: 124px;\n   line-height: .95; }",
        "h1 { margin: 0; font-size: 110px; line-height: .95; }",
      ),
      value,
    );
    expect(repaired.html).toContain("font-size: 110px");
    expect(repaired.html).not.toContain("font-size: 124px");
  });

  it("still rejects a repair patch whose search is genuinely absent", () => {
    expect(() =>
      applyCompositionRepair(
        patchResponse("this text appears nowhere in the document", "x"),
        draft(),
      ),
    ).toThrow(/was not found/);
  });

  it("still rejects a repair patch whose search is ambiguous", () => {
    // ".scene" whitespace-flex-matches multiple class selectors / attributes.
    expect(() =>
      applyCompositionRepair(patchResponse("scene", "shot"), draft()),
    ).toThrow(/not unique/);
  });

  it("keeps unique edits when another independent patch is ambiguous", () => {
    const value = draft();
    const repaired = applyCompositionRepair(
      `<patches_json>${JSON.stringify([
        {
          search: "border: 1px solid #8b5cf6",
          replace: "border: 1px solid #22d3ee",
        },
        { search: "scene", replace: "shot" },
      ])}</patches_json>`,
      value,
    );
    expect(repaired.html).toContain("#22d3ee");
    expect(repaired.html).toContain('class="scene clip"');
  });

  it("quarantines only the browser-proven broken optional interaction", () => {
    const value = draft();
    const interactions = [
      {
        version: 1 as const,
        id: "broken-click",
        sceneId: "payoff",
        cursorId: "pointer",
        targetPart: "primary-action",
        action: "click" as const,
        startSec: 4.4,
        arriveSec: 5,
        pressSec: 5.1,
        releaseSec: 5.25,
        from: "frame:bottom-right" as const,
        path: "human" as const,
        aimX: 0.5,
        aimY: 0.5,
        feedback: "press" as const,
      },
      {
        version: 1 as const,
        id: "healthy-hover",
        sceneId: "payoff",
        cursorId: "pointer",
        targetPart: "secondary-action",
        action: "hover" as const,
        startSec: 5.4,
        arriveSec: 6,
        from: "part:primary-action" as const,
        path: "arc" as const,
        aimX: 0.5,
        aimY: 0.5,
        feedback: "none" as const,
      },
    ];
    value.storyboard[1]!.interactions = interactions;
    value.html = value.html.replace(
      "<script>\n    window.__timelines",
      `<script type="application/json" id="sequences-interactions">${
        JSON.stringify({ version: 1, interactions })
      }</script>\n  <script>\n    window.__timelines`,
    );
    const result = quarantineFailedInteractions(value, [{
      code: "interaction_not_visible",
      severity: "error",
      time: 5.1,
      interactionId: "broken-click",
      selector: "#primary-action",
      message: "Cursor or target is not visible during press.",
      source: "sequences",
    }]);
    expect(result.removedIds).toEqual(["broken-click"]);
    expect(result.draft.storyboard[1]!.interactions?.map((entry) => entry.id))
      .toEqual(["healthy-hover"]);
    expect(result.draft.html).not.toContain('"id":"broken-click"');
    expect(result.draft.html).toContain('"id":"healthy-hover"');
    expect(result.draft.html).not.toContain("data-sequences-quarantine");
    expect(result.draft.html.replace(/sequences-interactions[\s\S]*/, ""))
      .toBe(value.html.replace(/sequences-interactions[\s\S]*/, ""));
  });

  it("reserves the completion budget for source instead of DeepSeek reasoning", async () => {
    const dir = projectDir();
    const complete = vi.fn().mockResolvedValueOnce(response(draft()));
    const provider: AgentProvider = {
      id: "openai-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: draft().storyboard,
    });
    const options = complete.mock.calls[0]?.[1] as {
      maxTokens?: number;
      thinkingMode?: string;
    } | undefined;
    expect(options?.maxTokens).toBe(12_288);
    expect(options?.thinkingMode).toBe("none");
  });

  it("uses a compact recovery prompt after a provider reports finish_reason=length", async () => {
    const dir = projectDir();
    const complete = vi.fn()
      .mockRejectedValueOnce(new ProviderOutputTruncatedError("OpenRouter", 16_384))
      .mockResolvedValueOnce(response(draft()));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: {
        ...skills(),
        text: `<blueprint id="huge">${"recipe ".repeat(8_000)}</blueprint>`,
      },
      lockedStoryboard: draft().storyboard,
    });
    expect(result.attempts).toBe(2);
    const firstPrompt = String(complete.mock.calls[0]?.[0]);
    const secondPrompt = String(complete.mock.calls[1]?.[0]);
    const secondOptions = complete.mock.calls[1]?.[1] as { model?: string } | undefined;
    expect(secondPrompt).toContain("compact recovery pass");
    expect(secondPrompt.length).toBeLessThan(firstPrompt.length / 2);
    expect(secondOptions?.model).toBe("deepseek/deepseek-v4-pro");
  });

  it("continues a partial OpenRouter document without spending a repair attempt", async () => {
    const dir = projectDir();
    const full = response(draft());
    const split = Math.floor(full.length / 2);
    const prefix = full.slice(0, split);
    const continuation = full.slice(split);
    const complete = vi.fn()
      .mockRejectedValueOnce(new ProviderOutputTruncatedError("OpenRouter", 8_192, prefix))
      .mockResolvedValueOnce(continuation);
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: draft().storyboard,
    });
    expect(result.attempts).toBe(1);
    const expected = draft();
    expected.html = withHostInjections(expected.html);
    expect(result.draft).toEqual(expected);
    expect((complete.mock.calls[1]?.[1] as { assistantPrefill?: string }).assistantPrefill)
      .toBe(prefix);
  });

  it("allows exactly one model repair after deterministic validation feedback", async () => {
    const dir = projectDir();
    const invalid = draft();
    invalid.html = invalid.html.replace(
      "const tl =",
      "const noise = setTimeout(() => {}, 1); const tl =",
    );
    const complete = vi.fn()
      .mockResolvedValueOnce(response(invalid))
      .mockResolvedValueOnce(patchResponse(
        "const noise = setTimeout(() => {}, 1); const tl =",
        "const tl =",
      ));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: draft().storyboard,
    });
    expect(result.attempts).toBe(2);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]?.[0]).toContain("timer-driven visual state is not seek-safe");
    expect(complete.mock.calls[1]?.[0]).toContain('"patches" array');
    expect((complete.mock.calls[1]?.[1] as { maxTokens?: number }).maxTokens).toBe(4_096);
    expect((complete.mock.calls[1]?.[1] as {
      responseFormat?: { json_schema?: { name?: string } };
    }).responseFormat?.json_schema?.name).toBe("sequences_composition_patches");
  });

  it("keeps OpenRouter bounded patches on the primary DeepSeek model by default", async () => {
    const dir = projectDir();
    const invalid = draft();
    invalid.html = invalid.html.replace(
      "const tl =",
      "const noise = setTimeout(() => {}, 1); const tl =",
    );
    const complete = vi.fn()
      .mockResolvedValueOnce(response(invalid))
      .mockResolvedValueOnce(patchResponse("setTimeout(() => {}, 1)", "Date.now()"))
      .mockResolvedValueOnce(patchResponse("setTimeout(() => {}, 1)", "0"));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: draft().storyboard,
    });
    expect(result.attempts).toBe(3);
    expect(complete).toHaveBeenCalledTimes(3);
    expect((complete.mock.calls[1]?.[1] as { model?: string }).model)
      .toBe("deepseek/deepseek-v4-pro");
    expect((complete.mock.calls[2]?.[1] as { model?: string }).model)
      .toBe("deepseek/deepseek-v4-pro");
    expect((complete.mock.calls[1]?.[1] as { thinkingMode?: string }).thinkingMode)
      .toBe("none");
  });

  it("uses an explicitly configured repair model only for patch calls", async () => {
    vi.stubEnv("SLACK_SEQUENCES_REPAIR_MODEL", "operator/patch-model");
    const dir = projectDir();
    const invalid = draft();
    invalid.html = invalid.html.replace(
      "const tl =",
      "const noise = setTimeout(() => {}, 1); const tl =",
    );
    const complete = vi.fn()
      .mockResolvedValueOnce(response(invalid))
      .mockResolvedValueOnce(patchResponse(
        "const noise = setTimeout(() => {}, 1); const tl =",
        "const tl =",
      ));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: draft().storyboard,
    });
    expect((complete.mock.calls[0]?.[1] as { model?: string }).model)
      .toBe("deepseek/deepseek-v4-pro");
    expect((complete.mock.calls[1]?.[1] as { model?: string }).model)
      .toBe("operator/patch-model");
  });

  it("falls back to the last browser-valid draft when final polish regresses", async () => {
    const dir = projectDir();
    const initial = draft();
    const complete = vi.fn()
      .mockResolvedValueOnce(response(initial))
      .mockResolvedValueOnce(patchResponse(
        "border: 1px solid #8b5cf6",
        "border: 1px solid #22d3ee",
      ))
      .mockResolvedValueOnce(patchResponse(
        "border: 1px solid #22d3ee",
        "border: 1px solid #ef4444",
      ));
    vi.mocked(inspectDirectComposition)
      .mockResolvedValueOnce({
        ok: true,
        strictOk: false,
        samples: [0, 2, 4],
        issues: [],
        errors: [],
        warnings: ["layout warning"],
      })
      .mockResolvedValueOnce({
        ok: false,
        strictOk: false,
        samples: [],
        issues: [],
        errors: ["browser runtime failed"],
        warnings: [],
      })
      .mockResolvedValueOnce({
        ok: false,
        strictOk: false,
        samples: [],
        issues: [],
        errors: ["browser runtime still failed"],
        warnings: [],
      });
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: initial.storyboard,
    });
    expect(result.attempts).toBe(3);
    expect(result.draft.html).toBe(withHostInjections(initial.html));
  });

  it("publishes runnable output when visual-QA polish patches are malformed", async () => {
    const dir = projectDir();
    const initial = draft();
    const complete = vi.fn()
      .mockResolvedValueOnce(response(initial))
      .mockResolvedValueOnce('{"patches":[]}')
      .mockResolvedValueOnce('{"patches":[]}');
    vi.mocked(inspectDirectComposition).mockResolvedValueOnce({
      ok: true,
      strictOk: false,
      samples: [0, 2, 4],
      issues: [{
        code: "text_occluded",
        severity: "error",
        time: 2,
        selector: "#sell-btn-el",
        message: "Text is hidden beneath an opaque element.",
        source: "hyperframes",
      }],
      errors: [],
      warnings: [
        "text_occluded #sell-btn-el (t=2.00s): Text is hidden beneath an opaque element.",
      ],
    });
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };

    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: initial.storyboard,
    });

    expect(result.attempts).toBe(3);
    expect(result.draft.html).toBe(withHostInjections(initial.html));
    expect(complete).toHaveBeenCalledTimes(3);
  });

  it("mechanically replaces unseeded randomness before spending a model repair", async () => {
    const dir = projectDir();
    const invalid = draft();
    invalid.html = invalid.html.replace(
      "const tl =",
      "const noise = Math.random(); const tl =",
    );
    const complete = vi.fn().mockResolvedValueOnce(response(invalid));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: draft().storyboard,
    });
    expect(result.attempts).toBe(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.draft.html).toContain("const __sequencesRandom");
    expect(result.draft.html).toContain("const noise = __sequencesRandom()");
    expect(result.draft.html).not.toContain("Math.random()");
  });

  it("normalizes computed timeline registration before spending a model repair", async () => {
    const dir = projectDir();
    const computed = draft();
    computed.html = computed.html.replace(
      'window.__timelines["relay-launch"] = tl;',
      "const root = document.getElementById('root'); " +
        "const compId = root.getAttribute('data-composition-id'); " +
        "window.__timelines[compId] = tl;",
    );
    const complete = vi.fn().mockResolvedValueOnce(response(computed));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: draft().storyboard,
    });
    expect(result.attempts).toBe(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.draft.html).toContain('window.__timelines["relay-launch"] = tl;');
  });

  it("removes unavailable font-face sources before spending a model repair", async () => {
    const dir = projectDir();
    const withMissingFont = draft();
    withMissingFont.html = withMissingFont.html.replace(
      "<style>",
      "<style>@font-face{font-family:Inter;src:url('assets/inter.woff2') format('woff2')}",
    );
    const complete = vi.fn().mockResolvedValueOnce(response(withMissingFont));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: draft().storyboard,
    });
    expect(result.attempts).toBe(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.draft.html).not.toContain("@font-face");
  });

  it("reconciles a mistyped scene id from its locked timing window", async () => {
    const dir = projectDir();
    const mistyped = draft();
    mistyped.html = mistyped.html.replaceAll("payoff", "payof");
    const complete = vi.fn().mockResolvedValueOnce(response(mistyped));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: draft().storyboard,
    });
    expect(result.attempts).toBe(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.draft.html).toContain('id="payoff"');
    expect(result.draft.html).toContain('"#payoff-title"');
    expect(result.draft.html).not.toContain('id="payof"');
    expect(result.draft.html).not.toContain('"#payof-title"');
  });

  it("creates a missing standard ripple binding without spending a model repair", async () => {
    const dir = projectDir();
    const value = draft();
    const interaction = {
      version: 1 as const,
      id: "payoff-click",
      sceneId: "payoff",
      cursorId: "pointer",
      targetPart: "primary-action",
      action: "click" as const,
      startSec: 4.4,
      arriveSec: 5,
      pressSec: 5.1,
      releaseSec: 5.25,
      from: "frame:bottom-right" as const,
      path: "human" as const,
      aimX: 0.5,
      aimY: 0.5,
      feedback: "press-ripple" as const,
      ripplePart: "primary-action-ripple",
    };
    value.storyboard[1]!.interactions = [interaction];
    value.html = value.html
      .replace(
        '<div class="panel" data-layout-important data-layout-anchor="frame:center"><h1 id="payoff-title">',
        '<div data-camera-world><div class="panel" data-part="primary-action" data-layout-important data-layout-anchor="frame:center"><h1 id="payoff-title">',
      )
      .replace(
        '<p>Ship with nerve.</p></div>\n    </section>',
        '<p>Ship with nerve.</p></div></div><div data-camera-overlay>' +
          '<span><i data-cursor-id="pointer" style="position:absolute;left:0;top:0;' +
          'width:24px;height:24px;pointer-events:none"></i></span></div>\n    </section>',
      )
      .replace(
        'window.__timelines["relay-launch"] = tl;',
        'const root = document.getElementById("root"); const interactionsData = [];\n' +
          'SequencesInteractions.compile(tl, root, interactionsData);\n' +
          'window.__timelines["relay-launch"] = tl;',
      )
      .replace(
        "</body>",
        `<script type="application/json" id="sequences-interactions">${
          JSON.stringify({ version: 1, interactions: [] })
        }</script></body>`,
      );
    const complete = vi.fn().mockResolvedValueOnce(response(value));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: value.storyboard,
    });
    expect(result.attempts).toBe(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.draft.html).toContain('data-part="primary-action-ripple"');
    expect(result.draft.html).toContain("data-sequences-runtime-ripple");
    expect(result.draft.html).toContain("data-sequences-runtime-cursor");
    expect(result.draft.html).toContain('data-cursor-hotspot-x="0.1"');
    expect(result.draft.html).toContain('data-sequences-retired-cursor="pointer"');
    expect(result.draft.html).toContain("[data-sequences-retired-cursor]");
    expect(result.draft.html).toContain('<script src="sequences-interactions.v1.js"></script>');
    expect(result.draft.html).toContain("SequencesInteractions.compile(tl, root);");
    expect(result.draft.html).not.toContain(
      "SequencesInteractions.compile(tl, root, interactionsData)",
    );
    expect(result.draft.html.indexOf('id="sequences-interactions"')).toBeLessThan(
      result.draft.html.indexOf("const tl = gsap.timeline"),
    );
  });

  it("lets a statically invalid optional interaction degrade without vetoing the film", async () => {
    const dir = projectDir();
    const value = draft();
    value.storyboard[1]!.interactions = [{
      version: 1,
      id: "missing-target-click",
      sceneId: "payoff",
      cursorId: "pointer",
      targetPart: "model-invented-target",
      action: "click",
      startSec: 4.4,
      arriveSec: 5,
      pressSec: 5.1,
      releaseSec: 5.25,
      from: "frame:bottom-right",
      path: "human",
      aimX: 0.5,
      aimY: 0.5,
      feedback: "press",
    }];
    const complete = vi.fn().mockResolvedValueOnce(response(value));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: value.storyboard,
    });
    expect(result.attempts).toBe(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.draft.storyboard[1]?.interactions).toBeUndefined();
    expect(result.draft.html).toContain('"interactions":[]');
    expect(result.draft.html).toContain("data-sequences-quarantine");
  });

  it("publishes the healthy film after bounded repairs cannot fix an optional interaction", async () => {
    const dir = projectDir();
    const value = draft();
    value.storyboard[1]!.interactions = [{
      version: 1,
      id: "payoff-click",
      sceneId: "payoff",
      cursorId: "pointer",
      targetPart: "primary-action",
      action: "click",
      startSec: 4.4,
      arriveSec: 5,
      pressSec: 5.1,
      releaseSec: 5.25,
      from: "frame:bottom-right",
      path: "human",
      aimX: 0.5,
      aimY: 0.5,
      feedback: "press",
    }];
    value.html = value.html
      .replace(
        '<div class="panel" data-layout-important data-layout-anchor="frame:center"><h1 id="payoff-title">',
        '<div data-camera-world><div class="panel" data-part="primary-action" data-layout-important data-layout-anchor="frame:center"><h1 id="payoff-title">',
      )
      .replace(
        '<p>Ship with nerve.</p></div>\n    </section>',
        '<p>Ship with nerve.</p></div></div><div data-camera-overlay>' +
          '<i data-cursor-id="pointer" style="position:absolute;left:0;top:0;' +
          'width:24px;height:24px;pointer-events:none"></i></div>\n    </section>',
      );
    const inspector = vi.mocked(inspectDirectComposition);
    const priorImplementation = inspector.getMockImplementation();
    inspector.mockImplementation(async (_projectDir, candidate) => {
      const hasInteraction = candidate.storyboard.some((scene) => scene.interactions?.length);
      return hasInteraction
        ? {
            ok: false,
            strictOk: false,
            samples: [5.1],
            issues: [{
              code: "interaction_not_visible",
              severity: "error",
              time: 5.1,
              interactionId: "payoff-click",
              selector: "#primary-action",
              message: "Cursor or target is not visible during press.",
              source: "sequences",
            }],
            errors: ["interaction_not_visible #primary-action"],
            warnings: [],
          }
        : {
            ok: true,
            strictOk: true,
            samples: [0, 2, 4, 6, 8],
            issues: [],
            errors: [],
            warnings: [],
          };
    });
    try {
      const noOpPatch = JSON.stringify({
        patches: [{ search: "Ship with nerve.", replace: "Ship with nerve." }],
      });
      const complete = vi.fn()
        .mockResolvedValueOnce(response(value))
        .mockResolvedValueOnce(noOpPatch)
        .mockResolvedValueOnce(noOpPatch);
      const provider: AgentProvider = {
        id: "openrouter-api",
        label: "test author",
        kind: "api",
        detect: async () => ({ available: true, detail: "test" }),
        complete,
      };
      const result = await requestDirectComposition(provider, {
        brief: "Launch Relay",
        projectDir: dir,
        skills: skills(),
        lockedStoryboard: value.storyboard,
      });
      expect(result.attempts).toBe(3);
      expect(complete).toHaveBeenCalledTimes(3);
      expect(result.draft.storyboard[1]!.interactions).toBeUndefined();
      expect(result.draft.html).toContain('"interactions":[]');
      expect(result.draft.html).toContain(
        '[data-cursor-id="pointer"]{display:none!important}',
      );
      expect(result.draft.html).toContain("Ship with nerve.");
    } finally {
      inspector.mockImplementation(priorImplementation!);
    }
  });

  it("quarantines runtime-level unsupported optional interaction plans", async () => {
    const dir = projectDir();
    const value = draft();
    value.storyboard[1]!.interactions = [{
      version: 1,
      id: "runtime-broken-click",
      sceneId: "payoff",
      cursorId: "pointer",
      targetPart: "primary-action",
      action: "click",
      startSec: 4.4,
      arriveSec: 5,
      pressSec: 5.1,
      releaseSec: 5.25,
      from: "frame:bottom-right",
      path: "human",
      aimX: 0.5,
      aimY: 0.5,
      feedback: "press",
    }];
    value.html = value.html.replace(
      '<div class="panel" data-layout-important data-layout-anchor="frame:center"><h1 id="payoff-title">',
      '<div class="panel" data-part="primary-action" data-layout-important data-layout-anchor="frame:center"><h1 id="payoff-title">',
    );
    const inspector = vi.mocked(inspectDirectComposition);
    const priorImplementation = inspector.getMockImplementation();
    inspector.mockImplementation(async (_projectDir, candidate) => {
      const hasInteraction = candidate.storyboard.some((scene) => scene.interactions?.length);
      return hasInteraction
        ? {
            ok: false,
            strictOk: false,
            samples: [],
            issues: [],
            errors: ["browser_runtime: unsupported sequences interaction plan"],
            warnings: [],
          }
        : {
            ok: true,
            strictOk: true,
            samples: [0, 2, 4, 6, 8],
            issues: [],
            errors: [],
            warnings: [],
          };
    });
    try {
      const complete = vi.fn().mockResolvedValue(response(value));
      const provider: AgentProvider = {
        id: "openrouter-api",
        label: "test author",
        kind: "api",
        detect: async () => ({ available: true, detail: "test" }),
        complete,
      };
      const result = await requestDirectComposition(provider, {
        brief: "Launch Relay",
        projectDir: dir,
        skills: skills(),
        lockedStoryboard: value.storyboard,
      });
      expect(result.attempts).toBe(3);
      expect(result.draft.storyboard[1]!.interactions).toBeUndefined();
      expect(result.draft.html).toContain('"interactions":[]');
      expect(result.draft.html).toContain("data-sequences-quarantine");
    } finally {
      inspector.mockImplementation(priorImplementation!);
    }
  });

  it("passes deterministic validation and checkpoints exact revisions", async () => {
    const dir = projectDir();
    const first = draft();
    const validation = await validateDirectComposition(dir, first);
    expect(validation.errors).toEqual([]);

    await commitDirectComposition(dir, "Relay", first);
    await commitDirectComposition(dir, "Relay", draft("#22d3ee"));
    expect(hasDirectComposition(dir)).toBe(true);
    expect(loadDirectComposition(dir).manifest.revision).toBe(2);
    expect(loadDirectComposition(dir).html).toContain("#22d3ee");
    expect(loadDirectComposition(dir).manifest.qa).toEqual({
      browserValidated: true,
      layoutSamples: 5,
      warningCount: 0,
    });
    expect(fs.existsSync(path.join(dir, "composition", "STORYBOARD.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "composition", "motion-plan.json"))).toBe(true);
    expect(fs.existsSync(
      path.join(dir, "composition", "sequences-interactions.v1.js"),
    )).toBe(true);
    expect(fs.existsSync(path.join(dir, "composition", "qa", "spatial.json"))).toBe(true);
    expect(fs.existsSync(path.join(
      dir,
      "revisions",
      "0002",
      "sequences-interactions.v1.js",
    ))).toBe(true);
    expect(fs.readFileSync(path.join(dir, "composition", "STORYBOARD.md"), "utf8"))
      .toContain("The trace arrives");

    // Simulate a checkpoint produced before interaction runtime/QA sidecars
    // existed. Undo must not leave revision 2 evidence beside revision 1.
    fs.rmSync(path.join(
      dir,
      "revisions",
      "0001",
      "sequences-interactions.v1.js",
    ));
    fs.rmSync(path.join(dir, "revisions", "0001", "qa"), {
      recursive: true,
      force: true,
    });
    expect(undoDirectComposition(dir)).toBe(true);
    expect(loadDirectComposition(dir).manifest.revision).toBe(1);
    expect(loadDirectComposition(dir).html).toContain("#8b5cf6");
    expect(fs.existsSync(path.join(
      dir,
      "composition",
      "sequences-interactions.v1.js",
    ))).toBe(false);
    expect(fs.existsSync(path.join(dir, "composition", "qa"))).toBe(false);
  });

  it("commits a statically valid draft when browser QA infrastructure is unavailable", async () => {
    const dir = projectDir();
    vi.mocked(inspectDirectComposition).mockResolvedValueOnce({
      ok: false,
      strictOk: false,
      infraError: "Chromium unavailable",
      samples: [],
      issues: [],
      errors: ["Chromium unavailable"],
      warnings: [],
    });
    await expect(commitDirectComposition(dir, "Relay", draft())).resolves.toBeDefined();
    const current = loadDirectComposition(dir);
    expect(current.manifest.qa).toMatchObject({
      browserValidated: false,
      layoutSamples: 0,
      warningCount: 1,
    });
    const qa = JSON.parse(
      fs.readFileSync(path.join(dir, "composition", "qa", "spatial.json"), "utf8"),
    ) as { infraError?: string };
    expect(qa.infraError).toBe("Chromium unavailable");
  });

  it("counts declared interactions even when browser evidence is unavailable", async () => {
    const value = draft();
    const intent = {
      version: 1 as const,
      id: "payoff-click",
      sceneId: "payoff",
      cursorId: "pointer",
      targetPart: "primary-action",
      action: "click" as const,
      startSec: 4.4,
      arriveSec: 5,
      pressSec: 5.1,
      releaseSec: 5.25,
      from: "frame:bottom-right" as const,
      path: "human" as const,
      aimX: 0.5,
      aimY: 0.5,
      feedback: "press" as const,
    };
    value.storyboard[1]!.interactions = [intent];
    value.html = value.html
      .replace(
        '<script src="gsap.min.js"></script>',
        '<script src="gsap.min.js"></script>\n<script src="sequences-interactions.v1.js"></script>',
      )
      .replace(
        '<div class="panel" data-layout-important data-layout-anchor="frame:center"><h1 id="payoff-title">',
        '<div data-camera-world><div class="panel" data-part="primary-action" data-layout-important data-layout-anchor="frame:center"><h1 id="payoff-title">',
      )
      .replace(
        '<p>Ship with nerve.</p></div>\n    </section>',
        '<p>Ship with nerve.</p></div></div><div data-camera-overlay><i data-cursor-id="pointer"></i></div>\n    </section>',
      )
      .replace(
        "  <script>\n    window.__timelines",
        `  <script type="application/json" id="sequences-interactions">${
          JSON.stringify({ version: 1, interactions: [intent] })
        }</script>\n  <script>\n    window.__timelines`,
      )
      .replace(
        '    window.__timelines["relay-launch"] = tl;',
        '    SequencesInteractions.compile(tl, document.getElementById("root"));\n' +
          '    window.__timelines["relay-launch"] = tl;',
      );
    const dir = projectDir();
    await commitDirectComposition(dir, "Relay", value);
    expect(loadDirectComposition(dir).manifest.qa?.interactionCount).toBe(1);
  });

  it("rejects network and nondeterministic scratch source without publishing it", async () => {
    const dir = projectDir();
    const invalid = draft();
    invalid.html = invalid.html
      .replace('src="gsap.min.js"', 'src="https://cdn.example/gsap.js"')
      .replace("const tl =", "const noise = Math.random(); const tl =");
    const validation = await validateDirectComposition(dir, invalid);
    expect(validation.ok).toBe(false);
    expect(validation.errors.join("\n")).toContain("network URLs are not allowed");
    expect(validation.errors.join("\n")).toContain("Math.random is not deterministic");
    expect(hasDirectComposition(dir)).toBe(false);
  });

  it("accepts inline data: URI backgrounds even when quoting is mangled", async () => {
    const dir = projectDir();
    // A Hero-Patterns-style inline SVG. The model frequently emits it with the
    // outer quotes backslash-escaped, which used to leave a stray quote clinging
    // to the captured value and defeat the data: skip — failing the whole build
    // with "referenced local asset does not exist".
    const pattern =
      "data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' " +
      "xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23E4C6BE' fill-opacity='0.4'%3E" +
      "%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4z'/%3E%3C/g%3E%3C/svg%3E";
    const withPattern = draft();
    withPattern.html = withPattern.html.replace(
      "background: #10131d;",
      `background: #10131d url(\\"${pattern}\\");`,
    );
    const validation = await validateDirectComposition(dir, withPattern);
    expect(validation.errors.join("\n")).not.toContain("referenced local asset");
    expect(validation.errors.join("\n")).not.toContain("asset reference must be local");
    expect(validation.ok).toBe(true);
  });

  it("gates committed frame facts and keeps softer frame guidance repairable", async () => {
    const dir = projectDir();
    await buildJobFrame({
      projectDir: dir,
      brief: "Launch Relay with brand accent #8B5CF6",
      evidence: "Brand signals: primary accent #8B5CF6; font Inter.",
      brandName: "Relay",
    });
    const matching = await validateDirectComposition(dir, draft("#8b5cf6"));
    expect(matching.frameErrors).toEqual([]);
    expect(matching.frameWarnings).toEqual(expect.any(Array));

    const drifted = await validateDirectComposition(dir, draft("#22d3ee"));
    expect(drifted.ok).toBe(false);
    expect(drifted.frameErrors.join("\n")).toContain("committed frame accent #8B5CF6");
  });
});
