import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateLunaAssetPack } from "../../src/engine/lunaAssetPack.ts";

const FILM_REQUIRED = [
  "deliverables/assets-manifest.json",
  "deliverables/composition.html",
  "deliverables/director-treatment.md",
  "deliverables/motion-intent.json",
  "deliverables/storyboard.json",
] as const;
const DIRECTION_REQUIRED = [
  "deliverables/director-treatment.md",
  "deliverables/storyboard.json",
] as const;
const ASSET_PACK_REQUIRED = [
  "deliverables/asset-pack.json",
  "deliverables/ui-kit.html",
  "deliverables/assets-manifest.json",
] as const;

export type LunaEvidenceArtifactKind =
  | "direction"
  | "synthetic-direction"
  | "film"
  | "asset-pack";

interface EvidenceArtifactContract {
  id: string;
  requiredPaths: string[];
  kind: LunaEvidenceArtifactKind;
}

const KNOWN_CONTRACTS: readonly EvidenceArtifactContract[] = [
  { id: "film-bundle-v1", requiredPaths: [...FILM_REQUIRED], kind: "film" },
  { id: "film-direction-v1", requiredPaths: [...DIRECTION_REQUIRED], kind: "direction" },
  {
    id: "film-direction-with-synthetic-ui-v1",
    requiredPaths: [...DIRECTION_REQUIRED, ...ASSET_PACK_REQUIRED],
    kind: "synthetic-direction",
  },
  { id: "sequences-luna-ui-pack-v1", requiredPaths: [...ASSET_PACK_REQUIRED], kind: "asset-pack" },
] as const;

interface JsonObject {
  [key: string]: unknown;
}

interface EncodedDeliverable {
  path: string;
  contentBase64: string;
  sha256: string;
  size: number;
}

export interface LunaRunAudit {
  runDir: string;
  kind: string;
  jobId: string;
  operationId: string;
  threadId: string;
  runCount: number;
  status: string;
  model: string;
  reasoningEffort: string;
  codexVersion: string;
  artifactContractSha256?: string;
  artifactContract?: { id: string; requiredPaths: string[] };
  artifactKind: LunaEvidenceArtifactKind;
  rawEnvelopeSha256: string;
  materializedFingerprint: string;
  rolloutSha256: string;
  deliverables: Array<{ path: string; sha256: string; size: number }>;
  usage: {
    inputTokens: number | null;
    cachedInputTokens: number | null;
    outputTokens: number | null;
    reasoningOutputTokens: number | null;
  };
  finalMessageBytes: number;
  totalDeliverableBytes: number;
  storyboardScenes: number | null;
  compositionId: string | null;
  durationSec: number | null;
  changedPaths: string[];
  compositionChanged: boolean | null;
}

export interface LunaRunBundle {
  audit: LunaRunAudit;
  html?: string;
  storyboard?: Array<Record<string, unknown>>;
  motionIntent?: Record<string, unknown>;
  assetsManifest?: unknown[];
  assetFiles: Array<{ relativePath: string; bytes: Buffer }>;
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as JsonObject;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function readJson(file: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(`missing Luna evidence file ${file}`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`invalid JSON in Luna evidence file ${file}`);
  }
}

function safeDeliverablePath(value: unknown): string {
  const file = string(value, "deliverable.path").replace(/\\/g, "/");
  if (
    !file.startsWith("deliverables/") ||
    file.includes("//") ||
    file.split("/").some((part) => !part || part === "." || part === "..") ||
    !/^[A-Za-z0-9._/-]+$/.test(file)
  ) {
    throw new Error(`unsafe Luna deliverable path ${file}`);
  }
  return file;
}

function canonicalContract(contract: Pick<EvidenceArtifactContract, "id" | "requiredPaths">): {
  id: string;
  requiredPaths: string[];
} {
  return {
    id: contract.id,
    requiredPaths: [...contract.requiredPaths].sort(),
  };
}

function contractSha256(contract: Pick<EvidenceArtifactContract, "id" | "requiredPaths">): string {
  return sha256(JSON.stringify(canonicalContract(contract)));
}

