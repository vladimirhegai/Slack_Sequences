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
import { initializeProject } from "../src/engine/projectTemplates.ts";
import { buildJobFrame } from "../src/engine/frameDesign.ts";

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
});

function projectDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-direct-test-"));
  roots.push(dir);
  initializeProject(dir, { name: "Relay", brandName: "Relay", seedScreenshot: true });
  return dir;
}

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

  it("recovers a bare or fenced storyboard array when the model omits the wrapper", () => {
    const plan = storyboard();
    // Flash-tier planners routinely ignore the <storyboard_json> wrapper.
    expect(parseStoryboardResponse(JSON.stringify(plan))).toEqual(plan);
    expect(
      parseStoryboardResponse("Here is the plan:\n```json\n" + JSON.stringify(plan) + "\n```"),
    ).toEqual(plan);
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

  it("uses Flash thinking for the bounded storyboard pass", async () => {
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
    };
    expect(options).toMatchObject({
      maxTokens: 3_072,
      thinkingMode: "medium",
      model: "deepseek/deepseek-v4-flash",
    });
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
    expect(secondOptions?.model).toBeUndefined();
  });

  it("allows exactly one model repair after deterministic validation feedback", async () => {
    const dir = projectDir();
    const invalid = draft();
    invalid.html = invalid.html.replace("const tl =", "const noise = Math.random(); const tl =");
    const complete = vi.fn()
      .mockResolvedValueOnce(response(invalid))
      .mockResolvedValueOnce(patchResponse(
        "const noise = Math.random(); const tl =",
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
    expect(complete.mock.calls[1]?.[0]).toContain("Math.random is not deterministic");
    expect(complete.mock.calls[1]?.[0]).toContain("<patches_json>");
    expect((complete.mock.calls[1]?.[1] as { maxTokens?: number }).maxTokens).toBe(4_096);
  });

  it("allows at most two bounded model repairs", async () => {
    const dir = projectDir();
    const invalid = draft();
    invalid.html = invalid.html.replace("const tl =", "const noise = Math.random(); const tl =");
    const complete = vi.fn()
      .mockResolvedValueOnce(response(invalid))
      .mockResolvedValueOnce(patchResponse("Math.random()", "Date.now()"))
      .mockResolvedValueOnce(patchResponse("Math.random()", "0"));
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
    expect((complete.mock.calls[1]?.[1] as { model?: string }).model).toBeUndefined();
    expect((complete.mock.calls[2]?.[1] as { model?: string }).model)
      .toBe("deepseek/deepseek-v4-flash");
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
    expect(fs.readFileSync(path.join(dir, "composition", "STORYBOARD.md"), "utf8"))
      .toContain("The trace arrives");

    expect(undoDirectComposition(dir)).toBe(true);
    expect(loadDirectComposition(dir).manifest.revision).toBe(1);
    expect(loadDirectComposition(dir).html).toContain("#8b5cf6");
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
