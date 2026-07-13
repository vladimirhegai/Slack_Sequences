import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { applyDeterministicSourceRepairs } from "../src/engine/compositionRunner.ts";
import {
  continuityGraphEnabled,
  normalizeStoryboardContinuity,
  parseContinuityGraph,
  reconcileContinuityBindings,
  resolveContinuityGraph,
} from "../src/engine/continuityGraph.ts";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function scene(
  id: string,
  startSec: number,
  part: string,
  extra: Partial<DirectScene> = {},
): DirectScene {
  return {
    id,
    title: id,
    purpose: "carry one product object",
    startSec,
    durationSec: 3,
    components: [{
      version: 1,
      id: part,
      kind: "app-window",
      role: "hero",
      entityId: "product-shell",
    }],
    spatialIntent: {
      version: 1,
      focalPart: part,
      composition: "product frame",
      relationships: [],
    },
    ...extra,
  };
}

describe("continuity graph", () => {
  it("is enabled by default and keeps an explicit zero rollback", () => {
    expect(continuityGraphEnabled()).toBe(true);
    vi.stubEnv("SLACK_SEQUENCES_CONTINUITY_GRAPH", "0");
    expect(continuityGraphEnabled()).toBe(false);
    vi.stubEnv("SLACK_SEQUENCES_CONTINUITY_GRAPH", "1");
    expect(continuityGraphEnabled()).toBe(true);
  });

  it("keeps one semantic product shell through three renamed representations", () => {
    const scenes = [
      scene("overview", 0, "shell-overview", { cut: { version: 1, style: "swipe", axis: "left" } }),
      scene("trace", 3, "shell-trace", { cut: { version: 1, style: "hard" } }),
      scene("resolve", 6, "shell-resolve"),
    ];
    const graph = resolveContinuityGraph(scenes);
    const shell = graph.entities.find((entity) => entity.id === "product-shell");
    expect(shell?.appearances.map((appearance) => appearance.part)).toEqual([
      "shell-overview",
      "shell-trace",
      "shell-resolve",
    ]);
    expect(shell?.traceableAcrossShots).toBe(3);
    expect(graph.summary.threeShotEntityCount).toBe(1);
    expect(graph.edges.map((edge) => edge.mode)).toEqual(["cut-owned", "shared-element"]);
  });

  it("lets an existing bridged cut own the handoff and reacquires across a skipped shot", () => {
    const scenes = [
      scene("one", 0, "trace-a", {
        continuity: [{ version: 1, entityId: "trace", part: "trace-a", kind: "trace" }],
        cut: {
          version: 1,
          style: "match",
          focalPartOut: "trace-a",
          focalPartIn: "trace-b",
        },
      }),
      scene("two", 3, "trace-b", {
        continuity: [{ version: 1, entityId: "trace", part: "trace-b", kind: "trace" }],
      }),
      scene("interlude", 6, "other"),
      scene("four", 9, "trace-d", {
        continuity: [{ version: 1, entityId: "trace", part: "trace-d", kind: "trace" }],
      }),
    ];
    const traceEdges = resolveContinuityGraph(scenes).edges.filter((edge) => edge.entityId === "trace");
    expect(traceEdges.map((edge) => edge.mode)).toEqual(["cut-owned", "reacquire"]);
  });

  it("gives the whole moving boundary one compositor even when its focal differs", () => {
    const scenes = [
      scene("one", 0, "shell-a", {
        cut: {
          version: 1,
          style: "morph",
          focalPartOut: "brief-lockup",
          focalPartIn: "hero-metric",
        },
      }),
      scene("two", 3, "shell-b"),
    ];
    const shellEdge = resolveContinuityGraph(scenes).edges.find(
      (edge) => edge.entityId === "product-shell",
    );
    expect(shellEdge).toMatchObject({
      fromPart: "shell-a",
      toPart: "shell-b",
      mode: "cut-owned",
    });
  });

  it("lets a typed swipe carry continuity on its scene plates", () => {
    const graph = resolveContinuityGraph([
      scene("one", 0, "shell-a", { cut: { version: 1, style: "swipe", axis: "left" } }),
      scene("two", 3, "shell-b"),
    ]);
    expect(graph.edges.find((edge) => edge.entityId === "product-shell")?.mode).toBe("cut-owned");
  });

  it("carries resolved metric state and proves only compatible endpoint transfers", () => {
    const metricScene = (id: string, startSec: number, part: string, value: number, kind: "stat-card" | "app-window" = "stat-card"): DirectScene => ({
      id,
      title: id,
      purpose: "advance one persistent metric",
      startSec,
      durationSec: 3,
      components: [{ version: 1, id: part, kind, entityId: "release-score" }],
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
    });
    const compatible = resolveContinuityGraph([
      { ...metricScene("one", 0, "score-a", 38), cut: { version: 1, style: "swipe", axis: "left" } },
      { ...metricScene("two", 3, "score-b", 71), cut: { version: 1, style: "morph", focalPartOut: "score-b", focalPartIn: "score-c" } },
      metricScene("three", 6, "score-c", 94),
    ]);
    expect(compatible.entities.find((entity) => entity.id === "release-score")?.state)
      .toEqual({ kind: "metric", value: 94 });
    expect(compatible.edges.map((edge) => ({ value: edge.state?.value, proof: edge.stateTransfer })))
      .toEqual([{ value: 38, proof: true }, { value: 71, proof: true }]);

    const impossible = resolveContinuityGraph([
      { ...metricScene("metric", 0, "score", 71), cut: { version: 1, style: "morph", focalPartOut: "score", focalPartIn: "shell" } },
      {
        id: "shell", title: "shell", purpose: "show a product shell", startSec: 3, durationSec: 3,
        components: [{ version: 1, id: "shell", kind: "app-window", entityId: "release-score" }],
        beats: [{
          version: 1, id: "shell-ready", sceneId: "shell", component: "shell",
          kind: "set-state", atSec: 3.5, durationSec: 0.4, toState: "ready",
        }],
      },
    ]);
    expect(impossible.edges[0]).toMatchObject({ stateTransfer: false });
    expect(impossible.edges[0]?.state).toBeUndefined();
  });

  it("carries the last resolved state through an appearance with no new beat", () => {
    const metric = (
      id: string,
      startSec: number,
      part: string,
      value?: number,
    ): DirectScene => ({
      id,
      title: id,
      purpose: "hold one persistent metric",
      startSec,
      durationSec: 3,
      components: [{ version: 1, id: part, kind: "stat-card", entityId: "release-score" }],
      ...(value === undefined
        ? {}
        : {
            beats: [{
              version: 1 as const,
              id: `${part}-count`,
              sceneId: id,
              component: part,
              kind: "count" as const,
              atSec: startSec + 0.5,
              durationSec: 0.8,
              value,
            }],
          }),
    });
    const graph = resolveContinuityGraph([
      metric("one", 0, "score-a", 38),
      metric("hold", 3, "score-b"),
      metric("three", 6, "score-c", 94),
    ]);

    expect(graph.entities[0]?.appearances.map((appearance) => appearance.state?.value))
      .toEqual([38, 38, 94]);
    expect(graph.edges.map((edge) => ({ value: edge.state?.value, proof: edge.stateTransfer })))
      .toEqual([{ value: 38, proof: true }, { value: 38, proof: true }]);
  });

  it("chooses one canonical representation per shot and never emits self-edges", () => {
    const middle = scene("middle", 3, "shell-middle", {
      components: [
        {
          version: 1,
          id: "nav-sidebar",
          kind: "sidebar",
          role: "support",
          entityId: "product-shell",
        },
        {
          version: 1,
          id: "shell-middle",
          kind: "app-window",
          role: "hero",
          entityId: "product-shell",
        },
        { version: 1, id: "trace-path", kind: "chart-line", entityId: "trace" },
        { version: 1, id: "trace-list", kind: "list", role: "hero", entityId: "trace" },
      ],
    });
    const graph = resolveContinuityGraph([
      scene("first", 0, "shell-first", { cut: { version: 1, style: "hard" } }),
      { ...middle, cut: { version: 1, style: "hard" } },
      scene("last", 6, "shell-last"),
    ]);
    const shellEdges = graph.edges.filter((edge) => edge.entityId === "product-shell");
    expect(shellEdges).toHaveLength(2);
    expect(shellEdges[0]?.toPart).toBe("shell-middle");
    expect(shellEdges[1]?.fromPart).toBe("shell-middle");
    expect(graph.edges.some((edge) => edge.fromScene === edge.toScene)).toBe(false);
    expect(graph.edges.some((edge) => edge.entityId === "trace")).toBe(false);
  });

  it("normalizes declarations and stamps exact DOM parts without author paperwork", () => {
    expect(normalizeStoryboardContinuity([
      { version: 1, entityId: "trace", part: "trace-a", kind: "trace", representation: " chip " },
      { version: 1, entityId: "Bad ID", part: "nope" },
    ])).toEqual([{
      version: 1,
      entityId: "trace",
      part: "trace-a",
      kind: "trace",
      representation: "chip",
    }]);
    const graph = resolveContinuityGraph([
      scene("one", 0, "trace-a", {
        continuity: [{ version: 1, entityId: "trace", part: "trace-a", kind: "trace" }],
      }),
      scene("two", 3, "trace-b", {
        continuity: [{ version: 1, entityId: "trace", part: "trace-b", kind: "trace" }],
      }),
    ]);
    const stamped = reconcileContinuityBindings(
      '<section data-scene="one"><div data-part="trace-a"></div></section>' +
        '<section data-scene="two"><div data-part="trace-b"></div></section>',
      graph,
    );
    expect(stamped.stamped).toBe(2);
    expect(stamped.html.match(/data-continuity-entity="trace"/g)).toHaveLength(2);

    const island = `<script type="application/json" id="sequences-continuity">${JSON.stringify(graph)}</script>`;
    expect(parseContinuityGraph(island)?.summary.multiShotEntityCount).toBeGreaterThanOrEqual(1);
  });

  it("injects the graph, blocking plan, runtime, compile call, and DOM identities in one host pass", () => {
    vi.stubEnv("SLACK_SEQUENCES_CONTINUITY_GRAPH", "1");
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-continuity-inject-"));
    roots.push(projectDir);
    const storyboard = [
      scene("overview", 0, "shell-overview", { cut: { version: 1, style: "hard" } }),
      scene("detail", 3, "shell-detail", { cut: { version: 1, style: "hard" } }),
      scene("resolve", 6, "shell-resolve"),
    ];
    const sections = storyboard.map((entry) =>
      `<section class="scene clip" data-scene="${entry.id}" data-start="${entry.startSec}" ` +
      `data-duration="3" data-track-index="1"><div data-part="${entry.components![0]!.id}" ` +
      `data-component="app-window">Product</div></section>`
    ).join("");
    const html = `<!doctype html><html><head><script src="gsap.min.js"></script></head><body>` +
      `<main data-composition-id="continuity-inject" data-width="1920" data-height="1080" data-duration="9">` +
      `${sections}</main><script>window.__timelines={};const tl=gsap.timeline({paused:true});` +
      `window.__timelines["continuity-inject"]=tl;</script></body></html>`;
    const repaired = applyDeterministicSourceRepairs({ html, storyboard }, projectDir, storyboard).html;
    expect(repaired).toContain('id="sequences-continuity"');
    expect(repaired).toContain('id="sequences-camera-blocking"');
    expect(repaired).toContain('src="sequences-continuity.v1.js"');
    expect(repaired).toContain("SequencesContinuity.compile(tl");
    expect(repaired.match(/data-continuity-entity="product-shell"/g)).toHaveLength(3);
  });
});
