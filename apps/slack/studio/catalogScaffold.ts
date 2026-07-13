import fs from "node:fs";
import path from "node:path";

export const STUDIO_CATALOGS = [
  "components",
  "assets",
  "recipes",
  "looks",
  "camera",
  "plugins",
] as const;

export type StudioCatalog = (typeof STUDIO_CATALOGS)[number];

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface CatalogScaffold {
  catalog: StudioCatalog;
  id: string;
  target: string;
  content: string;
  skill: string;
}

function title(id: string): string {
  return id.split("-").map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
}

function camel(id: string): string {
  return id.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

function recipeTemplate(id: string): string {
  return `<script type="application/json" data-recipe-meta>
{
  "format": 2,
  "id": "${id}",
  "title": "${title(id)}",
  "description": "TODO: name the reusable motion mechanism and its story job.",
  "tags": ["saas", "motion"],
  "triggerPatterns": ["${id.replace(/-/g, "[ -]?")}"],
  "durationWindow": { "minSec": 2.5, "maxSec": 8 },
  "componentKinds": [],
  "params": [{ "name": "headline", "kind": "text", "default": "Ship the proof", "maxChars": 40 }],
  "revision": 1,
  "demo": { "durationSec": 4.5, "params": { "headline": "Ship the proof" } },
  "sanityBriefs": ["TODO: a realistic brief that should retrieve ${id}."]
}
</script>
<template data-recipe-doc>
# ${id}

Describe what it is, when to declare it, how to stage around it, and every slot.
</template>
<style data-recipe-style>
.rcp-${id} { position: relative; opacity: 0; }
</style>
<template data-recipe-fragment>
<div class="rcp-${id}" data-part="${id}-{{uid}}" data-layout-important>{{headline}}</div>
</template>
<script data-recipe-motion>
function (tl, root, start, duration, uid) {
  tl.fromTo('.rcp-${id}[data-recipe-uid="' + uid + '"]',
    { opacity: 0, y: 24, scale: 0.98 },
    { opacity: 1, y: 0, scale: 1, duration: 0.48, ease: "power4.out" },
    start + 0.12);
}
</script>
`;
}

function template(catalog: StudioCatalog, id: string): { target: string; content: string } {
  const symbol = camel(id);
  switch (catalog) {
    case "components":
      return {
        target: `component-${id}.snippet.ts`,
        content: `// Apply this snippet deliberately in src/engine/componentContract.ts.
// 1. Add "${id}" to ComponentKind. 2. Add the catalog entry. 3. Add kit CSS/markup.
{
  kind: "${id}",
  purpose: "TODO: one reusable product-state role",
  beats: ["open", "highlight"],
  markup: '<div class="cmp cmp-${id}" data-component="${id}"></div>',
},
`,
      };
    case "assets":
      return {
        target: `${symbol}.ts`,
        content: `import { defineAsset } from "../assetContract.ts";

export const ${symbol} = defineAsset({
  version: 1,
  id: "${id}",
  title: "${title(id)}",
  purpose: "TODO: one recognizable SaaS-commercial visual job",
  family: "card",
  params: [],
  animations: [{
    name: "enter", purpose: "Fast staged arrival", spring: "pop", trigger: "enter",
    tracks: [{ property: "opacity", from: 0, to: 1 }, { property: "scale", from: 0.94, to: 1 }],
  }],
  style: ".asset-${id} { position: relative; }",
  render: () => '<div class="asset-${id}"></div>',
});
`,
      };
    case "recipes":
      return { target: `${id}.recipe.html`, content: recipeTemplate(id) };
    case "looks":
      return {
        target: `look-${id}.snippet.ts`,
        content: `// Apply as one complete DESIGN_DIALECTS entry in src/engine/designDialects.ts.
{
  id: "${id}", label: "${title(id)}", sourceRefs: [], preferredBasis: "either",
  canvas: { id: "quiet-solid", allowPureWhite: false, allowPureBlack: false, allowSolidField: true, description: "TODO" },
  colorTopology: "single-accent", accent: "#6C5CE7",
  palette: { bg: "#101218", surface: "#191d27", text: "#f7f8fb", textMuted: "#a8afbd" },
  materialProfile: "clean-flat", typeSystemId: "signal",
  typography: { pairingMode: "single-family", displayWeight: "700", bodyWeight: "400", tracking: "tight display; neutral body", casing: "sentence case" },
  visualGrammar: "TODO", motion: { macro: "TODO", camera: "TODO", micro: "TODO", transitions: "TODO" },
  backgroundPolicyIds: ["quiet-solid"], defaultBackgroundPolicyId: "quiet-solid",
  rules: ["TODO"], tones: ["crisp-saas"], keywords: ["${id}"],
},
`,
      };
    case "camera":
      return {
        target: `camera-${id}.snippet.ts`,
        content: `// Apply as one CAMERA_PATTERNS entry in src/engine/cameraPatterns.ts.
{
  version: 1, id: "${id}", title: "${title(id)}",
  purpose: "TODO: motivated camera story job", durationSec: 4.2,
  motionDescription: "A decisive reframe lands quickly, then settles while proof develops.",
  eyeTrace: "TODO: describe the viewer's eye path.", bestFor: ["SaaS proof"], world: WIDE_WORLD,
  stations: [
    { id: "context", label: "CONTEXT", role: "entry", x: 360, y: 520, width: 900, height: 620, description: "Opening context." },
    { id: "proof", label: "PROOF", role: "proof", x: 1840, y: 580, width: 900, height: 620, description: "Payoff detail." },
  ],
  camera: { version: 1, path: [
    { version: 1, move: "drift", fromRegion: "context", toRegion: "context", zoom: 1.02, startSec: 0, durationSec: 0.45, ease: "seqDrift" },
    { version: 1, move: "pan", toRegion: "proof", zoom: 1.18, startSec: 0.45, durationSec: 0.85, ease: "seqSwoosh" },
    { version: 1, move: "drift", toRegion: "proof", zoom: 1.22, startSec: 1.3, durationSec: 2.9, ease: "seqSettle" },
  ] },
},
`,
      };
    case "plugins":
      return {
        target: `plugin-${id}.snippet.ts`,
        content: `// Apply as one PLUGIN_CATALOG entry in src/engine/pluginContract.ts.
{
  kind: "${id}",
  purpose: "TODO: one coherent host-generated product unit",
  params: [{ name: "topic", kind: "text", default: "", maxChars: 60 }],
  planningLine: '- ${id} — TODO; params: topic (short phrase).',
  lower(ctx) {
    // Use ctx.rng, component(...), beat(...), and stable \`\${ctx.id}-part\` ids.
    return { components: [], beats: [], markup: '<div class="seq-plugin-${id}"></div>' };
  },
},
`,
      };
  }
}

export function buildCatalogScaffold(catalog: string, id: string): CatalogScaffold {
  if (!STUDIO_CATALOGS.includes(catalog as StudioCatalog)) {
    throw new Error(`unknown catalog "${catalog}" (choose ${STUDIO_CATALOGS.join(", ")})`);
  }
  if (!ID.test(id)) throw new Error("id must be lower kebab-case");
  const typedCatalog = catalog as StudioCatalog;
  const built = template(typedCatalog, id);
  return {
    catalog: typedCatalog,
    id,
    ...built,
    skill: `studio/skills/studio-${typedCatalog}/SKILL.md`,
  };
}

export function writeCatalogScaffold(root: string, scaffold: CatalogScaffold): string {
  const dir = scaffold.catalog === "recipes"
    ? path.join(root, "recipes")
    : path.join(root, ".data", "studio", "scaffolds", scaffold.catalog, scaffold.id);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, scaffold.target);
  if (fs.existsSync(target)) throw new Error(`refusing to overwrite ${target}`);
  fs.writeFileSync(target, scaffold.content, "utf8");
  return target;
}
