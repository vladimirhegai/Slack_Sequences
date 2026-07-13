import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";

export const DEFAULT_LIMITS = Object.freeze({
  maxBodyBytes: 48 * 1024 * 1024,
  maxPromptBytes: 256 * 1024,
  maxInputFiles: 192,
  maxInputFileBytes: 16 * 1024 * 1024,
  maxInputBytes: 32 * 1024 * 1024,
  maxInlineTextBytes: 8 * 1024 * 1024,
  maxDeliverables: 128,
  maxDeliverableBytes: 8 * 1024 * 1024,
  maxDeliverableTextBytes: 2 * 1024 * 1024,
  maxDeliverableTotalBytes: 16 * 1024 * 1024,
  maxCodexOutputBytes: 24 * 1024 * 1024,
  maxCodexStderrBytes: 2 * 1024 * 1024,
});

const JOB_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,94}[A-Za-z0-9])?$/;
const OPERATION_ID_PATTERN = /^[a-f0-9]{64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const CONTRACT_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SAFE_PROTOCOL_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const IMAGE_EXTENSIONS = new Set([".jpeg", ".jpg", ".png", ".webp"]);
const COPYABLE_ASSET_EXTENSIONS = new Set([
  ".jpeg",
  ".jpg",
  ".otf",
  ".png",
  ".svg",
  ".ttf",
  ".webp",
  ".woff",
  ".woff2",
]);
export const DEFAULT_ARTIFACT_CONTRACT = Object.freeze({
  id: "film-bundle-v1",
  requiredPaths: Object.freeze([
    "deliverables/assets-manifest.json",
    "deliverables/composition.html",
    "deliverables/director-treatment.md",
    "deliverables/motion-intent.json",
    "deliverables/storyboard.json",
  ]),
});
export const ARTIFACT_PROTOCOL_VERSION = "luna-tool-less-artifact-v2";
export const ARTIFACT_SCHEMA_SHA256 = "7fa551fb261b6dee573aca74507202f5ab0b30ca00fe60cd04141dea8dfe104d";
export const PERMISSION_PROFILE_SHA256 = "ebd9f548aaa2f1d48df15ea1e124462350791ede65267f7677e9a834fa0060c6";
const DISABLED_TOOL_FEATURES = Object.freeze([
  "shell_tool",
  "multi_agent",
  "multi_agent_v2",
  "apps",
  "plugins",
  "tool_suggest",
  "in_app_browser",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "computer_use",
  "image_generation",
  "goals",
  "remote_plugin",
  "plugin_sharing",
  "skill_mcp_dependency_install",
  "hooks",
  "workspace_dependencies",
]);
const FORBIDDEN_CODEX_ITEM_TYPES = new Set([
  "command_execution",
  "file_change",
  "mcp_tool_call",
  "collab_tool_call",
  "web_search",
  "todo_list",
]);
const ALLOWED_ROLLOUT_RESPONSE_ITEM_TYPES = new Set([
  "compaction",
  "context_compaction",
  "message",
  "reasoning",
]);
const TEXT_INPUT_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".svg",
  ".toml",
  ".ts",
  ".txt",
  ".xml",
]);
const FORBIDDEN_INSTRUCTION_NAMES = new Set([
  ".agents",
  ".claude",
  ".codex",
  ".cursor",
  ".git",
  "agents.md",
  "agents.override.md",
  "claude.md",
  "skill.md",
]);

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

const RECOVERABLE_ARTIFACT_FAILURE_CODES = new Set([
  "authored_text_too_large",
  "deliverable_too_large",
  "deliverables_too_large",
  "duplicate_deliverable_path",
  "invalid_artifact_envelope",
  "missing_required_deliverables",
]);
const SECURITY_FAILURE_CODES = new Set([
  "tool_use_forbidden",
  "workspace_instruction_tamper",
]);
const INTEGRITY_FAILURE_CODES = new Set([
  "asset_copy_mismatch",
  "base_artifact_integrity",
  "base_fingerprint_mismatch",
  "inherit_hash_mismatch",
  "invalid_asset_copy",
  "invalid_rollout_jsonl",
  "invalid_rollout_state",
  "invalid_thread_id",
  "rollout_not_found",
  "rollout_not_unique",
  "rollout_thread_mismatch",
  "thread_id_mismatch",
  "unsafe_deliverables",
  "unsafe_rollout_state",
]);

