import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";

export const DEFAULT_LIMITS = Object.freeze({
  maxBodyBytes: 48 * 1024 * 1024,
  maxPromptBytes: 256 * 1024,
  maxInputFiles: 64,
  maxInputFileBytes: 16 * 1024 * 1024,
  maxInputBytes: 32 * 1024 * 1024,
  maxDeliverables: 128,
  maxDeliverableBytes: 32 * 1024 * 1024,
  maxDeliverableTotalBytes: 64 * 1024 * 1024,
  maxCodexOutputBytes: 24 * 1024 * 1024,
  maxCodexStderrBytes: 2 * 1024 * 1024,
});

const JOB_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,94}[A-Za-z0-9])?$/;
const OPERATION_ID_PATTERN = /^[a-f0-9]{64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const IMAGE_EXTENSIONS = new Set([".jpeg", ".jpg", ".png", ".webp"]);
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

export function operationIdForRequest(prompt, files) {
  const canonical = JSON.stringify({
    promptSha256: sha256Bytes(Buffer.from(prompt, "utf8")),
    files: files.map((file) => ({ path: file.path, sha256: file.sha256 })),
  });
  return sha256Bytes(Buffer.from(canonical, "utf8"));
}

export function validateRelativeInputPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 240) {
    throw new HttpError(400, "invalid_file_path", "file paths must contain 1-240 characters");
  }
  if (value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value)) {
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
  { requireJobId, requireOperationId = true, limits = DEFAULT_LIMITS } = {},
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
  const files = sourceFiles.map((file) => decodeInputFile(file, limits));
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
  if (requireJobId) result.jobId = validateJobId(value.jobId);
  if (requireOperationId) {
    const suppliedOperationId = validateOperationId(value.operationId);
    const expectedOperationId = operationIdForRequest(prompt, files);
    if (suppliedOperationId !== expectedOperationId) {
      throw new HttpError(422, "operation_id_mismatch", "operationId does not match prompt and file bytes");
    }
    result.operationId = suppliedOperationId;
  }
  return result;
}

export function buildCodexArgs({ mode, workspace, threadId, model, reasoningEffort, imagePaths = [] }) {
  const configured = [
    "--strict-config",
    "--model",
    model,
    "-c",
    `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`,
    "--skip-git-repo-check",
  ];
  for (const imagePath of imagePaths) configured.push("--image", imagePath);
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
  const written = [];
  for (const file of files) {
    const destination = path.resolve(workspaceReal, ...file.path.split("/"));
    if (!isInside(workspaceReal, destination)) {
      throw new HttpError(400, "unsafe_file_path", `${file.path} escapes the workspace`);
    }
    await ensureDirectoryChain(workspaceReal, path.dirname(destination));
    try {
      const info = await lstat(destination);
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new HttpError(409, "unsafe_file_path", `${file.path} is not a regular file`);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | (fsConstants.O_NOFOLLOW ?? 0);
    const handle = await open(destination, flags, 0o600);
    try {
      await handle.writeFile(file.bytes);
    } finally {
      await handle.close();
    }
    written.push({ ...file, absolutePath: destination });
  }
  return written;
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
