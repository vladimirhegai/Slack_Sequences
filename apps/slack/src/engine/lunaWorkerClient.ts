import { createHash } from "node:crypto";
import { slackSequencesEnvRawValue } from "./featureFlags.ts";

const DEFAULT_WORKER_URL = "http://codex-worker.railway.internal:3000";
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000;
const MAX_RESPONSE_BYTES = 96 * 1024 * 1024;
const REQUIRED_CODEX_CLI_VERSION = "0.144.1";
const ARTIFACT_PROTOCOL = "luna-tool-less-artifact-v2";
const ARTIFACT_SCHEMA_SHA256 = "7fa551fb261b6dee573aca74507202f5ab0b30ca00fe60cd04141dea8dfe104d";
const PERMISSION_PROFILE_SHA256 = "ebd9f548aaa2f1d48df15ea1e124462350791ede65267f7677e9a834fa0060c6";

export interface LunaArtifactContract {
  id: string;
  requiredPaths: readonly string[];
}

export const LUNA_FILM_ARTIFACT_CONTRACT: Readonly<LunaArtifactContract> = Object.freeze({
  id: "film-bundle-v1",
  requiredPaths: Object.freeze([
    "deliverables/assets-manifest.json",
    "deliverables/composition.html",
    "deliverables/director-treatment.md",
    "deliverables/motion-intent.json",
    "deliverables/storyboard.json",
  ]),
});

export interface LunaWorkerInputFile {
  path: string;
  contentBase64: string;
  sha256?: string;
}

export interface LunaWorkerDeliverable {
  path: string;
  contentBase64: string;
  sha256: string;
  size: number;
}

export interface LunaWorkerResult {
  jobId: string;
  operationId: string;
  runCount: number;
  threadId: string;
  status: "completed";
  model: "gpt-5.6-luna";
  reasoningEffort: "high";
  codexVersion: "0.144.1";
  artifactContractSha256: string;
  rawEnvelopeSha256: string;
  materializedFingerprint: string;
  rolloutSha256: string;
  rolloutResponseItems: number;
  finalMessage: string;
  usage?: Record<string, unknown>;
  deliverables: LunaWorkerDeliverable[];
}

export interface LunaWorkerConfig {
  url: string;
  token: string;
  timeoutMs: number;
}

export interface LunaWorkerHealth {
  ok: boolean;
  status?: string;
  version?: string;
  model?: string;
  reasoningEffort?: string;
  artifactProtocol?: string;
  artifactSchemaSha256?: string;
  permissionProfileSha256?: string;
  authenticated?: boolean;
}

export interface LunaWorkerCursor {
  jobId: string;
  operationId: string;
  runCount: number;
  threadId?: string;
  status: "queued" | "running" | "completed" | "failed" | "timed_out" | "cancelled" | "interrupted";
  errorCode?: string;
  failure?: LunaWorkerFailureReceipt;
  rawEnvelopeSha256?: string;
  rolloutSha256?: string;
  rolloutResponseItems?: number;
  materializedFingerprint?: string;
  artifactContractSha256?: string;
}

export interface LunaWorkerFailureReceipt {
  errorCode: string;
  category: "artifact_protocol" | "security" | "integrity" | "runtime" | "cancelled" | "timeout";
  recoverable: boolean;
  envelopeFindings: Array<{ code: string }>;
  response: {
    present: boolean;
    bytes?: number;
    sha256?: string;
  };
  rollout?: {
    sha256: string;
    responseItems: number;
  };
  baseFingerprint?: string;
}

export class LunaWorkerJobError extends Error {
  readonly cursor: LunaWorkerCursor;

  constructor(cursor: LunaWorkerCursor) {
    const code = cursor.failure?.errorCode ?? cursor.errorCode ?? "unknown_worker_failure";
    super(`Luna worker job ${cursor.status}: ${code}`);
    this.name = "LunaWorkerJobError";
    this.cursor = cursor;
  }
}

