import { createHash } from "node:crypto";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCutPlan, validateCutContract } from "../src/engine/cutContract.ts";
import { validateCameraContract } from "../src/engine/cameraContract.ts";
import { validateComponentContract } from "../src/engine/componentContract.ts";
import { validateInteractionContract } from "../src/engine/interactionContract.ts";
import { validateTimeRampContract } from "../src/engine/timeRamp.ts";
import { validateFxContract } from "../src/engine/fxContract.ts";
import { validateAssetContract } from "../src/engine/assetRuntime.ts";
import {
  injectEnvironmentContract,
  stageEnvironmentAssets,
} from "../src/engine/environmentContract.ts";
import {
  ASSET_HOST_CONTRACT,
  CAMERA_HOST_CONTRACT,
  COMPONENT_HOST_CONTRACT,
  CONTINUITY_HOST_CONTRACT,
  CUT_HOST_CONTRACT,
  ENVIRONMENT_HOST_CONTRACT,
  FX_HOST_CONTRACT,
  HOST_CONTRACT_REGISTRY,
  HOST_CONTRACTS,
  INTERACTION_HOST_CONTRACT,
  TIME_HOST_CONTRACT,
  hostContract,
  runHostContractLifecycle,
  type ContractResult,
  type HostContractValidationContext,
} from "../src/engine/hostContract.ts";

const IDS = [
  "interaction",
  "cut",
  "camera",
  "continuity",
  "component",
  "time",
  "fx",
  "asset",
  "environment",
] as const;

function normalized(
  legacy: { errors: string[]; warnings?: string[] },
): ContractResult {
  return {
    ok: legacy.errors.length === 0,
    findings: [...legacy.errors],
    warnings: [...(legacy.warnings ?? [])],
    repairs: [],
  };
}

function malformedIsland(id: string): string {
  return `<script type="application/json" id="${id}">{broken</script>`;
}

