import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { operationIdForRequest } from "../worker-lib.mjs";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const token = "integration-worker-token-that-is-longer-than-thirty-two-characters";

async function unusedPort() {
  const server = createServer();
  server.listen(0, "::1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  server.close();
  await once(server, "close");
  return port;
}

async function startWorker(t, options = {}) {
  const home = await mkdtemp(path.join(os.tmpdir(), "sequences-codex-worker-test-"));
  const codexHome = path.join(home, ".codex");
  await mkdir(codexHome, { mode: 0o700 });
  await writeFile(path.join(codexHome, "auth.json"), "{}", { mode: 0o600 });
  await writeFile(
    path.join(codexHome, "config.toml"),
    await readFile(path.join(workerRoot, "config.toml")),
    { mode: 0o600 },
  );
  const fakeCodexPath = path.join(home, "fake-codex.mjs");
  const fakeCodexVersion = options.codexVersion ?? "codex-cli 0.144.1";
  await writeFile(fakeCodexPath, `
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write(${JSON.stringify(fakeCodexVersion)} + "\\n");
  process.exit(0);
}
const emitToolEvent = args.includes("--emit-tool-event");
const persistHiddenTool = args.includes("--persist-hidden-tool");
const codexArgs = args.filter((arg) => arg !== "--emit-tool-event" && arg !== "--persist-hidden-tool");
const resume = codexArgs[0] === "exec" && codexArgs[1] === "resume";
const threadId = resume ? codexArgs[2] : "019f5a36-c85c-7541-94d7-c474a8e26d33";
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
const countFile = path.join(process.cwd(), ".fake-count");
const count = fs.existsSync(countFile) ? Number(fs.readFileSync(countFile, "utf8")) + 1 : 1;
fs.writeFileSync(countFile, String(count));
const artifactEnvelope = {
  decision: "replace",
  files: [
    ["deliverables/assets-manifest.json", "[]"],
    ["deliverables/composition.html", "<!doctype html>"],
    ["deliverables/director-treatment.md", "Treatment"],
    ["deliverables/motion-intent.json", "{}"],
    ["deliverables/storyboard.json", "[]"],
    ["deliverables/result.txt", "run=" + count + " toolLess=" + prompt.includes("RAILWAY TOOL-LESS ARTIFACT EXCHANGE")],
  ].map(([artifactPath, content]) => ({
    path: artifactPath,
    content,
    copyFromInput: null,
    sha256: null,
  })),
};
const sessionDirectory = path.join(process.env.CODEX_HOME, "sessions", "2026", "07", "13");
fs.mkdirSync(sessionDirectory, { recursive: true });
const rolloutPath = path.join(sessionDirectory, "rollout-test-" + threadId + ".jsonl");
const rolloutRecords = [];
if (!fs.existsSync(rolloutPath)) {
  rolloutRecords.push({ type: "session_meta", payload: { session_id: threadId, id: threadId } });
}
rolloutRecords.push({ type: "response_item", payload: { type: "reasoning" } });
if (persistHiddenTool) {
  rolloutRecords.push({ type: "response_item", payload: { type: "function_call", name: "view_image" } });
}
rolloutRecords.push({ type: "response_item", payload: { type: "message", role: "assistant", content: [] } });
fs.appendFileSync(rolloutPath, rolloutRecords.map((record) => JSON.stringify(record)).join("\\n") + "\\n");
process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: threadId }) + "\\n");
if (emitToolEvent) process.stdout.write(JSON.stringify({ type: "item.started", item: { type: "command_execution" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(artifactEnvelope) } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 3, output_tokens: 2 } }) + "\\n");
`, { mode: 0o600 });
  const port = await unusedPort();
  const child = spawn(process.execPath, [path.join(workerRoot, "server.mjs")], {
    cwd: workerRoot,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      CODEX_HOME: codexHome,
      LUNA_WORKER_TOKEN: token,
      PORT: String(port),
      NODE_ENV: "test",
      LUNA_TEST_CODEX_BIN: process.execPath,
      LUNA_TEST_CODEX_PREFIX_ARGS: JSON.stringify([
        fakeCodexPath,
        ...(options.fakeToolEvent ? ["--emit-tool-event"] : []),
        ...(options.fakeHiddenTool ? ["--persist-hidden-tool"] : []),
      ]),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`worker startup timed out: ${stderr}`)), 5_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (!chunk.includes("listening on")) return;
      clearTimeout(timeout);
      resolve();
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`worker exited during startup with ${code}: ${stderr}`));
    });
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    await rm(home, { recursive: true, force: true });
  });
  await ready;
  return `http://[::1]:${port}`;
}