function resolveEvidenceContract(
  receipt: JsonObject,
  response: JsonObject,
  deliverablePaths: ReadonlySet<string>,
): EvidenceArtifactContract {
  const reportedHash = response.artifactContractSha256 === undefined
    ? undefined
    : string(response.artifactContractSha256, "artifactContractSha256").toLowerCase();
  let candidate: EvidenceArtifactContract | undefined;
  if (receipt.artifactContract !== undefined) {
    const raw = object(receipt.artifactContract, "artifactContract");
    const id = string(raw.id, "artifactContract.id");
    if (!Array.isArray(raw.requiredPaths) || !raw.requiredPaths.length) {
      throw new Error("artifactContract.requiredPaths must be a non-empty array");
    }
    const requiredPaths = raw.requiredPaths.map(safeDeliverablePath).sort();
    if (new Set(requiredPaths).size !== requiredPaths.length) {
      throw new Error("artifactContract.requiredPaths contains duplicates");
    }
    const known = KNOWN_CONTRACTS.find((contract) => contract.id === id);
    if (!known || JSON.stringify(canonicalContract(known).requiredPaths) !== JSON.stringify(requiredPaths)) {
      throw new Error(`unknown or drifted Luna artifact contract ${id}`);
    }
    candidate = known;
  } else if (reportedHash) {
    candidate = KNOWN_CONTRACTS.find((contract) => contractSha256(contract) === reportedHash);
    if (!candidate) throw new Error(`unknown Luna artifact contract hash ${reportedHash}`);
  } else if (FILM_REQUIRED.every((required) => deliverablePaths.has(required))) {
    // Backward compatibility for the pre-v2 downloaded incident receipts.
    candidate = KNOWN_CONTRACTS.find((contract) => contract.kind === "film");
  }
  if (!candidate) throw new Error("could not identify the Luna artifact contract");
  if (reportedHash && contractSha256(candidate) !== reportedHash) {
    throw new Error("artifact contract hash does not match its canonical contract");
  }
  for (const required of candidate.requiredPaths) {
    if (!deliverablePaths.has(required)) throw new Error(`Luna evidence is missing contract-required ${required}`);
  }
  return candidate;
}

function parseEncodedDeliverable(value: unknown): EncodedDeliverable {
  const item = object(value, "worker response deliverable");
  const encoded = string(item.contentBase64, "deliverable.contentBase64");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error("deliverable.contentBase64 is malformed");
  }
  return {
    path: safeDeliverablePath(item.path),
    contentBase64: encoded,
    sha256: string(item.sha256, "deliverable.sha256").toLowerCase(),
    size: integer(item.size, "deliverable.size"),
  };
}

