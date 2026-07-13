import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { inspectDirectComposition } from "../src/engine/layoutInspector.ts";
import { initializeProject } from "../src/engine/projectTemplates.ts";

const roots: string[] = [];
const savedEyeTrace = process.env.SLACK_SEQUENCES_EYE_TRACE;
const savedQaCache = process.env.SLACK_SEQUENCES_QA_CACHE;

beforeAll(() => {
  // Two inspections of the same draft under different eye-trace modes: the
  // QA evidence cache must not replay run 1's verdict into run 2.
  process.env.SLACK_SEQUENCES_QA_CACHE = "0";
  delete process.env.SLACK_SEQUENCES_EYE_TRACE;
});

afterAll(() => {
  if (savedQaCache === undefined) delete process.env.SLACK_SEQUENCES_QA_CACHE;
  else process.env.SLACK_SEQUENCES_QA_CACHE = savedQaCache;
  if (savedEyeTrace === undefined) delete process.env.SLACK_SEQUENCES_EYE_TRACE;
  else process.env.SLACK_SEQUENCES_EYE_TRACE = savedEyeTrace;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Eye-trace continuity (WS2) in one real browser run. Boundary 1→2 is a
 * `hard` cut whose declared attention targets sit in opposite frame quadrants
 * → `eye_trace_jump`. Boundary 2→3 is directional (`cut-right`), which
 * carries the eye → silent by design over the same class of geometry. Scene 3
 * fires two beats 0.6s apart on components across the frame →
 * advisory `eye_trace_pingpong`.
 */
function eyeTraceFilm(): { storyboard: DirectScene[]; html: string } {
  const storyboard: DirectScene[] = [
    {
      id: "jump-from",
      title: "Outgoing",
      purpose: "eye rests on the top-left panel",
      startSec: 0,
      durationSec: 3,
      cut: { version: 1, style: "hard" },
      spatialIntent: {
        version: 1,
        focalPart: "panel-a",
        composition: "top-left hero",
        relationships: [],
      },
    },
    {
      id: "jump-to",
      title: "Incoming",
      purpose: "hero appears bottom-right — an eye jump across a hard cut",
      startSec: 3,
      durationSec: 3,
      cut: { version: 1, style: "cut-right" },
      spatialIntent: {
        version: 1,
        focalPart: "panel-b",
        composition: "bottom-right hero",
        relationships: [],
      },
      components: [{ version: 1, id: "panel-b", kind: "stat-card", role: "hero" }],
    },
    {
      id: "ping",
      title: "Ping-pong",
      purpose: "two beats yank the eye across the frame",
      startSec: 6,
      durationSec: 3,
      components: [
        { version: 1, id: "pp-a", kind: "stat-card", role: "hero" },
        { version: 1, id: "pp-b", kind: "stat-card" },
      ],
      beats: [
        { version: 1, id: "pp-first", sceneId: "ping", component: "pp-a", kind: "highlight", atSec: 6.8 },
        { version: 1, id: "pp-second", sceneId: "ping", component: "pp-b", kind: "highlight", atSec: 7.4 },
      ],
    },
  ];
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<title>Eye trace smoke</title><script src="gsap.min.js"></script><style>
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0c1220}
body{color:#e8edf6;font-family:Arial,sans-serif}
#root{position:relative;width:1920px;height:1080px;overflow:hidden}
.scene{position:absolute;inset:0;opacity:0}
.panel{position:absolute;width:820px;height:520px;border-radius:24px;background:#22314a;display:grid;place-items:center;font-size:40px}
.small{width:400px;height:300px;font-size:30px}
.tl{left:100px;top:80px}
.br{left:1000px;top:480px}
.pp-far{left:1450px;top:640px}
</style></head><body>
<main id="root" data-composition-id="eye-trace-smoke" data-width="1920" data-height="1080" data-duration="9">
<section id="jump-from" class="scene clip" data-scene="jump-from" data-start="0" data-duration="3" data-track-index="1">
<div class="panel tl" data-part="panel-a" data-layout-important>top-left subject</div>
</section>
<section id="jump-to" class="scene clip" data-scene="jump-to" data-start="3" data-duration="3" data-track-index="1">
<div class="panel br" data-part="panel-b" data-layout-important>bottom-right hero</div>
</section>
<section id="ping" class="scene clip" data-scene="ping" data-start="6" data-duration="3" data-track-index="1">
<div class="panel tl" data-part="pp-a" data-layout-important>first beat target</div>
<div class="panel small pp-far" data-part="pp-b">second</div>
</section>
</main>
<script>
window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
tl.set("#jump-from",{opacity:1},0).set("#jump-from",{opacity:0},2.999);
tl.set("#jump-to",{opacity:1},3).set("#jump-to",{opacity:0},5.999);
tl.set("#ping",{opacity:1},6).set("#ping",{opacity:0},9);
// A quiet operated push keeps this eye-trace fixture honest under the
// independent rendered-liveness audit. It does not carry the eye across the
// hard cut; each scene scales around the same viewport center.
tl.fromTo("#jump-from",{scale:1},{scale:1.03,duration:2.98,ease:"none"},0);
tl.fromTo("#jump-to",{scale:1},{scale:1.03,duration:2.98,ease:"none"},3);
tl.fromTo("#ping",{scale:1},{scale:1.03,duration:2.98,ease:"none"},6);
tl.fromTo("#jump-to [data-part=panel-b]",{opacity:0},{opacity:1,duration:.3},3.15);
tl.to("#ping [data-part=pp-a]",{scale:1.04,duration:.25,yoyo:true,repeat:1},6.8);
tl.to("#ping [data-part=pp-b]",{scale:1.05,duration:.25,yoyo:true,repeat:1},7.4);
window.__timelines["eye-trace-smoke"]=tl;tl.seek(0);
</script></body></html>`;
  return { storyboard, html };
}

describe("eye-trace continuity browser audit", () => {
  it("flags the hard-cut jump (blocking) and the beat ping-pong (advisory)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-eyetrace-smoke-"));
    roots.push(dir);
    initializeProject(dir, { name: "Smoke", brandName: "Smoke", seedScreenshot: false });
    const draft = eyeTraceFilm();
    const qa = await inspectDirectComposition(dir, draft, { captureGuide: false });
    expect(qa.infraError).toBeUndefined();
    expect(qa.errors).toEqual([]);
    expect(qa.ok).toBe(true);
    const jumps = qa.issues.filter((issue) => issue.code === "eye_trace_jump");
    // The hard 1→2 boundary fires with measured centers…
    expect(jumps).toHaveLength(1);
    expect(jumps[0]!.severity).toBe("warning");
    expect(jumps[0]!.selector).toBe('[data-part="panel-b"]');
    expect(jumps[0]!.message).toMatch(/\d+%-of-frame-diagonal jump across a hard cut/);
    // …and the directional 2→3 boundary is exempt even though its geometry
    // also travels (cut-right carries the eye by design).
    const pingPong = qa.issues.filter((issue) => issue.code === "eye_trace_pingpong");
    expect(pingPong).toHaveLength(1);
    expect(pingPong[0]!.message).toContain('"pp-first" -> "pp-second"');
    expect(pingPong[0]!.eyeTracePingPong).toMatchObject({
      sceneId: "ping",
      firstBeatId: "pp-first",
      secondBeatId: "pp-second",
    });
    // This fixture exercises eye trace, not stopped-slide detection. Its
    // operated holds must satisfy the separate rendered-liveness obligation so
    // audit mode below can isolate the eye-trace disposition.
    expect(qa.issues.filter((issue) => issue.code === "motion_quiet_window")).toEqual([]);
    // The jump is a strictOk-blocking polish finding under the default mode.
    expect(qa.strictOk).toBe(false);

    // Audit mode: both findings stay reported, but neither blocks strictOk —
    // the ping-pong variant is advisory by design, the jump by mode.
    process.env.SLACK_SEQUENCES_EYE_TRACE = "audit";
    try {
      const auditQa = await inspectDirectComposition(dir, draft, { captureGuide: false });
      expect(auditQa.issues.some((issue) => issue.code === "eye_trace_jump")).toBe(true);
      expect(auditQa.issues.some((issue) => issue.code === "eye_trace_pingpong")).toBe(true);
      expect(auditQa.issues.some((issue) => issue.code === "motion_quiet_window")).toBe(false);
      expect(auditQa.ok).toBe(true);
      expect(auditQa.strictOk).toBe(true);
    } finally {
      delete process.env.SLACK_SEQUENCES_EYE_TRACE;
    }
  }, 120_000);
});
