import { describe, expect, it } from "vitest";
import { temporalOutgoingCutSelector } from "../src/engine/temporalInspector.ts";

describe("temporal outgoing cut target", () => {
  it("observes the runtime bridge for canonical and legacy matched cuts", () => {
    for (const style of ["match", "morph", "object-match", "shape-match"] as const) {
      expect(temporalOutgoingCutSelector({ style, fromScene: "one" }))
        .toBe('[data-sequences-runtime-cut="bridge"]');
    }
  });

  it("observes the flash overlay or ordinary outgoing scene", () => {
    expect(temporalOutgoingCutSelector({ style: "flash-white", fromScene: "one" }))
      .toBe('[data-sequences-runtime-cut="flash"]');
    expect(temporalOutgoingCutSelector({ style: "swipe", fromScene: "one" }))
      .toBe('[data-scene="one"]');
  });
});
