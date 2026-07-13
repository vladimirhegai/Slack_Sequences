import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, statfs, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  ARTIFACT_PROTOCOL_VERSION,
  ARTIFACT_SCHEMA_SHA256,
  DEFAULT_LIMITS,
  HttpError,
  PERMISSION_PROFILE_SHA256,
  auditCodexSessionRollout,
  artifactContractSha256,
  authenticateBearerHeader,
  buildChildEnv,
  buildCodexArgs,
  buildToollessArtifactPrompt,
  collectDeliverables,
  materializeArtifactEnvelope,
  materializedFingerprintFor,
  parseArtifactEnvelope,
  parseCodexEvent,
  parseJobRequest,
  removeForbiddenWorkspaceEntries,
  safeFailureReceipt,
  sha256Bytes,
  validateJobId,
  workspaceSizeBytes,
  writeInputFiles,
} from "./worker-lib.mjs";

const CODEX_HOME = path.resolve(process.env.CODEX_HOME || "/root/.codex");
const HOME = path.resolve(process.env.HOME || "/root");
const JOBS_ROOT = path.join(CODEX_HOME, "sequences-jobs");
const OUTPUT_SCHEMA_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "artifact-envelope.schema.json",
);
const BUNDLED_CONFIG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "config.toml");
const INSTALLED_CONFIG_PATH = path.join(CODEX_HOME, "config.toml");
const TOKEN = process.env.LUNA_WORKER_TOKEN || "";
const MODEL = process.env.LUNA_MODEL || "gpt-5.6-sol";
const REASONING_EFFORT = process.env.LUNA_REASONING_EFFORT || "high";
const CODEX_VERSION = "0.144.1";
const EXPECTED_CODEX_VERSION_OUTPUT = `codex-cli ${CODEX_VERSION}`;
const CODEX_COMMAND = process.env.NODE_ENV === "test" && process.env.LUNA_TEST_CODEX_BIN
  ? process.env.LUNA_TEST_CODEX_BIN
  : "codex";
const CODEX_PREFIX_ARGS = process.env.NODE_ENV === "test" && process.env.LUNA_TEST_CODEX_PREFIX_ARGS
  ? JSON.parse(process.env.LUNA_TEST_CODEX_PREFIX_ARGS)
  : [];
const PORT = parseIntegerEnv("PORT", 3000, { min: 1, max: 65_535 });
const JOB_TIMEOUT_MS = parseIntegerEnv("LUNA_JOB_TIMEOUT_MS", 30 * 60_000, {
  min: 60_000,
  max: 60 * 60_000,
});
const MAX_QUEUE_DEPTH = parseIntegerEnv("LUNA_MAX_QUEUE_DEPTH", 4, { min: 1, max: 32 });
const MAX_WORKSPACE_BYTES = parseIntegerEnv("LUNA_MAX_WORKSPACE_BYTES", 128 * 1024 * 1024, {
  min: 64 * 1024 * 1024,
  max: 512 * 1024 * 1024,
});
const MIN_FREE_BYTES = parseIntegerEnv("LUNA_MIN_FREE_BYTES", 512 * 1024 * 1024, {
  min: 128 * 1024 * 1024,
  max: 4 * 1024 * 1024 * 1024,
});

