import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCliInputPath } from "../src/engine/cliPaths.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("workspace CLI input paths", () => {
  it("accepts both app-relative and npm INIT_CWD repo-relative paths", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-cli-path-"));
    roots.push(repo);
    const app = path.join(repo, "apps", "slack");
    const data = path.join(app, ".data");
    fs.mkdirSync(data, { recursive: true });
    const brief = path.join(data, "brief.json");
    fs.writeFileSync(brief, "{}", "utf8");

    expect(resolveCliInputPath(".data/brief.json", app, app, repo)).toBe(brief);
    expect(resolveCliInputPath("apps/slack/.data/brief.json", app, app, repo)).toBe(brief);
  });
});
