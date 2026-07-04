import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { inspectDirectComposition } from "../src/engine/layoutInspector.ts";
import { initializeProject } from "../src/engine/projectTemplates.ts";
import {
  normalizeStoryboardCutIntent,
  validateCutContract,
} from "../src/engine/cutContract.ts";
import { applyDeterministicSourceRepairs } from "../src/engine/compositionRunner.ts";
import { discoverShapeMatchUpgrade } from "../src/engine/cutDiscovery.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/**
 * A film with only hard boundaries. The one→two boundary carries a genuinely
 * rhyming measured pair (round query pill → round status pill-bar); the
 * two→three boundary is deliberately mismatched (wide banner → tall card).
 * Discovery must measure both, upgrade exactly the rhyme, and the upgraded
 * boundary must survive the runtime's own bind-time audit (no degrade).
 */
function discoveryFilm(): { storyboard: DirectScene[]; html: string } {
  const storyboard: DirectScene[] = [
    { id: "one", title: "Search", purpose: "query", startSec: 0, durationSec: 3 },
    { id: "two", title: "Status", purpose: "queued", startSec: 3, durationSec: 3 },
    { id: "three", title: "Resolve", purpose: "landing", startSec: 6, durationSec: 3 },
  ];
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<title>Cut discovery smoke</title><script src="gsap.min.js"></script><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#101622}
body{color:#eef2f8;font-family:Arial,sans-serif}
#root{position:relative;width:1920px;height:1080px;overflow:hidden}
.scene{position:absolute;inset:0;padding:120px;display:grid;place-items:center;opacity:0}
.pill{width:320px;height:96px;border-radius:48px;background:#5eead4;color:#06231d;display:grid;place-items:center;font-size:32px}
.pillbar{width:480px;height:96px;border-radius:48px;background:#38bdf8;color:#082032;display:grid;place-items:center;font-size:32px}
.banner{width:1200px;height:120px;border-radius:12px;background:#f472b6;display:grid;place-items:center;font-size:30px}
.card{width:320px;height:640px;border-radius:24px;background:#a78bfa;display:grid;place-items:center;font-size:30px}
</style></head><body>
<main id="root" data-composition-id="discovery-smoke" data-width="1920" data-height="1080" data-duration="9">
<section id="one" class="scene clip" data-scene="one" data-start="0" data-duration="3" data-track-index="1">
<div class="pill" data-part="query-pill" data-layout-important>deploy checkout</div>
</section>
<section id="two" class="scene clip" data-scene="two" data-start="3" data-duration="3" data-track-index="1">
<div style="display:grid;gap:48px;justify-items:center">
<div class="pillbar" data-part="status-bar" data-layout-important>deploy checkout &middot; queued</div>
<div class="banner" data-part="wide-banner">release banner</div>
</div>
</section>
<section id="three" class="scene clip" data-scene="three" data-start="6" data-duration="3" data-track-index="1">
<div class="card" data-part="tall-card" data-layout-important>release card</div>
</section>
</main>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#one",{opacity:1},0).set("#one",{opacity:0},2.999);
tl.set("#two",{opacity:1},3).set("#two",{opacity:0},5.999);
tl.set("#three",{opacity:1},6).set("#three",{opacity:0},9);
tl.fromTo("#one [data-part=query-pill]",{y:40,opacity:0},{y:0,opacity:1,duration:.6,ease:"power3.out"},0.2);
tl.fromTo("#three [data-part=tall-card]",{scale:.96},{scale:1,duration:.6,ease:"power3.out"},6.6);
window.__timelines["discovery-smoke"]=tl;tl.seek(0);
</script></body></html>`;
  return { storyboard, html };
}

describe("cut discovery browser contract (measure-then-upgrade)", () => {
  it("measures boundary geometry, upgrades only the provable rhyme, and flies it", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-discovery-smoke-"));
    roots.push(dir);
    initializeProject(dir, { name: "Smoke", brandName: "Smoke", seedScreenshot: false });
    const draft = discoveryFilm();

    // 1. Inventory: browser QA measures visible data-parts on both sides of
    //    every boundary.
    const qa = await inspectDirectComposition(dir, draft, { captureGuide: false });
    expect(qa.infraError).toBeUndefined();
    expect(qa.errors).toEqual([]);
    expect(qa.boundaries?.length).toBe(2);
    const first = qa.boundaries!.find((entry) => entry.fromScene === "one")!;
    expect(first.outgoing.map((entry) => entry.part)).toContain("query-pill");
    expect(first.incoming.map((entry) => entry.part)).toContain("status-bar");
    const pill = first.outgoing.find((entry) => entry.part === "query-pill")!;
    expect(pill.radiusPx).toBeCloseTo(48, 0);
    expect(pill.onFrameRatio).toBeGreaterThan(0.99);

    // 2. Score: exactly the rhyming boundary upgrades; the mismatched pair
    //    (banner → tall card) never does.
    const upgrade = discoverShapeMatchUpgrade(draft.storyboard, qa.boundaries!);
    expect(upgrade).toMatchObject({
      fromScene: "one",
      toScene: "two",
      focalPartOut: "query-pill",
      focalPartIn: "status-bar",
    });

    // 3. Upgrade: mutate the storyboard, re-run the deterministic injections,
    //    and prove the shape-match binds without the runtime degrading it.
    const cut = normalizeStoryboardCutIntent({
      version: 1,
      style: "shape-match",
      focalPartOut: upgrade!.focalPartOut,
      focalPartIn: upgrade!.focalPartIn,
    })!;
    const mutated = draft.storyboard.map((scene) =>
      scene.id === "one" ? { ...scene, cut } : scene
    );
    const repaired = applyDeterministicSourceRepairs(
      { storyboard: mutated, html: draft.html },
      dir,
      mutated,
    );
    expect(validateCutContract(repaired.html, mutated).errors).toEqual([]);
    const upgradedQa = await inspectDirectComposition(
      dir,
      { storyboard: mutated, html: repaired.html },
      { captureGuide: false },
    );
    expect(upgradedQa.infraError).toBeUndefined();
    expect(upgradedQa.errors).toEqual([]);
    expect(upgradedQa.ok).toBe(true);
    expect(
      upgradedQa.warnings.filter((warning) => warning.startsWith("cut_degraded:")),
    ).toEqual([]);
  }, 60_000);
});