export function lunaWorkerHealthIsExact(health: LunaWorkerHealth): boolean {
  return health.ok === true && health.authenticated === true &&
    health.model === "gpt-5.6-luna" && health.reasoningEffort === "high" &&
    health.artifactProtocol === ARTIFACT_PROTOCOL &&
    health.artifactSchemaSha256 === ARTIFACT_SCHEMA_SHA256 &&
    health.permissionProfileSha256 === PERMISSION_PROFILE_SHA256 &&
    health.version === REQUIRED_CODEX_CLI_VERSION;
}

interface LunaWorkerJobState {
  jobId: string;
  operationId: string;
  runCount: number;
  threadId?: string;
  status: "queued" | "running" | "failed" | "timed_out" | "cancelled" | "interrupted";
  errorCode?: string;
  failure?: LunaWorkerFailureReceipt;
  rawEnvelopeSha256?: string;
  rolloutSha256?: string;
  rolloutResponseItems?: number;
  materializedFingerprint?: string;
  artifactContractSha256?: string;
}

export function resolveLunaWorkerConfig(): LunaWorkerConfig {
  const url = (
    slackSequencesEnvRawValue("SLACK_SEQUENCES_LUNA_WORKER_URL") ?? DEFAULT_WORKER_URL
  ).trim().replace(/\/+$/, "");
  const token = (
    slackSequencesEnvRawValue("SLACK_SEQUENCES_LUNA_WORKER_TOKEN") ?? ""
  ).trim();
  const rawTimeout = slackSequencesEnvRawValue("SLACK_SEQUENCES_LUNA_JOB_TIMEOUT_MS");
  const parsedTimeout = rawTimeout ? Number(rawTimeout) : DEFAULT_TIMEOUT_MS;
  const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout >= 30_000
    ? Math.floor(parsedTimeout)
    : DEFAULT_TIMEOUT_MS;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Luna worker URL is invalid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Luna worker URL must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Luna worker URL must not contain credentials");
  }
  if (!token) {
    throw new Error("SLACK_SEQUENCES_LUNA_WORKER_TOKEN is required for Luna authoring");
  }
  return { url, token, timeoutMs };
}

function boundedErrorBody(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 600) || "empty response";
}

function canonicalArtifactContract(contract: LunaArtifactContract): LunaArtifactContract {
  if (!contract || typeof contract !== "object") {
    throw new Error("Luna artifact contract must be an object");
  }
  if (
    typeof contract.id !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/.test(contract.id)
  ) {
    throw new Error("Luna artifact contract has an invalid id");
  }
  if (
    !Array.isArray(contract.requiredPaths) ||
    contract.requiredPaths.length < 1 ||
    contract.requiredPaths.length > 128
  ) {
    throw new Error("Luna artifact contract must declare 1-128 required paths");
  }
  const requiredPaths = [...contract.requiredPaths].map((candidate) => {
    if (
      typeof candidate !== "string" ||
      candidate.length < 1 ||
      candidate.length > 240 ||
      !/^deliverables\/[A-Za-z0-9._/-]+$/.test(candidate) ||
      candidate.includes("\\") ||
      candidate.split("/").some((segment) => !segment || segment === "." || segment === "..")
    ) {
      throw new Error("Luna artifact contract contains an invalid deliverable path");
    }
    return candidate;
  }).sort();
  if (new Set(requiredPaths).size !== requiredPaths.length) {
    throw new Error("Luna artifact contract required paths must be unique");
  }
  return { id: contract.id, requiredPaths };
}

