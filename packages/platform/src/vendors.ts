import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function resolveVendor(specifier: string, relative: string): string {
  const resolved = require.resolve(specifier);
  let root = path.dirname(resolved);
  while (!fs.existsSync(path.join(root, "package.json"))) {
    const parent = path.dirname(root);
    if (parent === root) {
      throw new Error(`cannot find package root for ${specifier}`);
    }
    root = parent;
  }
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) throw new Error(`vendor file missing: ${file}`);
  return file;
}

export function vendorFiles(): Record<string, string> {
  return {
    "gsap.min.js": resolveVendor("gsap", "dist/gsap.min.js"),
    "CustomEase.min.js": resolveVendor("gsap", "dist/CustomEase.min.js"),
    "hyperframe.runtime.iife.js": require.resolve("@hyperframes/core/runtime"),
    "hyperframes-player.global.js": resolveVendor(
      "@hyperframes/player",
      "dist/hyperframes-player.global.js",
    ),
  };
}
