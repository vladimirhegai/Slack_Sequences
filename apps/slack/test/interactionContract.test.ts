import { describe, expect, it, vi } from "vitest";
import type { AgentProvider, CompleteOptions } from "@sequences/platform/providers";
import {
  parseInteractionPlan,
  validateInteractionContract,
  type InteractionIntentV1,
  type SpatialIntentV1,
} from "../src/engine/interactionContract.ts";
import { tryDirectInteractionRevision } from "../src/engine/directRevisionRouter.ts";
import type { DirectCompositionDraft, DirectScene } from "../src/engine/directComposition.ts";

const interaction: InteractionIntentV1 = {
  version: 1,
  id: "cta-click",
  sceneId: "cta",
  cursorId: "pointer",
  targetPart: "primary-action",
  action: "click",
  startSec: 4.4,
  arriveSec: 5.1,
  pressSec: 5.25,
  releaseSec: 5.4,
  holdUntilSec: 5.8,
  from: "frame:bottom-right",
  path: "human",
  bend: -0.12,
  ease: "power3.out",
  aimX: 0.56,
  aimY: 0.48,
  offsetX: 3,
  offsetY: -2,
  hitInsetPx: 4,
  feedback: "press-ripple",
  ripplePart: "primary-action-ripple",
};

const spatialIntent: SpatialIntentV1 = {
  version: 1,
  focalPart: "primary-action",
  composition: "Quiet centered resolve with supporting proof below",
  frameAnchor: "frame:center",
  relationships: ["primary action remains centered over proof"],
};

function scene(): DirectScene {
  return {
    id: "cta",
    title: "Close",
    purpose: "Invite action",
    startSec: 4,
    durationSec: 2,
    spatialIntent,
    interactions: [interaction],
  };
}

function html(intent = interaction): string {
  return `<!doctype html><html><head>
<script src="gsap.min.js"></script>
<script src="sequences-interactions.v1.js"></script>
</head><body>
<main id="root" data-composition-id="test" data-width="800" data-height="600" data-duration="6">
<section id="cta" class="scene clip" data-scene="cta" data-start="4" data-duration="2" data-track-index="1">
  <div data-camera-world><button data-part="primary-action">Go</button></div>
  <div data-camera-overlay>
    <svg data-cursor-id="pointer" data-cursor-hotspot-x="0.1" data-cursor-hotspot-y="0.1"></svg>
    <div data-part="primary-action-ripple"></div>
  </div>
</section>
</main>
<script type="application/json" id="sequences-interactions">${
    JSON.stringify({ version: 1, interactions: [intent] })
  }</script>
<script>const tl=gsap.timeline({paused:true});SequencesInteractions.compile(tl,document.getElementById("root"));window.__timelines["test"]=tl;</script>
</body></html>`;
}

describe("interaction contract", () => {
  it("parses semantic cursor intent without canvas endpoint coordinates", () => {
    const result = parseInteractionPlan(html());
    expect(result.errors).toEqual([]);
    expect(result.plan?.interactions[0]).toMatchObject({
      id: "cta-click",
      targetPart: "primary-action",
      path: "human",
      aimX: 0.56,
    });
  });

  it("rejects timing outside the shot and missing stable parts", () => {
    const escaped = { ...interaction, holdUntilSec: 6.5, targetPart: "missing" };
    const result = validateInteractionContract(html(escaped), [{
      ...scene(),
      interactions: [escaped],
    }], 6);
    expect(result.errors).toContain('interaction "cta-click" timing escapes scene "cta"');
    expect(result.errors).toContain(
      'interaction "cta-click" target part "missing" is absent',
    );
  });

  it("routes a bounded cursor revision through Flash and patches only intent JSON", async () => {
    const complete = vi.fn(async (_prompt: string, _options?: CompleteOptions) => JSON.stringify({
      mode: "interaction-patch",
      interactionId: "cta-click",
      changes: {
        path: "arc",
        bend: 0.2,
        aimX: 0.5,
      },
    }));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const current: DirectCompositionDraft = {
      storyboard: [scene()],
      html: html(),
    };
    const revised = await tryDirectInteractionRevision(
      provider,
      "Make the cursor arc into the center of the button",
      current,
    );
    expect(revised?.storyboard[0]?.interactions?.[0]).toMatchObject({
      path: "arc",
      bend: 0.2,
      aimX: 0.5,
    });
    expect(parseInteractionPlan(revised!.html).plan?.interactions[0]).toMatchObject({
      path: "arc",
      bend: 0.2,
      aimX: 0.5,
    });
    expect((complete.mock.calls[0]?.[1] as { model?: string }).model)
      .toBe("deepseek/deepseek-v4-flash");
  });

  it("falls back instead of allowing Flash to change interaction structure", async () => {
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete: async () => '{"mode":"structural"}',
    };
    await expect(tryDirectInteractionRevision(
      provider,
      "Move the whole product surface and redesign the click",
      { storyboard: [scene()], html: html() },
    )).resolves.toBeNull();
  });
});
