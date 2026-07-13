import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  commitDirectComposition,
  type DirectCompositionDraft,
} from "../src/engine/directComposition.ts";
import { inspectDirectComposition } from "../src/engine/layoutInspector.ts";
import {
  parseLunaMotionIntent,
  type LunaMotionIntentV1,
} from "../src/engine/lunaRoute.ts";

const roots: string[] = [];
const fixture = path.join(import.meta.dirname, "fixtures", "luna-pointer-framing-20260713");

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function exactIncident(): { projectDir: string; draft: DirectCompositionDraft } {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-pointer-framing-"));
  roots.push(projectDir);
  fs.mkdirSync(path.join(projectDir, "assets"), { recursive: true });
  fs.copyFileSync(path.join(fixture, "dashboard.svg"), path.join(projectDir, "assets", "dashboard.svg"));
  const html = fs.readFileSync(path.join(fixture, "composition.html"), "utf8");
  const storyboardEnvelope = JSON.parse(
    fs.readFileSync(path.join(fixture, "storyboard.json"), "utf8"),
  ) as { storyboard: DirectCompositionDraft["storyboard"] };
  const storyboard = storyboardEnvelope.storyboard;
  const intent = parseLunaMotionIntent(
    fs.readFileSync(path.join(fixture, "motion-intent.json"), "utf8"),
    html,
    storyboard,
  );
  return {
    projectDir,
    draft: {
      html,
      storyboard,
      declaredPrimarySelectors: Object.fromEntries(
        intent.acts.map((act) => [act.sceneId, act.primarySelector]),
      ),
      declaredInteractions: declaredInteractions(intent),
    },
  };
}

function declaredInteractions(intent: LunaMotionIntentV1) {
  return intent.interactions.map((interaction, index) => ({
    id: `luna-interaction-${String(index + 1).padStart(2, "0")}`,
    actorSelector: interaction.actorSelector,
    targetSelector: interaction.targetSelector,
    resultSelector: interaction.resultSelector,
    startSec: interaction.startSec,
    actionSec: interaction.actionSec,
    settleSec: interaction.settleSec,
    beforeSampleSec: interaction.beforeSampleSec,
    afterSampleSec: interaction.afterSampleSec,
    observableStateChange: interaction.observableStateChange,
  }));
}

describe("Luna declared-intent browser authority", () => {
  it("hard-rejects the exact 2026-07-13 pointer miss and compounded modal transform", async () => {
    const { projectDir, draft } = exactIncident();
    expect(createHash("sha256").update(draft.html).digest("hex")).toBe(
      "b84498c675608635af939b4cc096805c63792929ddf55037caf14fd34a35eddc",
    );

    const qa = await inspectDirectComposition(projectDir, draft, { captureGuide: false });
    const modal = qa.loadBearingContainment?.find((entry) => entry.sceneId === "scene-07");
    expect(modal).toMatchObject({
      part: "#launch-dialog",
      detector: "declared-primary",
      found: true,
      requiredVisibleFraction: 0.85,
    });
    expect(modal?.visibleFraction).toBeCloseTo(0.642857, 4);
    expect(qa.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "spatial_focal_offframe",
        sceneId: "scene-07",
        selector: "#launch-dialog",
      }),
      expect.objectContaining({
        code: "interaction_target_miss",
        interactionId: "luna-interaction-04",
      }),
    ]));
    expect(qa.interactions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "luna-interaction-04",
        phase: "press",
        hit: false,
      }),
    ]));

    await expect(commitDirectComposition(projectDir, "Sequences", draft)).rejects.toThrow(
      /interaction_target_miss/,
    );
  }, 120_000);
});
