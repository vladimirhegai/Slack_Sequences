import { describe, expect, it } from "vitest";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { resolveComponentPlan, parseComponentPlan } from "../src/engine/componentContract.ts";
import { resolveCameraPlan, parseCameraPlan } from "../src/engine/cameraContract.ts";
import { resolveCutPlan, parseCutPlan } from "../src/engine/cutContract.ts";
import { resolveTimeRampPlan, parseTimeRampPlan } from "../src/engine/timeRamp.ts";
import { resolveFxPlan, parseFxPlan } from "../src/engine/fxContract.ts";
import {
  normalizeStoryboardInteractionIntents,
  parseInteractionPlan,
} from "../src/engine/interactionContract.ts";

/**
 * Island round-trip invariant (the md-audit-probe-1 lesson).
 *
 * Every host contract injects a JSON island from `resolve*Plan(...)` and its
 * `validate*Contract` gate rejects the film when `JSON.stringify(parse(island))`
 * differs from `JSON.stringify(resolve(...))`. Several parsers RECONSTRUCT the
 * plan field-by-field (`...(x ? { x } : {})`), so a field the resolver EMITS but
 * the parser forgets makes the two strings diverge on every attempt — with NO
 * deterministic repair, because re-injecting the canonical island reproduces the
 * mismatch. That is exactly how the MD3/MD6 beat `style` field silently blocked
 * every styled film (parseComponentPlan dropped it): the class was only caught by
 * a paid live probe, never by construction.
 *
 * This file closes that gap: for each reconstructing island, resolve a MAXIMAL
 * plan (every optional field populated), serialize it, parse it back, and assert
 * byte-identity — the exact comparison the production gate performs. A new
 * optional field that a parser forgets fails here, in unit tests, for free.
 */

function island(id: string, plan: unknown): string {
  return `<script type="application/json" id="${id}">${JSON.stringify(plan)}</script>`;
}

/** Assert resolve → serialize → parse is byte-identical (the gate's own check). */
function assertRoundTrip<T>(
  id: string,
  resolved: T,
  parse: (html: string) => { plan?: T; errors: string[] },
): void {
  const serialized = JSON.stringify(resolved);
  const parsed = parse(island(id, resolved));
  expect(parsed.errors, `${id}: parse reported errors`).toEqual([]);
  expect(
    JSON.stringify(parsed.plan),
    `${id}: a resolved field was dropped on parse (emit/parse asymmetry — the ` +
      `md-audit-probe-1 class). Add the field to the island parser.`,
  ).toBe(serialized);
}

describe("island round-trip invariant — components (every optional beat field)", () => {
  // Every optional field a ResolvedComponentBeatV1 can carry beyond the always-
  // present id/component/kind/startSec/endSec/ease. Adding a field to the
  // resolver means adding it here AND to parseComponentPlan.
  const OPTIONAL_BEAT_FIELDS = ["text", "value", "item", "toState", "morphTo", "style"] as const;

  const maximalScene: DirectScene = {
    id: "hero",
    title: "hero",
    purpose: "exercise every optional beat field",
    startSec: 0,
    durationSec: 14,
    components: [
      { version: 1, id: "hero-copy", kind: "headline" },
      { version: 1, id: "sub-copy", kind: "headline" },
      { version: 1, id: "metric", kind: "stat-card" },
      { version: 1, id: "orders", kind: "table" },
      { version: 1, id: "alerts", kind: "toggle" },
      { version: 1, id: "finder", kind: "search" },
      { version: 1, id: "palette", kind: "command-palette" },
      { version: 1, id: "ship-toast", kind: "toast" },
    ],
    beats: [
      // text + style (assemble)
      { version: 1, id: "b-type", sceneId: "hero", component: "hero-copy", kind: "type", atSec: 0.5, durationSec: 1.2, text: "SHIPFAST", style: "assemble" },
      // text (swap channel)
      { version: 1, id: "b-swap", sceneId: "hero", component: "sub-copy", kind: "swap", atSec: 2.5, durationSec: 0.6, text: "from shipped to shown" },
      // value + a NON-default ease (seqGlide != the count default seqImpulse)
      { version: 1, id: "b-count", sceneId: "hero", component: "metric", kind: "count", atSec: 3.5, durationSec: 1, value: 99, ease: "seqGlide" },
      // item
      { version: 1, id: "b-select", sceneId: "hero", component: "orders", kind: "select", atSec: 5, durationSec: 0.4, item: 2 },
      // toState
      { version: 1, id: "b-state", sceneId: "hero", component: "alerts", kind: "set-state", atSec: 6, durationSec: 0.4, toState: "on" },
      // morphTo
      { version: 1, id: "b-morph", sceneId: "hero", component: "finder", kind: "morph", atSec: 7, durationSec: 0.8, morphTo: "palette" },
      // style (open pop) on a compact kind
      { version: 1, id: "b-open", sceneId: "hero", component: "ship-toast", kind: "open", atSec: 8.5, durationSec: 0.5, style: "pop" },
      // style (highlight underline)
      { version: 1, id: "b-hl", sceneId: "hero", component: "metric", kind: "highlight", atSec: 9.5, durationSec: 0.8, style: "underline" },
    ],
  };

  it("resolves every optional field into the island", () => {
    const resolved = resolveComponentPlan([maximalScene]);
    const serialized = JSON.stringify(resolved);
    for (const field of OPTIONAL_BEAT_FIELDS) {
      expect(serialized, `fixture must exercise the optional beat field "${field}"`)
        .toContain(`"${field}"`);
    }
    expect(serialized).toContain('"ease"');
  });

  it("round-trips byte-identically (resolve → serialize → parse)", () => {
    assertRoundTrip("sequences-components", resolveComponentPlan([maximalScene]), parseComponentPlan);
  });

  it("survives every style variant across type/open/highlight", () => {
    for (const [kind, comp, style] of [
      ["type", "hero-copy", "rise"],
      ["type", "hero-copy", "pop"],
      ["type", "hero-copy", "assemble"],
      ["open", "ship-toast", "pop"],
      ["highlight", "metric", "sweep"],
      ["highlight", "metric", "underline"],
    ] as const) {
      const scene: DirectScene = {
        ...maximalScene,
        beats: [{ version: 1, id: "b", sceneId: "hero", component: comp, kind, atSec: 1, durationSec: 1, style, ...(kind === "type" ? { text: "SHIP" } : {}) }],
      };
      const resolved = resolveComponentPlan([scene]);
      expect(resolved.scenes[0]?.beats[0]?.style, `${kind}:${style} should resolve`).toBe(style);
      assertRoundTrip("sequences-components", resolved, parseComponentPlan);
    }
  });
});