if (TOKEN.length < 32) {
  console.error("[luna-worker] LUNA_WORKER_TOKEN must contain at least 32 characters");
  process.exit(1);
}
if (!Array.isArray(CODEX_PREFIX_ARGS) || !CODEX_PREFIX_ARGS.every((entry) => typeof entry === "string")) {
  console.error("[luna-worker] invalid test Codex prefix arguments");
  process.exit(1);
}
if (MODEL !== "gpt-5.6-sol") {
  console.error("[luna-worker] LUNA_MODEL must be gpt-5.6-sol");
  process.exit(1);
}
if (REASONING_EFFORT !== "high") {
  console.error("[luna-worker] LUNA_REASONING_EFFORT must be high");
  process.exit(1);
}
if (sha256Bytes(await readFile(OUTPUT_SCHEMA_PATH)) !== ARTIFACT_SCHEMA_SHA256) {
  console.error("[luna-worker] bundled artifact schema hash does not match the protocol");
  process.exit(1);
}
if (
  sha256Bytes(await readFile(BUNDLED_CONFIG_PATH)) !== PERMISSION_PROFILE_SHA256 ||
  sha256Bytes(await readFile(INSTALLED_CONFIG_PATH)) !== PERMISSION_PROFILE_SHA256
) {
  console.error("[luna-worker] installed permission profile hash does not match the protocol");
  process.exit(1);
}
const installedCodexVersion = await readInstalledCodexVersion();
if (installedCodexVersion !== EXPECTED_CODEX_VERSION_OUTPUT) {
  console.error(
    `[luna-worker] installed Codex CLI version must be exactly ${EXPECTED_CODEX_VERSION_OUTPUT}; received ${installedCodexVersion || "no output"}`,
  );
  process.exit(1);
}

await mkdir(JOBS_ROOT, { recursive: true, mode: 0o700 });
await reconcileInterruptedJobs();

const cancelledJobs = new Set();
const scheduledJobs = new Set();
const activeChildren = new Map();
let activeJobId = null;
let queuedRuns = 0;
let queueTail = Promise.resolve();

