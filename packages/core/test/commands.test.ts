import { describe, expect, it } from "vitest";
import { applyCommand, CommandSchema, type Command } from "../src/commands.ts";
import { ProjectStore, type EventEntry } from "../src/store.ts";
import { createDefaultProject } from "../src/defaults.ts";
import type { Project } from "../src/schema.ts";
import { testAsset } from "./helpers.ts";

function freshProject(): Project {
  return createDefaultProject({ title: "Cmd Test", brandName: "Acme" });
}

/** Commands covering every type (except Batch, tested separately). */
const COMMANDS: Command[] = [
  {
    type: "AddScene",
    scene: {
      id: "extra",
      archetype: "hook-opener",
      durationFrames: 90,
      slots: { headline: "Another beat" },
      choreography: {},
      overrides: {},
    },
    index: 1,
  },
  { type: "RemoveScene", sceneId: "stat" },
  { type: "ReorderScene", sceneId: "sting", toIndex: 0 },
  { type: "SetSceneDuration", sceneId: "hook", durationFrames: 120 },
  { type: "SetSceneLayout", sceneId: "hook", layout: "left" },
  { type: "SetSlotContent", sceneId: "hook", slot: "headline", value: "New headline" },
  { type: "SetTransition", afterSceneId: "hook", kind: "fade" },
  { type: "SetMotionProfile", profile: "warm-startup" },
  { type: "SetEnabledExtensions", enabled: ["hook-opener", "logo-sting-cta", "crisp-saas"] },
  { type: "SetBrandColor", key: "accent", value: "#FF8800" },
  { type: "SetBrandFont", key: "display", value: "Georgia" },
  { type: "OverrideLayerBox", sceneId: "hook", layerId: "headline", box: { x: 200, y: 300 } },
  { type: "SwapMotion", sceneId: "hook", layerId: "headline", phase: "enter", primitive: "enter.scaleIn" },
  {
    type: "SetLayerOverride",
    sceneId: "hook",
    layerId: "subline",
    patch: { colorToken: "accent", enterDuration: "slow" },
  },
  { type: "SetChoreography", sceneId: "hook", choreography: { stagger: "loose" } },
  { type: "SetSceneCamera", sceneId: "hook", camera: { move: "pushIn", scale: "pop" } },
  { type: "AddAsset", asset: testAsset("shot", "assets/shot.png") },
];