export function safeFailureReceipt(error, state = {}) {
  const rawCode = typeof error?.code === "string" ? error.code : "internal_error";
  const errorCode = /^[a-z0-9_]{1,80}$/.test(rawCode) ? rawCode : "internal_error";
  const category = SECURITY_FAILURE_CODES.has(errorCode)
    ? "security"
    : INTEGRITY_FAILURE_CODES.has(errorCode)
      ? "integrity"
      : RECOVERABLE_ARTIFACT_FAILURE_CODES.has(errorCode)
        ? "artifact_protocol"
        : errorCode === "job_cancelled"
          ? "cancelled"
          : errorCode === "job_timeout"
            ? "timeout"
            : "runtime";
  const hasExactThread = typeof state.threadId === "string" &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(state.threadId);
  const hasAuditedRollout = typeof state.rolloutSha256 === "string" &&
    SHA256_PATTERN.test(state.rolloutSha256) &&
    Number.isSafeInteger(state.rolloutResponseItems) &&
    state.rolloutResponseItems > 0;
  const hasBoundedResponse = typeof state.rawEnvelopeSha256 === "string" &&
    SHA256_PATTERN.test(state.rawEnvelopeSha256) &&
    Number.isSafeInteger(state.responseBytes) &&
    state.responseBytes >= 0 &&
    state.responseBytes <= DEFAULT_LIMITS.maxCodexOutputBytes;
  const recoverable = category === "artifact_protocol" &&
    hasExactThread && hasAuditedRollout && hasBoundedResponse;
  return {
    errorCode,
    category,
    recoverable,
    envelopeFindings: category === "artifact_protocol" ? [{ code: errorCode }] : [],
    response: {
      present: hasBoundedResponse,
      ...(hasBoundedResponse
        ? {
            bytes: state.responseBytes,
            sha256: state.rawEnvelopeSha256.toLowerCase(),
          }
        : {}),
    },
    ...(hasAuditedRollout
      ? {
          rollout: {
            sha256: state.rolloutSha256.toLowerCase(),
            responseItems: state.rolloutResponseItems,
          },
        }
      : {}),
  };
}

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function authenticateBearerHeader(header, expectedToken) {
  if (typeof expectedToken !== "string" || expectedToken.length < 32) return false;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const supplied = header.slice("Bearer ".length);
  if (!supplied) return false;
  const suppliedDigest = createHash("sha256").update(supplied, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expectedToken, "utf8").digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

export function validateJobId(value) {
  if (typeof value !== "string" || !JOB_ID_PATTERN.test(value)) {
    throw new HttpError(
      400,
      "invalid_job_id",
      "jobId must be 1-96 characters using letters, digits, dot, underscore, or hyphen",
    );
  }
  return value;
}

export function validateOperationId(value) {
  if (typeof value !== "string" || !OPERATION_ID_PATTERN.test(value)) {
    throw new HttpError(400, "invalid_operation_id", "operationId must be a lowercase SHA-256 digest");
  }
  return value;
}

export function validateArtifactContract(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_artifact_contract", "artifactContract must be an object");
  }
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "id,requiredPaths") {
    throw new HttpError(
      400,
      "invalid_artifact_contract",
      "artifactContract accepts only id and requiredPaths",
    );
  }
  if (typeof value.id !== "string" || !CONTRACT_ID_PATTERN.test(value.id)) {
    throw new HttpError(
      400,
      "invalid_artifact_contract",
      "artifactContract.id must be a safe 1-64 character identifier",
    );
  }
  if (
    !Array.isArray(value.requiredPaths) ||
    value.requiredPaths.length === 0 ||
    value.requiredPaths.length > DEFAULT_LIMITS.maxDeliverables
  ) {
    throw new HttpError(
      400,
      "invalid_artifact_contract",
      `artifactContract.requiredPaths must contain 1-${DEFAULT_LIMITS.maxDeliverables} paths`,
    );
  }
  const requiredPaths = value.requiredPaths.map(validateRelativeDeliverablePath).sort();
  if (new Set(requiredPaths).size !== requiredPaths.length) {
    throw new HttpError(400, "invalid_artifact_contract", "artifactContract required paths must be unique");
  }
  return Object.freeze({ id: value.id, requiredPaths: Object.freeze(requiredPaths) });
}

export function artifactContractSha256(contract) {
  const canonical = validateArtifactContract(contract);
  return sha256Bytes(Buffer.from(JSON.stringify(canonical), "utf8"));
}

export function materializedFingerprintFor(contractSha256, files) {
  if (typeof contractSha256 !== "string" || !SHA256_PATTERN.test(contractSha256)) {
    throw new Error("contractSha256 must be a SHA-256 digest");
  }
  const manifest = [...files]
    .map((file) => {
      if (
        !file ||
        typeof file.path !== "string" ||
        typeof file.sha256 !== "string" ||
        !SHA256_PATTERN.test(file.sha256)
      ) {
        throw new Error("materialized files require canonical paths and SHA-256 digests");
      }
      return { path: validateRelativeDeliverablePath(file.path), sha256: file.sha256.toLowerCase() };
    })
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return sha256Bytes(Buffer.from(JSON.stringify({ contractSha256: contractSha256.toLowerCase(), files: manifest }), "utf8"));
}

export function operationIdForRequest(
  prompt,
  files,
  {
    expectedRunCount = null,
    artifactContract = DEFAULT_ARTIFACT_CONTRACT,
    expectedBaseFingerprint = null,
  } = {},
) {
  const canonicalContract = validateArtifactContract(artifactContract);
  if (
    expectedBaseFingerprint !== null &&
    (typeof expectedBaseFingerprint !== "string" || !SHA256_PATTERN.test(expectedBaseFingerprint))
  ) {
    throw new HttpError(400, "invalid_base_fingerprint", "expectedBaseFingerprint must be null or a SHA-256 digest");
  }
  const canonical = JSON.stringify({
    protocol: ARTIFACT_PROTOCOL_VERSION,
    schemaSha256: ARTIFACT_SCHEMA_SHA256,
    permissionProfileSha256: PERMISSION_PROFILE_SHA256,
    expectedRunCount,
    expectedBaseFingerprint: expectedBaseFingerprint?.toLowerCase() ?? null,
    artifactContract: canonicalContract,
    promptSha256: sha256Bytes(Buffer.from(prompt, "utf8")),
    files: [...files]
      .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
      .map((file) => ({ path: file.path, sha256: file.sha256 })),
  });
  return sha256Bytes(Buffer.from(canonical, "utf8"));
}

