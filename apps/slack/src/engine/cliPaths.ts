import fs from "node:fs";
import path from "node:path";

/**
 * Resolve a CLI input across npm workspace cwd semantics.
 *
 * `npm run --workspace` executes inside the workspace but preserves the
 * caller's original directory in INIT_CWD. Accept both forms so a documented
 * repo-relative path (`apps/slack/.data/x.json`) and an app-relative path
 * (`.data/x.json`) behave identically.
 */
export function resolveCliInputPath(
  value: string,
  appDir: string,
  cwd = process.cwd(),
  initCwd = process.env.INIT_CWD,
): string {
  if (path.isAbsolute(value)) return value;
  const candidates = [
    path.resolve(cwd, value),
    ...(initCwd ? [path.resolve(initCwd, value)] : []),
    path.resolve(appDir, value),
    path.resolve(appDir, "..", "..", value),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]!;
}
