import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getSlackUserToken,
  storeSlackUserToken,
} from "../src/slackTokenStore.ts";

const originalDataDir = process.env.SLACK_SEQUENCES_DATA_DIR;
const originalKey = process.env.SLACK_TOKEN_ENCRYPTION_KEY;
let temporaryDirectory: string | undefined;

afterEach(() => {
  if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
  if (originalDataDir === undefined) delete process.env.SLACK_SEQUENCES_DATA_DIR;
  else process.env.SLACK_SEQUENCES_DATA_DIR = originalDataDir;
  if (originalKey === undefined) delete process.env.SLACK_TOKEN_ENCRYPTION_KEY;
  else process.env.SLACK_TOKEN_ENCRYPTION_KEY = originalKey;
});

describe("Slack user token store", () => {
  it("encrypts tokens at rest and retrieves them by workspace and user", () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-token-test-"));
    process.env.SLACK_SEQUENCES_DATA_DIR = temporaryDirectory;
    process.env.SLACK_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

    storeSlackUserToken({
      teamId: "T1",
      userId: "U1",
      token: "xoxp-secret-user-token",
      scopes: ["search:read.public"],
    });

    expect(getSlackUserToken("T1", "U1")).toBe("xoxp-secret-user-token");
    expect(getSlackUserToken("T1", "U2")).toBeUndefined();
    const stored = fs.readFileSync(
      path.join(temporaryDirectory, "slack-user-tokens.json"),
      "utf8",
    );
    expect(stored).not.toContain("xoxp-secret-user-token");
  });
});
