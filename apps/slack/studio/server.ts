/**
 * Recipe Studio server — owner-facing internal tool (RECIPE_STUDIO_PLAN.md).
 *
 * `npm run studio --workspace @sequences/slack` → http://127.0.0.1:4321
 *
 * Localhost-only, no auth, no build step, no heavy deps (`http.createServer`
 * + static files + vanilla JS UI). NEVER deployed: refuses to start under
 * RAILWAY_ENVIRONMENT (belt) and is absent from the Docker CMD (suspenders).
 * It is a cockpit over the real engine gate — never a second engine.
 *
 * Endpoints:
 *   GET  /                          studio UI
 *   GET  /api/state                 library recipes + workspaces
 *   POST /api/workspaces            { id, fromRecipe?, title? } create
 *   GET  /api/workspace/:id         full workspace (sources + gate)
 *   POST /api/workspace/:id/update  { fragment?, recipeMd?, params?, … }
 *   POST /api/workspace/:id/generate  scaffold + full gate + thumbnails
 *   POST /api/workspace/:id/export  RecipeV2 export (green gate only)
 *   GET  /preview/:id/*             serve the workspace composition dir
 *   GET  /thumbs/:id/*              serve the gate's thumbnail strip
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { loadRecipeLibrary } from "../src/engine/recipeContract.ts";
import { gateWorkspace } from "./gate.ts";
import { exportWorkspaceRecipe } from "./exportRecipe.ts";
import {
  createWorkspace,
  listWorkspaces,
  loadWorkspace,
  updateWorkspaceSources,
  workspaceFragment,
  workspaceProjectDir,
  workspaceRecipeMd,
} from "./workspaces.ts";

if (process.env.RAILWAY_ENVIRONMENT) {
  process.stderr.write(
    "Recipe Studio is an operator-local tool and refuses to start on Railway.\n",
  );
  process.exit(1);
}

const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "ui");
const PORT = Number(process.env.STUDIO_PORT ?? argValue("--port") ?? 4321);
const HOST = "127.0.0.1";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
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
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
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

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function libraryState(): unknown {
  const library = loadRecipeLibrary({ refresh: true });
  return {
    version: library.version,
    warnings: library.warnings,
    recipes: [...library.recipes.values()].map((recipe) => ({
      id: recipe.manifest.id,
      title: recipe.manifest.title,
      tags: recipe.manifest.tags,
      revision: recipe.manifest.revision,
      stale: recipe.stale,
      staleReasons: recipe.staleReasons,
      params: recipe.manifest.params,
      hasDemo: fs.existsSync(path.join(recipe.dir, "demo.html")),
    })),
  };
}

function workspaceState(id: string): unknown {
  const workspace = loadWorkspace(id);
  return {
    ...workspace,
    fragment: workspaceFragment(id),
    recipeMd: workspaceRecipeMd(id),
    previewUrl: fs.existsSync(path.join(workspaceProjectDir(id), "composition", "index.html"))
      ? `/preview/${id}/index.html`
      : undefined,
    thumbnails: (workspace.gate?.thumbnails ?? []).map((name) => `/thumbs/${id}/${name}`),
  };
}

// One request at a time: gates run a real browser and the library env
// override is process-global. A simple promise chain keeps handlers honest.
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
  if (req.method === "GET" && url.pathname === "/api/state") {
    return sendJson(res, 200, { library: libraryState(), workspaces: listWorkspaces() });
  }
  if (req.method === "POST" && url.pathname === "/api/workspaces") {
    const body = (await readBody(req)) as { id?: string; fromRecipe?: string; title?: string };
    if (!body.id) return sendJson(res, 400, { error: "id is required" });
    const workspace = createWorkspace({
      id: body.id,
      ...(body.fromRecipe ? { fromRecipe: body.fromRecipe } : {}),
      ...(body.title ? { title: body.title } : {}),
    });
    return sendJson(res, 200, { workspace: workspaceState(workspace.id) });
  }
  if (segments[0] === "api" && segments[1] === "workspace" && segments[2]) {
    const id = decodeURIComponent(segments[2]);
    const action = segments[3];
    if (req.method === "GET" && !action) {
      return sendJson(res, 200, { workspace: workspaceState(id) });
    }
    if (req.method === "POST" && action === "update") {
      const body = (await readBody(req)) as Parameters<typeof updateWorkspaceSources>[1];
      updateWorkspaceSources(id, body);
      return sendJson(res, 200, { workspace: workspaceState(id) });
    }
    if (req.method === "POST" && action === "generate") {
      const outcome = await enqueue(() => gateWorkspace(id));
      return sendJson(res, 200, { gate: outcome.gate, workspace: workspaceState(id) });
    }
    if (req.method === "POST" && action === "export") {
      const result = await enqueue(async () => exportWorkspaceRecipe(id));
      return sendJson(res, 200, { export: result, library: libraryState() });
    }
  }
  if (req.method === "GET" && segments[0] === "preview" && segments[1]) {
    const root = path.join(workspaceProjectDir(decodeURIComponent(segments[1])), "composition");
    return sendWithin(res, root, segments.slice(2).join("/") || "index.html");
  }
  if (req.method === "GET" && segments[0] === "thumbs" && segments[1]) {
    const root = path.join(workspaceProjectDir(decodeURIComponent(segments[1])), "build", "thumbs");
    return sendWithin(res, root, segments.slice(2).join("/"));
  }
  if (req.method === "GET" && segments[0] === "ui") {
    return sendWithin(res, UI_DIR, segments.slice(1).join("/"));
  }
  sendJson(res, 404, { error: "unknown route" });
}

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  process.stdout.write(`Recipe Studio → ${url}\n`);
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
