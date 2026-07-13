import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyDeterministicSourceRepairs,
  NORMALIZERS,
  runSourceNormalizerRegistry,
  runSourceSyntaxNormalizerRegistry,
  stripUnboundConnectorSvgs,
} from "../src/engine/compositionRunner.ts";
import { auditSentinelNormalizerRegistry } from "../src/engine/sentinel.ts";
import {
  auditNormalizerDependencyGraph,
  type OrderedNormalizer,
} from "../src/engine/runner/normalizerRegistry.ts";

const SYNTAX_ORDER = [
  "normalize.root-data-start",
  "normalize.inline-source-syntax.css-var",
  "normalize.inline-source-syntax.template-selector",
  "normalize.inline-source-syntax.svg-placeholder",
  "normalize.inline-source-syntax.persisted-scene-arrow",
  "normalize.inline-source-syntax.connector-svg-policy",
  "normalize.inline-source-syntax.visibility",
  "normalize.gsap-call-shape",
] as const;

const FULL_ORDER = [
  ...SYNTAX_ORDER,
  "normalize.source-bindings.scene-id",
  "normalize.lint-font-var-artifact.font-face",
  "normalize.host-plan-islands.asset-reference",
  "normalize.inline-source-syntax.deterministic-random",
  "normalize.gsap-repeat-clamp",
  "normalize.station-position",
  "normalize.brand-base",
  "normalize.source-bindings.timeline-registration",
  "normalize.host-plan-islands.strip",
  "normalize.source-bindings.layout-intent",
  "normalize.source-bindings.interaction-near-miss",
  "normalize.source-bindings.contract",
  "normalize.source-bindings.camera-world",
  "normalize.host-plan-islands.environment",
  "normalize.host-plan-islands.display-type",
  "normalize.plugin-lower.source-inject",
  "normalize.source-bindings.component-pre-continuity",
  "normalize.source-bindings.component-style-scope",
  "normalize.source-bindings.component-region-home",
  "normalize.source-bindings.component-alias",
  "normalize.source-bindings.rows-markup",
  "normalize.source-bindings.chat-beat-targets",
  "normalize.source-bindings.underline-markup",
  "normalize.kit-chart-complete",
  "normalize.kit-progress-complete",
  "normalize.host-plan-islands.cuts",
  "normalize.source-bindings.camera-runtime",
  "normalize.host-plan-islands.camera",
  "normalize.host-plan-islands.continuity",
  "normalize.source-bindings.component-post-continuity",
  "normalize.host-plan-islands.components",
  "normalize.fx-plan.source-inject",
  "normalize.asset-lower.source-inject",
  "normalize.recipe-reconcile.source-inject",
  "normalize.source-bindings.liveness",
  "normalize.host-plan-islands.component-kit",
  "normalize.host-plan-islands.cinema-kit",
  "normalize.brand-base.cinema-profile",
  "normalize.world-layout-derive.styles",
  "normalize.source-bindings.layout-repair",
  "normalize.dead-tween-strip",
  "normalize.host-plan-islands.time",
  "normalize.source-bindings.compile-order",
  "normalize.source-bindings.runtime-order",
] as const;

