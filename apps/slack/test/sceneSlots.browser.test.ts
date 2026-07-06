import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  validateDirectComposition,
  type DirectScene,
} from "../src/engine/directComposition.ts";
import { applyDeterministicSourceRepairs } from "../src/engine/compositionRunner.ts";
import {
  assembleSlotComposition,
  extractSceneSlots,
} from "../src/engine/sceneSlots.ts";
import { inspectDirectComposition } from "../src/engine/layoutInspector.ts";
import { initializeProject } from "../src/engine/projectTemplates.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/**
 * A complete slot response for a simple two-scene film. Deliberately carries
 * NO structural stage CSS (`#root` sizing, `.scene` positioning) and NO
 * scene-wrapper visibility sets — exactly what the failed live probe
 * (`sentinel-final-denseui`, blank frames) returned. The host stage floor and
 * host-owned visibility must position and reveal the scenes on their own; if
 * this fixture passes the gate, the chassis stands alone.
 */
const SLOT_RESPONSE = [
  "<film_style>",
  "body{background:#0b0d12;color:#f4f6fb;font-family:system-ui,sans-serif}",
  ".scene{display:flex;align-items:center;justify-content:center;padding:120px}",
  ".hero{font-size:104px;font-weight:800;line-height:1.05;max-width:1400px}",
  ".cta{font-size:88px;font-weight:800;color:#7cc4ff}",
  "</film_style>",
  '<scene_html id="hero-open">',
  '<div class="hero" data-part="headline">Ship faster, every deploy</div>',
  "</scene_html>",
  '<scene_script id="hero-open">',
  'tl.from("[data-part=\\"headline\\"]", { y: 48, opacity: 0, duration: 0.7, ease: "power3.out" }, 0.2);',
  "</scene_script>",
  '<scene_html id="cta-close">',
  '<div class="cta" data-part="cta">Start shipping today</div>',
  "</scene_html>",
  '<scene_script id="cta-close">',
  'tl.from("[data-part=\\"cta\\"]", { scale: 0.82, opacity: 0, duration: 0.7, ease: "power3.out" }, 4.2);',
  "</scene_script>",
].join("\n");

function storyboard(): DirectScene[] {
  return [
    { id: "hero-open", title: "Hook", purpose: "open", startSec: 0, durationSec: 4 },
    { id: "cta-close", title: "CTA", purpose: "close", startSec: 4, durationSec: 4 },
  ];
}

describe("Sentinel Phase 2 — assembled slot composition passes the gate", () => {
  it("assembles two scene slots into a document that loads and validates", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-slot-browser-"));
    roots.push(dir);
    initializeProject(dir, { name: "Cursorflow", brandName: "Cursorflow", seedScreenshot: true });

    const board = storyboard();
    const slots = extractSceneSlots(SLOT_RESPONSE);
    const assembled = assembleSlotComposition({
      storyboard: board,
      slots,
      compositionId: "slot-two-scene",
    });
    expect(assembled.missingHtml).toEqual([]);
    // The host owns the runtime/island/compile seam — inject it exactly as the
    // whole-doc path does, then run the real gate on the assembled document.
    const draft = applyDeterministicSourceRepairs(
      { storyboard: board, html: assembled.html },
      dir,
      board,
    );

    const validation = await validateDirectComposition(dir, draft);
    expect(validation.errors).toEqual([]);

    const qa = await inspectDirectComposition(dir, draft, { captureGuide: false });
    expect(qa.infraError).toBeUndefined();
    expect(qa.ok).toBe(true);
  }, 30_000);
});
