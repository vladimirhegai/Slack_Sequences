import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  conversationalJobAction,
  createJob,
  findJobByThread,
  getJob,
  normalizeStoredCreateRequest,
  retryCreateRequest,
  retryCreateRequestForActor,
  updateJob,
  type StoredCreateRequestV1,
} from "../src/jobStore.ts";

const roots: string[] = [];
const originalDataDir = process.env.SLACK_SEQUENCES_DATA_DIR;

function temporaryDataDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-job-store-"));
  roots.push(root);
  process.env.SLACK_SEQUENCES_DATA_DIR = root;
  return root;
}

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.SLACK_SEQUENCES_DATA_DIR;
  else process.env.SLACK_SEQUENCES_DATA_DIR = originalDataDir;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("failed-create persistence", () => {
  it("allowlists and bounds only the original fields needed for a fresh create", () => {
    const normalized = normalizeStoredCreateRequest({
      product: "  Relay  ",
      whatShipped: `  ${"x".repeat(2_100)}  `,
      audience: "operators",
      tone: "bold-launch",
      lengthSec: 20,
      context: "trusted CTA",
      teamId: "T123",
      userId: "U123",
      userToken: "xoxp-must-not-persist",
      enrichedContext: "private retrieved workspace content",
      notifyFailure: () => undefined,
    });

    expect(normalized).toMatchObject({
      version: 1,
      product: "Relay",
      audience: "operators",
      tone: "bold-launch",
      lengthSec: 20,
      context: "trusted CTA",
      teamId: "T123",
      userId: "U123",
    });
    expect(normalized?.whatShipped).toHaveLength(2_000);
    expect(JSON.stringify(normalized)).not.toContain("xoxp-must-not-persist");
    expect(JSON.stringify(normalized)).not.toContain("private retrieved workspace content");
  });

  it("restores an error job's brief even when no accepted project exists", () => {
    temporaryDataDir();
    const createRequest = normalizeStoredCreateRequest({
      product: "Relay",
      whatShipped: "A release brief now becomes an MP4.",
      tone: "crisp-saas",
      lengthSec: 15,
      teamId: "T123",
      userId: "U123",
    });
    expect(createRequest).toBeDefined();

    createJob({
      id: "failed-create",
      projectDir: "",
      channel: "C123",
      messageTs: "1700000000.000001",
      status: "error",
      title: "Relay",
      createRequest,
    });

    const persisted = getJob("failed-create");
    expect(persisted?.projectDir).toBe("");
    expect(persisted && retryCreateRequest(persisted)).toEqual(createRequest);
    expect(persisted && retryCreateRequestForActor(persisted, "U_DIFFERENT")).toEqual({
      ...createRequest,
      userId: "U_DIFFERENT",
    });
    expect(persisted && conversationalJobAction(persisted)).toBe("retry-create");
    expect(findJobByThread("C123", "1700000000.000001")?.id).toBe("failed-create");
  });

  it("keeps replies on accepted films routed to revision", () => {
    temporaryDataDir();
    const ready = createJob({
      id: "ready-film",
      projectDir: "C:/sequences/projects/ready-film",
      channel: "C123",
      messageTs: "1700000000.000003",
      status: "ready",
      title: "Relay",
    });

    expect(conversationalJobAction(ready)).toBe("revise");
    expect(conversationalJobAction({ ...ready, status: "building" })).toBe("busy");
    expect(conversationalJobAction({ ...ready, projectDir: "" })).toBe("unavailable");
  });

  it("fails closed for an old or corrupt persisted retry request", () => {
    temporaryDataDir();
    const job = createJob({
      id: "corrupt-create",
      projectDir: "",
      channel: "C123",
      messageTs: "1700000000.000002",
      status: "error",
      title: "Relay",
      createRequest: normalizeStoredCreateRequest({
        product: "Relay",
        whatShipped: "Valid at creation time",
      }),
    });
    updateJob(job.id, {
      createRequest: { version: 1, product: "", whatShipped: "missing product" } as StoredCreateRequestV1,
    });

    const persisted = getJob(job.id);
    expect(persisted && retryCreateRequest(persisted)).toBeUndefined();
  });

  it("fails closed instead of borrowing saved OAuth permissions without an actor", () => {
    const job = {
      id: "actor-bound",
      projectDir: "",
      channel: "C123",
      status: "error" as const,
      title: "Relay",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createRequest: normalizeStoredCreateRequest({
        product: "Relay",
        whatShipped: "A shared incident view",
        userId: "U_ORIGINAL",
      }),
    };
    expect(retryCreateRequestForActor(job, "")).toBeUndefined();
    expect(retryCreateRequestForActor(job, "   ")).toBeUndefined();
  });
});
