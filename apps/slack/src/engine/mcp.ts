/**
 * Sequences MCP server — exposes the command API and the two BYO-agent
 * planning tools (master plan Part V §7) over the Model Context Protocol so
 * an external agent (Claude Code, Codex, anything MCP-capable) can drive a
 * project with its own brain, billed to the subscription the user already
 * pays for.
 *
 * Transport: stdio, newline-delimited JSON-RPC 2.0 (the MCP stdio framing).
 * Hand-rolled on purpose — the protocol subset we need (initialize,
 * tools/list, tools/call, ping) is ~100 lines and keeps the no-build,
 * no-extra-deps rule.
 *
 * Live source goes through the direct HyperFrames lint/invariant gate and exact
 * revision checkpoints. The legacy Plan/Command tools remain available for the
 * deterministic demo and compatibility path.
 *
 * Wire-up (Claude Code):
 *   claude mcp add sequences -- node <repo>/apps/sequences/src/cli.ts mcp <projectDir>
 */
import readline from "node:readline";
import {
  CommandSchema,
  lintProject,
  applyAutoFixes,
  parsePlan,
  planToCommands,
  planningContext,
  ProjectStore,
  type Command,
  type EventEntry,
  type Project,
} from "@sequences/core";
import {
  buildProject,
  commitProject,
  loadProject,
  readEventSequence,
  withProjectWriteLock,
} from "./projectIo.ts";
import { renderProject } from "./render.ts";
import { generateSceneThumbnails } from "./thumbs.ts";
import {
  commitDirectComposition,
  directLintText,
  directOutline,
  generateDirectThumbnails,
  hasDirectComposition,
  loadDirectComposition,
  renderDirectComposition,
  undoDirectComposition,
  type DirectCompositionDraft,
} from "./directComposition.ts";

const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler(args: Record<string, unknown>): Promise<string> | string;
}

function outline(project: Project): string {
  const scenes = project.scenes
    .map(
      (s, i) =>
        `${i + 1}. ${s.id} [${s.archetype}${s.layout ? `/${s.layout}` : ""}] ${s.durationFrames}f` +
        `${s.camera ? ` camera:${s.camera.move}` : ""} slots:${JSON.stringify(s.slots)}`,
    )
    .join("\n");
  return [
    `project: ${project.meta.title} (${project.meta.width}x${project.meta.height}@${project.meta.fps}fps)`,
    `brand: ${project.brand.name}; profile: ${project.motionProfile}`,
    `scenes:`,
    scenes,
  ].join("\n");
}

function lintText(project: Project): string {
  const findings = lintProject(project);
  if (findings.length === 0) return "lint: clean";
  return findings
    .map(
      (f) =>
        `${f.severity} [${f.rule}] ${[f.sceneId, f.layerId].filter(Boolean).join("/")}: ${f.message}${f.fix ? " (auto-fixable)" : ""}`,
    )
    .join("\n");
}

