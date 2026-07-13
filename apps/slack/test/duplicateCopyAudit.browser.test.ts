import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DirectCompositionDraft, DirectScene } from "../src/engine/directComposition.ts";
import {
  inspectDirectComposition,
  REPEATED_VISIBLE_COPY_MIN_CHARS,
  REPEATED_VISIBLE_COPY_MIN_WORDS,
} from "../src/engine/layoutInspector.ts";
import { sourceRetryFeedbackForBrowserQa } from "../src/engine/runner/browserQuality.ts";
import { initializeProject } from "../src/engine/projectTemplates.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const DUPLICATED_FACT = "Unlimited liability is capped at twelve months of platform fees.";
const CROSS_SCENE_FACT = "Every approved amendment keeps one durable audit trail for reviewers.";

function documentFor(
  id: string,
  storyboard: DirectScene[],
  sections: string,
): DirectCompositionDraft {
  const duration = storyboard.at(-1)!.startSec + storyboard.at(-1)!.durationSec;
  const sceneCalls = storyboard.map((scene, index) => {
    const end = scene.startSec + scene.durationSec;
    return `tl.set("#${scene.id}",{opacity:1},${scene.startSec})` +
      `.set("#${scene.id}",{opacity:0},${Math.max(scene.startSec, end - 0.001)});`;
  }).join("\n");
  return {
    storyboard,
    html: `<!doctype html><html><head><meta charset="UTF-8"><title>Duplicate copy audit</title>
<script src="gsap.min.js"></script><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#101722;color:#edf3fb}
#root{position:relative;width:1920px;height:1080px;overflow:hidden}
.scene{position:absolute;inset:0;opacity:0;padding:80px;display:grid;align-content:center;gap:22px;background:#101722}
.surface{padding:24px 30px;border-radius:20px;background:#203047;border:2px solid #3d5878;font:600 28px/1.35 Arial}
.columns{display:grid;grid-template-columns:1fr 1fr;gap:42px}.stack{display:grid;gap:16px}
p,li,h2,button{margin:0}button{padding:14px 22px;font:700 20px Arial}
</style></head><body>
<main id="root" data-composition-id="${id}" data-width="1920" data-height="1080" data-duration="${duration}">
${sections}</main><script>
window.__timelines={};const tl=gsap.timeline({paused:true});
${sceneCalls}
window.__timelines[${JSON.stringify(id)}]=tl;tl.seek(0);
</script></body></html>`,
  };
}

function positiveFilm(): DirectCompositionDraft {
  const storyboard: DirectScene[] = [{
    id: "amendment",
    title: "Amendment comparison",
    purpose: "One fact accidentally appears on two visible surfaces",
    startSec: 0,
    durationSec: 6,
  }];
  return documentFor("duplicate-positive", storyboard, `
<section id="amendment" class="scene" data-scene="amendment" data-start="0" data-duration="6">
<div class="columns">
  <article class="surface" data-part="amendment-card"><p>${DUPLICATED_FACT}</p></article>
  <aside class="surface" data-part="redline-list"><ul><li>${DUPLICATED_FACT}</li></ul></aside>
</div></section>`);
}