function materializedPath(runDir: string, deliverablePath: string): string {
  const root = path.resolve(runDir, "deliverables");
  const destination = path.resolve(root, ...deliverablePath.split("/").slice(1));
  if (destination !== root && !destination.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Luna deliverable escaped ${root}`);
  }
  return destination;
}

function optionalToken(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function runKind(runDir: string): string {
  return path.basename(runDir).replace(/^\d{4}-/, "") || "unknown";
}

/**
 * Re-hash one persisted paid response from both its encoded response and the
 * materialized evidence directory. This deliberately performs no legacy
 * normalization or repair.
 */
export function auditLunaRunDirectory(
  runDir: string,
  previous?: LunaRunAudit,
): LunaRunBundle {
  const resolved = path.resolve(runDir);
  const receipt = object(readJson(path.join(resolved, "worker-receipt.json")), "worker receipt");
  const response = object(readJson(path.join(resolved, "worker-response.json")), "worker response");
  const identityFields = [
    "jobId",
    "operationId",
    "threadId",
    "status",
    "model",
    "reasoningEffort",
    "codexVersion",
    "rawEnvelopeSha256",
    "materializedFingerprint",
    "rolloutSha256",
  ] as const;
  for (const field of identityFields) {
    if (receipt[field] !== response[field]) throw new Error(`${resolved} receipt/response disagree on ${field}`);
  }
  if (receipt.artifactContractSha256 !== response.artifactContractSha256) {
    throw new Error(`${resolved} receipt/response disagree on artifactContractSha256`);
  }
  if (receipt.runCount !== response.runCount) throw new Error(`${resolved} receipt/response disagree on runCount`);

  const finalMessage = string(response.finalMessage, "worker response finalMessage");
  if (receipt.finalMessage !== finalMessage) {
    throw new Error(`${resolved} receipt/response disagree on finalMessage`);
  }
  const rawEnvelopeSha256 = string(response.rawEnvelopeSha256, "rawEnvelopeSha256").toLowerCase();
  if (sha256(finalMessage) !== rawEnvelopeSha256) {
    throw new Error(`${resolved} raw artifact-envelope hash does not match finalMessage`);
  }
  // Syntax-check the raw artifact envelope even though the trusted worker has
  // already materialized it. A replay should prove both representations.
  object(JSON.parse(finalMessage) as unknown, "raw artifact envelope");

  const encodedValues = response.deliverables;
  if (!Array.isArray(encodedValues)) throw new Error(`${resolved} response deliverables must be an array`);
  const encoded = encodedValues.map(parseEncodedDeliverable);
  const uniquePaths = new Set(encoded.map((file) => file.path));
  if (uniquePaths.size !== encoded.length) throw new Error(`${resolved} contains duplicate deliverable paths`);
  const artifactContract = resolveEvidenceContract(receipt, response, uniquePaths);

  const receiptValues = receipt.deliverables;
  if (!Array.isArray(receiptValues)) throw new Error(`${resolved} receipt deliverables must be an array`);
  const receiptFiles = receiptValues.map((value) => {
    const item = object(value, "receipt deliverable");
    return {
      path: safeDeliverablePath(item.path),
      sha256: string(item.sha256, "receipt deliverable sha256").toLowerCase(),
      size: integer(item.size, "receipt deliverable size"),
    };
  });

  let totalDeliverableBytes = 0;
  const fingerprints: string[] = [];
  const materialized = new Map<string, Buffer>();
  for (const file of encoded) {
    const bytes = Buffer.from(file.contentBase64, "base64");
    if (bytes.length !== file.size) throw new Error(`${resolved} ${file.path} has the wrong encoded size`);
    if (sha256(bytes) !== file.sha256) throw new Error(`${resolved} ${file.path} has the wrong encoded hash`);
    const disk = fs.readFileSync(materializedPath(resolved, file.path));
    if (!disk.equals(bytes)) throw new Error(`${resolved} ${file.path} differs from worker-response.json`);
    const receiptFile = receiptFiles.find((candidate) => candidate.path === file.path);
    if (!receiptFile || receiptFile.sha256 !== file.sha256 || receiptFile.size !== file.size) {
      throw new Error(`${resolved} receipt metadata differs for ${file.path}`);
    }
    totalDeliverableBytes += bytes.length;
    fingerprints.push(`${file.path}:${file.sha256}`);
    materialized.set(file.path, bytes);
  }
  if (receiptFiles.length !== encoded.length) throw new Error(`${resolved} receipt has extra deliverables`);
  const artifactContractSha256 = response.artifactContractSha256 === undefined
    ? undefined
    : string(response.artifactContractSha256, "artifactContractSha256").toLowerCase();
  const materializedFingerprint = artifactContractSha256
    ? sha256(JSON.stringify({
      contractSha256: artifactContractSha256,
      files: encoded
        .map((file) => ({ path: file.path, sha256: file.sha256 }))
        .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
    }))
    : sha256(fingerprints.sort().join("\n"));
  if (materializedFingerprint !== response.materializedFingerprint) {
    throw new Error(`${resolved} materialized fingerprint does not match deliverables`);
  }

  let storyboard: Array<Record<string, unknown>> | undefined;
  let directionDurationSec: number | null = null;
  const storyboardBytes = materialized.get("deliverables/storyboard.json");
  if (storyboardBytes) {
    const storyboardPayload = JSON.parse(storyboardBytes.toString("utf8")) as unknown;
    const storyboardValues = Array.isArray(storyboardPayload)
      ? storyboardPayload
      : object(storyboardPayload, "storyboard.json").storyboard;
    if (!Array.isArray(storyboardValues) || !storyboardValues.length) {
      throw new Error(`${resolved} storyboard.json has no scenes`);
    }
    storyboard = storyboardValues.map((scene, index) => {
      const parsed = object(scene, `storyboard scene ${index + 1}`);
      finite(parsed.startSec, `storyboard scene ${index + 1} startSec`);
      finite(parsed.durationSec, `storyboard scene ${index + 1} durationSec`);
      return parsed;
    });
    directionDurationSec = Math.max(...storyboard.map((scene) =>
      Number(scene.startSec) + Number(scene.durationSec)
    ));
  }
  let motionIntent: Record<string, unknown> | undefined;
  let assetsManifest: unknown[] | undefined;
  let html: string | undefined;
  if (artifactContract.kind === "film") {
    html = materialized.get("deliverables/composition.html")!.toString("utf8");
    motionIntent = object(
      JSON.parse(materialized.get("deliverables/motion-intent.json")!.toString("utf8")) as unknown,
      "motion-intent.json",
    );
    const parsedManifest = JSON.parse(
      materialized.get("deliverables/assets-manifest.json")!.toString("utf8"),
    ) as unknown;
    if (!Array.isArray(parsedManifest)) {
      throw new Error(`${resolved} assets-manifest.json must be an array`);
    }
    assetsManifest = parsedManifest;
  } else if (artifactContract.kind === "direction" || artifactContract.kind === "synthetic-direction") {
    const treatment = materialized.get("deliverables/director-treatment.md")!.toString("utf8").trim();
    if (!treatment) throw new Error(`${resolved} director-treatment.md is empty`);
    if (!storyboard) throw new Error(`${resolved} direction has no storyboard`);
    if (artifactContract.kind === "synthetic-direction") validateLunaAssetPack(materialized);
  } else {
    validateLunaAssetPack(materialized);
  }

  const deliverables = encoded.map(({ path: filePath, sha256: hash, size }) => ({
    path: filePath,
    sha256: hash,
    size,
  }));
  const previousByPath = new Map(previous?.deliverables.map((file) => [file.path, file.sha256]) ?? []);
  const changedPaths = previous
    ? deliverables
      .filter((file) => previousByPath.get(file.path) !== file.sha256)
      .map((file) => file.path)
      .concat(previous.deliverables
        .filter((file) => !uniquePaths.has(file.path))
        .map((file) => file.path))
      .sort()
    : deliverables.map((file) => file.path).sort();
  const usage = object(response.usage ?? {}, "worker usage");
  const responseRunCount = integer(response.runCount, "runCount");
  const audit: LunaRunAudit = {
    runDir: resolved,
    kind: runKind(resolved),
    jobId: string(response.jobId, "jobId"),
    operationId: string(response.operationId, "operationId"),
    threadId: string(response.threadId, "threadId"),
    runCount: responseRunCount,
    status: string(response.status, "status"),
    model: string(response.model, "model"),
    reasoningEffort: string(response.reasoningEffort, "reasoningEffort"),
    codexVersion: string(response.codexVersion, "codexVersion"),
    ...(artifactContractSha256 ? { artifactContractSha256 } : {}),
    artifactContract: canonicalContract(artifactContract),
    artifactKind: artifactContract.kind,
    rawEnvelopeSha256,
    materializedFingerprint: string(response.materializedFingerprint, "materializedFingerprint"),
    rolloutSha256: string(response.rolloutSha256, "rolloutSha256"),
    deliverables,
    usage: {
      inputTokens: optionalToken(usage.input_tokens),
      cachedInputTokens: optionalToken(usage.cached_input_tokens),
      outputTokens: optionalToken(usage.output_tokens),
      reasoningOutputTokens: optionalToken(usage.reasoning_output_tokens),
    },
    finalMessageBytes: Buffer.byteLength(finalMessage),
    totalDeliverableBytes,
    storyboardScenes: storyboard?.length ?? null,
    compositionId: motionIntent
      ? string(motionIntent.compositionId, "motion intent compositionId")
      : null,
    durationSec: motionIntent
      ? finite(motionIntent.durationSec, "motion intent durationSec")
      : directionDurationSec,
    changedPaths,
    compositionChanged: artifactContract.kind === "film" && previous &&
        previous.deliverables.some((file) => file.path === "deliverables/composition.html")
      ? previousByPath.get("deliverables/composition.html") !==
        deliverables.find((file) => file.path === "deliverables/composition.html")?.sha256
      : null,
  };
  const assetFiles = [...materialized.entries()]
    .filter(([filePath]) => filePath.startsWith("deliverables/assets/luna/"))
    .map(([filePath, bytes]) => ({
      relativePath: filePath.slice("deliverables/assets/luna/".length),
      bytes,
    }));
  return {
    audit,
    ...(html ? { html } : {}),
    ...(storyboard ? { storyboard } : {}),
    ...(motionIntent ? { motionIntent } : {}),
    ...(assetsManifest ? { assetsManifest } : {}),
    assetFiles,
  };
}

function hasReceipt(directory: string): boolean {
  return fs.existsSync(path.join(directory, "worker-receipt.json")) &&
    fs.existsSync(path.join(directory, "worker-response.json"));
}

function childRuns(directory: string): string[] {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directory, entry.name))
    .filter(hasReceipt);
}

/** Resolve a project, planning/luna/runs folder, downloaded .reports folder,
 * individual run directory, or a job ID under apps/slack/.data/projects. */
export function resolveLunaRunDirectories(input: string, appDir: string): string[] {
  const direct = path.resolve(input);
  const appRelative = path.resolve(appDir, input);
  const repositoryRelative = path.resolve(appDir, "../..", input);
  const job = path.join(appDir, ".data", "projects", input);
  const roots = [...new Set([direct, appRelative, repositoryRelative, job])];
  for (const root of roots) {
    if (hasReceipt(root)) return [root];
    const candidates = [
      path.join(root, "planning", "luna", "runs"),
      path.join(root, "luna", "runs"),
      root,
    ];
    for (const candidate of candidates) {
      const runs = childRuns(candidate).sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
      if (runs.length) return runs;
    }
  }
  throw new Error(`no Luna worker runs found for ${input}`);
}

export function auditLunaRunHistory(runDirs: readonly string[]): LunaRunBundle[] {
  let previous: LunaRunAudit | undefined;
  const bundles: LunaRunBundle[] = [];
  for (const runDir of runDirs) {
    const bundle = auditLunaRunDirectory(runDir, previous);
    if (previous) {
      if (bundle.audit.jobId !== previous.jobId) throw new Error("Luna run history changed job ID");
      if (bundle.audit.threadId !== previous.threadId) throw new Error("Luna run history changed Codex thread");
      if (bundle.audit.runCount <= previous.runCount) throw new Error("Luna run history did not advance runCount");
    }
    bundles.push(bundle);
    previous = bundle.audit;
  }
  return bundles;
}
