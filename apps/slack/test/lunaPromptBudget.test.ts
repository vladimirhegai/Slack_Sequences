import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The Railway worker is intentionally plain ESM JavaScript, not part of the
// Slack TypeScript build. Its exported pure prompt assembler is still the
// authoritative measurement seam for this regression.
const workerLib = await import("../codex-worker/worker-lib.mjs" as string) as {
  buildToollessArtifactPrompt(
    prompt: string,
    files: Array<{ path: string; bytes: Buffer; sha256: string; attachAsImage: boolean }>,
    options?: { mode?: "new" | "resume" },
  ): string;
  DEFAULT_LIMITS: { maxPromptBytes: number };
};
const { buildToollessArtifactPrompt, DEFAULT_LIMITS } = workerLib;

const promptsDir = path.resolve(import.meta.dirname, "..", "prompts");
const PROMPT_FILE_CEILING = 24 * 1024;
const ASSEMBLED_REGRESSION_CEILING = 192 * 1024;

function input(filePath: string, content: string, attachAsImage = false) {
  const bytes = Buffer.from(content);
  return {
    path: filePath,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    attachAsImage,
  };
}

function prompt(name: string): string {
  return fs.readFileSync(path.join(promptsDir, name), "utf8");
}

describe("Luna prompt and tool-less context budgets", () => {
  it("keeps every editable Luna instruction below a visible per-stage ceiling", () => {
    const names = fs.readdirSync(promptsDir)
      .filter((name) => /^luna-.*\.md$/.test(name))
      .sort();
    expect(names).toEqual(expect.arrayContaining([
      "luna-asset-pack.md",
      "luna-direction.md",
      "luna-director.md",
      "luna-motion-reference.md",
      "luna-protocol-recovery.md",
      "luna-repair.md",
      "luna-revision.md",
      "luna-self-review.md",
    ]));
    for (const name of names) {
      const bytes = fs.statSync(path.join(promptsDir, name)).size;
      expect(bytes, `${name} grew to ${bytes} bytes`).toBeLessThanOrEqual(PROMPT_FILE_CEILING);
    }
  });

  it("leaves headroom for a production-shaped create envelope", () => {
    const facts = JSON.stringify({
      version: 1,
      product: "Relay",
      brandName: "Relay",
      whatShipped: "A release signal becomes a verified deployment state. ".repeat(80),
      context: "Permission-scoped Slack evidence. ".repeat(800),
      targetDurationSec: 20,
      provenance: { unsupportedClaimsAllowed: false },
    });
    const goldenDir = path.resolve(promptsDir, "..", "demos", "slack-ad");
    const goldenNames = [
      "STORYBOARD.md",
      "index.html",
      "style.css",
      "polish.css",
      "config.js",
      "timeline.js",
    ];
    const files = [
      input("inputs/fact-envelope.json", facts),
      input("inputs/asset-brief.md", "No approved screenshots. Build synthetic local UI.\n"),
      input("inputs/references/slack-ad-motion-principles.md", prompt("luna-motion-reference.md")),
      input("inputs/references/golden-demo/README.md", prompt("luna-golden-demo-reference.md")),
      ...goldenNames.map((name) =>
        input(
          `inputs/references/golden-demo/${name}`,
          fs.readFileSync(path.join(goldenDir, name), "utf8"),
        )
      ),
    ];
    for (const name of ["luna-asset-pack.md", "luna-direction.md", "luna-director.md"]) {
      const assembled = buildToollessArtifactPrompt(prompt(name), files);
      expect(Buffer.byteLength(assembled), `${name} assembled envelope`).toBeLessThanOrEqual(
        ASSEMBLED_REGRESSION_CEILING,
      );
    }
    expect(Buffer.byteLength(prompt("luna-director.md"))).toBeLessThan(DEFAULT_LIMITS.maxPromptBytes);
  });

  it("keeps one complete evidence-rich repair below the same regression ceiling", () => {
    const rejectedHtml = [
      "<!doctype html><main data-composition-id=\"relay\">",
      "<section data-scene=\"proof\">",
      "<div class=\"product-ui\">Verified release state</div>".repeat(600),
      "</section></main>",
    ].join("");
    const assembled = buildToollessArtifactPrompt(prompt("luna-repair.md"), [
      input("inputs/repair/rejected-bundle/composition.html", rejectedHtml),
      input("inputs/repair/rejected-bundle/storyboard.json", JSON.stringify({ storyboard: [
        { id: "proof", startSec: 0, durationSec: 20 },
      ] })),
      input("inputs/repair/rejected-bundle/motion-intent.json", JSON.stringify({
        version: 1,
        compositionId: "relay",
        durationSec: 20,
      })),
      input("inputs/repair/hard-findings.json", JSON.stringify({ findings: [{
        code: "timeline_contract.seek_nondeterministic",
        selector: "#release-state",
        property: "transform",
        before: "matrix(1, 0, 0, 1, 0, 0)",
        after: "matrix(1, 0, 0, 1, 4, 0)",
      }] })),
    ], { mode: "resume" });
    expect(Buffer.byteLength(assembled)).toBeLessThanOrEqual(ASSEMBLED_REGRESSION_CEILING);
  });
});
