import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appDir = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(appDir, "../..");

function packageJson(file: string): { scripts: Record<string, string> } {
  return JSON.parse(fs.readFileSync(file, "utf8")) as { scripts: Record<string, string> };
}

describe("Luna probe and CI contracts", () => {
  it("runs the isolated Railway worker tests in both normal CI entrypoints", () => {
    const root = packageJson(path.join(repositoryRoot, "package.json"));
    const slack = packageJson(path.join(appDir, "package.json"));
    expect(root.scripts.test).toContain("test:worker");
    expect(root.scripts["test:ci"]).toContain("npm test");
    expect(slack.scripts.test).toContain("test:worker");
    expect(slack.scripts["test:luna"]).toContain("test:worker");
  });

  it("makes the paid model smoke Luna-only and fallback-intolerant", () => {
    const source = fs.readFileSync(path.join(appDir, "scripts", "modelAuthoringSmoke.ts"), "utf8");
    expect(source).toContain('SLACK_SEQUENCES_AUTHOR_ROUTE = "luna-direct"');
    expect(source).toContain('SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK = "0"');
    expect(source).toMatch(/if \(result\.fallback\)/);
    expect(source).toContain('result.provider !== "codex-cli"');
  });

  it("keeps legacy replay, triage and paid storyboard probe explicitly named", () => {
    const slack = packageJson(path.join(appDir, "package.json"));
    expect(slack.scripts["legacy:replay"]).toBe("tsx scripts/replayAll.ts");
    expect(slack.scripts["legacy:triage"]).toBe("tsx scripts/probeTriage.ts --legacy");
    expect(slack.scripts["legacy:storyboard:probe"]).toBe("tsx scripts/storyboardProbe.ts");
    expect(slack.scripts["luna:smoke"]).toBe("tsx scripts/modelAuthoringSmoke.ts");
    expect(slack.scripts["luna:replay"]).toBe("tsx scripts/lunaReplay.ts");
    expect(slack.scripts["luna:triage"]).toBe("tsx scripts/lunaTriage.ts");
    const triageSource = fs.readFileSync(path.join(appDir, "scripts", "probeTriage.ts"), "utf8");
    expect(triageSource).toContain("buildLunaTriageReport");
    expect(triageSource).toContain("renderLunaTriageMarkdown");
    expect(triageSource).toContain("if (!forceLegacy)");
  });

  it("requires the model-free Luna replay to pass both static and browser gates", () => {
    const source = fs.readFileSync(path.join(appDir, "scripts", "lunaReplay.ts"), "utf8");
    expect(source).toContain("inspectDirectComposition");
    expect(source).toContain("declaredInteractions: intent.interactions.map");
    expect(source).toContain("staticValidation.ok && browserValidation?.ok === true");
    expect(source).toContain("browser: browserValidation");
    expect(source).toContain("modelCalls: 0");
    expect(source).toContain("legacyRepairs: 0");
  });

  it("keeps Luna declared-intent authority during post-run sequence-check validation", () => {
    const source = fs.readFileSync(path.join(appDir, "scripts", "sequenceCheck.ts"), "utf8");
    expect(source).toContain("current.manifest.declaredPrimarySelectors");
    expect(source).toContain("declaredPrimarySelectors: current.manifest.declaredPrimarySelectors");
  });

  it("settles accepted films honestly on render failure and binds retries to the current actor", () => {
    const source = fs.readFileSync(path.join(appDir, "src", "index.ts"), "utf8");
    expect(source).toContain('updateJob(args.jobId, { status: "ready", mp4Path: undefined })');
    expect(source).toContain("storyboard is saved and can be revised");
    expect(source).toContain("retryCreateRequestForActor(job, actorUserId)");
    expect(source).toContain("runStoredCreateRetry(client, job, reply.userId");
    expect(source).toContain("runStoredCreateRetry(client, job, (body as BlockAction).user.id)");
  });
});
