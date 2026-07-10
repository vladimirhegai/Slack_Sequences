/**
 * Scene-scoped storyboard findings repair (Sentinel, 2026-07-07): the storyboard
 * analogue of the author-stage slot retry. When a rejected storyboard's EVERY
 * blocking finding maps to a named shot, re-plan ONLY those shots against the
 * LOCKED remainder in one bounded call and re-validate the merged plan through
 * the full gate — replacing the cost of a whole ~6-min re-plan. This suite
 * proves the gating (film-level findings and "every shot" defer to the ladder),
 * the timing lock (a repaired shot keeps its id/startSec/durationSec), and the
 * strict fall-through (an incomplete subset never looks like success).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentProvider } from "@sequences/platform/providers";
import type { DirectScene } from "../src/engine/directComposition.ts";
import {
  StoryboardValidationError,
  repairStoryboardScenesForFindings,
} from "../src/engine/compositionRunner.ts";

afterEach(() => vi.unstubAllEnvs());

/** A fully-valid 3s shot (all required text fields); 3 of these total 9s, below
 *  the 10s+ moment/framing/energy thresholds, so a bare plan validates clean. */
function shot(id: string, startSec: number, overrides: Partial<DirectScene> = {}): DirectScene {
  return {
    id,
    title: id,
    purpose: `show ${id}`,
    incomingIdea: `${id} idea entering`,
    foreground: `${id} hero composition`,
    background: `${id} atmospheric layer`,
    cameraIntent: `${id} framing intent`,
    continuityAnchor: `${id} anchor across the cut`,
    outgoingCut: `hard cut out of ${id}`,
    startSec,
    durationSec: 3,
    ...overrides,
  };
}

function makeProvider(complete: ReturnType<typeof vi.fn>): AgentProvider {
  return {
    id: "openrouter-api",
    label: "test storyboard",
    kind: "api",
    detect: async () => ({ available: true, detail: "test" }),
    complete,
  };
}

const rawScene = (scene: DirectScene): Record<string, unknown> => {
  const { sentinelNormalizations: _n, ...rest } = scene;
  return rest as unknown as Record<string, unknown>;
};
const subsetResponse = (...scenes: Record<string, unknown>[]): string =>
  `<storyboard_json>${JSON.stringify(scenes)}</storyboard_json>`;

const LOCKED = (): DirectScene[] => [
  shot("problem-signal", 0),
  // The rejected shot: missing `foreground` → "shot ... is missing foreground".
  shot("product-proof", 3, { foreground: "" }),
  shot("brand-close", 6),
];
const REJECTED_FINDING = 'shot "product-proof" is missing foreground';

describe("StoryboardValidationError", () => {
  it("carries the raw finding array so a finding with '; ' stays one element", () => {
    const finding = 'components/complexity: scene "x" declares 3 components; keep <= 2';
    const error = new StoryboardValidationError([finding, 'shot "y" is missing foreground'], []);
    expect(error.findings).toEqual([finding, 'shot "y" is missing foreground']);
    expect(error.message).toContain(finding); // still joined into the message
  });
});