function parseIntegerEnv(name, fallback, { min, max }) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function readInstalledCodexVersion() {
  return new Promise((resolve, reject) => {
    const child = spawn(CODEX_COMMAND, [...CODEX_PREFIX_ARGS, "--version"], {
      cwd: path.dirname(fileURLToPath(import.meta.url)),
      env: {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        HOME,
        CODEX_HOME,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${chunk}`.slice(0, 512);
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(0, 512);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 && !signal) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(
        `Codex version probe failed (${signal ?? code ?? "unknown"}): ${stderr.replace(/\s+/g, " ").trim() || "no stderr"}`,
      ));
    });
  });
}

async function availableVolumeBytes() {
  const stats = await statfs(CODEX_HOME);
  return Number(stats.bavail) * Number(stats.bsize);
}

async function reconcileInterruptedJobs() {
  const entries = await readdir(JOBS_ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let jobId;
    try {
      jobId = validateJobId(entry.name);
    } catch {
      continue;
    }
    const paths = jobPaths(jobId);
    let metadata;
    try {
      metadata = JSON.parse(await readFile(paths.metadata, "utf8"));
    } catch {
      continue;
    }
    if (metadata.status !== "queued" && metadata.status !== "running") continue;
    await writeMetadata(paths, {
      ...metadata,
      status: "interrupted",
      errorCode: "worker_restarted",
      updatedAt: new Date().toISOString(),
    });
  }
}

function jobPaths(jobId) {
  const root = path.join(JOBS_ROOT, validateJobId(jobId));
  return {
    root,
    workspace: path.join(root, "workspace"),
    metadata: path.join(root, "job.json"),
  };
}

function jsonResponse(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

async function readJsonBody(request) {
  const contentType = String(request.headers["content-type"] || "").split(";", 1)[0].trim();
  if (contentType !== "application/json") {
    throw new HttpError(415, "unsupported_media_type", "content-type must be application/json");
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.byteLength;
    if (bytes > DEFAULT_LIMITS.maxBodyBytes) {
      throw new HttpError(413, "request_too_large", "request body exceeds the configured limit");
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "request body is not valid JSON");
  }
}

async function readMetadata(paths) {
  try {
    return JSON.parse(await readFile(paths.metadata, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") throw new HttpError(404, "job_not_found", "job does not exist");
    throw error;
  }
}

async function writeMetadata(paths, metadata) {
  const temporary = path.join(paths.root, `.job-${process.pid}-${randomUUID()}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
  try {
    renameSync(temporary, paths.metadata);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function reserveRun(jobId) {
  if (scheduledJobs.has(jobId)) throw new HttpError(409, "job_busy", "job is already queued or running");
  if (queuedRuns >= MAX_QUEUE_DEPTH) throw new HttpError(429, "queue_full", "Luna worker queue is full");
  scheduledJobs.add(jobId);
  queuedRuns += 1;
}

function releaseRunReservation(jobId) {
  if (!scheduledJobs.delete(jobId)) return;
  queuedRuns = Math.max(0, queuedRuns - 1);
}

function enqueueReservedRun(jobId, operation) {
  if (!scheduledJobs.has(jobId)) throw new Error(`job ${jobId} was not reserved before enqueue`);
  const execute = async () => {
    queuedRuns -= 1;
    activeJobId = jobId;
    try {
      if (cancelledJobs.has(jobId)) throw new HttpError(409, "job_cancelled", "job was cancelled before it started");
      return await operation();
    } finally {
      activeJobId = null;
      cancelledJobs.delete(jobId);
      scheduledJobs.delete(jobId);
    }
  };
  const result = queueTail.then(execute, execute);
  queueTail = result.catch(() => undefined);
  return result;
}

function terminateChild(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const forceTimer = setTimeout(() => {
    if (child.exitCode !== null) return;
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, 5_000);
  forceTimer.unref();
}

function legacyMaterializedFingerprint(files) {
  return sha256Bytes(Buffer.from(
    files
      .map((file) => `${file.path}:${file.sha256}`)
      .sort()
      .join("\n"),
    "utf8",
  ));
}

async function loadBaseArtifact(paths, existing, expectedBaseFingerprint) {
  if (expectedBaseFingerprint === null) return { fingerprint: null, files: [] };
  if (!existing || existing.materializedFingerprint !== expectedBaseFingerprint) {
    throw new HttpError(409, "stale_base_fingerprint", "expected base does not match the current worker artifact");
  }
  const collected = await collectDeliverables(paths.workspace);
  const verifiedFingerprint = typeof existing.artifactContractSha256 === "string"
    ? materializedFingerprintFor(existing.artifactContractSha256, collected)
    : legacyMaterializedFingerprint(collected);
  if (verifiedFingerprint !== expectedBaseFingerprint) {
    throw new HttpError(422, "base_artifact_integrity", "persisted base artifact no longer matches its fingerprint");
  }
  return {
    fingerprint: expectedBaseFingerprint,
    files: collected.map((file) => ({
      path: file.path,
      bytes: Buffer.from(file.contentBase64, "base64"),
      sha256: file.sha256,
      size: file.size,
    })),
  };
}

async function runCodex({ jobId, paths, mode, prompt, threadId, files, state, artifactContract, baseArtifact }) {
  const preexistingForbidden = await removeForbiddenWorkspaceEntries(paths.workspace);
  if (preexistingForbidden.length) {
    await writeFile(
      path.join(paths.root, `security-violation-${Date.now()}-before.json`),
      `${JSON.stringify({ phase: "before", removed: preexistingForbidden }, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
    throw new HttpError(
      409,
      "workspace_instruction_tamper",
      "forbidden instruction or symlink state was removed before resume",
    );
  }
  const writtenFiles = await writeInputFiles(paths.workspace, files);
  const tmpDirectory = path.join(paths.workspace, ".tmp");
  await mkdir(tmpDirectory, { recursive: true, mode: 0o700 });
  const imagePaths = writtenFiles.filter((file) => file.attachAsImage).map((file) => file.absolutePath);
  const adaptedPrompt = buildToollessArtifactPrompt(prompt, writtenFiles, {
    mode,
    artifactContract,
    baseFingerprint: baseArtifact.fingerprint,
    baseDeliverables: baseArtifact.files,
  });
  const args = buildCodexArgs({
    mode,
    workspace: paths.workspace,
    threadId,
    model: MODEL,
    reasoningEffort: REASONING_EFFORT,
    imagePaths,
    outputSchemaPath: OUTPUT_SCHEMA_PATH,
  });
  const runId = `${Date.now()}-${mode}-${randomUUID()}`;
  const eventPath = path.join(paths.root, `events-${runId}.jsonl`);
  const stderrPath = path.join(paths.root, `stderr-${runId}.log`);
  const eventLines = [];
  const stderrChunks = [];
  Object.assign(state, {
    threadId: undefined,
    observedThreadId: undefined,
    turnCompleted: false,
    finalMessage: "",
    usage: undefined,
    codexError: undefined,
    rawEnvelopeSha256: undefined,
    responseBytes: undefined,
    materializedFingerprint: undefined,
    artifactContractSha256: undefined,
    rolloutSha256: undefined,
    rolloutResponseItems: undefined,
  });
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let timedOut = false;
  let outputOverflow = false;
  let workspaceOverflow = false;
  const child = spawn(CODEX_COMMAND, [...CODEX_PREFIX_ARGS, ...args], {
    cwd: paths.workspace,
    env: buildChildEnv(process.env, { home: HOME, codexHome: CODEX_HOME, workspace: paths.workspace }),
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  activeChildren.set(jobId, child);
  child.stdin.end(adaptedPrompt, "utf8");

  const timeout = setTimeout(() => {
    timedOut = true;
    terminateChild(child);
  }, JOB_TIMEOUT_MS);
  timeout.unref();
  const workspaceMonitor = setInterval(() => {
    void workspaceSizeBytes(paths.workspace).then((size) => {
      if (size <= MAX_WORKSPACE_BYTES || workspaceOverflow) return;
      workspaceOverflow = true;
      terminateChild(child);
    }).catch(() => undefined);
  }, 1_000);
  workspaceMonitor.unref();

  child.stderr.on("data", (chunk) => {
    const remaining = DEFAULT_LIMITS.maxCodexStderrBytes - stderrBytes;
    stderrBytes += chunk.byteLength;
    if (remaining > 0) stderrChunks.push(chunk.subarray(0, remaining));
  });

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let parseFailure;
  lines.on("line", (line) => {
    if (parseFailure || outputOverflow) return;
    stdoutBytes += Buffer.byteLength(line, "utf8") + 1;
    if (stdoutBytes > DEFAULT_LIMITS.maxCodexOutputBytes) {
      outputOverflow = true;
      terminateChild(child);
      return;
    }
    eventLines.push(`${line}\n`);
    try {
      parseCodexEvent(line, state);
      if (state.toolViolation || state.codexItemError || state.unknownItemType) terminateChild(child);
    } catch (error) {
      parseFailure = error;
      terminateChild(child);
    }
  });

  let exit;
  try {
    exit = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
    });
  } finally {
    clearTimeout(timeout);
    clearInterval(workspaceMonitor);
    activeChildren.delete(jobId);
    lines.close();
    await Promise.all([
      writeFile(eventPath, eventLines.join(""), { flag: "wx", mode: 0o600 }),
      writeFile(stderrPath, Buffer.concat(stderrChunks), { flag: "wx", mode: 0o600 }),
    ]);
  }
  const { code, signal } = exit;

  const authoredForbidden = await removeForbiddenWorkspaceEntries(paths.workspace);
  if (authoredForbidden.length) {
    await writeFile(
      path.join(paths.root, `security-violation-${Date.now()}-after.json`),
      `${JSON.stringify({ phase: "after", removed: authoredForbidden }, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
    throw new HttpError(
      422,
      "workspace_instruction_tamper",
      "Codex created a forbidden instruction file or symbolic link",
    );
  }
  if (await workspaceSizeBytes(paths.workspace) > MAX_WORKSPACE_BYTES) {
    throw new HttpError(413, "workspace_too_large", `Codex workspace exceeded ${MAX_WORKSPACE_BYTES} bytes`);
  }

  if (cancelledJobs.has(jobId)) throw new HttpError(409, "job_cancelled", "job was cancelled");
  if (timedOut) throw new HttpError(504, "job_timeout", `Codex exceeded ${JOB_TIMEOUT_MS}ms`);
  if (workspaceOverflow) {
    throw new HttpError(413, "workspace_too_large", `Codex workspace exceeded ${MAX_WORKSPACE_BYTES} bytes`);
  }
  if (outputOverflow) throw new HttpError(502, "codex_output_too_large", "Codex event output exceeded the configured limit");
  if (parseFailure) throw new HttpError(502, "invalid_codex_output", parseFailure.message);
  if (state.toolViolation) {
    throw new HttpError(422, "tool_use_forbidden", `Codex attempted forbidden item type: ${state.toolViolation}`);
  }
  if (state.codexItemError) {
    throw new HttpError(502, "codex_error_item", state.codexItemError);
  }
  if (state.unknownItemType) {
    throw new HttpError(502, "unknown_codex_item", `Codex emitted unknown item type: ${state.unknownItemType}`);
  }
  if (code !== 0) {
    throw new HttpError(502, "codex_failed", `Codex exited with code ${code ?? "null"} (${signal ?? "no signal"})`);
  }
  if (state.codexError) throw new HttpError(502, "codex_error", state.codexError);
  if (!state.threadId) throw new HttpError(502, "missing_thread_id", "Codex did not emit thread.started");
  if (!state.turnCompleted) {
    throw new HttpError(502, "missing_turn_completion", "Codex exited without emitting turn.completed");
  }
  if (threadId && state.threadId !== threadId) {
    throw new HttpError(502, "thread_id_mismatch", "Codex resumed a different thread than requested");
  }
  const rolloutAudit = await auditCodexSessionRollout(CODEX_HOME, state.threadId);
  if (rolloutAudit.forbiddenItems.length > 0) {
    throw new HttpError(
      422,
      "tool_use_forbidden",
      `Codex persisted forbidden tool/function items: ${rolloutAudit.forbiddenItems.join(", ")}`,
    );
  }
  state.rawEnvelopeSha256 = sha256Bytes(Buffer.from(state.finalMessage, "utf8"));
  state.responseBytes = Buffer.byteLength(state.finalMessage, "utf8");
  state.rolloutSha256 = rolloutAudit.sha256;
  state.rolloutResponseItems = rolloutAudit.responseItems;
  state.artifactContractSha256 = artifactContractSha256(artifactContract);
  const envelope = parseArtifactEnvelope(state.finalMessage, {
    mode,
    inputFiles: writtenFiles,
    baseFiles: baseArtifact.files,
    expectedBaseFingerprint: baseArtifact.fingerprint,
    artifactContract,
  });
  if (envelope.decision === "replace") {
    await materializeArtifactEnvelope(paths.workspace, envelope);
  }
  state.materializedFingerprint = materializedFingerprintFor(
    state.artifactContractSha256,
    envelope.files,
  );
  return state;
}

async function completedResponse(metadata, paths) {
  return {
    jobId: metadata.jobId,
    operationId: metadata.operationId,
    runCount: metadata.runCount,
    threadId: metadata.threadId,
    status: "completed",
    model: metadata.model,
    reasoningEffort: metadata.reasoningEffort,
    codexVersion: CODEX_VERSION,
    artifactContractSha256: metadata.artifactContractSha256,
    rawEnvelopeSha256: metadata.rawEnvelopeSha256,
    materializedFingerprint: metadata.materializedFingerprint,
    rolloutSha256: metadata.rolloutSha256,
    rolloutResponseItems: metadata.rolloutResponseItems,
    finalMessage: metadata.finalMessage || "",
    ...(metadata.usage ? { usage: metadata.usage } : {}),
    deliverables: await collectDeliverables(paths.workspace),
  };
}

async function executeJob({ jobId, paths, mode, request, existing }) {
  const startedAt = new Date().toISOString();
  const running = {
    ...(existing || {}),
    jobId,
    status: "running",
    model: MODEL,
    reasoningEffort: REASONING_EFFORT,
    startedAt,
    updatedAt: startedAt,
    runCount: (existing?.runCount || 0) + 1,
    errorCode: undefined,
    failure: undefined,
    finalMessage: undefined,
    rawEnvelopeSha256: undefined,
    rolloutSha256: undefined,
    rolloutResponseItems: undefined,
    usage: undefined,
  };
  await writeMetadata(paths, running);
  const state = {};
  try {
    const baseArtifact = await loadBaseArtifact(
      paths,
      existing,
      mode === "resume" ? request.expectedBaseFingerprint : null,
    );
    await runCodex({
      jobId,
      paths,
      mode,
      prompt: request.prompt,
      threadId: existing?.threadId,
      files: request.files,
      state,
      artifactContract: request.artifactContract,
      baseArtifact,
    });
    const completed = {
      ...running,
      status: "completed",
      threadId: state.threadId,
      finalMessage: state.finalMessage,
      artifactContractSha256: state.artifactContractSha256,
      rawEnvelopeSha256: state.rawEnvelopeSha256,
      materializedFingerprint: state.materializedFingerprint,
      rolloutSha256: state.rolloutSha256,
      rolloutResponseItems: state.rolloutResponseItems,
      usage: state.usage,
      errorCode: undefined,
      failure: undefined,
      updatedAt: new Date().toISOString(),
    };
    const response = await completedResponse(completed, paths);
    await writeMetadata(paths, completed);
    return response;
  } catch (error) {
    const failure = safeFailureReceipt(error, state);
    const failed = {
      ...running,
      ...(state?.threadId ? { threadId: state.threadId } : {}),
      status: error?.code === "job_cancelled" ? "cancelled" : error?.code === "job_timeout" ? "timed_out" : "failed",
      errorCode: error?.code || "internal_error",
      failure: {
        ...failure,
        ...(mode === "resume" && request.expectedBaseFingerprint
          ? { baseFingerprint: request.expectedBaseFingerprint }
          : {}),
      },
      ...(state.rawEnvelopeSha256 ? { rawEnvelopeSha256: state.rawEnvelopeSha256 } : {}),
      ...(state.rolloutSha256 ? { rolloutSha256: state.rolloutSha256 } : {}),
      ...(state.rolloutResponseItems ? { rolloutResponseItems: state.rolloutResponseItems } : {}),
      ...(state.usage ? { usage: state.usage } : {}),
      updatedAt: new Date().toISOString(),
    };
    await writeMetadata(paths, failed).catch(() => undefined);
    throw error;
  }
}

async function handleCreate(request, response) {
  if (await availableVolumeBytes() < MIN_FREE_BYTES) {
    throw new HttpError(507, "volume_low", "Luna worker volume is below its free-space reserve");
  }
  if (queuedRuns >= MAX_QUEUE_DEPTH) {
    throw new HttpError(429, "queue_full", "Luna worker queue is full");
  }
  const parsed = parseJobRequest(await readJsonBody(request), {
    requireJobId: true,
    requireOperationId: true,
  });
  const paths = jobPaths(parsed.jobId);
  try {
    await mkdir(paths.root, { mode: 0o700 });
    await mkdir(paths.workspace, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      const existing = await readMetadata(paths);
      if (existing.operationId !== parsed.operationId) {
        throw new HttpError(409, "job_exists", "jobId already belongs to a different create operation");
      }
      if (existing.status !== "interrupted") {
        jsonResponse(response, existing.status === "completed" ? 200 : 202, {
          jobId: parsed.jobId,
          operationId: existing.operationId,
          status: scheduledJobs.has(parsed.jobId)
            ? (activeJobId === parsed.jobId ? "running" : "queued")
            : existing.status,
        });
        return;
      }
      const requeuedAt = new Date().toISOString();
      const requeued = {
        ...existing,
        status: "queued",
        queuedAt: requeuedAt,
        updatedAt: requeuedAt,
      };
      reserveRun(parsed.jobId);
      try {
        await writeMetadata(paths, requeued);
      } catch (error) {
        releaseRunReservation(parsed.jobId);
        throw error;
      }
      void enqueueReservedRun(parsed.jobId, () =>
        executeJob({ jobId: parsed.jobId, paths, mode: "new", request: parsed, existing: requeued }),
      ).catch((runError) => {
        console.error(`[luna-worker] requeued create ${parsed.jobId} failed: ${runError?.code || runError?.message || runError}`);
      });
      jsonResponse(response, 202, {
        jobId: parsed.jobId,
        operationId: parsed.operationId,
        status: "queued",
      });
      return;
    }
    throw error;
  }
  const queuedAt = new Date().toISOString();
  const queued = {
    jobId: parsed.jobId,
    operationId: parsed.operationId,
    status: "queued",
    model: MODEL,
    reasoningEffort: REASONING_EFFORT,
    queuedAt,
    updatedAt: queuedAt,
    runCount: 0,
  };
  reserveRun(parsed.jobId);
  try {
    await writeMetadata(paths, queued);
  } catch (error) {
    releaseRunReservation(parsed.jobId);
    throw error;
  }
  void enqueueReservedRun(parsed.jobId, () =>
    executeJob({ jobId: parsed.jobId, paths, mode: "new", request: parsed, existing: queued }),
  ).catch((error) => {
    console.error(`[luna-worker] create ${parsed.jobId} failed: ${error?.code || error?.message || error}`);
  });
  jsonResponse(response, 202, {
    jobId: parsed.jobId,
    operationId: parsed.operationId,
    status: "queued",
  });
}

async function handleResume(jobId, request, response) {
  if (queuedRuns >= MAX_QUEUE_DEPTH) {
    throw new HttpError(429, "queue_full", "Luna worker queue is full");
  }
  const parsed = parseJobRequest(await readJsonBody(request), {
    requireJobId: false,
    requireOperationId: true,
    requireExpectedRunCount: true,
  });
  const paths = jobPaths(jobId);
  const existing = await readMetadata(paths);
  if (!existing.threadId) throw new HttpError(409, "job_not_resumable", "job has no persisted Codex thread id");
  if (existing.operationId === parsed.operationId && existing.status !== "interrupted") {
    jsonResponse(response, existing.status === "completed" ? 200 : 202, {
      jobId,
      operationId: existing.operationId,
      status: scheduledJobs.has(jobId)
        ? (activeJobId === jobId ? "running" : "queued")
        : existing.status,
    });
    return;
  }
  if (existing.status === "running" || existing.status === "queued") {
    throw new HttpError(409, "job_busy", "job is already queued or running");
  }
  const resumableStatus = existing.status === "completed" ||
    existing.status === "interrupted" ||
    (existing.status === "failed" && existing.failure?.recoverable === true);
  if (!resumableStatus) {
    throw new HttpError(
      409,
      "job_not_resumable",
      "only completed, interrupted, or recoverable artifact-protocol turns may continue",
    );
  }
  if (existing.operationId !== parsed.operationId && existing.runCount !== parsed.expectedRunCount) {
    throw new HttpError(
      409,
      "stale_job_generation",
      `expected completed run ${parsed.expectedRunCount}, current run is ${existing.runCount}`,
    );
  }
  const currentBaseFingerprint = typeof existing.materializedFingerprint === "string"
    ? existing.materializedFingerprint
    : null;
  if (parsed.expectedBaseFingerprint !== currentBaseFingerprint) {
    throw new HttpError(
      409,
      "stale_base_fingerprint",
      "expectedBaseFingerprint does not match the current trustworthy worker artifact",
    );
  }
  const queuedAt = new Date().toISOString();
  const queued = {
    ...existing,
    operationId: parsed.operationId,
    status: "queued",
    queuedAt,
    updatedAt: queuedAt,
  };
  reserveRun(jobId);
  try {
    await writeMetadata(paths, queued);
  } catch (error) {
    releaseRunReservation(jobId);
    throw error;
  }
  void enqueueReservedRun(jobId, () =>
    executeJob({ jobId, paths, mode: "resume", request: parsed, existing: queued }),
  ).catch((error) => {
    console.error(`[luna-worker] resume ${jobId} failed: ${error?.code || error?.message || error}`);
  });
  jsonResponse(response, 202, { jobId, operationId: parsed.operationId, status: "queued" });
}

async function handleGet(jobId, response) {
  const paths = jobPaths(jobId);
  const metadata = await readMetadata(paths);
  const scheduledStatus = scheduledJobs.has(jobId) ? (activeJobId === jobId ? "running" : "queued") : undefined;
  if (metadata.status === "completed" && !scheduledStatus) {
    jsonResponse(response, 200, await completedResponse(metadata, paths));
    return;
  }
  jsonResponse(response, 200, {
    jobId: metadata.jobId,
    operationId: metadata.operationId,
    runCount: metadata.runCount,
    threadId: metadata.threadId,
    status: scheduledStatus || metadata.status,
    ...(metadata.errorCode ? { errorCode: metadata.errorCode } : {}),
    ...(metadata.failure ? { failure: metadata.failure } : {}),
    ...(metadata.rawEnvelopeSha256 ? { rawEnvelopeSha256: metadata.rawEnvelopeSha256 } : {}),
    ...(metadata.rolloutSha256 ? { rolloutSha256: metadata.rolloutSha256 } : {}),
    ...(metadata.rolloutResponseItems
      ? { rolloutResponseItems: metadata.rolloutResponseItems }
      : {}),
  });
}

async function handleCancel(jobId, response) {
  const paths = jobPaths(jobId);
  const metadata = await readMetadata(paths);
  if (!scheduledJobs.has(jobId) && !new Set(["queued", "running"]).has(metadata.status)) {
    throw new HttpError(409, "job_not_active", "only queued or running jobs can be cancelled");
  }
  cancelledJobs.add(jobId);
  terminateChild(activeChildren.get(jobId));
  const cancelled = {
    ...metadata,
    status: "cancelled",
    errorCode: "job_cancelled",
    updatedAt: new Date().toISOString(),
  };
  await writeMetadata(paths, cancelled);
  jsonResponse(response, 202, { jobId, threadId: metadata.threadId, status: "cancelled" });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://worker.internal");
    if (request.method === "GET" && url.pathname === "/healthz") {
      const authPath = path.join(CODEX_HOME, "auth.json");
      const freeBytes = await availableVolumeBytes();
      const authConfigured = existsSync(authPath);
      const ready = authConfigured && freeBytes >= MIN_FREE_BYTES;
      jsonResponse(response, ready ? 200 : 503, {
        ok: ready,
        status: ready ? "ready" : freeBytes < MIN_FREE_BYTES ? "volume_low" : "not_ready",
        version: CODEX_VERSION,
        model: MODEL,
        reasoningEffort: REASONING_EFFORT,
        artifactProtocol: ARTIFACT_PROTOCOL_VERSION,
        artifactSchemaSha256: ARTIFACT_SCHEMA_SHA256,
        permissionProfileSha256: PERMISSION_PROFILE_SHA256,
        authenticated: authConfigured,
        authConfigured,
        freeBytes,
        minFreeBytes: MIN_FREE_BYTES,
        queue: { active: activeJobId !== null, queued: queuedRuns },
      });
      return;
    }

    if (!authenticateBearerHeader(request.headers.authorization, TOKEN)) {
      jsonResponse(response, 401, { error: { code: "unauthorized", message: "valid bearer authentication is required" } });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/jobs") {
      await handleCreate(request, response);
      return;
    }
    const match = /^\/v1\/jobs\/([^/]+?)(\/resume)?$/.exec(url.pathname);
    if (match) {
      const jobId = validateJobId(decodeURIComponent(match[1]));
      if (request.method === "POST" && match[2] === "/resume") {
        await handleResume(jobId, request, response);
        return;
      }
      if (request.method === "GET" && !match[2]) {
        await handleGet(jobId, response);
        return;
      }
      if (request.method === "DELETE" && !match[2]) {
        await handleCancel(jobId, response);
        return;
      }
    }
    throw new HttpError(404, "not_found", "route not found");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const code = error instanceof HttpError ? error.code : "internal_error";
    const message = error instanceof HttpError ? error.message : "internal worker error";
    if (status >= 500) console.error(`[luna-worker] ${code}: ${error?.stack || error}`);
    if (!response.headersSent) jsonResponse(response, status, { error: { code, message } });
    else response.destroy();
  }
});

server.requestTimeout = 60_000;
server.headersTimeout = 30_000;
server.keepAliveTimeout = 5_000;
server.listen(PORT, "::", () => {
  console.log(`[luna-worker] listening on [::]:${PORT}; model=${MODEL}; reasoning=${REASONING_EFFORT}`);
});

function shutdown(signal) {
  console.log(`[luna-worker] received ${signal}; stopping`);
  for (const child of activeChildren.values()) terminateChild(child);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
