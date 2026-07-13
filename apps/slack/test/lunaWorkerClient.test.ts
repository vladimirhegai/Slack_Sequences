import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  inspectLunaWorkerHealth,
  lunaWorkerHealthIsExact,
  resolveLunaWorkerConfig,
  resumeLunaWorkerJob,
  startLunaWorkerJob,
  type LunaArtifactContract,
} from "../src/engine/lunaWorkerClient.ts";

const token = "client-test-token-that-is-longer-than-thirty-two-characters";
const threadId = "019f5a36-c85c-7541-94d7-c474a8e26d33";

async function fakeWorker(
  reply: (request: http.IncomingMessage, body: Record<string, unknown>) => Record<string, unknown>,
): Promise<{
  url: string;
  requests: Array<{ method: string; pathname: string; body: Record<string, unknown> }>;
  close: () => Promise<void>;
}> {
  const requests: Array<{ method: string; pathname: string; body: Record<string, unknown> }> = [];
  const server = http.createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk.toString("utf8");
    const body = text ? JSON.parse(text) as Record<string, unknown> : {};
    const pathname = new URL(request.url ?? "/", "http://worker.test").pathname;
    requests.push({ method: request.method ?? "GET", pathname, body });
    const payload = reply(request, body);
    const encoded = JSON.stringify(payload);
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(encoded),
    });
    response.end(encoded);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()
    )),
  };
}

function completed(body: Record<string, unknown>, runCount: number): Record<string, unknown> {
  return {
    jobId: body.jobId ?? "client-job",
    operationId: body.operationId,
    runCount,
    threadId,
    status: "completed",
    model: "gpt-5.6-luna",
    reasoningEffort: "high",
    codexVersion: "0.144.1",
    artifactContractSha256: "a".repeat(64),
    rawEnvelopeSha256: "b".repeat(64),
    materializedFingerprint: "c".repeat(64),
    rolloutSha256: "d".repeat(64),
    rolloutResponseItems: 2,
    finalMessage: "{}",
    deliverables: [],
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Luna worker client v2", () => {
  it("aligns the default host timeout with the worker's thirty-minute limit", () => {
    vi.stubEnv("SLACK_SEQUENCES_LUNA_WORKER_TOKEN", token);
    expect(resolveLunaWorkerConfig().timeoutMs).toBe(30 * 60 * 1_000);
  });

  it("requires the exact v2 schema and deny-all permission profile at health", async () => {
    const worker = await fakeWorker(() => ({
      ok: true,
      status: "ready",
      version: "0.144.1",
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      artifactProtocol: "luna-tool-less-artifact-v2",
      artifactSchemaSha256: "7fa551fb261b6dee573aca74507202f5ab0b30ca00fe60cd04141dea8dfe104d",
      permissionProfileSha256: "ebd9f548aaa2f1d48df15ea1e124462350791ede65267f7677e9a834fa0060c6",
      authenticated: true,
    }));
    try {
      const config = { url: worker.url, token, timeoutMs: 30_000 };
      expect(lunaWorkerHealthIsExact(await inspectLunaWorkerHealth(config))).toBe(true);
    } finally {
      await worker.close();
    }
  });

  it("binds explicit create and resume contracts plus the exact base fingerprint", async () => {
    let submitted: Record<string, unknown> = {};
    let runCount = 1;
    const worker = await fakeWorker((request, body) => {
      if (request.method === "POST") {
        submitted = body;
        return { jobId: body.jobId ?? "client-job", operationId: body.operationId, status: "queued" };
      }
      return completed({ ...submitted, jobId: "client-job" }, runCount);
    });
    const contract: LunaArtifactContract = {
      id: "direction-v1",
      requiredPaths: ["deliverables/storyboard.json", "deliverables/director-treatment.md"],
    };
    try {
      const config = { url: worker.url, token, timeoutMs: 30_000 };
      await startLunaWorkerJob(config, {
        jobId: "client-job",
        prompt: "Direct the film.",
        files: [],
        artifactContract: contract,
      });
      const createBody = worker.requests.find((entry) => entry.method === "POST")!.body;
      expect(createBody.artifactContract).toEqual({
        id: "direction-v1",
        requiredPaths: ["deliverables/director-treatment.md", "deliverables/storyboard.json"],
      });
      expect(createBody).not.toHaveProperty("expectedBaseFingerprint");

      worker.requests.length = 0;
      runCount = 2;
      const expectedBaseFingerprint = "e".repeat(64);
      await resumeLunaWorkerJob(config, {
        jobId: "client-job",
        expectedRunCount: 1,
        expectedBaseFingerprint,
        prompt: "Build the film.",
        files: [],
        artifactContract: {
          id: "film-v2",
          requiredPaths: ["deliverables/composition.html"],
        },
      });
      const resumeBody = worker.requests.find((entry) => entry.method === "POST")!.body;
      expect(resumeBody.expectedRunCount).toBe(1);
      expect(resumeBody.expectedBaseFingerprint).toBe(expectedBaseFingerprint);
      expect(resumeBody.artifactContract).toEqual({
        id: "film-v2",
        requiredPaths: ["deliverables/composition.html"],
      });
    } finally {
      await worker.close();
    }
  });

  it("surfaces a bounded recoverable failure receipt without response bytes", async () => {
    let submitted: Record<string, unknown> = {};
    const worker = await fakeWorker((request, body) => {
      if (request.method === "POST") {
        submitted = body;
        return { jobId: body.jobId, operationId: body.operationId, status: "queued" };
      }
      return {
        jobId: "failed-client-job",
        operationId: submitted.operationId,
        runCount: 1,
        threadId,
        status: "failed",
        errorCode: "invalid_artifact_envelope",
        rawEnvelopeSha256: "1".repeat(64),
        rolloutSha256: "2".repeat(64),
        rolloutResponseItems: 3,
        failure: {
          errorCode: "invalid_artifact_envelope",
          category: "artifact_protocol",
          recoverable: true,
          envelopeFindings: [{ code: "invalid_artifact_envelope" }],
          response: { present: true, bytes: 87, sha256: "1".repeat(64) },
          rollout: { sha256: "2".repeat(64), responseItems: 3 },
        },
      };
    });
    try {
      await expect(startLunaWorkerJob(
        { url: worker.url, token, timeoutMs: 30_000 },
        {
          jobId: "failed-client-job",
          prompt: "Return the artifact.",
          files: [],
          artifactContract: { id: "direction-v1", requiredPaths: ["deliverables/direction.json"] },
        },
      )).rejects.toMatchObject({
        name: "LunaWorkerJobError",
        cursor: {
          runCount: 1,
          threadId,
          failure: { recoverable: true, category: "artifact_protocol" },
        },
      });
    } finally {
      await worker.close();
    }
  });
});