describe("repairStoryboardScenesForFindings — gating", () => {
  it("defers to the full ladder when any finding is film-level (never calls the model)", async () => {
    const complete = vi.fn();
    const result = await repairStoryboardScenesForFindings(
      makeProvider(complete),
      { brief: "b", requirements: {} },
      LOCKED(),
      // A camera/energy finding names no shot → the "__film__" bucket.
      ["a 12s film has no high-energy peak — no whip or orbit", REJECTED_FINDING],
    );
    expect(result).toBeUndefined();
    expect(complete).not.toHaveBeenCalled();
  });

  it("defers when the findings name EVERY shot (no locked remainder to plan against)", async () => {
    const complete = vi.fn();
    const result = await repairStoryboardScenesForFindings(
      makeProvider(complete),
      { brief: "b", requirements: {} },
      LOCKED(),
      [
        'shot "problem-signal" is missing background',
        'shot "product-proof" is missing foreground',
        'shot "brand-close" is missing cameraIntent',
      ],
    );
    expect(result).toBeUndefined();
    expect(complete).not.toHaveBeenCalled();
  });

  it("is disabled by the kill switch", async () => {
    vi.stubEnv("SLACK_SEQUENCES_STORYBOARD_SCENE_REPAIR", "0");
    const complete = vi.fn();
    const result = await repairStoryboardScenesForFindings(
      makeProvider(complete),
      { brief: "b", requirements: {} },
      LOCKED(),
      [REJECTED_FINDING],
    );
    expect(result).toBeUndefined();
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("repairStoryboardScenesForFindings — convergence", () => {
  it("re-plans only the named shot and adopts the merged plan when it validates", async () => {
    const repaired = { ...rawScene(shot("product-proof", 3)), foreground: "restored product hero" };
    const complete = vi.fn().mockResolvedValueOnce(subsetResponse(repaired));
    const result = await repairStoryboardScenesForFindings(
      makeProvider(complete),
      { brief: "b", requirements: {} },
      LOCKED(),
      [REJECTED_FINDING],
    );
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
    const fixed = result!.find((scene) => scene.id === "product-proof")!;
    expect(fixed.foreground).toBe("restored product hero");
    // The locked remainder is byte-stable.
    expect(result!.find((s) => s.id === "problem-signal")!.foreground).toBe(
      "problem-signal hero composition",
    );
    // The prompt was scene-scoped: it named the shot + its finding and asked for
    // exactly one corrected shot object.
    const prompt = String(complete.mock.calls[0]?.[0]);
    expect(prompt).toContain('shot "product-proof"');
    expect(prompt).toContain("is missing foreground");
    expect(prompt).toContain("JSON ARRAY of exactly these 1");
  });

  it("forces the locked timing envelope even if the model retimes/resizes the shot", async () => {
    // The model returns a fixed shot but tries to move it to 4s / stretch to 5s.
    const repaired = {
      ...rawScene(shot("product-proof", 4, { durationSec: 5 })),
      foreground: "restored product hero",
    };
    const complete = vi.fn().mockResolvedValueOnce(subsetResponse(repaired));
    const result = await repairStoryboardScenesForFindings(
      makeProvider(complete),
      { brief: "b", requirements: {} },
      LOCKED(),
      [REJECTED_FINDING],
    );
    expect(result).toBeDefined();
    const fixed = result!.find((scene) => scene.id === "product-proof")!;
    expect(fixed.startSec).toBe(3); // locked, not 4
    expect(fixed.durationSec).toBe(3); // locked, not 5 → film stays contiguous
    expect(result!.find((s) => s.id === "brand-close")!.startSec).toBe(6);
  });

  it("falls back (undefined) when the subset is incomplete — a partial response is not success", async () => {
    // The model returns a DIFFERENT shot id, so the requested one is missing.
    const complete = vi
      .fn()
      .mockResolvedValueOnce(subsetResponse({ ...rawScene(shot("wrong-id", 3)), foreground: "x" }));
    const result = await repairStoryboardScenesForFindings(
      makeProvider(complete),
      { brief: "b", requirements: {} },
      LOCKED(),
      [REJECTED_FINDING],
    );
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
  });

  it("attributes a finding that itself contains '; ' to its named shot (not __film__)", async () => {
    // `components/complexity` findings carry "; " INSIDE ("… build them; keep
    // <= 2 (…)"). Splitting the joined message fragments the finding into a
    // scene-less "keep <= 2" piece that routes to __film__ and wrongly cancels
    // the repair (the reprobe-econ-1 defect). The raw finding array must not.
    const complete = vi
      .fn()
      .mockResolvedValueOnce(
        subsetResponse({ ...rawScene(shot("product-proof", 3)), foreground: "leaner product hero" }),
      );
    const result = await repairStoryboardScenesForFindings(
      makeProvider(complete),
      { brief: "b", requirements: {} },
      LOCKED(),
      [
        'components/complexity: scene "product-proof" (3.0s) declares 3 components — a viewer ' +
          "cannot read more than 2 product surfaces in that window and the author cannot build " +
          "them; keep <= 2 (drop the set dressing)",
      ],
    );
    // The model WAS consulted → the "; " finding attributed to the shot, not __film__.
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result?.find((scene) => scene.id === "product-proof")?.foreground).toBe(
      "leaner product hero",
    );
  });

  it("falls back when the merged plan still fails the gate (duration-change out of scope)", async () => {
    // The ONLY way to fix this finding is more time, but the envelope is locked —
    // the repair cannot converge, so it defers to the full ladder.
    const beat = {
      version: 1,
      id: "long-copy",
      sceneId: "product-proof",
      component: "headline",
      kind: "type",
      atSec: 5.7, // finishes typing right at the 6s cut → far too little reading time
      text: "a very long headline sentence that needs several seconds to read on screen",
    };
    const locked = [
      shot("problem-signal", 0),
      shot("product-proof", 3, {
        components: [{ version: 1, id: "headline", kind: "headline" }],
        beats: [beat as never],
      }),
      shot("brand-close", 6),
    ];
    const repaired = subsetResponse({
      ...rawScene(locked[1]!),
      // The model returns it unchanged (it was told duration changes are out of scope).
    });
    const complete = vi.fn().mockResolvedValueOnce(repaired);
    const result = await repairStoryboardScenesForFindings(
      makeProvider(complete),
      { brief: "b", requirements: {} },
      locked,
      ['pacing/reading: scene "product-proof" beat "long-copy" finishes typing'],
    );
    expect(result).toBeUndefined();
  });
});