function assertWorkerResult(value: unknown): LunaWorkerResult {
  if (!value || typeof value !== "object") throw new Error("Luna worker returned invalid JSON");
  const candidate = value as Partial<LunaWorkerResult>;
  if (
    typeof candidate.jobId !== "string" ||
    typeof candidate.operationId !== "string" ||
    !/^[a-f0-9]{64}$/.test(candidate.operationId) ||
    typeof candidate.runCount !== "number" ||
    !Number.isSafeInteger(candidate.runCount) ||
    candidate.runCount < 1 ||
    typeof candidate.threadId !== "string" ||
    candidate.status !== "completed" ||
    candidate.model !== "gpt-5.6-luna" ||
    candidate.reasoningEffort !== "high" ||
    candidate.codexVersion !== REQUIRED_CODEX_CLI_VERSION ||
    typeof candidate.artifactContractSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(candidate.artifactContractSha256) ||
    typeof candidate.rawEnvelopeSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(candidate.rawEnvelopeSha256) ||
    typeof candidate.materializedFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(candidate.materializedFingerprint) ||
    typeof candidate.rolloutSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(candidate.rolloutSha256) ||
    typeof candidate.rolloutResponseItems !== "number" ||
    !Number.isSafeInteger(candidate.rolloutResponseItems) ||
    candidate.rolloutResponseItems < 1 ||
    typeof candidate.finalMessage !== "string" ||
    !Array.isArray(candidate.deliverables)
  ) {
    throw new Error("Luna worker response has an invalid job, thread, model, status, or deliverables envelope");
  }
  for (const file of candidate.deliverables) {
    if (
      !file ||
      typeof file.path !== "string" ||
      typeof file.contentBase64 !== "string" ||
      typeof file.sha256 !== "string" ||
      typeof file.size !== "number"
    ) {
      throw new Error("Luna worker returned an invalid deliverable");
    }
  }
  return candidate as LunaWorkerResult;
}

function assertFailureReceipt(value: unknown): LunaWorkerFailureReceipt {
  if (!value || typeof value !== "object") {
    throw new Error("Luna worker returned an invalid failure receipt");
  }
  const candidate = value as Partial<LunaWorkerFailureReceipt>;
  if (
    typeof candidate.errorCode !== "string" ||
    !/^[a-z0-9_]{1,80}$/.test(candidate.errorCode) ||
    !new Set(["artifact_protocol", "security", "integrity", "runtime", "cancelled", "timeout"])
      .has(candidate.category ?? "") ||
    typeof candidate.recoverable !== "boolean" ||
    !Array.isArray(candidate.envelopeFindings) ||
    candidate.envelopeFindings.length > 16 ||
    !candidate.envelopeFindings.every((finding) =>
      finding && typeof finding === "object" &&
      typeof finding.code === "string" && /^[a-z0-9_]{1,80}$/.test(finding.code)
    ) ||
    !candidate.response ||
    typeof candidate.response.present !== "boolean"
  ) {
    throw new Error("Luna worker returned an invalid failure receipt");
  }
  if (candidate.response.present) {
    if (
      !Number.isSafeInteger(candidate.response.bytes) ||
      (candidate.response.bytes ?? -1) < 0 ||
      (candidate.response.bytes ?? Infinity) > 24 * 1024 * 1024 ||
      typeof candidate.response.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(candidate.response.sha256)
    ) {
      throw new Error("Luna worker returned invalid bounded response metadata");
    }
  }
  if (candidate.rollout !== undefined) {
    if (
      typeof candidate.rollout.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(candidate.rollout.sha256) ||
      !Number.isSafeInteger(candidate.rollout.responseItems) ||
      candidate.rollout.responseItems < 1
    ) {
      throw new Error("Luna worker returned invalid rollout failure metadata");
    }
  }
  if (
    candidate.baseFingerprint !== undefined &&
    !/^[a-f0-9]{64}$/.test(candidate.baseFingerprint)
  ) {
    throw new Error("Luna worker returned an invalid failure base fingerprint");
  }
  if (
    candidate.recoverable &&
    (candidate.category !== "artifact_protocol" || !candidate.response.present || !candidate.rollout)
  ) {
    throw new Error("Luna worker marked an unbound failure as recoverable");
  }
  return candidate as LunaWorkerFailureReceipt;
}