function guardedFilm(): DirectCompositionDraft {
  const storyboard: DirectScene[] = [
    {
      id: "guards-a",
      title: "False-positive guards",
      purpose: "Mirrors and intentional text mechanics stay out of the audit",
      startSec: 0,
      durationSec: 6,
    },
    {
      id: "guards-b",
      title: "Cross-scene reuse",
      purpose: "Copy reused in a later scene is not simultaneously duplicated",
      startSec: 6,
      durationSec: 6,
    },
  ];
  const pluginFact = "The verified workflow keeps every signature event in one secure ledger.";
  const ariaFact = "Reviewers receive a complete approval history before the document ships.";
  const splitFact = "A deliberate kinetic headline is one phrase, not several duplicate labels.";
  const sameOwnerFact = "This component intentionally repeats one legal note inside its own rows.";
  return documentFor("duplicate-guards", storyboard, `
<section id="guards-a" class="scene" data-scene="guards-a" data-start="0" data-duration="6">
<div class="columns">
  <div class="stack">
    <p class="surface" data-part="plugin-author-copy">${pluginFact}</p>
    <div class="surface" data-sequences-host="1" data-sequences-plugin="lockup"><p>${pluginFact}</p></div>
    <p class="surface" data-part="aria-author-copy">${ariaFact}</p>
    <p class="surface" data-part="aria-mirror" aria-hidden="true">${ariaFact}</p>
    <button>Sign contract now</button><button>Sign contract now</button>
  </div>
  <div class="stack">
    <p class="surface" data-brand>${DUPLICATED_FACT}</p>
    <p class="surface" data-wordmark>${DUPLICATED_FACT}</p>
    <h2 class="surface"><span class="cmp-split">A deliberate kinetic headline </span><span class="cmp-split">is one phrase, not several duplicate labels.</span></h2>
    <p class="surface" data-part="split-control">${splitFact}</p>
    <article class="surface" data-part="same-owner"><p>${sameOwnerFact}</p><p>${sameOwnerFact}</p></article>
    <p class="surface" data-part="cross-a">${CROSS_SCENE_FACT}</p>
  </div>
</div></section>
<section id="guards-b" class="scene" data-scene="guards-b" data-start="6" data-duration="6">
  <p class="surface" data-part="cross-b">${CROSS_SCENE_FACT}</p>
</section>`);
}

async function inspect(id: string, draft: DirectCompositionDraft) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sequences-copy-${id}-`));
  roots.push(dir);
  initializeProject(dir, { name: id, brandName: id, seedScreenshot: false });
  return inspectDirectComposition(dir, draft, { captureGuide: false });
}

async function withoutUnrelatedPolish<T>(run: () => Promise<T>): Promise<T> {
  const priorContinuous = process.env.SLACK_SEQUENCES_CONTINUOUS_MOTION;
  const priorComposition = process.env.SLACK_SEQUENCES_COMPOSITION;
  process.env.SLACK_SEQUENCES_CONTINUOUS_MOTION = "0";
  process.env.SLACK_SEQUENCES_COMPOSITION = "0";
  try {
    return await run();
  } finally {
    if (priorContinuous === undefined) delete process.env.SLACK_SEQUENCES_CONTINUOUS_MOTION;
    else process.env.SLACK_SEQUENCES_CONTINUOUS_MOTION = priorContinuous;
    if (priorComposition === undefined) delete process.env.SLACK_SEQUENCES_COMPOSITION;
    else process.env.SLACK_SEQUENCES_COMPOSITION = priorComposition;
  }
}

describe("same-scene repeated visible copy audit", () => {
  it("keeps one repeated substantial fact visible as advisory QA only", async () => {
    expect(REPEATED_VISIBLE_COPY_MIN_CHARS).toBe(30);
    expect(REPEATED_VISIBLE_COPY_MIN_WORDS).toBe(5);
    const qa = await withoutUnrelatedPolish(() => inspect("positive", positiveFilm()));
    const repeated = qa.issues.filter((issue) => issue.code === "repeated_visible_copy");
    expect(qa.infraError).toBeUndefined();
    expect(qa.errors).toEqual([]);
    expect(qa.ok).toBe(true);
    expect(qa.strictOk).toBe(false);
    expect(repeated).toHaveLength(1);
    expect(repeated[0]).toMatchObject({
      severity: "warning",
      sceneId: "amendment",
      text: DUPLICATED_FACT,
      source: "sequences",
    });
    const warning = qa.warnings.find((entry) => entry.startsWith("repeated_visible_copy"));
    expect(warning).toBeDefined();
    expect(sourceRetryFeedbackForBrowserQa(qa)).not.toContain(warning);
  }, 45_000);

  it("ignores host/plugin and ARIA mirrors, CTA/brand tokens, split spans, same-owner repeats, and cross-scene reuse", async () => {
    const qa = await withoutUnrelatedPolish(() => inspect("guards", guardedFilm()));
    expect(qa.infraError).toBeUndefined();
    expect(qa.errors).toEqual([]);
    expect(qa.ok).toBe(true);
    expect(qa.issues.filter((issue) => issue.code === "repeated_visible_copy")).toEqual([]);
    expect(qa.warnings.filter((warning) => warning.startsWith("repeated_visible_copy")))
      .toEqual([]);
  }, 45_000);
});