describe("shared host contract registry", () => {
  it("registers each contract exactly once in stable catalog order", () => {
    expect(HOST_CONTRACTS.map((contract) => contract.id)).toEqual(IDS);
    expect(HOST_CONTRACT_REGISTRY.size).toBe(IDS.length);
    expect(new Set(HOST_CONTRACTS.map((contract) => contract.id)).size).toBe(IDS.length);
    expect(Object.isFrozen(HOST_CONTRACTS)).toBe(true);

    for (const id of IDS) {
      const contract = hostContract(id);
      expect(contract).toBe(HOST_CONTRACT_REGISTRY.get(id));
      expect(Object.isFrozen(contract)).toBe(true);
    }
  });

  it("has unique runtime/kit files and deterministic source hashes", () => {
    const artifacts = HOST_CONTRACTS.flatMap((contract) => [
      { owner: contract.id, kind: "runtime", artifact: contract },
      ...(contract.kit
        ? [{ owner: contract.id, kind: "kit", artifact: contract.kit }]
        : []),
    ]);
    const files = artifacts.map(({ artifact }) => artifact.file);
    expect(new Set(files).size).toBe(files.length);

    for (const { owner, kind, artifact } of artifacts) {
      const firstSource = artifact.source();
      const secondSource = artifact.source();
      const expectedHash = createHash("sha256").update(firstSource).digest("hex");
      expect(firstSource, `${owner}:${kind} source`).toBe(secondSource);
      expect(artifact.hash(), `${owner}:${kind} hash`).toBe(expectedHash);
      expect(artifact.hash(), `${owner}:${kind} replay hash`).toBe(expectedHash);
      expect(artifact.hash()).toMatch(/^[a-f0-9]{64}$/);
      expect(artifact.file).toContain(`.v${artifact.version}.`);
    }
  });

  it("exposes canonical idempotent runtime and kit injection", () => {
    const shell = "<!doctype html><html><head><script src=\"gsap.min.js\"></script>" +
      "<style>body{margin:0}</style></head><body></body></html>";

    for (const contract of HOST_CONTRACTS) {
      const once = contract.inject(shell);
      const twice = contract.inject(once);
      expect(twice, contract.id).toBe(once);
      expect(once.split(contract.file).length - 1, contract.id).toBe(1);
      expect(once.indexOf(contract.file), contract.id)
        .toBeGreaterThan(once.indexOf("gsap.min.js"));
    }

    for (const contract of [COMPONENT_HOST_CONTRACT, ENVIRONMENT_HOST_CONTRACT]) {
      const kit = contract.kit!;
      const once = kit.inject(shell);
      expect(kit.inject(once), `${contract.id} kit`).toBe(once);
      expect(once.split(kit.file).length - 1, `${contract.id} kit`).toBe(0);
      expect(once).toContain(`data-version="${kit.version}"`);
      expect(once).toContain(kit.source());
    }
  });

  it("publishes the legacy capability matrix without inventing missing gates", () => {
    expect(HOST_CONTRACTS.map((contract) => ({
      id: contract.id,
      parse: Boolean(contract.parse),
      planInjection: Boolean(contract.injectPlan),
      kit: Boolean(contract.kit),
      stage: Boolean(contract.stage),
    }))).toEqual([
      { id: "interaction", parse: true, planInjection: false, kit: false, stage: false },
      { id: "cut", parse: true, planInjection: false, kit: false, stage: false },
      { id: "camera", parse: true, planInjection: false, kit: false, stage: false },
      { id: "continuity", parse: true, planInjection: false, kit: false, stage: false },
      { id: "component", parse: true, planInjection: false, kit: true, stage: false },
      { id: "time", parse: true, planInjection: false, kit: false, stage: false },
      { id: "fx", parse: true, planInjection: false, kit: false, stage: false },
      { id: "asset", parse: true, planInjection: false, kit: false, stage: false },
      { id: "environment", parse: true, planInjection: true, kit: true, stage: true },
    ]);
    expect(HOST_CONTRACTS.every((contract) => typeof contract.validate === "function"))
      .toBe(true);
    const environmentPlanInjector: typeof injectEnvironmentContract =
      ENVIRONMENT_HOST_CONTRACT.injectPlan!;
    const environmentStager: typeof stageEnvironmentAssets = ENVIRONMENT_HOST_CONTRACT.stage!;
    expect(environmentPlanInjector).toBe(injectEnvironmentContract);
    expect(environmentStager).toBe(stageEnvironmentAssets);
  });

  it("normalizes parse errors while preserving legacy parser semantics", () => {
    const html = malformedIsland("sequences-cuts");
    const legacy = parseCutPlan(html);
    expect(CUT_HOST_CONTRACT.parse!(html)).toEqual({
      ok: false,
      findings: legacy.errors,
      warnings: [],
      repairs: [],
    });

    const valid = CUT_HOST_CONTRACT.parse!(
      '<script type="application/json" id="sequences-cuts">{"version":1,"cuts":[]}</script>',
    );
    expect(valid).toEqual({
      ok: true,
      findings: [],
      warnings: [],
      repairs: [],
      plan: { version: 1, cuts: [] },
    });

    // Continuity's existing parser intentionally makes malformed and absent
    // islands indistinguishable. The adapter records that behavior verbatim.
    expect(CONTINUITY_HOST_CONTRACT.parse!(malformedIsland("sequences-continuity")))
      .toEqual({ ok: true, findings: [], warnings: [], repairs: [] });
    expect(ASSET_HOST_CONTRACT.parse!(malformedIsland("sequences-assets"))).toMatchObject({
      ok: false,
      warnings: [],
      repairs: [],
    });
  });

  it("delegates validation byte-for-byte and only renames errors to findings", () => {
    const base: Pick<HostContractValidationContext, "scenes"> & { durationSec: number } = {
      scenes: [],
      durationSec: 0,
    };
    const cases = [
      {
        contract: CUT_HOST_CONTRACT,
        html: malformedIsland("sequences-cuts"),
        legacy: (html: string) => validateCutContract(html, base.scenes),
      },
      {
        contract: CAMERA_HOST_CONTRACT,
        html: malformedIsland("sequences-camera"),
        legacy: (html: string) => validateCameraContract(html, base.scenes),
      },
      {
        contract: COMPONENT_HOST_CONTRACT,
        html: malformedIsland("sequences-components"),
        legacy: (html: string) => validateComponentContract(html, base.scenes),
      },
      {
        contract: INTERACTION_HOST_CONTRACT,
        html: malformedIsland("sequences-interactions"),
        legacy: (html: string) => validateInteractionContract(html, base.scenes, base.durationSec),
      },
      {
        contract: TIME_HOST_CONTRACT,
        html: malformedIsland("sequences-time"),
        legacy: (html: string) => validateTimeRampContract(html, base.scenes),
      },
      {
        contract: FX_HOST_CONTRACT,
        html: malformedIsland("sequences-fx"),
        legacy: (html: string) => validateFxContract(html, base.scenes),
      },
      {
        contract: ASSET_HOST_CONTRACT,
        html: "",
        legacy: (html: string) => validateAssetContract(html, base.scenes),
      },
    ] as const;

    for (const entry of cases) {
      const context = { ...base, html: entry.html };
      expect(entry.contract.validate(undefined, context), entry.contract.id)
        .toEqual(normalized(entry.legacy(entry.html)));
    }

    expect(CONTINUITY_HOST_CONTRACT.validate(undefined, { ...base, html: "broken" }))
      .toEqual({ ok: true, findings: [], warnings: [], repairs: [] });

    const badEnvironment = malformedIsland("sequences-environment");
    expect(ENVIRONMENT_HOST_CONTRACT.validate(undefined, { ...base, html: badEnvironment }))
      .toEqual({
        ok: false,
        findings: ENVIRONMENT_HOST_CONTRACT.parse!(badEnvironment).findings,
        warnings: [],
        repairs: [],
      });

    expect(INTERACTION_HOST_CONTRACT.validate(undefined, {
      html: malformedIsland("sequences-interactions"),
      scenes: [],
    })).toEqual({ ok: true, findings: [], warnings: [], repairs: [] });
  });

  it("runs every adapter through the same parse/validate lifecycle", () => {
    const context = {
      html: malformedIsland("sequences-cuts"),
      scenes: [],
      durationSec: 0,
    };
    const lifecycle = runHostContractLifecycle("cut", context);
    expect(lifecycle.parsed).toEqual(CUT_HOST_CONTRACT.parse!(context.html));
    expect(lifecycle.validation).toEqual(
      CUT_HOST_CONTRACT.validate(lifecycle.parsed?.plan, context),
    );
  });

  it("routes the production publication gate through the shared lifecycle", () => {
    const directSource = fs.readFileSync(
      new URL("../src/engine/directComposition.ts", import.meta.url),
      "utf8",
    );
    expect(directSource).toContain("runHostContractLifecycle(id,");
    for (const id of IDS) expect(directSource).toContain(`"${id}"`);
    expect(directSource).toContain("for (const contract of HOST_CONTRACTS)");
    expect(directSource).toContain('hostContract("continuity").hash()');
    expect(directSource).not.toContain("continuityRuntimeSource()");
  });

  it("routes ordered source injection, kits, and staging through adapters", () => {
    const runnerDir = new URL("../src/engine/runner/", import.meta.url);
    const readRunnerSources = (directory: URL): string[] => fs.readdirSync(directory, {
      withFileTypes: true,
    }).flatMap((entry) => {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      if (entry.isDirectory()) return readRunnerSources(child);
      return entry.name.endsWith(".ts") ? [fs.readFileSync(child, "utf8")] : [];
    });
    const runnerSource = [
      fs.readFileSync(new URL("../src/engine/compositionRunner.ts", import.meta.url), "utf8"),
      ...readRunnerSources(runnerDir),
    ].join("\n");
    for (const id of IDS) expect(runnerSource).toContain(`hostContract("${id}")`);
    expect(runnerSource).toContain("...HOST_CONTRACTS.map((contract) => contract.file)");

    for (const variable of [
      "interactionContract",
      "cutContract",
      "cameraContract",
      "continuityContract",
      "componentContract",
      "fxContract",
      "assetContract",
      "timeContract",
    ]) {
      expect(runnerSource).toContain(`${variable}.inject(html)`);
    }
    expect(runnerSource).toContain("environmentContract.injectPlan!(html, environmentPlan)");
    expect(runnerSource).toContain(
      "environmentContract.inject(environmentKit.inject(canonicalIslandSpacing))",
    );
    expect(runnerSource).toContain("environmentContract.stage!(projectDir, environmentPlan)");
    expect(runnerSource).toContain('hostContract("component").kit!');
    expect(runnerSource).toContain("componentKit.inject(html)");

    for (const legacyCall of [
      "injectCameraRuntimeTag(",
      "injectContinuityRuntimeTag(",
      "injectComponentRuntimeTag(",
      "injectComponentKit(",
      "injectEnvironmentContract(",
      "injectEnvironmentKit(",
      "injectEnvironmentRuntimeTag(",
      "stageEnvironmentAssets(",
    ]) {
      expect(runnerSource).not.toContain(legacyCall);
    }
    for (const legacyFileConstant of [
      "INTERACTION_RUNTIME_FILE",
      "CUT_RUNTIME_FILE",
      "CAMERA_RUNTIME_FILE",
      "CONTINUITY_RUNTIME_FILE",
      "COMPONENT_RUNTIME_FILE",
      "TIME_RUNTIME_FILE",
      "FX_RUNTIME_FILE",
      "ASSET_RUNTIME_FILE",
      "ENVIRONMENT_RUNTIME_FILE",
    ]) {
      expect(runnerSource).not.toContain(legacyFileConstant);
    }
  });
});