export function startMcpServer(projectDir: string): void {
  let pendingEvents: EventEntry[] = [];
  const createStore = (project = loadProject(projectDir)) =>
    new ProjectStore(
      project,
      (entry) => pendingEvents.push(entry),
      readEventSequence(projectDir),
    );
  let store = createStore();
  let projectFingerprint = JSON.stringify(store.project);

  const syncFromDisk = () => {
    if (pendingEvents.length > 0 && JSON.stringify(store.project) === projectFingerprint) {
      commitProject(projectDir, store.project, pendingEvents.splice(0));
    }
    const diskProject = loadProject(projectDir);
    const diskFingerprint = JSON.stringify(diskProject);
    const diskSequence = readEventSequence(projectDir);
    if (diskFingerprint !== projectFingerprint || diskSequence !== store.eventCount) {
      pendingEvents = [];
      store = createStore(diskProject);
      projectFingerprint = diskFingerprint;
    }
  };

  const withCurrentProject = <T>(action: () => T | Promise<T>) =>
    withProjectWriteLock(projectDir, async () => {
      syncFromDisk();
      return action();
    });

  const persist = () => {
    commitProject(projectDir, store.project, pendingEvents.splice(0));
    projectFingerprint = JSON.stringify(store.project);
    buildProject(projectDir, store.project);
  };

  const tools: ToolDef[] = [
    {
      name: "submit_composition",
      description:
        "Validate and transactionally checkpoint a complete direct HyperFrames index.html plus its matching storyboard. Invalid scratch source is rejected without replacing the current revision.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          html: { type: "string", description: "Complete standalone HyperFrames index.html" },
          // Matches the planner's 3-10 shot ceiling (plus the 2-scene revision floor).
          storyboard: { type: "array", items: { type: "object" }, minItems: 2, maxItems: 10 },
          declaredPrimarySelectors: {
            type: "object",
            description:
              "Optional author-declared primary selector by scene id; presence selects the Luna declared-intent validation policy.",
            additionalProperties: { type: "string" },
          },
          declaredInteractions: {
            type: "array",
            description:
              "Optional Luna selector-level interactions measured against live actor/target geometry.",
            items: { type: "object" },
            maxItems: 8,
          },
        },
        required: ["title", "html", "storyboard"],
        additionalProperties: false,
      },
      handler: (args) =>
        withCurrentProject(async () => {
          if (typeof args.title !== "string" || typeof args.html !== "string" || !Array.isArray(args.storyboard)) {
            throw new Error("title, html, and storyboard are required");
          }
          const result = await commitDirectComposition(projectDir, args.title, {
            html: args.html,
            storyboard: args.storyboard as DirectCompositionDraft["storyboard"],
            ...(args.declaredPrimarySelectors &&
                typeof args.declaredPrimarySelectors === "object" &&
                !Array.isArray(args.declaredPrimarySelectors)
              ? {
                  declaredPrimarySelectors:
                    args.declaredPrimarySelectors as DirectCompositionDraft["declaredPrimarySelectors"],
                }
              : {}),
            ...(Array.isArray(args.declaredInteractions)
              ? {
                  declaredInteractions:
                    args.declaredInteractions as DirectCompositionDraft["declaredInteractions"],
                }
              : {}),
          });
          return [
            `direct composition revision ${result.manifest.revision} applied.`,
            directOutline(result.manifest),
            await directLintText(projectDir),
          ].join("\n");
        }),
    },
    {
      name: "get_planning_context",
      description:
        "Returns everything needed to plan this video: the motion catalog (archetypes, primitives, profiles, camera moves, tokens), brand, assets, and the required plan JSON shape. Call this FIRST, then submit_plan.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: () =>
        withCurrentProject(() =>
          [
            planningContext(store.project),
            "",
            "## Plan shape for submit_plan",
            '{ "motionProfile": "<id>", "scenes": [ { "archetype": "<id>", "layout"?, "durationFrames"?, "slots": {...}, "camera"? } ] }',
            "Rules: 3-6 scenes, use only enabled extension ids from the catalog, respect slot word budgets.",
          ].join("\n"),
        ),
    },
    {
      name: "submit_plan",
      description:
        "Validate a plan (beat sheet) and apply it atomically, replacing the current scenes. Returns the new outline plus lint findings. Invalid plans return structured errors you can self-correct from.",
      inputSchema: {
        type: "object",
        properties: { plan: { type: "object", description: "The plan JSON (see get_planning_context)" } },
        required: ["plan"],
      },
      handler: (args) =>
        withCurrentProject(() => {
          const plan = parsePlan(args.plan, { project: store.project });
          const outcome = store.apply(planToCommands(store.project, plan), "agent");
          if (!outcome.ok) {
            throw new Error(
              `plan failed validation: ${outcome.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
            );
          }
          persist();
          return `plan applied.\n${outline(store.project)}\n${lintText(store.project)}`;
        }),
    },
    {
      name: "get_project_outline",
      description: "Compact outline of the project: scenes, archetypes, durations, slots, profile.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: () =>
        withCurrentProject(() =>
          hasDirectComposition(projectDir)
            ? directOutline(loadDirectComposition(projectDir).manifest)
            : outline(store.project),
        ),
    },
    {
      name: "get_scene",
      description: "Full JSON of one scene (slots, overrides, choreography, camera).",
      inputSchema: {
        type: "object",
        properties: { sceneId: { type: "string" } },
        required: ["sceneId"],
      },
      handler: (args) =>
        withCurrentProject(() => {
          const scene = store.project.scenes.find((s) => s.id === args.sceneId);
          if (!scene) throw new Error(`unknown scene "${String(args.sceneId)}"`);
          return JSON.stringify(scene, null, 2);
        }),
    },
    {
      name: "apply_commands",
      description:
        "Apply one or more typed commands (the same operations the studio UI emits): AddScene, RemoveScene, ReorderScene, SetSceneDuration, SetSceneLayout, SetSlotContent, SetTransition, SetMotionProfile, SetBrandColor, SetBrandFont, OverrideLayerBox, SwapMotion, SetLayerOverride, SetChoreography, SetSceneCamera, Batch. Multiple commands apply atomically as a Batch. All changes are journaled and undoable.",
      inputSchema: {
        type: "object",
        properties: {
          commands: { type: "array", items: { type: "object" }, minItems: 1, maxItems: 100 },
        },
        required: ["commands"],
      },
      handler: (args) =>
        withCurrentProject(() => {
          const raw = args.commands as unknown[];
          const commands: Command[] = raw.map((c, i) => {
            const parsed = CommandSchema.safeParse(c);
            if (!parsed.success) {
              throw new Error(
                `commands[${i}] invalid: ${parsed.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`).join("; ")}`,
              );
            }
            return c as Command;
          });
          const command: Command =
            commands.length === 1 ? commands[0]! : { type: "Batch", commands };
          const outcome = store.apply(command, "agent");
          if (!outcome.ok) {
            throw new Error(
              `rejected: ${outcome.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
            );
          }
          persist();
          return `applied.\n${outline(store.project)}\n${lintText(store.project)}`;
        }),
    },
    {
      name: "lint_report",
      description: "Run the deterministic motion linter. Findings marked auto-fixable can be fixed with autofix.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: () =>
        withCurrentProject(() =>
          hasDirectComposition(projectDir) ? directLintText(projectDir) : lintText(store.project),
        ),
    },
    {
      name: "autofix",
      description: "Apply every available lint auto-fix (as journaled, undoable commands).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: () =>
        withCurrentProject(() => {
          const result = applyAutoFixes(store);
          if (result.applied.length > 0) persist();
          return `applied ${result.applied.length} fixes.\n${lintText(store.project)}`;
        }),
    },
    {
      name: "undo",
      description: "Undo the most recent change (including everything a submitted plan did).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: () =>
        withCurrentProject(() => {
          if (hasDirectComposition(projectDir)) {
            const moved = undoDirectComposition(projectDir);
            return moved
              ? `undone.\n${directOutline(loadDirectComposition(projectDir).manifest)}`
              : "nothing to undo";
          }
          const moved = store.undo("agent");
          if (moved) persist();
          return moved ? `undone.\n${outline(store.project)}` : "nothing to undo";
        }),
    },
    {
      name: "redo",
      description: "Redo the most recently undone change.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: () =>
        withCurrentProject(() => {
          const moved = store.redo("agent");
          if (moved) persist();
          return moved ? `redone.\n${outline(store.project)}` : "nothing to redo";
        }),
    },
    {
      name: "render_preview",
      description:
        "Render deterministic scene preview PNGs from the current compiled project. Returns project-relative paths.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => {
        const result = hasDirectComposition(projectDir)
          ? await generateDirectThumbnails(projectDir)
          : await generateSceneThumbnails(
              projectDir,
              await withCurrentProject(() => store.project),
            );
        return JSON.stringify({
          files: Object.values(result.files),
          scenes: result.files,
        });
      },
    },
    {
      name: "render",
      description:
        "Render the project to MP4 (draft quality by default). Slow (~0.5-2 min). Returns the output path.",
      inputSchema: {
        type: "object",
        properties: {
          quality: { type: "string", enum: ["draft", "standard", "high"] },
        },
      },
      handler: async (args) => {
        const quality =
          args.quality === "standard" || args.quality === "high" ? args.quality : "draft";
        if (hasDirectComposition(projectDir)) {
          const result = await renderDirectComposition(projectDir, { quality, quiet: true });
          return JSON.stringify({
            durationSec: result.durationSec,
            outputPath: result.outputPath,
          });
        }
        const project = await withCurrentProject(() => store.project);
        const result = await renderProject(projectDir, project, { quality, quiet: true });
        return JSON.stringify({
          durationSec: result.manifest.durationSec,
          outputPath: result.outputPath,
        });
      },
    },
  ];

  const write = (message: unknown) => {
    process.stdout.write(JSON.stringify(message) + "\n");
  };

  const handle = async (req: JsonRpcRequest) => {
    if (req.method === "initialize") {
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "sequences", version: "0.1.0" },
      };
    }
    if (req.method === "ping") return {};
    if (req.method === "tools/list") {
      return {
        tools: tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      };
    }
    if (req.method === "tools/call") {
      const name = req.params?.name as string;
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      const tool = tools.find((t) => t.name === name);
      if (!tool) throw Object.assign(new Error(`unknown tool: ${name}`), { code: -32602 });
      try {
        const text = await tool.handler(args);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        };
      }
    }
    throw Object.assign(new Error(`method not found: ${req.method}`), { code: -32601 });
  };

  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      return;
    }
    if (req.id === undefined) return; // notification (e.g. notifications/initialized)
    void handle(req)
      .then((result) => write({ jsonrpc: "2.0", id: req.id, result }))
      .catch((err: Error & { code?: number }) =>
        write({
          jsonrpc: "2.0",
          id: req.id,
          error: { code: err.code ?? -32603, message: err.message },
        }),
      );
  });

  process.stderr.write(`sequences MCP server ready (project: ${projectDir})\n`);
}
