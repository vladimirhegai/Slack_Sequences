/**
 * Sequences Studio — the operator's ONE local viewer over engine catalogs.
 * (`npm run studio --workspace @sequences/slack` →
 * http://127.0.0.1:4321; `npm run assets` is an alias.)
 *
 * The operator VIEWS here; coding agents AUTHOR elsewhere:
 *  - components: the 23-kind catalog rendered live from COMPONENT_CATALOG +
 *    the kit CSS (never a forked copy) with each kind's beat vocabulary;
 *  - assets: the pre-built parametric asset library (params, spring
 *    animations, morph preview) through assetContract — never re-implemented;
 *  - recipes: the agent-authored source library (recipes/<id>.recipe.html,
 *    see recipes/README.md) joined against the exported RecipeV2 library,
 *    with gate/export buttons that run the SAME CLI machinery.
 *  - looks: DESIGN_DIALECTS rendered as palette/type/material/motion cards;
 *    production-cleared MIT wallpapers appear with their crop/motion metadata;
 *  - camera: typed SceneCameraIntentV1 patterns with a seekable station map;
 *  - plugins: PLUGIN_CATALOG kinds, params, purpose, and planning vocabulary.
 *
 * Localhost-only, no auth, no build step, no heavy deps (`http.createServer`
 * + static files + vanilla JS UI). NEVER deployed: refuses to start under
 * RAILWAY_ENVIRONMENT (belt) and is absent from the Docker CMD (suspenders).
 * It is a cockpit over the real engine gate — never a second engine.
 */
import "dotenv/config";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { loadRecipeLibrary } from "../src/engine/recipeContract.ts";
import {
  COMPONENT_CATALOG,
  componentKitStyleTag,
} from "../src/engine/componentContract.ts";
import {
  renderAssetInstance,
  compileAssetAnimation,
  type AssetDefinitionV1,
} from "../src/engine/assetContract.ts";
import { SPRING_PRESETS, type SpringPresetName } from "../src/engine/motionSpring.ts";
import { ASSET_LIBRARY, getAsset } from "../src/engine/assets/index.ts";
import { BACKGROUND_CATALOG, backgroundById } from "../src/engine/backgroundCatalog.ts";
import { CAMERA_PATTERNS } from "../src/engine/cameraPatterns.ts";
import { DESIGN_DIALECTS } from "../src/engine/designDialects.ts";
import { PLUGIN_CATALOG } from "../src/engine/pluginContract.ts";
import { sweepOrphanBrowsers } from "../src/engine/browserLifecycle.ts";
import { gateRecipe, loadGateRecord, recipeGateDir } from "./gate.ts";
import { exportRecipe } from "./exportRecipe.ts";
import { listRecipeSources } from "./recipeSource.ts";
import { pluginDeclarationExample } from "./pluginExamples.ts";

if (process.env.RAILWAY_ENVIRONMENT) {
  process.stderr.write(
    "Sequences Studio is an operator-local tool and refuses to start on Railway.\n",
  );
  process.exit(1);
}

const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "ui");
const RECIPES_LIBRARY_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../skills/sequences-recipes",
);
const PROBE_PROJECTS_DIR = path.join(
  process.env.SLACK_SEQUENCES_DATA_DIR ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.data"),
  "projects",
);
const WALLPAPERS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../vendor/wallpapers",
);
const PORT = Number(process.env.STUDIO_PORT ?? argValue("--port") ?? 4321);
const HOST = "127.0.0.1";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
};

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function sendFile(res: http.ServerResponse, file: string): void {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
  });
  fs.createReadStream(file).pipe(res);
}

/** Serve a file under `root`, rejecting path traversal. */
function sendWithin(res: http.ServerResponse, root: string, rel: string): void {
  const resolved = path.resolve(root, rel.replace(/^\/+/, ""));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden");
    return;
  }
  sendFile(res, resolved);
}

