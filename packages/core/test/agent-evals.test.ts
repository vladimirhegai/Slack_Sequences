import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDefaultProject,
  parsePlan,
  structuredBriefToPlan,
  type StructuredBrief,
} from "../src/index.ts";

const briefs = JSON.parse(
  fs.readFileSync(path.resolve("evals/phase1-briefs.json"), "utf8"),
) as StructuredBrief[];

describe("Phase-1 agent evaluation set", () => {
  it("15 canonical briefs produce valid, sane zero-token plans", () => {
    expect(briefs).toHaveLength(15);
    const project = createDefaultProject();
    const profiles = new Set<string>();
    for (const brief of briefs) {
      const plan = structuredBriefToPlan(project, brief);
      expect(parsePlan(plan, { project })).toEqual(plan);
      expect(plan.scenes.length).toBeGreaterThanOrEqual(3);
      expect(plan.scenes.length).toBeLessThanOrEqual(6);
      expect(plan.scenes[0]!.archetype).toBe("hook-opener");
      expect(plan.scenes.at(-1)!.archetype).toBe("logo-sting-cta");
      profiles.add(plan.motionProfile);
    }
    expect(profiles).toEqual(new Set(["warm-startup", "crisp-saas", "bold-launch"]));
  });
});