describe("command API (T5)", () => {
  it("every command validates against CommandSchema (agents emit JSON)", () => {
    for (const cmd of COMMANDS) {
      const result = CommandSchema.safeParse(cmd);
      expect(result.success, `${cmd.type}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
    expect(CommandSchema.safeParse({ type: "Batch", commands: COMMANDS }).success).toBe(true);
  });

  it("apply → inverse is an exact roundtrip for every command", () => {
    for (const cmd of COMMANDS) {
      const before = freshProject();
      const { project: after, inverse } = applyCommand(before, cmd);
      const { project: roundtripped } = applyCommand(after, inverse);
      expect(roundtripped, cmd.type).toEqual(before);
      // applyCommand is pure: the input was not mutated.
      expect(before).toEqual(freshProject());
    }
  });

  it("Batch applies atomically and inverts in reverse order", () => {
    const before = freshProject();
    const batch: Command = {
      type: "Batch",
      commands: [
        { type: "SetSceneDuration", sceneId: "hook", durationFrames: 100 },
        { type: "SetSceneDuration", sceneId: "hook", durationFrames: 130 },
        { type: "SetSlotContent", sceneId: "hook", slot: "subline", value: null },
      ],
    };
    const { project: after, inverse } = applyCommand(before, batch);
    expect(after.scenes[0]!.durationFrames).toBe(130);
    expect(after.scenes[0]!.slots["subline"]).toBeUndefined();
    const { project: restored } = applyCommand(after, inverse);
    expect(restored).toEqual(before);
  });

  it("store: undo/redo, validation rejection, event journal", () => {
    const events: EventEntry[] = [];
    const store = new ProjectStore(freshProject(), (e) => events.push(e));

    // Invalid result (unknown profile) → rejected, state untouched.
    const bad = store.apply({ type: "SetMotionProfile", profile: "nope" });
    expect(bad.ok).toBe(false);
    expect(store.project.motionProfile).toBe("crisp-saas");
    expect(events).toHaveLength(0);

    const originalDuration = freshProject().scenes[0]!.durationFrames;
    const good = store.apply({ type: "SetSceneDuration", sceneId: "hook", durationFrames: 120 });
    expect(good.ok).toBe(true);
    expect(store.project.scenes[0]!.durationFrames).toBe(120);
    expect(store.canUndo).toBe(true);

    store.undo();
    expect(store.project.scenes[0]!.durationFrames).toBe(originalDuration);
    store.redo();
    expect(store.project.scenes[0]!.durationFrames).toBe(120);

    expect(events.map((e) => e.kind)).toEqual(["apply", "undo", "redo"]);
  });

  it("RemoveAsset roundtrips (and restores position), duplicates are rejected", () => {
    const seeded = freshProject();
    const a = testAsset("a", "assets/a.png");
    const b = testAsset("b", "assets/b.png");
    seeded.assets.push(a, b);
    const { project: after, inverse } = applyCommand(seeded, { type: "RemoveAsset", assetId: a.id });
    expect(after.assets.map((x) => x.id)).toEqual([b.id]);
    const { project: restored } = applyCommand(after, inverse);
    expect(restored).toEqual(seeded);
    expect(() =>
      applyCommand(seeded, { type: "AddAsset", asset: { ...testAsset("b2", "assets/b2.png"), id: b.id } }),
    ).toThrow(/already exists/);
  });

  it("rejects commands that violate referential integrity", () => {
    const store = new ProjectStore(freshProject());
    // Swapping in an exit primitive as an enter is role-invalid.
    const outcome = store.apply({
      type: "SwapMotion",
      sceneId: "hook",
      layerId: "headline",
      phase: "enter",
      primitive: "exit.fadeDown",
    });
    expect(outcome.ok).toBe(false);
  });

  it("removing and undoing a scene restores its transition exactly", () => {
    const project = freshProject();
    project.transitions["stat"] = "fade";
    const store = new ProjectStore(project);
    expect(store.apply({ type: "RemoveScene", sceneId: "stat" }).ok).toBe(true);
    expect(store.project.transitions["stat"]).toBeUndefined();
    expect(store.undo()).toBe(true);
    expect(store.project).toEqual(project);
  });

  it("rejects direct command references to disabled extensions", () => {
    const project = freshProject();
    project.extensions.enabled = [
      "hook-opener",
      "stat-callout",
      "logo-sting-cta",
      "crisp-saas",
      "enter.fadeIn",
    ];
    const store = new ProjectStore(project);
    const outcome = store.apply({
      type: "SwapMotion",
      sceneId: "hook",
      layerId: "headline",
      phase: "enter",
      primitive: "enter.scaleIn",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errors[0]?.message).toContain("extension disabled");
  });

  it("evaluates extension enablement in Batch command order", () => {
    const project = freshProject();
    project.extensions.enabled = [
      "hook-opener",
      "stat-callout",
      "logo-sting-cta",
      "crisp-saas",
      "enter.fadeIn",
    ];
    const store = new ProjectStore(project);
    const enabled = [...project.extensions.enabled, "enter.scaleIn"];
    const outcome = store.apply({
      type: "Batch",
      commands: [
        { type: "SetEnabledExtensions", enabled },
        {
          type: "SwapMotion",
          sceneId: "hook",
          layerId: "headline",
          phase: "enter",
          primitive: "enter.scaleIn",
        },
      ],
    });
    expect(outcome.ok).toBe(true);
  });

  it("continues event sequence numbers from a durable starting point", () => {
    const events: EventEntry[] = [];
    const store = new ProjectStore(freshProject(), (event) => events.push(event), 41);
    store.apply({ type: "SetSceneDuration", sceneId: "hook", durationFrames: 120 });
    expect(events[0]?.seq).toBe(42);
    expect(store.eventCount).toBe(42);
  });

  it("does not expose mutable project state outside the command pathway", () => {
    const store = new ProjectStore(freshProject());
    expect(() => {
      store.project.meta.title = "bypassed";
    }).toThrow();
    expect(store.project.meta.title).toBe("Cmd Test");
  });

  it("removing emphasis also clears its schedule and undo restores it exactly", () => {
    const before = freshProject();
    before.scenes[0]!.overrides.headline = {
      emphasisPrimitive: "emphasis.pop",
      emphasisAtFrame: 42,
      emphasisDuration: "slow",
    };
    const removed = applyCommand(before, {
      type: "RemoveMotion",
      sceneId: "hook",
      layerId: "headline",
      phase: "emphasis",
    });
    expect(removed.project.scenes[0]!.overrides.headline).toBeUndefined();
    expect(applyCommand(removed.project, removed.inverse).project).toEqual(before);
  });

  it("rejects phase-incompatible motion parameter values", () => {
    const store = new ProjectStore(freshProject());
    expect(
      store.apply({
        type: "SetMotionParam",
        sceneId: "hook",
        layerId: "headline",
        phase: "enter",
        param: "atFrame",
        value: 12,
      }).ok,
    ).toBe(false);
    expect(
      store.apply({
        type: "SetMotionParam",
        sceneId: "hook",
        layerId: "headline",
        phase: "emphasis",
        param: "duration",
        value: 12,
      }).ok,
    ).toBe(false);
  });
});