async function waitForCompleted(baseUrl, jobId) {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const response = await fetch(`${baseUrl}/v1/jobs/${jobId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    if (body.status === "completed") return body;
    if (Date.now() >= deadline) throw new Error(`job did not complete: ${JSON.stringify(body)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function waitForFailed(baseUrl, jobId) {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const response = await fetch(`${baseUrl}/v1/jobs/${jobId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    if (body.status === "failed") return body;
    if (Date.now() >= deadline) throw new Error(`job did not fail: ${JSON.stringify(body)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test("HTTP boundary exposes private readiness and protects every v1 route", async (t) => {
  const baseUrl = await startWorker(t);

  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(typeof healthBody.freeBytes, "number");
  assert.deepEqual(healthBody, {
    ok: true,
    status: "ready",
    version: "0.144.1",
    model: "gpt-5.6-luna",
    reasoningEffort: "high",
    artifactProtocol: "luna-tool-less-artifact-v1",
    artifactSchemaSha256: "ac487766f625ecd680541cbf3b7a6e0018a3570e1037e65c9c629d8af52569cb",
    permissionProfileSha256: "0c8565ee79930bddb66469f4672e5eb57b0ba87e8919fe5389556f8b28695e42",
    authenticated: true,
    authConfigured: true,
    freeBytes: healthBody.freeBytes,
    minFreeBytes: 536870912,
    queue: { active: false, queued: 0 },
  });

  const unauthorized = await fetch(`${baseUrl}/v1/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId: "test-job", prompt: "Do not run." }),
  });
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error.code, "unauthorized");

  const invalid = await fetch(`${baseUrl}/v1/jobs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ jobId: "../escape", prompt: "Do not run." }),
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "invalid_job_id");
});

test("startup rejects a Codex CLI binary that drifts from the pinned protocol version", async (t) => {
  await assert.rejects(
    startWorker(t, { codexVersion: "codex-cli 0.145.0" }),
    /installed Codex CLI version must be exactly codex-cli 0\.144\.1/i,
  );
});

test("async create polling and exact-thread resume complete through the worker boundary", async (t) => {
  const baseUrl = await startWorker(t, { fakeCodex: true });
  const jobId = "worker-lifecycle";
  const createPrompt = "Create the deliverable.";
  const createOperationId = operationIdForRequest(createPrompt, []);
  const created = await fetch(`${baseUrl}/v1/jobs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jobId,
      operationId: createOperationId,
      prompt: createPrompt,
      files: [],
    }),
  });
  assert.equal(created.status, 202);
  const first = await waitForCompleted(baseUrl, jobId);
  assert.equal(first.threadId, "019f5a36-c85c-7541-94d7-c474a8e26d33");
  assert.equal(first.runCount, 1);
  assert.equal(first.operationId, createOperationId);

  const revisionPrompt = "Revise the same deliverable.";
  const revisionOperationId = operationIdForRequest(revisionPrompt, [], first.runCount);
  const resumed = await fetch(`${baseUrl}/v1/jobs/${jobId}/resume`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      operationId: revisionOperationId,
      expectedRunCount: first.runCount,
      prompt: revisionPrompt,
      files: [],
    }),
  });
  assert.equal(resumed.status, 202);
  const second = await waitForCompleted(baseUrl, jobId);
  assert.equal(second.threadId, first.threadId);
  assert.equal(second.runCount, 2);
  assert.equal(second.operationId, revisionOperationId);
  const result = second.deliverables.find((file) => file.path === "deliverables/result.txt");
  assert.equal(Buffer.from(result.contentBase64, "base64").toString("utf8"), "run=2 toolLess=true");

  const stalePrompt = "Retry an obsolete revision.";
  const stale = await fetch(`${baseUrl}/v1/jobs/${jobId}/resume`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      operationId: operationIdForRequest(stalePrompt, [], first.runCount),
      expectedRunCount: first.runCount,
      prompt: stalePrompt,
      files: [],
    }),
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.code, "stale_job_generation");
});

test("a tool event fails the job even when Codex also emits a valid artifact envelope", async (t) => {
  const baseUrl = await startWorker(t, { fakeCodex: true, fakeToolEvent: true });
  const prompt = "Return an artifact without tools.";
  const operationId = operationIdForRequest(prompt, []);
  const response = await fetch(`${baseUrl}/v1/jobs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jobId: "worker-tool-violation",
      operationId,
      prompt,
      files: [],
    }),
  });
  assert.equal(response.status, 202);
  const failed = await waitForFailed(baseUrl, "worker-tool-violation");
  assert.equal(failed.errorCode, "tool_use_forbidden");
});

test("persisted rollout inspection catches a tool item omitted from exec JSONL", async (t) => {
  const baseUrl = await startWorker(t, { fakeCodex: true, fakeHiddenTool: true });
  const prompt = "Return an artifact without tools.";
  const operationId = operationIdForRequest(prompt, []);
  const response = await fetch(`${baseUrl}/v1/jobs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jobId: "worker-hidden-tool-violation",
      operationId,
      prompt,
      files: [],
    }),
  });
  assert.equal(response.status, 202);
  const failed = await waitForFailed(baseUrl, "worker-hidden-tool-violation");
  assert.equal(failed.errorCode, "tool_use_forbidden");
});
