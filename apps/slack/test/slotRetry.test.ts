/**
 * Slot persistence across paid attempts (Sentinel, 2026-07-07): attempt 1's
 * scene-addressable slot state used to die with its loop iteration, so every
 * recovery attempt re-gambled the whole document (persisted ledgers showed
 * slotCalls: 0 on retry-heavy runs). This suite proves the retry rung: while
 * the retry baseline is still the slot assembly, a rejected attempt re-authors
 * ONLY the failing scenes before any whole-document patch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentProvider } from "@sequences/platform/providers";
import type { RetrievedSkillContext } from "../src/agent/skillContext.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { requestDirectComposition } from "../src/engine/compositionRunner.ts";
import { inspectDirectComposition } from "../src/engine/layoutInspector.ts";
import { initializeProject } from "../src/engine/projectTemplates.ts";

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

const inspectMock = vi.mocked(inspectDirectComposition);

const roots: string[] = [];

beforeEach(() => {
  vi.stubEnv("SLACK_SEQUENCES_HEDGED_REQUESTS", "0");
  vi.stubEnv("SLACK_SEQUENCES_SOURCE_RESCUE_MODEL", "none");
  vi.stubEnv("SLACK_SEQUENCES_SHARED_PLANNING_CACHE", "0");
  inspectMock.mockReset();
});

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function projectDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-slot-retry-"));
  roots.push(dir);
  initializeProject(dir, { name: "Relay", brandName: "Relay", seedScreenshot: true });
  return dir;
}

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

const htmlSlot = (id: string, body: string): string =>
  `<scene_html id="${id}">${body}</scene_html>`;
const scriptSlot = (id: string, body: string): string =>
  `<scene_script id="${id}">${body}</scene_script>`;

const FULL_SLOT_RESPONSE = [
  "<film_style>",
  ".stage{background:#0b0d12;color:#fff}.hero{font-size:96px}",
  "</film_style>",
  htmlSlot("hero-open", '<div class="hero" data-part="headline">Ship faster</div>'),
  scriptSlot(
    "hero-open",
    'tl.from("[data-part=\\"headline\\"]", { y: 40, opacity: 0, duration: 0.6 }, 0.2);',
  ),
  htmlSlot("cta-close", '<div class="hero" data-part="cta">Try it</div>'),
  scriptSlot(
    "cta-close",
    'tl.from("[data-part=\\"cta\\"]", { scale: 0.9, opacity: 0, duration: 0.5 }, 4.2);',
  ),
].join("\n");

const CTA_REPAIR_RESPONSE = [
  htmlSlot("cta-close", '<div class="hero" data-part="cta">Try it now — fixed</div>'),
  scriptSlot(
    "cta-close",
    'tl.from("[data-part=\\"cta\\"]", { scale: 0.92, opacity: 0, duration: 0.5 }, 4.2);',
  ),
].join("\n");

const badQa = {
  ok: false,
  strictOk: false,
  samples: [0, 2, 4, 6, 8],
  issues: [],
  errors: ['browser_runtime: TypeError: boom while animating scene "cta-close"'],
  warnings: [],
};

const cleanQa = {
  ok: true,
  strictOk: true,
  samples: [0, 2, 4, 6, 8],
  issues: [],
  errors: [],
  warnings: [],
};

describe("scene-slot retry rung — slots persist across paid attempts", () => {
  it("repairs only the failing scene on attempt 2 instead of a whole-document patch", async () => {
    const dir = projectDir();
    const complete = vi.fn()
      // Attempt 1: the full scene-addressable authoring pass.
      .mockResolvedValueOnce(FULL_SLOT_RESPONSE)
      // Attempt 1's within-attempt browser repair seam: an unusable response —
      // the seam keeps the previous draft and the attempt is browser-rejected.
      .mockResolvedValueOnce("no slots here")
      // Attempt 2: the NEW slot-retry rung re-requests only cta-close.
      .mockResolvedValueOnce(CTA_REPAIR_RESPONSE);
    inspectMock
      .mockResolvedValueOnce(badQa as never)
      .mockResolvedValue(cleanQa as never);
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
      skills: SKILLS,
      lockedStoryboard: [scene("hero-open", 0), scene("cta-close", 4)],
    });

    expect(result.attempts).toBe(2);
    // The repaired scene shipped; the untouched scene stayed byte-stable.
    expect(result.draft.html).toContain("Try it now — fixed");
    expect(result.draft.html).toContain("Ship faster");
    // The attempt-2 call was scene-scoped — not a patches_json whole-doc patch.
    expect(complete).toHaveBeenCalledTimes(3);
    const retryPrompt = String(complete.mock.calls[2]?.[0]);
    expect(retryPrompt).toContain('<previous_scene_html id="cta-close">');
    expect(retryPrompt).not.toContain('<previous_scene_html id="hero-open">');
    expect(retryPrompt).not.toContain("patches_json");
    // The run summary records the strategy so ledgers can count the rung.
    const summary = JSON.parse(
      fs.readFileSync(path.join(dir, "planning", "author-run.json"), "utf8"),
    ) as { strategyChanges?: string[] };
    expect(summary.strategyChanges).toContain("slot-retry:cta-close");
  });

  it("falls through to the whole-document ladder when no finding names a scene", async () => {
    const dir = projectDir();
    const filmLevelQa = {
      ...badQa,
      errors: ["browser_runtime: TypeError: boom with no scene name at all"],
    };
    const complete = vi.fn()
      .mockResolvedValueOnce(FULL_SLOT_RESPONSE)
      // Attempt 2 must be a whole-document patch (the rung finds nothing
      // scene-attributable and never spends a call).
      .mockResolvedValueOnce(
        `<patches_json>${JSON.stringify([{ search: "Try it", replace: "Try it today" }])}</patches_json>`,
      );
    inspectMock
      .mockResolvedValueOnce(filmLevelQa as never)
      .mockResolvedValue(cleanQa as never);
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
      skills: SKILLS,
      lockedStoryboard: [scene("hero-open", 0), scene("cta-close", 4)],
    });

    expect(result.attempts).toBe(2);
    expect(result.draft.html).toContain("Try it today");
    const patchPrompt = String(complete.mock.calls[1]?.[0]);
    expect(patchPrompt).toContain('"patches"');
    expect(patchPrompt).not.toContain("<previous_scene_html");
  });
});