async function requestJson(
  config: LunaWorkerConfig,
  pathname: string,
  method: "GET" | "POST" | "DELETE",
  body?: Record<string, unknown>,
  requestTimeoutMs = Math.min(config.timeoutMs, 30_000),
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(`${config.url}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${config.token}`,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_RESPONSE_BYTES) {
      throw new Error("Luna worker response exceeded the host limit");
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
      throw new Error("Luna worker response exceeded the host limit");
    }
    if (!response.ok) {
      throw new Error(`Luna worker ${response.status}: ${boundedErrorBody(text)}`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("Luna worker returned malformed JSON");
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Luna worker request timed out after ${requestTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

class LunaWorkerInterruptedError extends Error {
  constructor() {
    super("Luna worker restarted during the operation");
    this.name = "LunaWorkerInterruptedError";
  }
}

async function bestEffortCancel(config: LunaWorkerConfig, jobId: string): Promise<void> {
  try {
    await requestJson(
      config,
      `/v1/jobs/${encodeURIComponent(jobId)}`,
      "DELETE",
      undefined,
      5_000,
    );
  } catch {
    // The primary timeout/failure remains the useful error; cancellation is best effort.
  }
}

function operationIdFor(
  prompt: string,
  files: readonly LunaWorkerInputFile[],
  expectedRunCount: number | null,
  artifactContract: LunaArtifactContract,
  expectedBaseFingerprint: string | null,
): string {
  const canonicalContract = canonicalArtifactContract(artifactContract);
  if (
    expectedBaseFingerprint !== null &&
    !/^[a-f0-9]{64}$/.test(expectedBaseFingerprint)
  ) {
    throw new Error("Luna worker base fingerprint must be a lowercase SHA-256 digest");
  }
  const canonical = JSON.stringify({
    protocol: ARTIFACT_PROTOCOL,
    schemaSha256: ARTIFACT_SCHEMA_SHA256,
    permissionProfileSha256: PERMISSION_PROFILE_SHA256,
    expectedRunCount,
    expectedBaseFingerprint,
    artifactContract: canonicalContract,
    promptSha256: createHash("sha256").update(prompt, "utf8").digest("hex"),
    files: [...files]
      .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
      .map((file) => ({
        path: file.path,
        sha256: file.sha256 ?? createHash("sha256")
          .update(Buffer.from(file.contentBase64, "base64"))
          .digest("hex"),
      })),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function assertJobState(value: unknown): LunaWorkerJobState {
  if (!value || typeof value !== "object") throw new Error("Luna worker returned an invalid job state");
  const candidate = value as Partial<LunaWorkerJobState>;
  if (
    typeof candidate.jobId !== "string" ||
    typeof candidate.operationId !== "string" ||
    !/^[a-f0-9]{64}$/.test(candidate.operationId) ||
    typeof candidate.runCount !== "number" ||
    !Number.isSafeInteger(candidate.runCount) ||
    candidate.runCount < 0 ||
    (candidate.threadId !== undefined && typeof candidate.threadId !== "string") ||
    !new Set(["queued", "running", "failed", "timed_out", "cancelled", "interrupted"])
      .has(candidate.status ?? "")
  ) {
    throw new Error("Luna worker returned an invalid job state");
  }
  if (candidate.failure !== undefined) candidate.failure = assertFailureReceipt(candidate.failure);
  if (
    candidate.rawEnvelopeSha256 !== undefined &&
    !/^[a-f0-9]{64}$/.test(candidate.rawEnvelopeSha256)
  ) {
    throw new Error("Luna worker returned an invalid raw-envelope failure hash");
  }
  if (
    candidate.rolloutSha256 !== undefined &&
    !/^[a-f0-9]{64}$/.test(candidate.rolloutSha256)
  ) {
    throw new Error("Luna worker returned an invalid rollout failure hash");
  }
  if (
    candidate.rolloutResponseItems !== undefined &&
    (!Number.isSafeInteger(candidate.rolloutResponseItems) || candidate.rolloutResponseItems < 1)
  ) {
    throw new Error("Luna worker returned an invalid rollout failure count");
  }
  for (const digest of [candidate.materializedFingerprint, candidate.artifactContractSha256]) {
    if (digest !== undefined && !/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error("Luna worker returned an invalid materialization state hash");
    }
  }
  return candidate as LunaWorkerJobState;
}

function assertWorkerCursor(value: unknown): LunaWorkerCursor {
  if (!value || typeof value !== "object") throw new Error("Luna worker returned an invalid cursor");
  const candidate = value as Partial<LunaWorkerCursor>;
  if (
    typeof candidate.jobId !== "string" ||
    typeof candidate.operationId !== "string" ||
    !/^[a-f0-9]{64}$/.test(candidate.operationId) ||
    typeof candidate.runCount !== "number" ||
    !Number.isSafeInteger(candidate.runCount) ||
    candidate.runCount < 1 ||
    (candidate.threadId !== undefined && typeof candidate.threadId !== "string") ||
    !new Set(["queued", "running", "completed", "failed", "timed_out", "cancelled", "interrupted"])
      .has(candidate.status ?? "") ||
    (candidate.rolloutSha256 !== undefined && !/^[a-f0-9]{64}$/.test(candidate.rolloutSha256))
  ) {
    throw new Error("Luna worker returned an invalid cursor");
  }
  if (candidate.failure !== undefined) candidate.failure = assertFailureReceipt(candidate.failure);
  if (
    candidate.rawEnvelopeSha256 !== undefined &&
    !/^[a-f0-9]{64}$/.test(candidate.rawEnvelopeSha256)
  ) {
    throw new Error("Luna worker returned an invalid cursor raw-envelope hash");
  }
  if (
    candidate.rolloutResponseItems !== undefined &&
    (!Number.isSafeInteger(candidate.rolloutResponseItems) || candidate.rolloutResponseItems < 1)
  ) {
    throw new Error("Luna worker returned an invalid cursor rollout count");
  }
  for (const digest of [candidate.materializedFingerprint, candidate.artifactContractSha256]) {
    if (digest !== undefined && !/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error("Luna worker returned an invalid cursor materialization hash");
    }
  }
  return candidate as LunaWorkerCursor;
}

async function pollLunaWorkerJob(
  config: LunaWorkerConfig,
  jobId: string,
  operationId: string,
  startedAt: number,
): Promise<LunaWorkerResult> {
  let transientFailures = 0;
  for (;;) {
    const remainingMs = config.timeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      await bestEffortCancel(config, jobId);
      throw new Error(`Luna worker job timed out after ${config.timeoutMs}ms`);
    }
    let value: unknown;
    try {
      value = await requestJson(
        config,
        `/v1/jobs/${encodeURIComponent(jobId)}`,
        "GET",
        undefined,
        Math.min(remainingMs, 15_000),
      );
      transientFailures = 0;
    } catch (error) {
      transientFailures += 1;
      if (transientFailures >= 5) {
        await bestEffortCancel(config, jobId);
        throw error;
      }
      await new Promise((resolve) => setTimeout(
        resolve,
        Math.min(500 * (2 ** (transientFailures - 1)), 4_000, remainingMs),
      ));
      continue;
    }
    if (
      value && typeof value === "object" &&
      (value as { status?: unknown }).status === "completed"
    ) {
      const result = assertWorkerResult(value);
      if (result.jobId !== jobId || result.operationId !== operationId) {
        throw new Error("Luna worker completed a different operation");
      }
      return result;
    }
    const state = assertJobState(value);
    if (state.jobId !== jobId || state.operationId !== operationId) {
      throw new Error("Luna worker is running a different operation for this job");
    }
    if (!new Set(["queued", "running"]).has(state.status)) {
      if (state.status === "interrupted") throw new LunaWorkerInterruptedError();
      throw new LunaWorkerJobError(state);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, remainingMs)));
  }
}

async function submitAndPoll(
  config: LunaWorkerConfig,
  pathname: string,
  jobId: string,
  prompt: string,
  files: LunaWorkerInputFile[],
  expectedRunCount: number | null,
  artifactContract: LunaArtifactContract,
  expectedBaseFingerprint: string | null,
): Promise<LunaWorkerResult> {
  const canonicalContract = canonicalArtifactContract(artifactContract);
  const operationId = operationIdFor(
    prompt,
    files,
    expectedRunCount,
    canonicalContract,
    expectedBaseFingerprint,
  );
  const startedAt = Date.now();
  for (let restartAttempt = 0; restartAttempt < 2; restartAttempt += 1) {
    try {
      await requestJson(config, pathname, "POST", {
        jobId,
        operationId,
        prompt,
        files,
        artifactContract: canonicalContract,
        ...(expectedRunCount === null ? {} : { expectedRunCount }),
        ...(expectedRunCount === null ? {} : { expectedBaseFingerprint }),
      }, 15_000);
    } catch (submissionError) {
      try {
        return await pollLunaWorkerJob(config, jobId, operationId, startedAt);
      } catch (recoveryError) {
        if (recoveryError instanceof LunaWorkerInterruptedError && restartAttempt === 0) continue;
        throw recoveryError instanceof Error ? recoveryError : submissionError;
      }
    }
    try {
      return await pollLunaWorkerJob(config, jobId, operationId, startedAt);
    } catch (error) {
      if (error instanceof LunaWorkerInterruptedError && restartAttempt === 0) continue;
      throw error;
    }
  }
  throw new Error("Luna worker could not recover the interrupted operation");
}

export function workerInputFile(relativePath: string, bytes: Buffer | string): LunaWorkerInputFile {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, "utf8");
  return {
    path: relativePath,
    contentBase64: buffer.toString("base64"),
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

export async function startLunaWorkerJob(
  config: LunaWorkerConfig,
  input: {
    jobId: string;
    prompt: string;
    files: LunaWorkerInputFile[];
    artifactContract: LunaArtifactContract;
  },
): Promise<LunaWorkerResult> {
  return submitAndPoll(
    config,
    "/v1/jobs",
    input.jobId,
    input.prompt,
    input.files,
    null,
    input.artifactContract,
    null,
  );
}

export async function resumeLunaWorkerJob(
  config: LunaWorkerConfig,
  input: {
    jobId: string;
    expectedRunCount: number;
    expectedBaseFingerprint: string | null;
    prompt: string;
    files?: LunaWorkerInputFile[];
    artifactContract: LunaArtifactContract;
  },
): Promise<LunaWorkerResult> {
  return submitAndPoll(
    config,
    `/v1/jobs/${encodeURIComponent(input.jobId)}/resume`,
    input.jobId,
    input.prompt,
    input.files ?? [],
    input.expectedRunCount,
    input.artifactContract,
    input.expectedBaseFingerprint,
  );
}

export async function inspectLunaWorkerHealth(
  config: LunaWorkerConfig,
): Promise<LunaWorkerHealth> {
  const value = await requestJson(config, "/healthz", "GET", undefined, 8_000);
  if (!value || typeof value !== "object") throw new Error("Luna worker health is invalid");
  return value as LunaWorkerHealth;
}

export async function inspectLunaWorkerCursor(
  config: LunaWorkerConfig,
  jobId: string,
): Promise<LunaWorkerCursor> {
  return assertWorkerCursor(await requestJson(
    config,
    `/v1/jobs/${encodeURIComponent(jobId)}`,
    "GET",
    undefined,
    15_000,
  ));
}
