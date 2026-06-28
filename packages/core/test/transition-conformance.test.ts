import { describe, it, expect } from "vitest";
import { lintHyperframeHtml } from "@hyperframes/core/lint";
import { compile } from "../src/compiler.ts";
import { createDefaultProject } from "../src/defaults.ts";
import { testAsset } from "./helpers.ts";
import { TransitionKindSchema, type TransitionKind } from "../src/schema.ts";

// Every transition kind the schema accepts must survive HyperFrames' own linter
// — the golden/conformance test only exercises the default cut/fade path, so the
// shader/wipe/slide kinds would otherwise ship untested against the substrate.
const KINDS = TransitionKindSchema.options as readonly TransitionKind[];

describe("transition substrate conformance", () => {
  for (const kind of KINDS) {
    it(`compiles "${kind}" transitions that pass the HF linter`, async () => {
      const dashboard = testAsset("dashboard", "assets/dashboard.svg");
      const project = createDefaultProject({
        title: "Transition Conformance",
        brandName: "Acme",
        screenshotAssetId: dashboard.id,
      });
      project.assets.push(dashboard);
      project.transitions = {};
      for (let i = 0; i < project.scenes.length - 1; i++) {
        project.transitions[project.scenes[i]!.id] = kind;
      }
      const { html } = compile(project);
      const result = await lintHyperframeHtml(html);
      const errors = result.findings.filter((f: { severity: string }) => f.severity === "error");
      expect(errors, `${kind}: ${JSON.stringify(errors, null, 2)}`).toEqual([]);
    });
  }
});