describe("ordered source normalizer registry (WS-F1)", () => {
  it("golden-replays the migrated legacy prefix in exact order with automatic telemetry", () => {
    const source = [
      "<!doctype html>",
      '<main data-composition-id="golden">',
      '  <svg class="connector-lines"><path d="M0 0 L20 20"/></svg>',
      '  <svg class="product-graph" data-part="stamped-not-bound"><path d="M0 0 L20 20"/></svg>',
      '  <svg class="ornament"><path d="M0 0 C..."/></svg>',
      '  <div id="card"></div>',
      "  <script>",
      "    const tl = gsap.timeline({ paused: true });",
      '    tl.set("#card", { opacity: 0 }, 0);',
      '    tl.set("#card", { display: "grid", visibility: "visible", opacity: 1 }, 0.2);',
      '    tl.to("#card", { borderColor: var(--positive) }, 0.4);',
      '    const sel = ".active";',
      '    document.querySelector(`#card ${sel}`);',
      '    tl.fromTo("#card", { opacity: 1, duration: 0.01 }, 1);',
      "  </script>",
      "</main>",
    ].join("\n");
    const telemetry: Array<[string, number]> = [];
    const diagnostics: string[] = [];

    const result = runSourceSyntaxNormalizerRegistry(source, {
      recordTelemetry: (tag, count) => telemetry.push([tag, count]),
      writeDiagnostic: (message) => diagnostics.push(message),
    });

    expect(result.executedIds).toEqual(SYNTAX_ORDER);
    expect(result.changedIds).toEqual(
      SYNTAX_ORDER.filter((id) => id !== "normalize.inline-source-syntax.persisted-scene-arrow"),
    );
    expect(telemetry).toEqual([
      ["root-data-start", 1],
      ["bare-css-var", 1],
      ["template-literal-selector", 1],
      ["invalid-svg-placeholder", 1],
      ["connector-svg-policy", 2],
      ["gsap-display-visibility", 1],
      ["gsap-call-shape", 1],
    ]);
    expect(diagnostics).toHaveLength(7);
    expect(result.state).toBe([
      "<!doctype html>",
      '<main data-composition-id="golden" data-start="0">',
      "  ",
      "  ",
      '  <svg class="ornament"></svg>',
      '  <div id="card"></div>',
      "  <script>",
      "    const tl = gsap.timeline({ paused: true });",
      '    tl.set("#card", { opacity: 0 }, 0);',
      '    tl.set("#card", {opacity: 1 }, 0.2);',
      '    tl.to("#card", { borderColor: "var(--positive)" }, 0.4);',
      '    const sel = ".active";',
      '    document.querySelector("#card " + sel + "");',
      '    tl.to("#card", { opacity: 1, duration: 0.01 }, 1);',
      "  </script>",
      "</main>",
    ].join("\n"));

    const replayTelemetry: Array<[string, number]> = [];
    const replay = runSourceSyntaxNormalizerRegistry(result.state, {
      recordTelemetry: (tag, count) => replayTelemetry.push([tag, count]),
      writeDiagnostic: () => undefined,
    });
    expect(replay.state).toBe(result.state);
    expect(replay.executedIds).toEqual(SYNTAX_ORDER);
    expect(replay.changedIds).toEqual([]);
    expect(replayTelemetry).toEqual([]);
  });

  it("allows connector geometry only when the host-owned flow plugin owns it", () => {
    const source = [
      '<svg class="connector-map"><path d="M0 0L1 1"/></svg>',
      '<svg class="connector-map" data-part="cosmetic-stamp"><path d="M0 0L1 1"/></svg>',
      '<svg class="connector-map"><path data-edge-from="a" data-edge-to="b" d="M0 0L1 1"/></svg>',
      '<div class="connection-lines"><svg><path d="M0 0L1 1"/></svg></div>',
      '<svg class="connector-map" data-sequences-host="1"><path d="M0 0L1 1"/></svg>',
      '<svg class="illustration"><path d="M0 0L1 1"/></svg>',
    ].join("\n");
    const result = stripUnboundConnectorSvgs(source);
    expect(result.repairs).toBe(4);
    expect(result.html).not.toContain('<svg class="connector-map"><path d=');
    expect(result.html).not.toContain('data-part="cosmetic-stamp"');
    expect(result.html).not.toContain('data-edge-from="a"');
    expect(result.html).not.toContain('class="connection-lines"');
    expect(result.html).toContain('data-sequences-host="1"');
    expect(result.html).toContain('class="illustration"');
  });

  it("keeps registry ids unique and owned by L2 Sentinel rows", () => {
    expect(NORMALIZERS.map((entry) => entry.id)).toEqual(FULL_ORDER);
    const audit = auditSentinelNormalizerRegistry(FULL_ORDER);
    expect(audit.duplicateIds).toEqual([]);
    expect(audit.unknownIds).toEqual([]);
    expect(audit.wrongLayerIds).toEqual([]);
    expect(audit.unclassifiedSentinelIds).toEqual([]);
    expect(audit.unmigratedSentinelIds).toEqual([]);
    expect(audit.nonSourceSentinelIds.storyboard).toContain("normalize.camera-budget-clamp");
    expect(audit.nonSourceSentinelIds.browser).toContain("normalize.station-size-fit");
    expect(audit.nonSourceSentinelIds["source-slot"]).toEqual([
      "normalize.slot-script-envelope",
    ]);
  });

  it("declares an acyclic dependency graph with ordered writes and proof refs", () => {
    const audit = auditNormalizerDependencyGraph(NORMALIZERS);
    expect(audit).toEqual({
      duplicateIds: [],
      missingDependencies: [],
      cycles: [],
      orderViolations: [],
      writeConflicts: [],
      splitAtomicGroups: [],
    });
    expect(NORMALIZERS.every((entry) => entry.reads.length > 0)).toBe(true);
    expect(NORMALIZERS.every((entry) => entry.writes.length > 0)).toBe(true);
    expect(NORMALIZERS.every((entry) => entry.preconditions.length > 0)).toBe(true);
    expect(NORMALIZERS.every((entry) => entry.postconditions.length > 0)).toBe(true);
    expect(NORMALIZERS.every((entry) => entry.idempotenceTestRef.includes("normalizerRegistry.test.ts")))
      .toBe(true);
  });

  it("rejects write/write conflicts that have no declared order", () => {
    const first = NORMALIZERS[0]!;
    const second: OrderedNormalizer<string, never> = {
      ...first,
      id: "normalize.test-unordered-writer",
      orderingDependencies: [],
      run: (state) => ({ state, repairCount: 0 }),
    };
    const audit = auditNormalizerDependencyGraph([first, second]);
    expect(audit.writeConflicts).toEqual([
      "normalize.root-data-start <> normalize.test-unordered-writer: source.html",
    ]);
  });

  it("keeps the full registry byte-identical to the public repair seam and converges", () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-normalizers-"));
    try {
      const draft = {
        storyboard: [],
        html: [
          "<!doctype html>",
          "<html><head>",
          '<script src="gsap.min.js"></script>',
          "</head><body>",
          '<main data-composition-id="registry-parity">',
          '<script>const tl = gsap.timeline({ paused: true }); window.__timelines[key] = tl;</script>',
          "</main></body></html>",
        ].join("\n"),
      };
      const telemetry: Array<[string, number]> = [];
      const groupAudits: string[] = [];
      const first = runSourceNormalizerRegistry(
        draft.html,
        { draft, projectDir },
        {
          recordTelemetry: (tag, count) => telemetry.push([tag, count]),
          writeDiagnostic: () => undefined,
          auditAtomicGroup: ({ group }) => groupAudits.push(group),
        },
      );
      expect(first.executedIds).toEqual(FULL_ORDER);
      expect(first.auditedGroups).toEqual(["source-composition"]);
      expect(groupAudits).toEqual(["source-composition"]);
      expect(telemetry).toContainEqual(["root-data-start", 1]);

      const publicResult = applyDeterministicSourceRepairs(draft, projectDir);
      expect(publicResult.html).toBe(first.state);

      const replayTelemetry: Array<[string, number]> = [];
      const replayDraft = { ...draft, html: first.state };
      const replay = runSourceNormalizerRegistry(
        first.state,
        { draft: replayDraft, projectDir },
        {
          recordTelemetry: (tag, count) => replayTelemetry.push([tag, count]),
          writeDiagnostic: () => undefined,
        },
      );
      expect(replay.executedIds).toEqual(FULL_ORDER);
      expect(replay.state).toBe(first.state);
      expect(replayTelemetry).toEqual([]);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("reports duplicate, unknown, and wrong-layer ids at the validation seam", () => {
    const audit = auditSentinelNormalizerRegistry([
      ...FULL_ORDER,
      FULL_ORDER[0],
      "normalize.not-registered",
      "camera.world-plane",
    ]);
    expect(audit.duplicateIds).toEqual([FULL_ORDER[0]]);
    expect(audit.unknownIds).toEqual(["normalize.not-registered"]);
    expect(audit.wrongLayerIds).toEqual(["camera.world-plane"]);
  });
});
