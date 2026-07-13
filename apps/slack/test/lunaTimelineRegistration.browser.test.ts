import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  commitDirectComposition,
  loadDirectComposition,
  type DirectCompositionDraft,
} from "../src/engine/directComposition.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function browserValidComputedRegistration(): DirectCompositionDraft {
  return {
    storyboard: [
      { id: "problem", title: "Problem", purpose: "Name the incident", startSec: 0, durationSec: 3 },
      { id: "proof", title: "Proof", purpose: "Show the resolution", startSec: 3, durationSec: 3 },
    ],
    declaredPrimarySelectors: {
      problem: "#problem-title",
      proof: "#proof-title",
    },
    html: `<!doctype html>
<html><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<script src="gsap.min.js"></script>
<style>
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#071018;color:#f7fbff;font-family:Arial,sans-serif}
#film{position:relative;width:1920px;height:1080px;overflow:hidden}
.scene{position:absolute;inset:0;display:grid;place-items:center;opacity:0;background:#071018}
h1{font-size:128px;max-width:12ch;text-align:center}
</style></head><body>
<main id="film" data-composition-id="relay-browser-proof" data-width="1920" data-height="1080" data-duration="6" data-start="0">
<section id="problem" class="scene clip" data-scene="problem" data-start="0" data-duration="3" data-track-index="1"><h1 id="problem-title">Signals scatter.</h1></section>
<section id="proof" class="scene clip" data-scene="proof" data-start="3" data-duration="3" data-track-index="1"><h1 id="proof-title">Relay resolves them.</h1></section>
</main>
<script>
const master=gsap.timeline({paused:true});
master.set("#problem",{opacity:1},0).set("#problem",{opacity:0},2.99);
master.set("#proof",{opacity:1},3).set("#proof",{opacity:0},6);
master.fromTo("#problem-title",{y:80,opacity:0},{y:0,opacity:1,duration:.7},.2);
master.fromTo("#proof-title",{scale:.88,opacity:0},{scale:1,opacity:1,duration:.7},3.2);
const declared=document.querySelector("[data-composition-id]").dataset.compositionId;
const registry=window["__timelines"]||{};
window["__timelines"]=registry;
Reflect.set(registry,declared,master);
window.__seek=(seconds)=>{master.pause();master.seek(seconds,false);};
</script></body></html>`,
  };
}

describe("Luna browser timeline authority", () => {
  it("commits a non-blessed but browser-valid exact timeline registration end to end", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-timeline-browser-"));
    roots.push(root);
    const draft = browserValidComputedRegistration();
    const result = await commitDirectComposition(root, "Relay", draft);

    expect(result.validation.ok).toBe(true);
    expect(result.validation.warnings.join("\n")).toContain(
      'register the paused timeline as window.__timelines["relay-browser-proof"]',
    );
    expect(result.validation.warnings.join("\n")).toContain("missing_timeline_registry");
    expect(result.manifest.qa?.browserValidated).toBe(true);
    expect(loadDirectComposition(root).manifest).toMatchObject({
      compositionId: "relay-browser-proof",
      declaredPrimarySelectors: draft.declaredPrimarySelectors,
    });
  }, 60_000);

  it("hard-rejects a populated registry that omits the declared composition id", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-timeline-wrong-id-"));
    roots.push(root);
    const draft = browserValidComputedRegistration();
    draft.html = draft.html.replace(
      "Reflect.set(registry,declared,master);",
      'Reflect.set(registry,"some-other-composition",master);',
    );

    await expect(commitDirectComposition(root, "Relay", draft)).rejects.toThrow(
      'timeline_contract: window.__timelines["relay-browser-proof"] is absent',
    );
  }, 60_000);
});
