interface ExampleParam {
  name: string;
  default?: string | number;
  options?: string[];
  kind: string;
}

interface ExamplePlugin {
  kind: string;
  params: ExampleParam[];
}

/** Exact planner-facing declaration shape, populated with safe catalog defaults. */
export function pluginDeclarationExample(plugin: ExamplePlugin): object {
  const params = Object.fromEntries(plugin.params.map((param) => [
    param.name,
    param.default ?? param.options?.[0] ?? (param.kind === "number" ? 1 : `<${param.name}>`),
  ]));
  return {
    version: 1,
    kind: plugin.kind,
    id: plugin.kind.replace(/^(?:asset-)?/, "") || plugin.kind,
    params,
  };
}
