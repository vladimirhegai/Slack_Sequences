import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
  let fakeCodexPath;
  if (options.fakeCodex) {
    fakeCodexPath = path.join(home, "fake-codex.mjs");
    await writeFile(fakeCodexPath, `
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const resume = args[0] === "exec" && args[1] === "resume";
const threadId = resume ? args[2] : "019f5a36-c85c-7541-94d7-c474a8e26d33";
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
const countFile = path.join(process.cwd(), ".fake-count");
const count = fs.existsSync(countFile) ? Number(fs.readFileSync(countFile, "utf8")) + 1 : 1;
fs.writeFileSync(countFile, String(count));
fs.mkdirSync(path.join(process.cwd(), "deliverables"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "deliverables", "result.txt"), "run=" + count + " prompt=" + prompt.trim());
process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: threadId }) + "\\n");
process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done " + count } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 3, output_tokens: 2 } }) + "\\n");
`, { mode: 0o600 });
  }
  const port = await unusedPort();
  const child = spawn(process.execPath, [path.join(workerRoot, "server.mjs")], {
    cwd: workerRoot,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      CODEX_HOME: codexHome,
      LUNA_WORKER_TOKEN: token,
      PORT: String(port),
      ...(options.fakeCodex ? {
        NODE_ENV: "test",
        LUNA_TEST_CODEX_BIN: process.execPath,
        LUNA_TEST_CODEX_PREFIX_ARGS: JSON.stringify([fakeCodexPath]),
      } : {}),
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
  await ready;
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    await rm(home, { recursive: true, force: true });
  });
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
  const revisionOperationId = operationIdForRequest(revisionPrompt, []);
  const resumed = await fetch(`${baseUrl}/v1/jobs/${jobId}/resume`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      operationId: revisionOperationId,
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
  assert.match(Buffer.from(result.contentBase64, "base64").toString("utf8"), /run=2/);
});
