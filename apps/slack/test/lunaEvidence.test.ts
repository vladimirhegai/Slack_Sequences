import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditLunaRunDirectory,
  auditLunaRunHistory,
  resolveLunaRunDirectories,
} from "../scripts/lib/lunaEvidence.ts";
import {
  buildLunaTriageReport,
  renderLunaTriageMarkdown,
} from "../scripts/lunaTriage.ts";

const roots: string[] = [];
const FILM_CONTRACT = {
  id: "film-bundle-v1",
  requiredPaths: [
    "deliverables/assets-manifest.json",
    "deliverables/composition.html",
    "deliverables/director-treatment.md",
    "deliverables/motion-intent.json",
    "deliverables/storyboard.json",
  ].sort(),
};
const DIRECTION_CONTRACT = {
  id: "film-direction-v1",
  requiredPaths: [
    "deliverables/director-treatment.md",
    "deliverables/storyboard.json",
  ].sort(),
};
const ASSET_PACK_CONTRACT = {
  id: "sequences-luna-ui-pack-v1",
  requiredPaths: [
    "deliverables/asset-pack.json",
    "deliverables/assets-manifest.json",
    "deliverables/ui-kit.html",
  ].sort(),
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function evidenceRun(
  root: string,
  runCount: number,
  html = "<!doctype html><main></main>",
  storyboardShape: "wrapped" | "array" = "wrapped",
): string {
  const runDir = path.join(root, `${String(runCount).padStart(4, "0")}-${runCount === 1 ? "create" : "repair"}`);
  const source = new Map<string, string>([
    ["deliverables/assets-manifest.json", "[]\n"],
    ["deliverables/composition.html", html],
    ["deliverables/director-treatment.md", "# Treatment\n"],
    ["deliverables/motion-intent.json", JSON.stringify({
      version: 1,
      compositionId: "evidence-proof",
      durationSec: 6,
    }) + "\n"],
    ["deliverables/storyboard.json", JSON.stringify(storyboardShape === "array"
      ? [{ id: "proof", title: "Proof", purpose: "Prove", startSec: 0, durationSec: 6 }]
      : { storyboard: [{ id: "proof", title: "Proof", purpose: "Prove", startSec: 0, durationSec: 6 }] }) + "\n"],
  ]);
  const deliverables = [...source].map(([filePath, content]) => {
    const bytes = Buffer.from(content);
    const destination = path.join(runDir, ...filePath.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
    return {
      path: filePath,
      contentBase64: bytes.toString("base64"),
      sha256: sha256(bytes),
      size: bytes.length,
    };
  });
  const finalMessage = JSON.stringify({ decision: "replace", files: [] });
  const response = {
    jobId: "luna-evidence-proof",
    operationId: String(runCount).repeat(64),
    runCount,
    threadId: "019f5a36-c85c-7541-94d7-c474a8e26d33",
    status: "completed",
    model: "gpt-5.6-luna",
    reasoningEffort: "high",
    codexVersion: "0.144.1",
    rawEnvelopeSha256: sha256(finalMessage),
    materializedFingerprint: sha256(deliverables
      .map((file) => `${file.path}:${file.sha256}`)
      .sort()
      .join("\n")),
    rolloutSha256: String(runCount + 1).repeat(64),
    rolloutResponseItems: 4,
    finalMessage,
    usage: {
      input_tokens: 100 * runCount,
      cached_input_tokens: 10,
      output_tokens: 50,
      reasoning_output_tokens: 20,
    },
    deliverables,
  };
  const receipt = {
    version: 1,
    ...response,
    deliverables: deliverables.map(({ path: filePath, sha256: hash, size }) => ({
      path: filePath,
      sha256: hash,
      size,
    })),
  };
  fs.writeFileSync(path.join(runDir, "worker-response.json"), JSON.stringify(response, null, 2));
  fs.writeFileSync(path.join(runDir, "worker-receipt.json"), JSON.stringify(receipt, null, 2));
  return runDir;
}

function rewriteV2Bundle(
  runDir: string,
  source: ReadonlyMap<string, string>,
  contract: { id: string; requiredPaths: string[] },
  runCount?: number,
): void {
  const responsePath = path.join(runDir, "worker-response.json");
  const receiptPath = path.join(runDir, "worker-receipt.json");
  const response = JSON.parse(fs.readFileSync(responsePath, "utf8")) as Record<string, unknown>;
  const deliverablesRoot = path.join(runDir, "deliverables");
  fs.rmSync(deliverablesRoot, { recursive: true, force: true });
  const deliverables = [...source].map(([filePath, content]) => {
    const bytes = Buffer.from(content);
    const destination = path.join(runDir, ...filePath.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
    return {
      path: filePath,
      contentBase64: bytes.toString("base64"),
      sha256: sha256(bytes),
      size: bytes.length,
    };
  });
  const artifactContractSha256 = sha256(JSON.stringify({
    id: contract.id,
    requiredPaths: [...contract.requiredPaths].sort(),
  }));
  response.runCount = runCount ?? response.runCount;
  response.artifactContractSha256 = artifactContractSha256;
  response.materializedFingerprint = sha256(JSON.stringify({
    contractSha256: artifactContractSha256,
    files: deliverables
      .map((file) => ({ path: file.path, sha256: file.sha256 }))
      .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
  }));
  response.deliverables = deliverables;
  const receipt = {
    ...response,
    version: 1,
    artifactContract: contract,
    deliverables: deliverables.map(({ path: filePath, sha256: hash, size }) => ({
      path: filePath,
      sha256: hash,
      size,
    })),
  };
  fs.writeFileSync(responsePath, JSON.stringify(response, null, 2));
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
}

function directionFiles(): Map<string, string> {
  return new Map([
    ["deliverables/director-treatment.md", "# Direction\n\nOne clear product story with an executable visual system.\n"],
    ["deliverables/storyboard.json", JSON.stringify({
      storyboard: [{ id: "proof", title: "Proof", purpose: "Prove", startSec: 0, durationSec: 6 }],
    }) + "\n"],
  ]);
}

function assetPackFiles(): Map<string, string> {
  const csp = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; " +
    "img-src 'self'; font-src 'self'; connect-src 'none'; media-src 'none'; " +
    "frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  return new Map([
    ["deliverables/asset-pack.json", JSON.stringify({
      version: 1,
      name: "Evidence kit",
      visualThesis: "One calm operational surface.",
      tokens: { accent: "#7057ff" },
      components: [{
        id: "proof-card",
        purpose: "Show proof.",
        rootSelector: "#proof-card",
        states: [{ id: "ready", description: "Ready state." }],
        parts: [{ id: "root", selector: "#proof-card", purpose: "Stable morph root." }],
      }],
    })],
    ["deliverables/ui-kit.html", `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><style>#proof-card{color:white}</style></head><body><section id="proof-card">Ready</section></body></html>`],
    ["deliverables/assets-manifest.json", "[]\n"],
  ]);
}

describe("Luna evidence replay", () => {
  it("proves response, receipt, materialized bytes and exact-thread history", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-evidence-"));
    roots.push(root);
    const create = evidenceRun(root, 1);
    const repair = evidenceRun(root, 2);

    const runs = auditLunaRunHistory([create, repair]);
    expect(runs).toHaveLength(2);
    expect(runs[1]!.audit.runCount).toBe(2);
    expect(runs[1]!.audit.compositionChanged).toBe(false);
    expect(runs[1]!.audit.changedPaths).toEqual([]);
    expect(runs[1]!.audit.usage.inputTokens).toBe(200);
    expect(resolveLunaRunDirectories(root, root)).toEqual([create, repair]);
    const triage = buildLunaTriageReport(root);
    expect(triage.legacyStagesRead).toBe(0);
    expect(triage.findings.join(" ")).toMatch(/byte-identical/);
    expect(renderLunaTriageMarkdown(triage)).toContain("Exact Codex thread");
  });

  it("reports the exact changed files in a repair", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-evidence-change-"));
    roots.push(root);
    const create = evidenceRun(root, 1);
    const repair = evidenceRun(root, 2, "<!doctype html><main>repaired</main>");
    const runs = auditLunaRunHistory([create, repair]);
    expect(runs[1]!.audit.compositionChanged).toBe(true);
    expect(runs[1]!.audit.changedPaths).toEqual(["deliverables/composition.html"]);
  });

  it("audits a staged direction-to-film history across an omitted failed worker turn", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-evidence-staged-"));
    roots.push(root);
    const direction = evidenceRun(root, 1);
    rewriteV2Bundle(direction, directionFiles(), DIRECTION_CONTRACT, 1);
    const film = evidenceRun(root, 2);
    rewriteV2Bundle(film, new Map([
      ["deliverables/assets-manifest.json", "[]\n"],
      ["deliverables/composition.html", "<!doctype html><main></main>"],
      ["deliverables/director-treatment.md", "# Treatment\n"],
      ["deliverables/motion-intent.json", JSON.stringify({
        version: 1,
        compositionId: "evidence-proof",
        durationSec: 6,
      }) + "\n"],
      ["deliverables/storyboard.json", JSON.stringify({
        storyboard: [{ id: "proof", title: "Proof", purpose: "Prove", startSec: 0, durationSec: 6 }],
      }) + "\n"],
    ]), FILM_CONTRACT, 3);

    const history = auditLunaRunHistory([direction, film]);
    expect(history.map((run) => run.audit.artifactKind)).toEqual(["direction", "film"]);
    expect(history.map((run) => run.audit.runCount)).toEqual([1, 3]);
    expect(history[0]!.html).toBeUndefined();
    expect(history[1]!.html).toContain("<main>");
  });

  it("audits standalone and synthetic UI-pack contracts without requiring a film", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-evidence-pack-"));
    roots.push(root);
    const assetPack = evidenceRun(root, 1);
    rewriteV2Bundle(assetPack, assetPackFiles(), ASSET_PACK_CONTRACT, 1);
    expect(auditLunaRunDirectory(assetPack).audit.artifactKind).toBe("asset-pack");

    const syntheticRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-evidence-synthetic-"));
    roots.push(syntheticRoot);
    const synthetic = evidenceRun(syntheticRoot, 1);
    const syntheticContract = {
      id: "film-direction-with-synthetic-ui-v1",
      requiredPaths: [...DIRECTION_CONTRACT.requiredPaths, ...ASSET_PACK_CONTRACT.requiredPaths].sort(),
    };
    rewriteV2Bundle(
      synthetic,
      new Map([...directionFiles(), ...assetPackFiles()]),
      syntheticContract,
      1,
    );
    expect(auditLunaRunDirectory(synthetic).audit.artifactKind).toBe("synthetic-direction");
  });

  it("replays the raw storyboard array accepted by the production Luna route", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-evidence-array-"));
    roots.push(root);
    const run = evidenceRun(root, 1, "<!doctype html><main></main>", "array");
    expect(auditLunaRunDirectory(run).audit.storyboardScenes).toBe(1);
  });

  it("verifies contract-bound v2 materialized fingerprints", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-evidence-v2-"));
    roots.push(root);
    const run = evidenceRun(root, 1);
    const responsePath = path.join(run, "worker-response.json");
    const receiptPath = path.join(run, "worker-receipt.json");
    const contractSha256 = sha256(JSON.stringify(FILM_CONTRACT));
    for (const file of [responsePath, receiptPath]) {
      const value = JSON.parse(fs.readFileSync(file, "utf8")) as {
        artifactContractSha256?: string;
        materializedFingerprint: string;
        deliverables: Array<{ path: string; sha256: string }>;
      };
      value.artifactContractSha256 = contractSha256;
      value.materializedFingerprint = sha256(JSON.stringify({
        contractSha256,
        files: value.deliverables
          .map((deliverable) => ({ path: deliverable.path, sha256: deliverable.sha256 }))
          .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
      }));
      fs.writeFileSync(file, JSON.stringify(value));
    }
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as Record<string, unknown>;
    receipt.artifactContract = FILM_CONTRACT;
    fs.writeFileSync(receiptPath, JSON.stringify(receipt));
    expect(auditLunaRunDirectory(run).audit.artifactContractSha256).toBe(contractSha256);
  });

  it("rejects a well-formed but unknown artifact contract hash", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-evidence-contract-"));
    roots.push(root);
    const run = evidenceRun(root, 1);
    const responsePath = path.join(run, "worker-response.json");
    const receiptPath = path.join(run, "worker-receipt.json");
    const unknownHash = "f".repeat(64);
    for (const file of [responsePath, receiptPath]) {
      const value = JSON.parse(fs.readFileSync(file, "utf8")) as {
        artifactContractSha256?: string;
        materializedFingerprint: string;
        deliverables: Array<{ path: string; sha256: string }>;
      };
      value.artifactContractSha256 = unknownHash;
      value.materializedFingerprint = sha256(JSON.stringify({
        contractSha256: unknownHash,
        files: value.deliverables
          .map((deliverable) => ({ path: deliverable.path, sha256: deliverable.sha256 }))
          .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
      }));
      fs.writeFileSync(file, JSON.stringify(value));
    }
    expect(() => auditLunaRunDirectory(run)).toThrow(/unknown Luna artifact contract hash/);
  });

  it("rejects a materialized file that no longer matches the paid response", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-evidence-tamper-"));
    roots.push(root);
    const run = evidenceRun(root, 1);
    fs.writeFileSync(path.join(run, "deliverables", "composition.html"), "tampered");
    expect(() => auditLunaRunDirectory(run)).toThrow(/differs from worker-response/);
  });

  it("rejects a repair that switches jobs, threads, or generations", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-evidence-thread-"));
    roots.push(root);
    const create = evidenceRun(root, 1);
    const repair = evidenceRun(root, 2);
    const responsePath = path.join(repair, "worker-response.json");
    const receiptPath = path.join(repair, "worker-receipt.json");
    for (const file of [responsePath, receiptPath]) {
      const value = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
      value.threadId = "019f5a36-c85c-7541-94d7-c474a8e26d34";
      fs.writeFileSync(file, JSON.stringify(value));
    }
    expect(() => auditLunaRunHistory([create, repair])).toThrow(/changed Codex thread/);
  });
});
