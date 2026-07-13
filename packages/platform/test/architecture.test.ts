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
  it("keeps shared packages independent of application source", () => {
    const violations = sourceFiles(path.join(ROOT, "packages"))
      .filter((file) => {
        const source = fs.readFileSync(file, "utf8");
        return /(?:from|import)\s*["'][^"']*apps[\\/]/.test(source);
      })
      .map((file) => path.relative(ROOT, file));
    expect(violations).toEqual([]);
  });

});
