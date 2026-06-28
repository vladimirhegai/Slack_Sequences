import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(file));
    else if (/\.(?:ts|js)$/.test(entry.name)) files.push(file);
  }
  return files;
}

describe("application boundaries", () => {
  it("keeps Forge and Sequences source independent", () => {
    const violations: string[] = [];
    for (const app of ["forge", "sequences"]) {
      const other = app === "forge" ? "sequences" : "forge";
      for (const file of sourceFiles(path.join(ROOT, "apps", app, "src"))) {
        const source = fs.readFileSync(file, "utf8");
        if (
          source.includes(`apps/${other}`) ||
          source.includes(`apps\\${other}`) ||
          new RegExp(`(?:\\.\\./)+${other}/`).test(source)
        ) {
          violations.push(path.relative(ROOT, file));
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps shared packages independent of application source", () => {
    const violations = sourceFiles(path.join(ROOT, "packages"))
      .filter((file) => {
        const source = fs.readFileSync(file, "utf8");
        return /(?:from|import)\s*["'][^"']*apps[\\/]/.test(source);
      })
      .map((file) => path.relative(ROOT, file));
    expect(violations).toEqual([]);
  });

  it("does not couple either app package to the other", () => {
    const forge = JSON.parse(
      fs.readFileSync(path.join(ROOT, "apps", "forge", "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const sequences = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, "apps", "sequences", "package.json"),
        "utf8",
      ),
    ) as { dependencies?: Record<string, string> };

    expect(forge.dependencies).not.toHaveProperty("@sequences/app");
    expect(sequences.dependencies).not.toHaveProperty("@sequences/forge");
  });
});
