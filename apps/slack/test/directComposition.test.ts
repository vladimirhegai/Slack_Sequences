import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProviderOutputTruncatedError,
  type AgentProvider,
} from "@sequences/platform/providers";
import {
  applyCompositionRepair,
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
  loadDirectComposition,
  undoDirectComposition,
  validateDirectComposition,
  type DirectCompositionDraft,
} from "../src/engine/directComposition.ts";
import { inspectDirectComposition } from "../src/engine/layoutInspector.ts";
import { initializeProject } from "../src/engine/projectTemplates.ts";
import { buildJobFrame } from "../src/engine/frameDesign.ts";
import { injectCinemaKit } from "../src/engine/cinemaKit.ts";
import { buildFallbackComposition } from "../src/engine/fallbackComposition.ts";

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

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
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
    expect(fallback.html).toContain("layout-split");
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
    )).toThrow(/3-5 distinct shots/);
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

  it("routes the high-leverage storyboard pass to reasoning-enabled GLM 5.2", async () => {
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
      maxTokens: 16_384,
      thinkingMode: "high",
      model: "z-ai/glm-5.2",
    });
    expect(options.responseFormat).toMatchObject({
      type: "json_schema",
      json_schema: { name: "sequences_storyboard" },
    });
  });

  it("uses a separate storyboard model only when the operator explicitly configures one", async () => {
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
      maxTokens: 4_096,
      thinkingMode: "none",
    });
  });

  it("lets operators keep the primary authoring model for storyboard work", async () => {
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
      maxTokens: 4_096,
      thinkingMode: "none",
    });
    expect((complete.mock.calls[0]?.[1] as { model?: string }).model).toBeUndefined();
  });

  it("retries the storyboard pass through a transient provider timeout", async () => {
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

  it("surfaces an actionable message when storyboard timeouts exhaust retries", async () => {
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
    expect(complete).toHaveBeenCalledTimes(3);
  }, 15_000);

  it("does not retry a genuine content error from the storyboard pass", async () => {
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
    expect(complete).toHaveBeenCalledTimes(1);
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
    expect(options?.maxTokens).toBe(10_240);
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
    expected.html = injectCinemaKit(expected.html);
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
    expect(result.draft.html).toBe(injectCinemaKit(initial.html));
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
    expect(result.draft.html).toBe(injectCinemaKit(initial.html));
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
