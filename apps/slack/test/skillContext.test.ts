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
  it("routes launch creation through the router, workflow, and core domains", () => {
    const result = retrieveHyperframesSkillContext(
      "create",
      "Launch Relay with kinetic typography and a 40% stat",
      12_000,
    );

    expect(result.skillNames).toEqual(expect.arrayContaining([
      "hyperframes",
      "product-launch-video",
      "hyperframes-core",
      "hyperframes-creative",
      "hyperframes-animation",
      "motion-graphics",
    ]));
    expect(result.text).toContain("<hyperframes_skill_context>");
    expect(result.text).toContain("The current response contract remains the Sequences Plan/Command JSON");
    expect(result.text.length).toBeLessThanOrEqual(13_500);
  });

  it("loads media knowledge only when a revision asks for it", () => {
    const result = retrieveHyperframesSkillContext("revise", "make the music softer");
    expect(result.skillNames).toContain("hyperframes-media");
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
