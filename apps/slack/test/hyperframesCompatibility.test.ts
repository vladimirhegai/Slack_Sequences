import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertHyperframesSubmissionCompatibility,
  HYPERFRAMES_RUNTIME_PACKAGES,
  HYPERFRAMES_SUBMISSION_VERSION,
} from "../src/engine/hyperframesCompatibility.ts";

describe("HyperFrames hackathon submission freeze", () => {
  it("pins every Slack runtime package exactly and rejects accidental drift", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    for (const packageName of HYPERFRAMES_RUNTIME_PACKAGES) {
      expect(manifest.dependencies[packageName]).toBe(HYPERFRAMES_SUBMISSION_VERSION);
    }
    expect(() => assertHyperframesSubmissionCompatibility()).not.toThrow();
  });

  it("ships the browser audits locally instead of depending on npx or a remote CLI", () => {
    const commands = path.resolve(
      import.meta.dirname,
      "../vendor/hyperframes/packages/cli/src/commands",
    );
    expect(fs.existsSync(path.join(commands, "layout-audit.browser.js"))).toBe(true);
    expect(fs.existsSync(path.join(commands, "contrast-audit.browser.js"))).toBe(true);
  });
});