export function validateRelativeInputPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 240) {
    throw new HttpError(400, "invalid_file_path", "file paths must contain 1-240 characters");
  }
  if (!SAFE_PROTOCOL_PATH_PATTERN.test(value) || value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value)) {
    throw new HttpError(400, "invalid_file_path", "file paths must use safe relative POSIX syntax");
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new HttpError(400, "invalid_file_path", "file paths cannot contain empty, dot, or parent segments");
  }
  if (segments[0] !== "inputs") {
    throw new HttpError(400, "invalid_file_path", "input files must be placed below inputs/");
  }
  if (
    segments.some((segment) => FORBIDDEN_INSTRUCTION_NAMES.has(segment.toLowerCase())) ||
    path.posix.basename(value).toLowerCase().endsWith(".env")
  ) {
    throw new HttpError(400, "invalid_file_path", "Codex state and environment files cannot be uploaded");
  }
  return segments.join("/");
}

export function validateRelativeDeliverablePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 240) {
    throw new HttpError(422, "invalid_deliverable_path", "deliverable paths must contain 1-240 characters");
  }
  if (!SAFE_PROTOCOL_PATH_PATTERN.test(value) || value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value)) {
    throw new HttpError(422, "invalid_deliverable_path", "deliverable paths must use safe relative POSIX syntax");
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new HttpError(422, "invalid_deliverable_path", "deliverable paths cannot contain empty, dot, or parent segments");
  }
  if (segments.length < 2 || segments[0] !== "deliverables") {
    throw new HttpError(422, "invalid_deliverable_path", "artifact-envelope files must be placed below deliverables/");
  }
  if (
    segments.some((segment) => FORBIDDEN_INSTRUCTION_NAMES.has(segment.toLowerCase())) ||
    path.posix.basename(value).toLowerCase().endsWith(".env")
  ) {
    throw new HttpError(422, "invalid_deliverable_path", "instruction, Codex state, and environment files are forbidden");
  }
  return segments.join("/");
}

export async function removeForbiddenWorkspaceEntries(workspace) {
  const removed = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(workspace, absolutePath).split(path.sep).join("/");
      if (entry.isSymbolicLink() || FORBIDDEN_INSTRUCTION_NAMES.has(entry.name.toLowerCase())) {
        await rm(absolutePath, { recursive: true, force: true });
        removed.push(relativePath);
        continue;
      }
      if (entry.isDirectory()) await walk(absolutePath);
    }
  }
  try {
    await walk(workspace);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  removed.sort();
  return removed;
}

export async function workspaceSizeBytes(workspace) {
  let total = 0;
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        try {
          total += (await lstat(absolutePath)).size;
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
    }
  }
  try {
    await walk(workspace);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return total;
}

export async function auditCodexSessionRollout(codexHome, threadId, { maxBytes = 64 * 1024 * 1024 } = {}) {
  if (typeof threadId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(threadId)) {
    throw new HttpError(502, "invalid_thread_id", "Codex thread ID is not a canonical UUID");
  }
  const codexHomeReal = await realpath(path.resolve(codexHome));
  const sessionsRoot = path.join(codexHomeReal, "sessions");
  const matches = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new HttpError(502, "unsafe_rollout_state", "Codex session storage contains a symbolic link");
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith(`-${threadId}.jsonl`)) {
        matches.push(absolutePath);
      }
    }
  }
  try {
    const sessionsInfo = await lstat(sessionsRoot);
    if (sessionsInfo.isSymbolicLink() || !sessionsInfo.isDirectory()) {
      throw new HttpError(502, "unsafe_rollout_state", "Codex sessions root must be a regular directory");
    }
    await walk(sessionsRoot);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new HttpError(502, "rollout_not_found", "Codex did not persist the exact session rollout");
    }
    throw error;
  }
  if (matches.length !== 1) {
    throw new HttpError(502, "rollout_not_unique", `expected one exact Codex rollout, found ${matches.length}`);
  }
  const info = await lstat(matches[0]);
  const rolloutReal = await realpath(matches[0]);
  if (!isInside(sessionsRoot, rolloutReal) || !info.isFile() || info.size > maxBytes) {
    throw new HttpError(502, "invalid_rollout_state", "Codex rollout is not a bounded regular file");
  }
  const bytes = await readFile(matches[0]);
  const forbiddenItems = [];
  let responseItems = 0;
  let sessionMatched = false;
  let rolloutText;
  try {
    rolloutText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new HttpError(502, "invalid_rollout_jsonl", "Codex rollout is not valid UTF-8");
  }
  for (const line of rolloutText.split(/\r?\n/)) {
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new HttpError(502, "invalid_rollout_jsonl", "Codex rollout contains malformed JSONL");
    }
    if (
      record?.type === "session_meta" &&
      (record.payload?.session_id === threadId || record.payload?.id === threadId)
    ) {
      sessionMatched = true;
    }
    if (record?.type !== "response_item") continue;
    responseItems += 1;
    const itemType = typeof record.payload?.type === "string" ? record.payload.type : "missing";
    if (!ALLOWED_ROLLOUT_RESPONSE_ITEM_TYPES.has(itemType)) {
      const name = typeof record.payload?.name === "string" ? `:${record.payload.name}` : "";
      forbiddenItems.push(`${itemType}${name}`);
    }
  }
  if (!sessionMatched) {
    throw new HttpError(502, "rollout_thread_mismatch", "Codex rollout did not identify the exact thread");
  }
  if (responseItems === 0) {
    throw new HttpError(502, "empty_rollout", "Codex rollout contained no response items");
  }
  return {
    sha256: sha256Bytes(bytes),
    responseItems,
    forbiddenItems: [...new Set(forbiddenItems)].sort(),
  };
}

