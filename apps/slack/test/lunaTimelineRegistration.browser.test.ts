import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  commitDirectComposition,
  loadDirectComposition,
  type DirectCompositionDraft,
} from "../src/engine/directComposition.ts";
import { inspectDirectComposition } from "../src/engine/layoutInspector.ts";

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

function exactRelayIncident(): DirectCompositionDraft {
  const fixture = path.join(import.meta.dirname, "fixtures", "luna-seek-relay");
  const storyboard = JSON.parse(fs.readFileSync(path.join(fixture, "storyboard.json"), "utf8")) as {
    storyboard: DirectCompositionDraft["storyboard"];
  };
  const intent = JSON.parse(fs.readFileSync(path.join(fixture, "motion-intent.json"), "utf8")) as {
    acts: Array<{ sceneId: string; primarySelector: string }>;
  };
  return {
    html: fs.readFileSync(path.join(fixture, "composition.html"), "utf8"),
    storyboard: storyboard.storyboard,
    declaredPrimarySelectors: Object.fromEntries(
      intent.acts.map((act) => [act.sceneId, act.primarySelector]),
    ),
  };
}

function withLateIdentityTransform(draft: DirectCompositionDraft): DirectCompositionDraft {
  return {
    ...draft,
    html: draft.html
      .replace("</main>", '<div id="late-identity" aria-hidden="true"></div></main>')
      .replace(
        "const declared=document.querySelector",
        'master.set("#late-identity",{x:0},4);\nconst declared=document.querySelector',
      ),
  };
}

function withPathDependentCallbacks(draft: DirectCompositionDraft): DirectCompositionDraft {
  const nodes = Array.from({ length: 12 }, (_, index) =>
    `<i id="seek-state-${index}" data-count="0" aria-hidden="true"></i>`
  ).join("");
  return {
    ...draft,
    html: draft.html
      .replace("</main>", `${nodes}</main>`)
      .replace(
        "const declared=document.querySelector",
        `master.call(()=>{document.querySelectorAll('[data-count]').forEach((element)=>{element.dataset.count=String(Number(element.dataset.count)+1);});},[],3);\nconst declared=document.querySelector`,
      ),
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

  it("replays the exact Relay incident as a genuine reset-to-zero visibility leak", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-relay-incident-"));
    roots.push(root);
    const incident = exactRelayIncident();
    expect(createHash("sha256").update(incident.html).digest("hex")).toBe(
      "107e80094d250655432aadd2ee5ace8a45af50be7f6dafbb19611ee9f78093f1",
    );
    const qa = await inspectDirectComposition(root, incident, { captureGuide: false });

    expect(qa.errors[0]).toContain("timeline_contract: canonical seek(1.890)");
    expect(qa.timelineContract).toMatchObject({
      compositionId: "relay-luna-launch",
      seekSequence: [1.89, 7.4, 0, 1.89],
    });
    expect(qa.timelineContract?.changeCount).toBeGreaterThan(8);
    expect(qa.timelineContract?.differences[0]).toMatchObject({
      selector: "#signals-scene",
      property: "style.visibility",
      before: "visible",
      after: "hidden",
    });
  }, 120_000);

  it("accepts a minimized late identity transform as the same rendered seek state", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-identity-seek-"));
    roots.push(root);
    const qa = await inspectDirectComposition(
      root,
      withLateIdentityTransform(browserValidComputedRegistration()),
      { captureGuide: false },
    );

    expect(qa.errors).toEqual([]);
    expect(qa.timelineContract).toBeUndefined();
  }, 60_000);

  it("hard-rejects real path-dependent callbacks with bounded structured evidence", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-path-dependent-seek-"));
    roots.push(root);
    const qa = await inspectDirectComposition(
      root,
      withPathDependentCallbacks(browserValidComputedRegistration()),
      { captureGuide: false },
    );

    expect(qa.ok).toBe(false);
    expect(qa.errors).toHaveLength(1);
    expect(qa.errors[0]).toContain("timeline_contract: canonical seek(2.220)");
    expect(qa.timelineContract).toMatchObject({
      compositionId: "relay-browser-proof",
      seekSequence: [2.22, 4.38, 0, 2.22],
      changeCount: 12,
    });
    expect(qa.timelineContract?.differences).toHaveLength(8);
    expect(qa.timelineContract?.differences[0]).toMatchObject({
      selector: "#seek-state-0",
      property: "attribute.data-count",
      before: "0",
    });
    expect(qa.timelineContract?.differences[0]?.after).not.toBe("0");
  }, 60_000);
});
