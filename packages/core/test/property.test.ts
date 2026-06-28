import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  compile,
  createDefaultProject,
  ProjectStore,
  scaleFrames30,
  validateProject,
  type Command,
} from "../src/index.ts";

describe("property-based graph contracts", () => {
  it("arbitrary valid edit sequences undo exactly to the starting graph", () => {
    const commandArbitrary = fc.oneof(
      fc.integer({ min: 60, max: 150 }).map(
        (durationFrames): Command => ({
          type: "SetSceneDuration",
          sceneId: "hook",
          durationFrames,
        }),
      ),
      fc.constantFrom("center", "left").map(
        (layout): Command => ({ type: "SetSceneLayout", sceneId: "hook", layout }),
      ),
      fc
        .tuple(
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
        )
        .map(
          (channels): Command => ({
            type: "SetBrandColor",
            key: "accent",
            value: `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`,
          }),
        ),
      fc.constantFrom("cutHold", "crossFade", "wipeDirectional", "slidePush").map(
        (kind): Command => ({ type: "SetTransition", afterSceneId: "hook", kind }),
      ),
    );

    fc.assert(
      fc.property(fc.array(commandArbitrary, { minLength: 1, maxLength: 40 }), (commands) => {
        const initial = createDefaultProject();
        const store = new ProjectStore(initial);
        for (const command of commands) expect(store.apply(command).ok).toBe(true);
        while (store.canUndo) expect(store.undo()).toBe(true);
        expect(store.project).toEqual(initial);
        expect(validateProject(store.project).ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("30/60-fps projects preserve authored seconds when frame values are scaled", () => {
    fc.assert(
      fc.property(fc.integer({ min: 15, max: 600 }), (framesAt30) => {
        const at30 = createDefaultProject();
        at30.scenes = [structuredClone(at30.scenes[0]!)];
        at30.scenes[0]!.durationFrames = framesAt30;

        const at60 = structuredClone(at30);
        at60.meta.fps = 60;
        at60.scenes[0]!.durationFrames = scaleFrames30(framesAt30, 60);

        expect(compile(at60).manifest.durationSec).toBe(compile(at30).manifest.durationSec);
      }),
      { numRuns: 100 },
    );
  });
});