export function decodeInputFile(file, limits = DEFAULT_LIMITS) {
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    throw new HttpError(400, "invalid_file", "each file must be an object");
  }
  const relativePath = validateRelativeInputPath(file.path);
  if (typeof file.contentBase64 !== "string" || !BASE64_PATTERN.test(file.contentBase64)) {
    throw new HttpError(400, "invalid_base64", `invalid base64 for ${relativePath}`);
  }
  const bytes = Buffer.from(file.contentBase64, "base64");
  if (bytes.byteLength > limits.maxInputFileBytes) {
    throw new HttpError(413, "input_file_too_large", `${relativePath} exceeds the per-file limit`);
  }
  const digest = sha256Bytes(bytes);
  if (file.sha256 !== undefined) {
    if (typeof file.sha256 !== "string" || !SHA256_PATTERN.test(file.sha256)) {
      throw new HttpError(400, "invalid_sha256", `invalid sha256 for ${relativePath}`);
    }
    if (file.sha256.toLowerCase() !== digest) {
      throw new HttpError(422, "sha256_mismatch", `sha256 does not match ${relativePath}`);
    }
  }
  return {
    path: relativePath,
    bytes,
    sha256: digest,
    attachAsImage: IMAGE_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase()),
  };
}

export function parseJobRequest(
  value,
  {
    requireJobId,
    requireOperationId = true,
    requireExpectedRunCount = false,
    limits = DEFAULT_LIMITS,
  } = {},
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_request", "request body must be a JSON object");
  }
  const prompt = value.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    throw new HttpError(400, "invalid_prompt", "prompt must be a non-empty string");
  }
  if (Buffer.byteLength(prompt, "utf8") > limits.maxPromptBytes) {
    throw new HttpError(413, "prompt_too_large", "prompt exceeds the configured limit");
  }
  const sourceFiles = value.files ?? [];
  if (!Array.isArray(sourceFiles) || sourceFiles.length > limits.maxInputFiles) {
    throw new HttpError(400, "invalid_files", `files must be an array of at most ${limits.maxInputFiles} items`);
  }
  const files = sourceFiles
    .map((file) => decodeInputFile(file, limits))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const uniquePaths = new Set();
  let totalBytes = 0;
  for (const file of files) {
    if (uniquePaths.has(file.path)) {
      throw new HttpError(400, "duplicate_file_path", `duplicate input path: ${file.path}`);
    }
    uniquePaths.add(file.path);
    totalBytes += file.bytes.byteLength;
  }
  if (totalBytes > limits.maxInputBytes) {
    throw new HttpError(413, "inputs_too_large", "decoded inputs exceed the configured total limit");
  }
  const result = { prompt, files };
  const artifactContract = validateArtifactContract(value.artifactContract);
  result.artifactContract = artifactContract;
  let expectedRunCount = null;
  let expectedBaseFingerprint = null;
  if (requireExpectedRunCount) {
    if (!Number.isSafeInteger(value.expectedRunCount) || value.expectedRunCount < 1) {
      throw new HttpError(400, "invalid_expected_run_count", "expectedRunCount must be a positive safe integer");
    }
    expectedRunCount = value.expectedRunCount;
    result.expectedRunCount = expectedRunCount;
    if (
      value.expectedBaseFingerprint !== null &&
      (typeof value.expectedBaseFingerprint !== "string" || !SHA256_PATTERN.test(value.expectedBaseFingerprint))
    ) {
      throw new HttpError(
        400,
        "invalid_base_fingerprint",
        "expectedBaseFingerprint must be null or a SHA-256 digest",
      );
    }
    expectedBaseFingerprint = value.expectedBaseFingerprint?.toLowerCase() ?? null;
    result.expectedBaseFingerprint = expectedBaseFingerprint;
  } else if (value.expectedBaseFingerprint !== undefined && value.expectedBaseFingerprint !== null) {
    throw new HttpError(400, "invalid_base_fingerprint", "create requests cannot name a base fingerprint");
  }
  if (requireJobId) result.jobId = validateJobId(value.jobId);
  if (requireOperationId) {
    const suppliedOperationId = validateOperationId(value.operationId);
    const expectedOperationId = operationIdForRequest(prompt, files, {
      expectedRunCount,
      artifactContract,
      expectedBaseFingerprint,
    });
    if (suppliedOperationId !== expectedOperationId) {
      throw new HttpError(422, "operation_id_mismatch", "operationId does not match prompt and file bytes");
    }
    result.operationId = suppliedOperationId;
  }
  return result;
}

