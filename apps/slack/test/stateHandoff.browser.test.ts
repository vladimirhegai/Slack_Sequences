import { createRequire } from "node:module";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { launchHeadlessBrowser } from "../src/engine/browserLifecycle.ts";
import {
  COMPONENT_RUNTIME_FILE,
  componentRuntimeSource,
  resolveComponentPlan,
} from "../src/engine/componentContract.ts";
import { resolveContinuityGraph } from "../src/engine/continuityGraph.ts";
import { CUT_RUNTIME_FILE, cutRuntimeSource, resolveCutPlan } from "../src/engine/cutContract.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { findBrowserExecutable } from "../src/engine/render.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function metricScene(
  id: string,
  startSec: number,
  part: string,
  value: number,
  kind: "stat-card" | "app-window" = "stat-card",
): DirectScene {
  return {
    id,
    title: id,
    purpose: "advance one persistent release score",
    startSec,
    durationSec: 3,
    components: [{ version: 1, id: part, kind, role: "hero", entityId: "release-score" }],
    beats: [{
      version: 1,
      id: `${part}-count`,
      sceneId: id,
      component: part,
      kind: "count",
      atSec: startSec + 0.5,
      durationSec: 0.8,
      value,
    }],
  };
}

function stateFilm(includeContinuity = true): string {
  const scenes: DirectScene[] = [
    { ...metricScene("signal", 0, "score-38", 38), cut: { version: 1, style: "swipe", axis: "left" } },
    { ...metricScene("proof", 3, "score-71", 71), cut: { version: 1, style: "swipe", axis: "left" } },
    {
      ...metricScene("resolve", 6, "score-94", 94),
      cut: {
        version: 1,
        style: "morph",
        focalPartOut: "score-94",
        focalPartIn: "gate-shell",
      },
    },
    metricScene("gate", 9, "gate-shell", 99, "app-window"),
  ];
  const components = resolveComponentPlan(scenes);
  const cuts = resolveCutPlan(scenes);
  const continuity = resolveContinuityGraph(scenes);
  const sections = scenes.map((scene, index) => {
    const part = scene.components![0]!.id;
    const kind = scene.components![0]!.kind;
    return `<section class="scene" data-scene="${scene.id}" data-start="${scene.startSec}" data-duration="3">` +
      `<div class="cmp ${kind === "app-window" ? "cmp-window" : "cmp-stat"}" data-component="${kind}" ` +
      `data-part="${part}" data-continuity-entity="release-score">` +
      `<div class="chrome">${kind === "app-window" ? "GatePilot" : "Score"}</div>` +
      `<div class="cmp-value" data-cmp-value>${[38, 71, 94, 99][index]}%</div>` +
      `${kind === "app-window" ? "<div class=body><div>Policy</div><div>Owner</div><div>Status</div></div>" : ""}` +
      `</div></section>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><script src="gsap.min.js"></script>` +
    `<script src="${CUT_RUNTIME_FILE}"></script><script src="${COMPONENT_RUNTIME_FILE}"></script>` +
    `<style>*{box-sizing:border-box}html,body,#root,.scene{margin:0;width:1920px;height:1080px;overflow:hidden}` +
    `#root,.scene{position:absolute;inset:0}.scene{opacity:0;display:grid;place-items:center;background:#fff}` +
    `.cmp{background:#172033;color:#fff;border-radius:28px;padding:36px;font:700 48px Arial}` +
    `.cmp-stat{width:520px;height:300px}.cmp-window{width:1200px;height:700px}` +
    `.cmp-value{font-size:112px}.body{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:120px}</style>` +
    `</head><body><main id="root" data-composition-id="state-handoff" data-duration="12">${sections}</main>` +
    `<script type="application/json" id="sequences-cuts">${JSON.stringify(cuts)}</script>` +
    `<script type="application/json" id="sequences-components">${JSON.stringify(components)}</script>` +
    (includeContinuity
      ? `<script type="application/json" id="sequences-continuity">${JSON.stringify(continuity)}</script>`
      : "") +
    `<script>window.__timelines={};const tl=gsap.timeline({paused:true});` +
    scenes.map((scene) =>
      `tl.set('[data-scene="${scene.id}"]',{opacity:1},${scene.startSec})` +
      `.set('[data-scene="${scene.id}"]',{opacity:0},${scene.startSec + scene.durationSec - 0.001});`
    ).join("") +
    `SequencesCuts.compile(tl,document.getElementById('root'));` +
    `SequencesComponents.compile(tl,document.getElementById('root'));` +
    `window.__timelines['state-handoff']=tl;tl.seek(0,false);</script></body></html>`;
}

function selectionFilm(): string {
  const scenes: DirectScene[] = [
    {
      id: "choose", title: "Choose", purpose: "select the owner", startSec: 0, durationSec: 3,
      components: [{ version: 1, id: "owner-list-a", kind: "sidebar", entityId: "owner-list" }],
      beats: [{
        version: 1, id: "choose-owner", sceneId: "choose", component: "owner-list-a",
        kind: "select", atSec: 0.5, durationSec: 0.6, item: 2,
      }],
      cut: {
        version: 1, style: "morph", focalPartOut: "owner-list-a", focalPartIn: "owner-list-b",
      },
    },
    {
      id: "confirm", title: "Confirm", purpose: "confirm the owner", startSec: 3, durationSec: 3,
      components: [{ version: 1, id: "owner-list-b", kind: "sidebar", entityId: "owner-list" }],
      beats: [{
        version: 1, id: "confirm-owner", sceneId: "confirm", component: "owner-list-b",
        kind: "select", atSec: 3.5, durationSec: 0.6, item: 3,
      }],
    },
  ];
  const rows = `<div class="cmp-row active">Ari</div><div class="cmp-row">Bo</div><div class="cmp-row">Cam</div>`;
  const sections = scenes.map((scene) =>
    `<section class="scene" data-scene="${scene.id}" data-start="${scene.startSec}" data-duration="3">` +
    `<div class="cmp-list" data-component="sidebar" data-part="${scene.components![0]!.id}">${rows}</div>` +
    `</section>`
  ).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><script src="gsap.min.js"></script>` +
    `<script src="${CUT_RUNTIME_FILE}"></script><script src="${COMPONENT_RUNTIME_FILE}"></script>` +
    `<style>*{box-sizing:border-box}html,body,#root,.scene{margin:0;width:1920px;height:1080px;overflow:hidden}` +
    `#root,.scene{position:absolute;inset:0}.scene{opacity:0;display:grid;place-items:center;background:#fff}` +
    `.cmp-list{width:520px;padding:24px;background:#172033;color:#fff}.cmp-row{padding:24px}` +
    `.cmp-row.active{background:#5b7cfa}</style></head><body>` +
    `<main id="root" data-composition-id="selection-handoff" data-duration="6">${sections}</main>` +
    `<script type="application/json" id="sequences-cuts">${JSON.stringify(resolveCutPlan(scenes))}</script>` +
    `<script type="application/json" id="sequences-components">${JSON.stringify(resolveComponentPlan(scenes))}</script>` +
    `<script type="application/json" id="sequences-continuity">${JSON.stringify(resolveContinuityGraph(scenes))}</script>` +
    `<script>window.__timelines={};const tl=gsap.timeline({paused:true});` +
    `tl.set('[data-scene="choose"]',{opacity:1},0).set('[data-scene="choose"]',{opacity:0},2.999);` +
    `tl.set('[data-scene="confirm"]',{opacity:1},3).set('[data-scene="confirm"]',{opacity:0},5.999);` +
    `SequencesCuts.compile(tl,document.getElementById('root'));` +
    `SequencesComponents.compile(tl,document.getElementById('root'));` +
    `window.__timelines['selection-handoff']=tl;tl.seek(0,false);</script></body></html>`;
}

function serve(dir: string): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const file = path.resolve(dir, "." + pathname.replace(/\/$/, "/index.html"));
      if (!file.startsWith(path.resolve(dir)) || !fs.existsSync(file)) {
        response.writeHead(404); response.end(); return;
      }
      response.writeHead(200, { "content-type": path.extname(file) === ".js" ? "text/javascript" : "text/html" });
      response.end(fs.readFileSync(file));
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("could not bind browser fixture"));
      resolve({
        url: `http://127.0.0.1:${address.port}/index.html`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

describe("typed continuity state handoff browser contract", () => {
  it("never resets 38→71→94 and degrades an impossible cross-kind morph seek-safely", async () => {
    const executablePath = findBrowserExecutable();
    expect(executablePath).toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-state-handoff-"));
    roots.push(dir);
    fs.writeFileSync(path.join(dir, "index.html"), stateFilm(), "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, CUT_RUNTIME_FILE), cutRuntimeSource(), "utf8");
    fs.writeFileSync(path.join(dir, COMPONENT_RUNTIME_FILE), componentRuntimeSource(), "utf8");
    const server = await serve(dir);
    const browser = await launchHeadlessBrowser({
      executablePath: executablePath!,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
      const at = (time: number, part: string) => page.evaluate(({ time, part }) => {
        const win = window as unknown as {
          __timelines: Record<string, { seek: (at: number, suppress?: boolean) => void }>;
        };
        win.__timelines["state-handoff"]!.seek(time, false);
        const el = document.querySelector<HTMLElement>(`[data-part="${part}"]`)!;
        return Number(el.querySelector<HTMLElement>("[data-cmp-value]")!.textContent!.replace(/[^0-9.-]/g, ""));
      }, { time, part });

      expect(await at(3.05, "score-71")).toBe(38);
      expect(await at(6.05, "score-94")).toBe(71);
      expect(await at(9.05, "gate-shell")).toBe(94);
      expect(await at(4.4, "score-71")).toBe(71);
      expect(await at(7.4, "score-94")).toBe(94);
      expect(await at(3.05, "score-71")).toBe(38);

      const binding = await page.evaluate(() => {
        const bindings = (window as unknown as {
          __sequencesCutBindings: Array<{ cut: { fromScene: string }; degraded?: boolean; target?: string; reason?: string }>;
        }).__sequencesCutBindings;
        const found = bindings.find((entry) => entry.cut.fromScene === "resolve");
        return found
          ? { degraded: found.degraded, target: found.target, reason: found.reason }
          : null;
      });
      expect(binding).toMatchObject({ degraded: true });
      expect(binding?.target).toMatch(/^swipe-/);
      expect(binding?.reason).toContain("different semantic families");
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 30_000);

  it("degrades a morph when continuity state proof is absent", async () => {
    const executablePath = findBrowserExecutable();
    expect(executablePath).toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-state-proof-"));
    roots.push(dir);
    fs.writeFileSync(path.join(dir, "index.html"), stateFilm(false), "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, CUT_RUNTIME_FILE), cutRuntimeSource(), "utf8");
    fs.writeFileSync(path.join(dir, COMPONENT_RUNTIME_FILE), componentRuntimeSource(), "utf8");
    const server = await serve(dir);
    const browser = await launchHeadlessBrowser({
      executablePath: executablePath!,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
      const binding = await page.evaluate(() => {
        const bindings = (window as unknown as {
          __sequencesCutBindings: Array<{ cut: { fromScene: string }; degraded?: boolean; reason?: string }>;
        }).__sequencesCutBindings;
        const found = bindings.find((entry) => entry.cut.fromScene === "resolve");
        return found ? { degraded: found.degraded, reason: found.reason } : null;
      });
      expect(binding).toMatchObject({
        degraded: true,
        reason: "continuity state transfer proof is absent",
      });
    } finally {
      await browser.close();
      await server.close();
    }
  }, 30_000);

  it("captures the transferred selection in the incoming morph clone", async () => {
    const executablePath = findBrowserExecutable();
    expect(executablePath).toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-selection-proof-"));
    roots.push(dir);
    fs.writeFileSync(path.join(dir, "index.html"), selectionFilm(), "utf8");
    const require = createRequire(import.meta.url);
    fs.copyFileSync(require.resolve("gsap/dist/gsap.min.js"), path.join(dir, "gsap.min.js"));
    fs.writeFileSync(path.join(dir, CUT_RUNTIME_FILE), cutRuntimeSource(), "utf8");
    fs.writeFileSync(path.join(dir, COMPONENT_RUNTIME_FILE), componentRuntimeSource(), "utf8");
    const server = await serve(dir);
    const browser = await launchHeadlessBrowser({
      executablePath: executablePath!,
      headless: true,
      args: ["--hide-scrollbars", "--mute-audio", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
      const activeRows = await page.evaluate(() => {
        const bridges = document.querySelectorAll<HTMLElement>(
          '[data-sequences-runtime-cut="bridge"][data-sequences-cut-from="choose"]',
        );
        return Array.from(bridges[1]!.querySelectorAll<HTMLElement>(".cmp-row"))
          .map((row) => row.classList.contains("active"));
      });
      expect(activeRows).toEqual([false, true, false]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 30_000);
});
