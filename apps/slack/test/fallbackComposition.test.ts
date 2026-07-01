import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateDirectComposition } from "../src/engine/directComposition.ts";
import { buildFallbackComposition } from "../src/engine/fallbackComposition.ts";
import { inspectDirectComposition } from "../src/engine/layoutInspector.ts";
import { initializeProject } from "../src/engine/projectTemplates.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("deterministic direct fallback browser contract", () => {
  it("loads cleanly and keeps load-bearing content inside the flow layout", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-fallback-test-"));
    roots.push(dir);
    initializeProject(dir, { name: "RADAR", brandName: "RADAR", seedScreenshot: true });
    const draft = buildFallbackComposition({
      product: "RADAR",
      whatShipped:
        "RADAR turns scattered product signals into one live operational view for confident decisions.",
      audience: "product and operations teams",
      lengthSec: 20,
    });
    expect((await validateDirectComposition(dir, draft)).errors).toEqual([]);
    const qa = await inspectDirectComposition(dir, draft, { captureGuide: false });
    expect(qa.infraError).toBeUndefined();
    expect(qa.ok).toBe(true);
    expect(qa.issues.filter((issue) =>
      ["important_safe_area", "content_overlap", "clipped_text", "text_box_overflow"]
        .includes(issue.code)
    )).toEqual([]);
  }, 20_000);
});
