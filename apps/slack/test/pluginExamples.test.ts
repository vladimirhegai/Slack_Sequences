import { describe, expect, it } from "vitest";
import { PLUGIN_CATALOG } from "../src/engine/pluginContract.ts";
import { pluginDeclarationExample } from "../studio/pluginExamples.ts";

describe("Studio plugin examples", () => {
  it("emits one copy-ready declaration with safe defaults for every plugin", () => {
    for (const plugin of PLUGIN_CATALOG) {
      const example = pluginDeclarationExample(plugin) as {
        version: number;
        kind: string;
        params: Record<string, unknown>;
      };
      expect(example.version, plugin.kind).toBe(1);
      expect(example.kind, plugin.kind).toBe(plugin.kind);
      expect(Object.keys(example.params), plugin.kind).toEqual(plugin.params.map((param) => param.name));
      expect(Object.values(example.params), plugin.kind).not.toContain(undefined);
    }
  });
});
