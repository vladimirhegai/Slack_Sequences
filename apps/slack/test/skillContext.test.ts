import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { retrieveHyperframesSkillContext } from "../src/agent/skillContext.ts";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fileCount(dir: string): number {
  return fs.readdirSync(dir, { withFileTypes: true }).reduce(
    (count, entry) =>
      count + (entry.isDirectory() ? fileCount(path.join(dir, entry.name)) : 1),
    0,
  );
}

describe("HyperFrames skill retrieval", () => {
  it("routes launch creation through core domains with blueprints and rules", () => {
    const result = retrieveHyperframesSkillContext(
      "create",
      "Launch Relay with kinetic typography and a 40% stat",
      30_000,
    );

    expect(result.skillNames).toContain("hyperframes-core");
    expect(result.skillNames).toContain("hyperframes-animation");
    expect(result.skillNames).toContain("hyperframes-creative");
    expect(result.text.length).toBeLessThanOrEqual(30_000);
    expect(result.blueprintIds).toEqual(expect.arrayContaining([
      "kinetic-type-beats",
      "dataviz-countup",
    ]));
    expect(result.ruleIds).toContain("counting-dynamic-scale");
    expect(result.text).toContain("<hyperframes_skill_context>");
    expect(result.text).toContain("<blueprint id=");
    expect(result.text).toContain("<motion-rule id=");
    expect(result.text).toContain("storyboard_json + index_html");
    expect(result.text).toContain("Embedded fonts");
    expect(result.text).toContain("Minimal composition skeleton");
    expect(result.text).toContain("Determinism rules");
    expect(result.text.length).toBeLessThanOrEqual(32_000);
  });

  it("selects fewer skills and recipes for revisions", () => {
    const result = retrieveHyperframesSkillContext("revise", "make the music softer");
    expect(result.skillNames).toContain("hyperframes-core");
    expect(result.skillNames).toContain("hyperframes-animation");
    expect(result.skillNames).not.toContain("hyperframes-creative");
  });

  it("keeps every upstream skill and file recorded by the manifest", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(APP_DIR, "skills-manifest.json"), "utf8"),
    ) as { skills: Record<string, { files: number }> };
    const installed = fs.readdirSync(path.join(APP_DIR, "skills"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(installed).toEqual(Object.keys(manifest.skills).sort());
    for (const [name, expected] of Object.entries(manifest.skills)) {
      expect(fileCount(path.join(APP_DIR, "skills", name)), name).toBe(expected.files);
    }
  });
});
