import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkPlanningBrain,
  runDiagnostics,
  type CheckStatus,
} from "../src/diagnostics.ts";

const STATUSES: CheckStatus[] = ["ok", "warn", "fail"];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runDiagnostics", () => {
  it("returns a contained report covering every service, without a Slack client", async () => {
    const report = await runDiagnostics();

    // One entry per service; each is a valid, non-throwing result.
    const labels = report.checks.map((check) => check.label);
    expect(labels).toContain("Sequences MCP (video engine)");
    expect(labels).toContain("Render host (Chrome + FFmpeg)");
    expect(labels).toContain("Data directory");
    for (const check of report.checks) {
      expect(STATUSES).toContain(check.status);
      expect(check.detail.length).toBeGreaterThan(0);
    }

    // The data directory must be writable in the test environment.
    const dataDir = report.checks.find((check) => check.label === "Data directory");
    expect(dataDir?.status).toBe("ok");

    const mcp = report.checks.find((check) => check.label === "Sequences MCP (video engine)");
    expect(mcp?.status).toBe("ok");

    // healthy is derived only from core checks failing.
    const anyCoreFailed = report.checks.some((check) => check.core && check.status === "fail");
    expect(report.healthy).toBe(!anyCoreFailed);
  }, 20_000);

  it("reports the configured OpenAI planning provider", () => {
    vi.stubEnv("SLACK_SEQUENCES_PROVIDER", "openai-api");
    vi.stubEnv("OPENAI_API_KEY", "test-key");

    expect(checkPlanningBrain()).toMatchObject({
      status: "ok",
      detail: "openai-api (OPENAI_API_KEY set)",
    });
  });
});