describe("island round-trip invariant — camera / cut / time / fx", () => {
  it("camera plan round-trips every optional segment field", () => {
    const scene: DirectScene = {
      id: "world",
      title: "world",
      purpose: "camera",
      startSec: 0,
      durationSec: 10,
      camera: {
        version: 1,
        depth3d: true,
        path: [
          { version: 1, move: "pan", fromRegion: "intro", toRegion: "metrics", zoom: 1.2, startSec: 0.5, durationSec: 1.2, ease: "seqSwoosh" },
          { version: 1, move: "track-to-anchor", toPart: "hero-stat", startSec: 2, durationSec: 1, focus: { part: "hero-stat", blurMaxPx: 6 } },
          { version: 1, move: "orbit", toRegion: "logo", arcDeg: 28, startSec: 4, durationSec: 1.5 },
          { version: 1, move: "push-in", toRegion: "logo", startSec: 6, durationSec: 1.2, focus: { depth: 0.4, blurMaxPx: 8 } },
        ],
      },
    };
    assertRoundTrip("sequences-camera", resolveCameraPlan([scene]), parseCameraPlan);
  });

  it("cut plan round-trips swipe (axis+cover) and morph (focal parts + shape hints)", () => {
    const scenes: DirectScene[] = [
      { id: "a", title: "a", purpose: "p", startSec: 0, durationSec: 4, cut: { version: 1, style: "swipe", axis: "right", cover: true, travelPx: 200, exitSec: 0.3, entrySec: 0.5 } },
      { id: "b", title: "b", purpose: "p", startSec: 4, durationSec: 4, cut: { version: 1, style: "morph", focalPartOut: "pill", focalPartIn: "bar", shapeOut: "pill", shapeIn: "bar" } },
      { id: "c", title: "c", purpose: "p", startSec: 8, durationSec: 4 },
    ];
    assertRoundTrip("sequences-cuts", resolveCutPlan(scenes), parseCutPlan);
  });

  it("time-ramp plan round-trips", () => {
    const scenes: DirectScene[] = [
      { id: "a", title: "a", purpose: "p", startSec: 0, durationSec: 4 },
      { id: "b", title: "b", purpose: "p", startSec: 4, durationSec: 6, timeRamp: { version: 1, atSec: 6, slowTo: 0.35, holdSec: 0.6, recoverSec: 0.9 } },
    ];
    assertRoundTrip("sequences-time", resolveTimeRampPlan(scenes), parseTimeRampPlan);
  });

  it("fx plan round-trips grade-shift, underline draw, sweep/glow, and connector", () => {
    const scenes: DirectScene[] = [
      {
        id: "turn",
        title: "turn",
        purpose: "p",
        startSec: 0,
        durationSec: 8,
        gradeShift: { version: 1, atSec: 3, toGrade: "warm", fromPart: "hero-stat" },
        components: [{ version: 1, id: "hero-stat", kind: "stat-card" }],
        beats: [
          { version: 1, id: "count", sceneId: "turn", component: "hero-stat", kind: "count", atSec: 1.5, durationSec: 1, value: 99 },
          { version: 1, id: "underline", sceneId: "turn", component: "hero-stat", kind: "highlight", atSec: 5, durationSec: 0.8, style: "underline" },
        ],
        camera: { version: 1, path: [{ version: 1, move: "pan", toRegion: "metrics", startSec: 0.5, durationSec: 1 }] },
        moments: [{ version: 1, id: "m", sceneId: "turn", atSec: 2.6, title: "metric lands", visualState: "x", change: "y", motionIntent: "ui-state", importance: "primary" }],
      },
      // A second scene WITHOUT a sweep: its camera arrival still earns a
      // connector, so the fixture keeps exercising the "region" field even though
      // the sweep-holding "turn" scene now skips its own connector (T3 caps).
      {
        id: "reveal",
        title: "reveal",
        purpose: "p",
        startSec: 8,
        durationSec: 6,
        camera: { version: 1, path: [{ version: 1, move: "push-in", toRegion: "board", startSec: 8.5, durationSec: 1.2, zoom: 1.3 }] },
      },
    ];
    // parseFxPlan is an identity parse, but the invariant guards against a future
    // reconstruction ever dropping toGrade / region / target.
    const fx = resolveFxPlan(scenes);
    for (const field of ["toGrade", "region", "target"] as const) {
      expect(JSON.stringify(fx), `fx fixture must exercise "${field}"`).toContain(`"${field}"`);
    }
    assertRoundTrip("sequences-fx", fx, parseFxPlan);
  });
});

