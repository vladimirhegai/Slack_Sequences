/**
 * `/sequences mcp-test` — a self-check that exercises every service the bot
 * depends on and reports a pass/warn/fail board, so you can tell at a glance
 * whether the deployment is healthy before continuing development or a demo.
 *
 * Every check is contained: it never throws and never blocks forever (the MCP
 * roundtrip is bounded by a timeout). Nothing here costs a paid API call.
 */
import fs from "node:fs";
import path from "node:path";
import { PROVIDERS } from "@sequences/platform/providers";
import type { WebClient } from "@slack/web-api";
import { McpClient } from "./engine/mcpClient.ts";
import { mcpEnabled, resolveProvider } from "./orchestrator.ts";
import { findBrowserExecutable, findFfmpeg } from "./engine/render.ts";
import { dataDir, initializeProject } from "./engine/projectTemplates.ts";
import { getSlackUserToken } from "./slackTokenStore.ts";
import { resolveAuthorRoute } from "./engine/lunaRoute.ts";
import {
  inspectLunaWorkerHealth,
  lunaWorkerHealthIsExact,
  resolveLunaWorkerConfig,
} from "./engine/lunaWorkerClient.ts";

export type CheckStatus = "ok" | "warn" | "fail";

export interface DiagnosticCheck {
  label: string;
  status: CheckStatus;
  detail: string;
  /** Core checks gate "healthy"; non-core checks (provider, hosted MCP) only warn. */
  core: boolean;
}

export interface DiagnosticsReport {
  checks: DiagnosticCheck[];
  healthy: boolean;
}

export interface DiagnosticsInput {
  client?: WebClient;
  teamId?: string;
  userId?: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(onTimeout()), ms)),
  ]);
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function checkSlackApi(client?: WebClient): Promise<DiagnosticCheck> {
  if (!client) {
    return { label: "Slack API", status: "warn", detail: "no Slack client in this context", core: false };
  }
  try {
    const auth = (await client.auth.test()) as { user?: string; team?: string };
    return {
      label: "Slack API",
      status: "ok",
      detail: `connected as @${auth.user ?? "?"} in ${auth.team ?? "?"}`,
      core: true,
    };
  } catch (error) {
    return { label: "Slack API", status: "fail", detail: errMessage(error), core: true };
  }
}

async function checkSequencesMcp(): Promise<DiagnosticCheck> {
  if (!mcpEnabled()) {
    return {
      label: "Sequences MCP (video engine)",
      status: "warn",
      detail: "disabled via SLACK_SEQUENCES_USE_MCP=0 — using the in-process engine",
      core: false,
    };
  }
  let probeDir: string | undefined;
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    probeDir = fs.mkdtempSync(path.join(dataDir(), "diag-"));
    const dir = probeDir;
    initializeProject(dir, {
      name: "Diagnostics Probe",
      brandName: "Sequences",
      seedScreenshot: false,
    });
    return await withTimeout(
      (async (): Promise<DiagnosticCheck> => {
        const mcp = await McpClient.connect(dir);
        try {
          const tools = await mcp.listTools();
          return {
            label: "Sequences MCP (video engine)",
            status: "ok",
            detail: `connected · ${tools.length} tools (${tools.slice(0, 3).map((t) => t.name).join(", ")}…)`,
            core: true,
          };
        } finally {
          mcp.close();
        }
      })(),
      8000,
      () => ({
        label: "Sequences MCP (video engine)",
        status: "fail" as const,
        detail: "timed out connecting to the MCP server",
        core: true,
      }),
    );
  } catch (error) {
    return { label: "Sequences MCP (video engine)", status: "fail", detail: errMessage(error), core: true };
  } finally {
    if (probeDir) fs.rmSync(probeDir, { recursive: true, force: true });
  }
}

function checkRenderHost(): DiagnosticCheck {
  const browser = findBrowserExecutable();
  const ffmpeg = findFfmpeg();
  if (browser && ffmpeg) {
    return { label: "Render host (Chrome + FFmpeg)", status: "ok", detail: `browser + ffmpeg found`, core: true };
  }
  const missing = [!browser && "Chrome/Chromium", !ffmpeg && "FFmpeg"].filter(Boolean).join(" + ");
  return {
    label: "Render host (Chrome + FFmpeg)",
    status: "warn",
    detail: `missing ${missing} — delivery degrades to thumbnails only`,
    core: false,
  };
}

