import { describe, expect, it } from "vitest";
import {
  DURATION_TOKENS,
  DURATION_ORDER,
  EASING_TOKENS,
  easingRole,
  ENTER_EASINGS,
  EXIT_EASINGS,
  STAGGER_TOKENS,
  TYPE_TOKENS,
} from "../src/tokens.ts";
import {
  DurationTokenSchema,
  StaggerTokenSchema,
  TypeTokenSchema,
} from "../src/schema.ts";

describe("token lattice", () => {
  it("schema enums stay in sync with token tables (literal-enum guard)", () => {
    expect(DurationTokenSchema.options).toEqual(Object.keys(DURATION_TOKENS));
    expect(StaggerTokenSchema.options).toEqual(Object.keys(STAGGER_TOKENS));
    expect(TypeTokenSchema.options).toEqual(Object.keys(TYPE_TOKENS));
  });

  it("duration order covers every token, fastest to slowest", () => {
    expect([...DURATION_ORDER].sort()).toEqual(Object.keys(DURATION_TOKENS).sort());
    for (let i = 1; i < DURATION_ORDER.length; i++) {
      expect(DURATION_TOKENS[DURATION_ORDER[i]!]).toBeGreaterThan(
        DURATION_TOKENS[DURATION_ORDER[i - 1]!],
      );
    }
  });

  it("easings are role-typed and every role is populated", () => {
    for (const id of Object.keys(EASING_TOKENS)) {
      expect(["enter", "exit", "move", "linear"]).toContain(easingRole(id as never));
    }
    expect(ENTER_EASINGS.length).toBeGreaterThanOrEqual(3);
    expect(EXIT_EASINGS.length).toBeGreaterThanOrEqual(2);
  });

  it("bezier easings have dot-free runtime names (GSAP parser constraint)", () => {
    for (const easing of Object.values(EASING_TOKENS)) {
      if (easing.kind === "bezier") {
        expect(easing.runtimeName).not.toContain(".");
      }
    }
  });
});