describe("island round-trip invariant — interactions (the reconstructing parser the invariant missed)", () => {
  // `parseInteraction` rebuilds every field with `...(x !== undefined ? { x } : {})`
  // spreads — the exact emit/parse-asymmetry shape that dropped beat `style`. It
  // was NOT covered by this invariant. Every OPTIONAL field an InteractionIntentV1
  // can carry beyond the always-present version/id/sceneId/cursorId/targetPart/
  // action/startSec/arriveSec/from/path/aimX/aimY/feedback. Adding a field to the
  // type + emit normalizer means adding it here AND to parseInteraction.
  const OPTIONAL_INTERACTION_FIELDS = [
    "pressSec", "releaseSec", "holdUntilSec", "bend", "ease", "offsetX", "offsetY",
    "item", "hitInsetPx", "ripplePart", "dragTargetPart", "cursorScale", "targetScale", "waypoints",
  ] as const;

  // A maximal drag intent — drag needs press timing + dragTargetPart, press-ripple
  // feedback derives ripplePart, a custom path carries waypoints — so ONE intent,
  // run through the REAL emit normalizer, exercises every optional field. Values
  // sit inside the normalizer's clamp ranges so nothing is altered.
  const maximalRawIntent = {
    version: 1,
    id: "drag-card",
    sceneId: "s",
    cursorId: "pointer",
    targetPart: "card",
    item: 2,
    action: "drag",
    startSec: 0.5,
    arriveSec: 1,
    pressSec: 1.2,
    releaseSec: 1.7,
    holdUntilSec: 2.1,
    from: "part:tray",
    path: "custom",
    waypoints: [{ x: 0.3, y: 0.35 }, { x: 0.6, y: 0.5 }],
    bend: 0.2,
    ease: "power2.out",
    aimX: 0.5,
    aimY: 0.5,
    offsetX: 8,
    offsetY: -6,
    hitInsetPx: 4,
    feedback: "press-ripple",
    ripplePart: "card-ripple",
    dragTargetPart: "slot",
    cursorScale: 0.8,
    targetScale: 0.9,
  };

  const normalized = normalizeStoryboardInteractionIntents([maximalRawIntent], {
    sceneId: "s",
    startSec: 0,
    durationSec: 8,
  });

  it("the emit normalizer preserves every optional field (airtight coverage)", () => {
    expect(normalized).toHaveLength(1);
    const serialized = JSON.stringify(normalized[0]);
    for (const field of OPTIONAL_INTERACTION_FIELDS) {
      expect(serialized, `emit normalizer must preserve the optional field "${field}"`)
        .toContain(`"${field}"`);
    }
  });

  it("round-trips byte-identically (emit → island → parseInteractionPlan)", () => {
    // The exact island the host injects: {version:1, interactions:[...]}.
    assertRoundTrip("sequences-interactions", { version: 1, interactions: normalized }, parseInteractionPlan);
  });
});