export function buildToollessArtifactPrompt(
  prompt,
  files,
  {
    mode = "new",
    limits = DEFAULT_LIMITS,
    artifactContract = DEFAULT_ARTIFACT_CONTRACT,
    baseFingerprint = null,
    baseDeliverables = [],
  } = {},
) {
  if (mode !== "new" && mode !== "resume") throw new Error(`unsupported Codex mode: ${mode}`);
  const canonicalContract = validateArtifactContract(artifactContract);
  if (
    baseFingerprint !== null &&
    (typeof baseFingerprint !== "string" || !SHA256_PATTERN.test(baseFingerprint))
  ) {
    throw new Error("baseFingerprint must be null or a SHA-256 digest");
  }
  const textDecoder = new TextDecoder("utf-8", { fatal: true });
  const inlineFiles = [];
  const attachedImages = [];
  const opaqueFiles = [];
  let inlineBytes = 0;
  const canonicalFiles = [...files]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  for (const file of canonicalFiles) {
    const descriptor = { path: file.path, sha256: file.sha256, size: file.bytes.byteLength };
    if (file.attachAsImage) {
      attachedImages.push(descriptor);
      continue;
    }
    if (!TEXT_INPUT_EXTENSIONS.has(path.posix.extname(file.path).toLowerCase())) {
      opaqueFiles.push(descriptor);
      continue;
    }
    inlineBytes += file.bytes.byteLength;
    if (inlineBytes > limits.maxInlineTextBytes) {
      throw new HttpError(
        413,
        "inline_inputs_too_large",
        `text inputs exceed the ${limits.maxInlineTextBytes}-byte tool-less exchange limit`,
      );
    }
    let content;
    try {
      content = textDecoder.decode(file.bytes);
    } catch {
      throw new HttpError(422, "invalid_text_input", `${file.path} is not valid UTF-8`);
    }
    inlineFiles.push({ ...descriptor, content });
  }
  const hasBase = mode === "resume" && baseFingerprint !== null;
  const turnRule = mode === "new"
    ? "This is an initial turn. Use decision=replace, baseFingerprint=null, action=replace for every file, and return the complete final manifest."
    : hasBase
      ? `This is a continuation of the exact director thread. The trusted base fingerprint is ${baseFingerprint}. You may return decision=keep with that baseFingerprint and no files. Otherwise return decision=replace with the same baseFingerprint and a complete final file manifest: use action=inherit plus the exact prior sha256 for unchanged base files, and action=replace only for changed or new bytes. Omitting an old optional path deletes it.`
      : "This exact-thread continuation has no trustworthy materialized base. Use decision=replace, baseFingerprint=null, action=replace for every file, and return the complete final manifest; keep and inherit are unavailable.";
  const baseArtifact = hasBase
    ? {
        fingerprint: baseFingerprint,
        files: [...baseDeliverables]
          .map((file) => ({ path: file.path, sha256: file.sha256, size: file.size }))
          .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
      }
    : null;
  return `${prompt}\n\n---\nRAILWAY TOOL-LESS ARTIFACT EXCHANGE (hard execution contract)\n\nRailway does not permit the Codex Linux namespace sandbox. Do not call the shell, filesystem, network, MCP, connector, browser, todo-list, sub-agent, or any other tool. The verified UTF-8 inputs are embedded below and approved images are attached by the CLI. They are the complete read-only evidence for this turn. Opaque binary descriptors are not inspectable content and may only be preserved through the hash-bound copy mechanism below.\n\nReturn exactly one JSON object matching the supplied output schema, with no Markdown fence or prose. Every file object has path, action, content, copyFromInput, and sha256. For authored UTF-8 replacement text, set action=replace, content to the complete raw text, and the other two fields to null. To adopt an approved inert image/font, set action=replace, content=null, and copyFromInput/sha256 to the exact embedded input descriptor; copy bindings may target only deliverables/assets/luna/. For hash-bound inheritance, set action=inherit, content=null, copyFromInput=null, and sha256 to the exact base descriptor. Never return base64. The trusted worker independently verifies the host-declared artifact contract, resolves every inherited byte, re-hashes the final manifest, and atomically materializes replacements. ${turnRule}\n\n<verified-exchange-json>\n${JSON.stringify({ artifactContract: canonicalContract, baseArtifact, inlineFiles, attachedImages, opaqueFiles })}\n</verified-exchange-json>\n`;
}

function containsLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function parseArtifactEnvelope(
  value,
  {
    mode = "new",
    limits = DEFAULT_LIMITS,
    inputFiles = [],
    baseFiles = [],
    expectedBaseFingerprint = null,
    artifactContract = DEFAULT_ARTIFACT_CONTRACT,
  } = {},
) {
  if (mode !== "new" && mode !== "resume") throw new Error(`unsupported artifact mode: ${mode}`);
  const canonicalContract = validateArtifactContract(artifactContract);
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new HttpError(422, "invalid_artifact_envelope", "Codex final output is not valid artifact-envelope JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(422, "invalid_artifact_envelope", "artifact envelope must be a JSON object");
  }
  const keys = Object.keys(parsed).sort();
  if (keys.join(",") !== "baseFingerprint,decision,files") {
    throw new HttpError(
      422,
      "invalid_artifact_envelope",
      "artifact envelope accepts only decision, baseFingerprint, and files",
    );
  }
  if (parsed.decision !== "keep" && parsed.decision !== "replace") {
    throw new HttpError(422, "invalid_artifact_envelope", "artifact envelope decision must be keep or replace");
  }
  if (
    parsed.baseFingerprint !== null &&
    (typeof parsed.baseFingerprint !== "string" || !SHA256_PATTERN.test(parsed.baseFingerprint))
  ) {
    throw new HttpError(
      422,
      "invalid_artifact_envelope",
      "artifact envelope baseFingerprint must be null or a SHA-256 digest",
    );
  }
  const envelopeBaseFingerprint = parsed.baseFingerprint?.toLowerCase() ?? null;
  const canonicalExpectedBase = expectedBaseFingerprint?.toLowerCase() ?? null;
  if (envelopeBaseFingerprint !== canonicalExpectedBase) {
    throw new HttpError(
      422,
      "base_fingerprint_mismatch",
      "artifact envelope does not bind the expected base fingerprint",
    );
  }
  if (!Array.isArray(parsed.files) || parsed.files.length > limits.maxDeliverables) {
    throw new HttpError(422, "invalid_artifact_envelope", `files must contain at most ${limits.maxDeliverables} entries`);
  }
  if (parsed.decision === "replace" && parsed.files.length === 0) {
    throw new HttpError(422, "invalid_artifact_envelope", "replace requires at least one deliverable file");
  }
  if (parsed.decision === "keep" && parsed.files.length !== 0) {
    throw new HttpError(422, "invalid_artifact_envelope", "keep requires an empty files array");
  }
  const normalizedBaseFiles = baseFiles.map((file) => {
    const relativePath = validateRelativeDeliverablePath(file.path);
    if (!Buffer.isBuffer(file.bytes)) {
      throw new HttpError(422, "base_artifact_integrity", "base artifact bytes are unavailable");
    }
    const actualSha256 = sha256Bytes(file.bytes);
    if (typeof file.sha256 !== "string" || file.sha256.toLowerCase() !== actualSha256) {
      throw new HttpError(422, "base_artifact_integrity", "base artifact hash verification failed");
    }
    return { path: relativePath, bytes: file.bytes, sha256: actualSha256 };
  });
  const baseByPath = new Map(normalizedBaseFiles.map((file) => [file.path, file]));
  if (baseByPath.size !== normalizedBaseFiles.length) {
    throw new HttpError(422, "base_artifact_integrity", "base artifact contains duplicate paths");
  }
  if (parsed.decision === "keep") {
    if (mode !== "resume" || canonicalExpectedBase === null || normalizedBaseFiles.length === 0) {
      throw new HttpError(422, "invalid_artifact_envelope", "keep requires an exact materialized resume base");
    }
    const missing = canonicalContract.requiredPaths.filter((required) => !baseByPath.has(required));
    if (missing.length) {
      throw new HttpError(
        422,
        "missing_required_deliverables",
        "kept base artifact does not satisfy the host-declared contract",
      );
    }
    return {
      decision: "keep",
      baseFingerprint: canonicalExpectedBase,
      files: normalizedBaseFiles.sort(
        (left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
      ),
    };
  }
  const paths = new Set();
  const inputByPath = new Map(inputFiles.map((file) => [file.path, file]));
  const files = [];
  let totalBytes = 0;
  let authoredTextBytes = 0;
  for (const file of parsed.files) {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      throw new HttpError(422, "invalid_artifact_envelope", "each artifact-envelope file must be an object");
    }
    const fileKeys = Object.keys(file).sort();
    if (fileKeys.join(",") !== "action,content,copyFromInput,path,sha256") {
      throw new HttpError(
        422,
        "invalid_artifact_envelope",
        "artifact-envelope files require path, action, content, copyFromInput, and sha256",
      );
    }
    const relativePath = validateRelativeDeliverablePath(file.path);
    if (paths.has(relativePath)) {
      throw new HttpError(422, "duplicate_deliverable_path", `duplicate deliverable path: ${relativePath}`);
    }
    let bytes;
    if (
      file.action === "inherit" &&
      file.content === null &&
      file.copyFromInput === null &&
      typeof file.sha256 === "string" &&
      SHA256_PATTERN.test(file.sha256)
    ) {
      if (mode !== "resume" || canonicalExpectedBase === null) {
        throw new HttpError(422, "invalid_artifact_envelope", "inherit requires an exact materialized resume base");
      }
      const inherited = baseByPath.get(relativePath);
      if (!inherited || inherited.sha256 !== file.sha256.toLowerCase()) {
        throw new HttpError(422, "inherit_hash_mismatch", "inherited deliverable does not match its trusted base hash");
      }
      bytes = inherited.bytes;
    } else if (
      file.action === "replace" &&
      typeof file.content === "string" &&
      file.copyFromInput === null &&
      file.sha256 === null
    ) {
      if (file.content.includes("\0") || containsLoneSurrogate(file.content)) {
        throw new HttpError(
          422,
          "invalid_artifact_envelope",
          `${relativePath} content must be a NUL-free Unicode scalar string`,
        );
      }
      bytes = Buffer.from(file.content, "utf8");
      authoredTextBytes += bytes.byteLength;
      if (authoredTextBytes > limits.maxDeliverableTextBytes) {
        throw new HttpError(
          413,
          "authored_text_too_large",
          `authored text exceeds the ${limits.maxDeliverableTextBytes}-byte resumable limit`,
        );
      }
    } else if (
      file.action === "replace" &&
      file.content === null &&
      typeof file.copyFromInput === "string" &&
      typeof file.sha256 === "string" &&
      SHA256_PATTERN.test(file.sha256)
    ) {
      const sourcePath = validateRelativeInputPath(file.copyFromInput);
      const source = inputByPath.get(sourcePath);
      if (!source || source.sha256 !== file.sha256) {
        throw new HttpError(422, "asset_copy_mismatch", `${relativePath} does not bind an approved input hash`);
      }
      if (!relativePath.startsWith("deliverables/assets/luna/")) {
        throw new HttpError(422, "invalid_asset_copy", "approved binary inputs may only populate deliverables/assets/luna/");
      }
      if (!COPYABLE_ASSET_EXTENSIONS.has(path.posix.extname(sourcePath).toLowerCase())) {
        throw new HttpError(422, "invalid_asset_copy", `${sourcePath} is not an approved inert asset type`);
      }
      bytes = source.bytes;
    } else {
      throw new HttpError(
        422,
        "invalid_artifact_envelope",
        `${relativePath} must inherit an exact base hash, contain UTF-8 replacement text, or bind an exact approved input`,
      );
    }
    if (bytes.byteLength > limits.maxDeliverableBytes) {
      throw new HttpError(413, "deliverable_too_large", `${relativePath} exceeds the per-file limit`);
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > limits.maxDeliverableTotalBytes) {
      throw new HttpError(413, "deliverables_too_large", "artifact-envelope files exceed the configured total limit");
    }
    paths.add(relativePath);
    files.push({ path: relativePath, bytes, sha256: sha256Bytes(bytes) });
  }
  const missing = canonicalContract.requiredPaths.filter((required) => !paths.has(required));
  if (missing.length) {
    throw new HttpError(
      422,
      "missing_required_deliverables",
      "artifact envelope does not satisfy the host-declared required deliverables",
    );
  }
  return {
    decision: "replace",
    baseFingerprint: canonicalExpectedBase,
    files: files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
  };
}

