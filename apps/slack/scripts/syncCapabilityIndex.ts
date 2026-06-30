/**
 * Deterministically sync the HyperFrames registry metadata into one offline
 * capability index. The registry ref is pinned to the vendored skill snapshot;
 * the production renderer itself remains on HyperFrames 0.6.86.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FRAME_PRESETS } from "../src/engine/framePresets.ts";
import type {
  CapabilityIndex,
  CapabilityRecord,
} from "../src/agent/capabilityIndex.ts";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY_COMMIT = "3351fb1a6d7f0202d07db9bf9ad335fd0d1ec344";
const REGISTRY_VERSION = "0.7.17";
const RUNTIME_VERSION = "0.6.86";
const BASE_URL =
  `https://raw.githubusercontent.com/heygen-com/hyperframes/${REGISTRY_COMMIT}/registry`;
const OUTPUT = path.join(APP_DIR, "capabilities", "capability-index.json");

interface RegistryManifest {
  items: Array<{
    name: string;
    type: "hyperframes:block" | "hyperframes:component" | "hyperframes:example";
  }>;
}

interface RegistryItem {
  name: string;
  type: "hyperframes:block" | "hyperframes:component";
  title: string;
  description: string;
  tags?: string[];
  dimensions?: { width: number; height: number };
  duration?: number;
  files?: Array<{ target?: string }>;
  registryDependencies?: string[];
  params?: Array<{ key?: string }>;
  preview?: { poster?: string; video?: string };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return await response.json() as T;
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(values.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor++;
      result[index] = await map(values[index]!);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return result;
}

function readSkillFile(...segments: string[]): string {
  return fs.readFileSync(path.join(APP_DIR, "skills", "hyperframes-animation", ...segments), "utf8");
}

function registryCapability(item: RegistryItem): CapabilityRecord {
  return {
    id: item.name,
    kind: item.type === "hyperframes:block" ? "registry-block" : "registry-component",
    title: item.title,
    description: item.description,
    tags: item.tags ?? [],
    reuseTier: item.type === "hyperframes:block" ? "parameter-swap" : "safe-composition",
    ...(item.duration ? { durationSec: item.duration } : {}),
    ...(item.dimensions ? { dimensions: item.dimensions } : {}),
    ...(item.params?.length
      ? {
          configurableVariables: item.params
            .map((param) => param.key)
            .filter((key): key is string => Boolean(key)),
        }
      : {}),
    ...(item.registryDependencies?.length
      ? { dependencies: item.registryDependencies }
      : {}),
    ...(item.files?.length
      ? {
          files: item.files
            .map((file) => file.target)
            .filter((target): target is string => Boolean(target)),
        }
      : {}),
    ...(item.preview ? { preview: item.preview } : {}),
    provenance: {
      source: "hyperframes-registry",
      ref: `${REGISTRY_COMMIT}:${item.type === "hyperframes:block" ? "blocks" : "components"}/${item.name}/registry-item.json`,
    },
  };
}

function localCapabilities(): CapabilityRecord[] {
  const capabilities: CapabilityRecord[] = [];
  const blueprints = readSkillFile("blueprints-index.md");
  for (const match of blueprints.matchAll(
    /<blueprint id="([^"]+)" roles="([^"]+)" duration="([^"]+)">\n([\s\S]*?)\n<\/blueprint>/g,
  )) {
    const [, id, roles, duration, description] = match;
    capabilities.push({
      id: id!,
      kind: "blueprint",
      title: id!.split("-").map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" "),
      description: description!.replace(/\s+/g, " ").trim(),
      tags: roles!.split(",").map((role) => role.trim().toLowerCase()),
      reuseTier: "safe-composition",
      provenance: {
        source: "vendored-hyperframes-skill",
        ref: `hyperframes-animation/blueprints/${id}.md (${duration})`,
      },
    });
  }

  const rules = readSkillFile("rules-index.md");
  const seenRules = new Set<string>();
  for (const match of rules.matchAll(/<([a-z0-9-]+) path="([^"]+)">([\s\S]*?)<\/\1>/g)) {
    const [, id, ref, description] = match;
    if (seenRules.has(id!)) continue;
    seenRules.add(id!);
    const tagMatch = description!.match(/Tags:\s*([^<.]+)/i);
    capabilities.push({
      id: id!,
      kind: "motion-rule",
      title: id!.split("-").map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" "),
      description: description!.replace(/\s+/g, " ").trim(),
      tags: tagMatch?.[1]?.split(",").map((tag) => tag.trim().toLowerCase()) ?? [],
      reuseTier: "safe-composition",
      provenance: {
        source: "vendored-hyperframes-skill",
        ref: `hyperframes-animation/${ref}`,
      },
    });
  }

  for (const preset of FRAME_PRESETS) {
    capabilities.push({
      id: preset.id,
      kind: "frame-preset",
      title: preset.label,
      description: preset.thesis,
      tags: [...preset.tones, preset.basis],
      reuseTier: "parameter-swap",
      configurableVariables: [
        "palette",
        "typography",
        "spacing",
        "corners",
        "depth",
        "background",
      ],
      provenance: {
        source: "sequences-frame-presets",
        ref: "src/engine/framePresets.ts",
      },
    });
  }
  return capabilities;
}

async function main(): Promise<void> {
  const manifest = await fetchJson<RegistryManifest>(`${BASE_URL}/registry.json`);
  const catalog = manifest.items.filter(
    (item): item is RegistryManifest["items"][number] & {
      type: "hyperframes:block" | "hyperframes:component";
    } => item.type === "hyperframes:block" || item.type === "hyperframes:component",
  );
  const registry = await mapConcurrent(catalog, 10, async (entry) => {
    const directory = entry.type === "hyperframes:block" ? "blocks" : "components";
    const item = await fetchJson<RegistryItem>(
      `${BASE_URL}/${directory}/${entry.name}/registry-item.json`,
    );
    if (item.name !== entry.name || item.type !== entry.type) {
      throw new Error(`registry identity mismatch for ${entry.name}`);
    }
    return registryCapability(item);
  });
  const capabilities = [...registry, ...localCapabilities()]
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const index: CapabilityIndex = {
    version: 1,
    registry: {
      commit: REGISTRY_COMMIT,
      version: REGISTRY_VERSION,
      runtimeVersion: RUNTIME_VERSION,
      itemCount: registry.length,
    },
    capabilities,
  };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(index, null, 2) + "\n", "utf8");
  process.stdout.write(
    `synced ${registry.length} registry items + ${capabilities.length - registry.length} local capabilities -> ${OUTPUT}\n`,
  );
}

await main();