export function checkPlanningBrain(): DiagnosticCheck {
  const providerId = resolveProvider();
  const provider = PROVIDERS[providerId];
  if (provider.kind === "api") {
    const keyName = provider.apiKeyEnv;
    const configured = Boolean(keyName && process.env[keyName]);
    return configured
      ? {
          label: "Legacy provider",
          status: "ok",
          detail: `${providerId} (${keyName} set)`,
          core: false,
        }
      : {
          label: "Legacy provider",
          status: "fail",
          detail: `${providerId} selected but ${keyName ?? "its API key"} is missing`,
          core: false,
        };
  }
  return {
    label: "Legacy provider",
    status: "warn",
    detail: `${providerId} (key-free; ensure the CLI is installed and logged in)`,
    core: false,
  };
}

async function checkLunaWorker(): Promise<DiagnosticCheck> {
  if (resolveAuthorRoute() !== "luna-direct") {
    return {
      label: "Luna Codex worker",
      status: "warn",
      detail: "legacy-provider rollback route is selected",
      core: false,
    };
  }
  try {
    const health = await withTimeout(
      inspectLunaWorkerHealth(resolveLunaWorkerConfig()),
      8_000,
      () => ({ ok: false, status: "timed out" }),
    );
    if (!lunaWorkerHealthIsExact(health)) {
      return {
        label: "Luna Codex worker",
        status: "fail",
        detail: `${health.status ?? "not ready"} · model=${health.model ?? "missing"} · ` +
          `reasoning=${health.reasoningEffort ?? "missing"} · version=${health.version ?? "missing"}`,
        core: true,
      };
    }
    return {
      label: "Luna Codex worker",
      status: "ok",
      detail: `${health.model ?? "gpt-5.6-luna"} · ${health.version ?? "Codex CLI"} · authenticated`,
      core: true,
    };
  } catch (error) {
    return {
      label: "Luna Codex worker",
      status: "fail",
      detail: errMessage(error),
      core: true,
    };
  }
}

function checkHostedMcpContext(teamId?: string, userId?: string): DiagnosticCheck {
  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY);
  const oauthMissing = ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_REDIRECT_URI", "SLACK_STATE_SECRET"]
    .filter((key) => !process.env[key]);
  const connected = Boolean(teamId && userId && getSlackUserToken(teamId, userId));

  if (!hasOpenAi || oauthMissing.length > 0) {
    const gaps = [
      !hasOpenAi && "OPENAI_API_KEY",
      oauthMissing.length > 0 && `OAuth (${oauthMissing.join(", ")})`,
    ].filter(Boolean).join("; ");
    return {
      label: "Slack hosted MCP (context)",
      status: "warn",
      detail: `not fully configured: ${gaps} — the demo path still works without it`,
      core: false,
    };
  }
  return connected
    ? { label: "Slack hosted MCP (context)", status: "ok", detail: "configured · you're connected", core: false }
    : { label: "Slack hosted MCP (context)", status: "warn", detail: "configured · open /slack/install once to connect your account", core: false };
}

function checkTokenEncryption(): DiagnosticCheck {
  const raw = process.env.SLACK_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) {
    return {
      label: "Token encryption key",
      status: "warn",
      detail: "SLACK_TOKEN_ENCRYPTION_KEY not set (only needed to store hosted-MCP user tokens)",
      core: false,
    };
  }
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return key.length === 32
    ? { label: "Token encryption key", status: "ok", detail: "valid 32-byte key", core: false }
    : { label: "Token encryption key", status: "fail", detail: `must be 32 bytes (base64 or 64 hex); got ${key.length}`, core: false };
}

function checkDataDir(): DiagnosticCheck {
  try {
    const dir = dataDir();
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.diag-write-${Date.now()}`);
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
    return { label: "Data directory", status: "ok", detail: `writable: ${dir}`, core: true };
  } catch (error) {
    return { label: "Data directory", status: "fail", detail: errMessage(error), core: true };
  }
}

/** Run every service check. Resolves to a report; individual checks never throw. */
export async function runDiagnostics(input: DiagnosticsInput = {}): Promise<DiagnosticsReport> {
  const checks: DiagnosticCheck[] = [
    await checkSlackApi(input.client),
    await checkSequencesMcp(),
    checkRenderHost(),
    await checkLunaWorker(),
    ...(resolveAuthorRoute() === "legacy-provider" ? [checkPlanningBrain()] : []),
    checkHostedMcpContext(input.teamId, input.userId),
    checkTokenEncryption(),
    checkDataDir(),
  ];
  const healthy = checks.every((check) => !check.core || check.status !== "fail");
  return { checks, healthy };
}