export async function materializeArtifactEnvelope(workspace, envelope) {
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  const workspaceReal = await realpath(workspace);
  const nonce = randomUUID();
  const stage = path.join(workspaceReal, `.deliverables-stage-${nonce}`);
  const backup = path.join(workspaceReal, `.deliverables-backup-${nonce}`);
  const target = path.join(workspaceReal, "deliverables");
  await mkdir(stage, { mode: 0o700 });
  const stageReal = await realpath(stage);
  let backedUp = false;
  try {
    for (const file of envelope.files) {
      const destination = path.resolve(stageReal, ...file.path.split("/").slice(1));
      if (!isInside(stageReal, destination)) {
        throw new HttpError(422, "unsafe_deliverables", `${file.path} escapes the staged deliverables root`);
      }
      await ensureDirectoryChain(stageReal, path.dirname(destination));
      const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0);
      const handle = await open(destination, flags, 0o600);
      try {
        await handle.writeFile(file.bytes);
      } finally {
        await handle.close();
      }
    }
    try {
      const existing = await lstat(target);
      if (existing.isSymbolicLink() || !existing.isDirectory()) {
        throw new HttpError(422, "unsafe_deliverables", "existing deliverables must be a regular directory");
      }
      await rename(target, backup);
      backedUp = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await rename(stage, target);
    // The atomic stage->target rename is the commit point. A stale random-named
    // backup is safer than reporting failure after the replacement is active.
    if (backedUp) await rm(backup, { recursive: true, force: true }).catch(() => undefined);
  } catch (error) {
    await rm(stage, { recursive: true, force: true }).catch(() => undefined);
    if (backedUp) {
      try {
        await lstat(target);
      } catch (targetError) {
        if (targetError?.code === "ENOENT") await rename(backup, target).catch(() => undefined);
      }
    }
    throw error;
  }
}

export function buildCodexArgs({
  mode,
  workspace,
  threadId,
  model,
  reasoningEffort,
  imagePaths = [],
  outputSchemaPath,
}) {
  const configured = [
    "--strict-config",
    "--model",
    model,
    "-c",
    `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`,
    "-c",
    'web_search="disabled"',
    "--skip-git-repo-check",
  ];
  for (const feature of DISABLED_TOOL_FEATURES) configured.push("--disable", feature);
  for (const imagePath of imagePaths) configured.push("--image", imagePath);
  if (outputSchemaPath) configured.push("--output-schema", outputSchemaPath);
  if (mode === "new") {
    return ["exec", "--json", "-C", workspace, ...configured, "-"];
  }
  if (mode === "resume") {
    if (typeof threadId !== "string" || threadId.length === 0) {
      throw new Error("threadId is required for resume");
    }
    return ["exec", "resume", threadId, "--json", ...configured, "-"];
  }
  throw new Error(`unsupported Codex mode: ${mode}`);
}

export function buildChildEnv(source, { home, codexHome, workspace }) {
  const result = {
    PATH: source.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: home,
    CODEX_HOME: codexHome,
    TMPDIR: path.join(workspace, ".tmp"),
    TMP: path.join(workspace, ".tmp"),
    TEMP: path.join(workspace, ".tmp"),
    LANG: source.LANG ?? "C.UTF-8",
    LC_ALL: source.LC_ALL ?? "C.UTF-8",
    NO_COLOR: "1",
  };
  for (const key of ["SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS"]) {
    if (source[key]) result[key] = source[key];
  }
  return result;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function ensureDirectoryChain(root, directory) {
  if (directory === root) return;
  const relative = path.relative(root, directory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new HttpError(400, "unsafe_file_path", "input path escapes the workspace");
  }
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new HttpError(409, "unsafe_file_path", "input path crosses a non-directory or symbolic link");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
    }
  }
}

