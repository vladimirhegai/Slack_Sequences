import { createHash } from "node:crypto";
import type { Asset } from "../src/schema.ts";

export function testAsset(
  label: string,
  path: string,
  kind: Asset["kind"] = "image",
): Asset {
  const contentHash = createHash("sha256").update(`test:${label}`).digest("hex");
  return {
    id: `asset-${contentHash.slice(0, 16)}`,
    path,
    kind,
    contentHash,
    metadata: { dominantColors: [] },
  };
}