/** Like sendWithin, but honors HTTP Range so <video> can seek MP4s. */
function sendMediaWithin(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  root: string,
  rel: string,
): void {
  const resolved = path.resolve(root, rel.replace(/^\/+/, ""));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden");
    return;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  const size = fs.statSync(resolved).size;
  const type = MIME[path.extname(resolved).toLowerCase()] ?? "application/octet-stream";
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { "content-range": `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      "content-type": type,
      "content-range": `bytes ${start}-${end}/${size}`,
      "content-length": end - start + 1,
      "accept-ranges": "bytes",
    });
    fs.createReadStream(resolved, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    "content-type": type,
    "content-length": size,
    "accept-ranges": "bytes",
  });
  fs.createReadStream(resolved).pipe(res);
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.trim() ? JSON.parse(raw) : {};
}

/* ------------------------------------------------------------ components */

function componentsState(): unknown {
  return {
    components: COMPONENT_CATALOG.map((spec) => ({
      kind: spec.kind,
      purpose: spec.purpose,
      beats: spec.beats,
      markup: spec.markup,
    })),
    kitCss: componentKitStyleTag(),
  };
}

/* ------------------------------------------------------- discovery catalogs */

function looksState(): unknown {
  return {
    entries: DESIGN_DIALECTS.map((dialect) => ({
      id: dialect.id,
      label: dialect.label,
      preferredBasis: dialect.preferredBasis,
      canvas: dialect.canvas,
      colorTopology: dialect.colorTopology,
      palette: { ...dialect.palette, accent: dialect.accent },
      chapterColors: dialect.chapterColors ?? [],
      materialProfile: dialect.materialProfile,
      type: {
        systemId: dialect.typeSystemId,
        ...dialect.typography,
      },
      visualGrammar: dialect.visualGrammar,
      motion: dialect.motion,
      backgroundPolicyIds: dialect.backgroundPolicyIds,
      defaultBackgroundPolicyId: dialect.defaultBackgroundPolicyId,
      rules: dialect.rules,
      sourceRefs: dialect.sourceRefs,
    })),
    backgrounds: backgroundsState().entries,
  };
}

function backgroundsState(): { entries: Array<unknown> } {
  return {
    entries: BACKGROUND_CATALOG.map((entry) => ({
      ...entry,
      previewUrl: `/backgrounds/${encodeURIComponent(entry.id)}`,
    })),
  };
}

function cameraState(): unknown {
  return { version: 1, entries: CAMERA_PATTERNS };
}

function pluginsState(): unknown {
  return {
    entries: PLUGIN_CATALOG.map((spec) => ({
      kind: spec.kind,
      purpose: spec.purpose,
      params: spec.params,
      planningLine: spec.planningLine,
      example: pluginDeclarationExample(spec),
    })),
  };
}

/* ------------------------------------------------------------ assets */

function assetSummary(definition: AssetDefinitionV1): unknown {
  return {
    id: definition.id,
    title: definition.title,
    purpose: definition.purpose,
    family: definition.family,
    params: definition.params,
    animations: definition.animations.map((animation) => ({
      name: animation.name,
      purpose: animation.purpose,
      spring: animation.spring,
      trigger: animation.trigger ?? "manual",
    })),
  };
}

/**
 * The morph preview's gesture, precompiled once per house spring preset so
 * the morph-tweak picker recomputes nothing client-side — every option is the
 * exact easing the contract would compile. Default stays `settle`.
 */
const MORPH_GESTURES = Object.fromEntries(
  (Object.keys(SPRING_PRESETS) as SpringPresetName[]).map((preset) => {
    const compiled = compileAssetAnimation(
      {
        name: "morph",
        purpose: "FLIP morph between two assets",
        spring: preset,
        tracks: [{ property: "opacity", from: 0, to: 1 }],
      },
      {},
    );
    return [preset, { durationMs: compiled.durationMs, easing: compiled.easing }];
  }),
) as Record<SpringPresetName, { durationMs: number; easing: string }>;

/* ------------------------------------------------------------ recipes */

function recipesState(): unknown {
  const { sources, issues } = listRecipeSources();
  const library = loadRecipeLibrary({ refresh: true });
  const ids = new Set<string>([
    ...sources.map((source) => source.id),
    ...library.recipes.keys(),
  ]);
  const entries = [...ids].sort().map((id) => {
    const source = sources.find((entry) => entry.id === id);
    const exported = library.recipes.get(id);
    const gate = source ? loadGateRecord(id) : undefined;
    const manifest = source?.manifest ?? exported?.manifest;
    const previewDir = path.join(RECIPES_LIBRARY_DIR, id, "preview");
    const preview = fs.existsSync(previewDir)
      ? fs.readdirSync(previewDir)
          .filter((name) => name.endsWith(".png"))
          .map((name) => `/library/${id}/preview/${name}`)
      : [];
    const hasLivePreview = fs.existsSync(
      path.join(recipeGateDir(id), "composition", "index.html"),
    );
    return {
      id,
      title: manifest?.title ?? id,
      description: manifest?.description ?? "",
      tags: manifest?.tags ?? [],
      triggerPatterns: manifest?.triggerPatterns ?? [],
      durationWindow: manifest?.durationWindow,
      params: manifest?.params ?? [],
      source: source
        ? {
            file: path.relative(path.resolve(UI_DIR, "../.."), source.file).replace(/\\/g, "/"),
            demoParams: source.demo.params ?? {},
            sanityBriefs: source.sanityBriefs,
            gate: gate
              ? {
                  ok: gate.ok,
                  gatedAt: gate.gatedAt,
                  errors: gate.errors,
                  warnings: gate.warnings,
                  fresh: gate.fragmentHash === source.fragmentHash,
                }
              : undefined,
          }
        : undefined,
      exported: exported
        ? {
            revision: exported.manifest.revision,
            stale: exported.stale,
            staleReasons: exported.staleReasons,
            inSync: source ? exported.manifest.fragmentHash === source.fragmentHash : true,
            preview,
          }
        : undefined,
      previewUrl: hasLivePreview ? `/preview/${id}/index.html` : undefined,
      thumbnails: (gate?.thumbnails ?? []).map((name) => `/thumbs/${id}/${name}`),
    };
  });
  return { version: library.version, warnings: library.warnings, entries, issues };
}

/* ------------------------------------------------------------ probes */

/**
 * Live-probe viewer state: every local `.data/projects/<id>` that produced a
 * non-empty rendered MP4 (fail-loud runs and rejected attempts never render,
 * so they are excluded by construction). The operator audits the actual film
 * plus the temporal strip / blocking overlay QA already persists.
 */
function probesState(): unknown {
  if (!fs.existsSync(PROBE_PROJECTS_DIR)) return { entries: [] };
  const entries = fs.readdirSync(PROBE_PROJECTS_DIR, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => {
      const dir = path.join(PROBE_PROJECTS_DIR, dirent.name);
      const rendersDir = path.join(dir, "renders");
      const renders = fs.existsSync(rendersDir)
        ? fs.readdirSync(rendersDir)
            .filter((name) => name.endsWith(".mp4"))
            .map((name) => ({ name, stat: fs.statSync(path.join(rendersDir, name)) }))
            .filter((render) => render.stat.size > 0)
            .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
        : [];
      if (!renders.length) return undefined;
      const latest = renders[0]!;
      let sentinel: {
        disposition?: string;
        durationMs?: number;
        degradations?: string[];
        stages?: Array<{ stage: string; status: string; durationMs: number; attempts?: number }>;
      } | undefined;
      try {
        sentinel = JSON.parse(
          fs.readFileSync(path.join(dir, "planning", "sentinel-run.json"), "utf8"),
        );
      } catch {
        sentinel = undefined;
      }
      const mediaUrl = (rel: string): string | undefined =>
        fs.existsSync(path.join(dir, rel))
          ? `/probe-media/${encodeURIComponent(dirent.name)}/${rel.replace(/\\/g, "/")}`
          : undefined;
      const thumbsDir = path.join(dir, "build", "thumbs");
      const thumbnails = fs.existsSync(thumbsDir)
        ? fs.readdirSync(thumbsDir)
            .filter((name) => name.endsWith(".png"))
            .sort()
            .map((name) => `/probe-media/${encodeURIComponent(dirent.name)}/build/thumbs/${name}`)
        : [];
      return {
        id: dirent.name,
        renderedAt: latest.stat.mtime.toISOString(),
        mp4: `/probe-media/${encodeURIComponent(dirent.name)}/renders/${encodeURIComponent(latest.name)}`,
        mp4Bytes: latest.stat.size,
        renders: renders.map((render) => ({
          name: render.name,
          url: `/probe-media/${encodeURIComponent(dirent.name)}/renders/${encodeURIComponent(render.name)}`,
          bytes: render.stat.size,
          at: render.stat.mtime.toISOString(),
        })),
        strip: mediaUrl(path.join("build", "qa", "temporal", "strip.png")),
        blocking: mediaUrl(path.join("build", "qa", "temporal", "blocking.png")),
        thumbnails,
        disposition: sentinel?.disposition,
        degradations: sentinel?.degradations ?? [],
        stages: (sentinel?.stages ?? []).map((stage) => ({
          stage: stage.stage,
          status: stage.status,
          attempts: stage.attempts ?? 1,
          durationMs: stage.durationMs,
        })),
        wallClockMs: sentinel?.durationMs,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => (a.renderedAt < b.renderedAt ? 1 : -1));
  return { entries };
}

// One long-running job at a time: gates run a real browser and the library
// env override is process-global. A simple promise chain keeps handlers honest.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

const server = http.createServer((req, res) => {
  void handle(req, res).catch((error) => {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  });
});

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  const segments = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return sendFile(res, path.join(UI_DIR, "index.html"));
  }
  if (req.method === "GET" && url.pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/state") {
    return sendJson(res, 200, {
      ...(componentsState() as object),
      assets: ASSET_LIBRARY.map(assetSummary),
      morph: { default: "settle", gestures: MORPH_GESTURES },
      recipes: recipesState(),
      looks: looksState(),
      camera: cameraState(),
      plugins: pluginsState(),
    });
  }
  if (req.method === "GET" && url.pathname === "/api/looks") {
    return sendJson(res, 200, { looks: looksState() });
  }
  if (req.method === "GET" && url.pathname === "/api/backgrounds") {
    return sendJson(res, 200, { backgrounds: backgroundsState() });
  }
  if (req.method === "GET" && url.pathname === "/api/camera") {
    return sendJson(res, 200, { camera: cameraState() });
  }
  if (req.method === "GET" && url.pathname === "/api/plugins") {
    return sendJson(res, 200, { plugins: pluginsState() });
  }
  if (req.method === "GET" && url.pathname === "/api/recipes") {
    return sendJson(res, 200, { recipes: recipesState() });
  }
  if (req.method === "GET" && url.pathname === "/api/probes") {
    return sendJson(res, 200, { probes: probesState() });
  }
  if (req.method === "GET" && segments[0] === "probe-media" && segments[1]) {
    const probeRoot = path.resolve(PROBE_PROJECTS_DIR, decodeURIComponent(segments[1]));
    if (
      probeRoot !== PROBE_PROJECTS_DIR &&
      !probeRoot.startsWith(PROBE_PROJECTS_DIR + path.sep)
    ) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("forbidden");
      return;
    }
    return sendMediaWithin(req, res, probeRoot, segments.slice(2).map(decodeURIComponent).join("/"));
  }
  if (req.method === "POST" && url.pathname === "/api/render") {
    const body = (await readBody(req)) as {
      id?: string;
      params?: Record<string, string | number>;
      partId?: string;
    };
    const definition = getAsset(body.id ?? "");
    if (!definition) return sendJson(res, 404, { error: `unknown asset "${body.id}"` });
    const instance = renderAssetInstance(definition, body.params ?? {}, {
      ...(body.partId ? { partId: body.partId } : {}),
    });
    return sendJson(res, 200, instance);
  }
  if (segments[0] === "api" && segments[1] === "recipes" && segments[2] && req.method === "POST") {
    const id = decodeURIComponent(segments[2]);
    if (segments[3] === "gate") {
      const outcome = await enqueue(() => gateRecipe(id));
      return sendJson(res, 200, { gate: outcome.gate, recipes: recipesState() });
    }
    if (segments[3] === "export") {
      const result = await enqueue(async () => exportRecipe(id));
      return sendJson(res, 200, { export: result, recipes: recipesState() });
    }
  }
  if (req.method === "GET" && segments[0] === "preview" && segments[1]) {
    const root = path.join(recipeGateDir(decodeURIComponent(segments[1])), "composition");
    return sendWithin(res, root, segments.slice(2).join("/") || "index.html");
  }
  if (req.method === "GET" && segments[0] === "thumbs" && segments[1]) {
    const root = path.join(recipeGateDir(decodeURIComponent(segments[1])), "build", "thumbs");
    return sendWithin(res, root, segments.slice(2).join("/"));
  }
  if (req.method === "GET" && segments[0] === "library" && segments[1]) {
    const root = path.join(RECIPES_LIBRARY_DIR, decodeURIComponent(segments[1]));
    return sendWithin(res, root, segments.slice(2).join("/"));
  }
  if (
    req.method === "GET" &&
    segments.length === 2 &&
    segments[0] === "backgrounds" &&
    segments[1]
  ) {
    const entry = backgroundById(decodeURIComponent(segments[1]));
    if (!entry) return sendJson(res, 404, { error: "unknown production background" });
    return sendWithin(res, WALLPAPERS_DIR, path.basename(entry.file));
  }
  if (req.method === "GET" && segments[0] === "ui") {
    return sendWithin(res, UI_DIR, segments.slice(1).join("/"));
  }
  sendJson(res, 404, { error: "unknown route" });
}

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  process.stdout.write(
    `Sequences Studio → ${url}  (${COMPONENT_CATALOG.length} components · ` +
      `${ASSET_LIBRARY.length} assets · ${DESIGN_DIALECTS.length} looks · ` +
      `${CAMERA_PATTERNS.length} camera patterns · ${PLUGIN_CATALOG.length} plugins · ` +
      `${BACKGROUND_CATALOG.length} production backgrounds · recipes from recipes/*.recipe.html)\n`,
  );
  // Operator-local hygiene: reap any headless QA browsers a previous
  // interrupted gate/test stranded on this machine (orphans only).
  void sweepOrphanBrowsers().then((killed) => {
    if (killed > 0) process.stdout.write(`(cleaned ${killed} orphaned headless browser process(es))\n`);
  }).catch(() => undefined);
  if (!process.argv.includes("--no-open")) {
    // Best-effort browser launch; the URL above is the contract.
    const opener = process.platform === "win32"
      ? spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" })
      : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], {
          detached: true,
          stdio: "ignore",
        });
    opener.on("error", () => undefined);
    opener.unref();
  }
});