export async function writeInputFiles(workspace, files) {
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  const workspaceReal = await realpath(workspace);
  const nonce = randomUUID();
  const stage = path.join(workspaceReal, `.inputs-stage-${nonce}`);
  const backup = path.join(workspaceReal, `.inputs-backup-${nonce}`);
  const target = path.join(workspaceReal, "inputs");
  await mkdir(stage, { mode: 0o700 });
  const stageReal = await realpath(stage);
  const written = [];
  let backedUp = false;
  try {
    const canonicalFiles = [...files]
      .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    for (const file of canonicalFiles) {
      const inputRelative = file.path.split("/").slice(1);
      const destination = path.resolve(stageReal, ...inputRelative);
      if (!isInside(stageReal, destination)) {
        throw new HttpError(400, "unsafe_file_path", `${file.path} escapes the staged input root`);
      }
      await ensureDirectoryChain(stageReal, path.dirname(destination));
      const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0);
      const handle = await open(destination, flags, 0o600);
      try {
        await handle.writeFile(file.bytes);
      } finally {
        await handle.close();
      }
      written.push({
        ...file,
        absolutePath: path.resolve(target, ...inputRelative),
      });
    }
    try {
      const existing = await lstat(target);
      if (existing.isSymbolicLink() || !existing.isDirectory()) {
        throw new HttpError(409, "unsafe_file_path", "existing inputs must be a regular directory");
      }
      await rename(target, backup);
      backedUp = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await rename(stage, target);
    if (backedUp) await rm(backup, { recursive: true, force: true }).catch(() => undefined);
    return written;
  } catch (error) {
    await rm(stage, { recursive: true, force: true }).catch(() => undefined);
    if (backedUp) {
      try {
        await lstat(target);
      } catch (targetError) {
        if (targetError?.code === "ENOENT") await rename(backup, target).catch(() => undefined);
      }
    }
    throw error;
  }
}

export function parseCodexEvent(line, state) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    throw new Error("Codex emitted non-JSON output on stdout");
  }
  if (event?.type === "thread.started" && typeof event.thread_id === "string") {
    state.threadId = event.thread_id;
    state.observedThreadId = event.thread_id;
  }
  if (
    (event?.type === "item.started" || event?.type === "item.completed") &&
    typeof event.item?.type === "string"
  ) {
    if (FORBIDDEN_CODEX_ITEM_TYPES.has(event.item.type)) {
      state.toolViolation = event.item.type;
    } else if (event.item.type === "error") {
      state.codexItemError = String(event.item.message ?? event.item.text ?? "Codex reported a non-fatal error")
        .replace(/\s+/g, " ")
        .slice(0, 400);
    } else if (event.item.type !== "agent_message" && event.item.type !== "reasoning") {
      state.unknownItemType = event.item.type;
    }
  }
  if (
    event?.type === "item.completed" &&
    event.item?.type === "agent_message" &&
    typeof event.item.text === "string"
  ) {
    state.finalMessage = event.item.text;
  }
  if (event?.type === "turn.completed" && event.usage && typeof event.usage === "object") {
    state.usage = event.usage;
    state.turnCompleted = true;
  } else if (event?.type === "turn.completed") {
    state.turnCompleted = true;
  }
  if (event?.type === "error" || event?.type === "turn.failed") {
    state.codexError = String(
      event.message ?? event.error?.message ?? event.error ?? "Codex reported an error",
    );
  }
  return event;
}

export async function collectDeliverables(workspace, limits = DEFAULT_LIMITS) {
  const root = path.join(workspace, "deliverables");
  let rootReal;
  try {
    const rootInfo = await lstat(root);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
      throw new HttpError(422, "unsafe_deliverables", "deliverables must be a regular directory");
    }
    rootReal = await realpath(root);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new HttpError(422, "missing_deliverables", "Codex did not create deliverables/");
    }
    throw error;
  }
  const workspaceReal = await realpath(workspace);
  if (!isInside(workspaceReal, rootReal)) {
    throw new HttpError(422, "unsafe_deliverables", "deliverables resolves outside the job workspace");
  }
  const output = [];
  let totalBytes = 0;
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new HttpError(422, "unsafe_deliverables", "deliverables cannot contain symbolic links");
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (output.length >= limits.maxDeliverables) {
        throw new HttpError(413, "too_many_deliverables", "deliverable count exceeds the configured limit");
      }
      const bytes = await readFile(absolutePath);
      if (bytes.byteLength > limits.maxDeliverableBytes) {
        throw new HttpError(413, "deliverable_too_large", `${entry.name} exceeds the per-file limit`);
      }
      totalBytes += bytes.byteLength;
      if (totalBytes > limits.maxDeliverableTotalBytes) {
        throw new HttpError(413, "deliverables_too_large", "deliverables exceed the configured total limit");
      }
      const relativePath = path.relative(workspaceReal, absolutePath).split(path.sep).join("/");
      output.push({
        path: relativePath,
        contentBase64: bytes.toString("base64"),
        sha256: sha256Bytes(bytes),
        size: bytes.byteLength,
      });
    }
  }
  await walk(rootReal);
  if (output.length === 0) {
    throw new HttpError(422, "empty_deliverables", "Codex created no deliverable files");
  }
  return output;
}
