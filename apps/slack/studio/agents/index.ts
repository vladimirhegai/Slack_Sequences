/**
 * Recipe Studio — agent session runner (plan §6).
 *
 * One conversation per workspace, provider switchable per message. The context
 * is composed identically for every provider (`context.ts`) so switching is
 * seamless. A Claude CLI turn edits workspace files directly; the studio is the
 * referee, so after the turn we RE-GATE the composition (the real production
 * gate) and stream the findings into the same feed both the operator and the
 * agent see. Transcript + provider receipts persist under `chat/`.
 */
import fs from "node:fs";
import path from "node:path";
import { loadWorkspace, saveWorkspace, workspaceProjectDir } from "../workspaces.ts";
import { recipeFragmentHash } from "../../src/engine/recipeContract.ts";
import { runOpenRouterTurn, type OpenRouterModel } from "./openrouter.ts";
import { runClaudeCliTurn } from "./cli.ts";
import { regateComposition, writeAgentMd } from "./context.ts";

export type AgentProviderId = "glm" | "deepseek-flash" | "claude-cli";
export const AGENT_PROVIDERS: AgentProviderId[] = ["glm", "deepseek-flash", "claude-cli"];

export interface ChatMessage {
  role: "operator" | "agent" | "system";
  provider?: AgentProviderId;
  text: string;
  at: string;
  images?: string[];
}

function transcriptFile(id: string): string {
  return path.join(workspaceProjectDir(id), "chat", "transcript.jsonl");
}

export function loadTranscript(id: string): ChatMessage[] {
  const file = transcriptFile(id);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChatMessage);
}

function appendTranscript(id: string, message: ChatMessage): void {
  const file = transcriptFile(id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(message) + "\n", "utf8");
}

/** Save uploaded ref images under refs/<msgId>/ (workspace-local, never exported). */
export function saveRefImages(
  id: string,
  msgId: string,
  images: Array<{ name: string; mimeType: string; base64: string }>,
): string[] {
  if (!images.length) return [];
  const dir = path.join(workspaceProjectDir(id), "refs", msgId);
  fs.mkdirSync(dir, { recursive: true });
  return images.map((img, index) => {
    const ext = (img.mimeType.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "");
    const rel = path.join("refs", msgId, `${String(index + 1).padStart(2, "0")}.${ext}`);
    fs.writeFileSync(path.join(workspaceProjectDir(id), rel), Buffer.from(img.base64, "base64"));
    return rel;
  });
}

export interface ChatTurnOptions {
  provider: AgentProviderId;
  message: string;
  images?: Array<{ mimeType: string; base64: string; name: string }>;
  onChunk: (text: string) => void;
}

/**
 * Run one chat turn end-to-end: persist the operator message, refresh AGENT.md,
 * dispatch to the provider (streaming), persist the reply, and — for the CLI
 * agent, which edits files — re-gate the composition and stream the findings.
 */
export async function runChatTurn(id: string, options: ChatTurnOptions): Promise<void> {
  const msgId = `${Date.now().toString(36)}`;
  const refImages = options.images
    ? saveRefImages(id, msgId, options.images)
    : [];
  appendTranscript(id, {
    role: "operator",
    text: options.message,
    at: new Date().toISOString(),
    ...(refImages.length ? { images: refImages } : {}),
  });
  writeAgentMd(id);

  let replyText = "";
  const stream = (chunk: string) => { replyText += chunk; options.onChunk(chunk); };

  if (options.provider === "claude-cli") {
    const promptWithRefs = refImages.length
      ? `${options.message}\n\nReference images in this workspace: ${refImages.join(", ")}`
      : options.message;
    await runClaudeCliTurn(id, promptWithRefs, stream);
    // The agent edited files — re-gate and report to the same feed.
    options.onChunk("\n\n_re-gating your edits…_\n");
    try {
      const gate = await regateComposition(id);
      const summary = gate.ok
        ? `✅ gate GREEN · ${gate.thumbnails} thumbnails${gate.warnings.length ? ` · ${gate.warnings.length} warning(s)` : ""}`
        : `❌ gate RED\n${gate.errors.slice(0, 8).map((e) => `  ✗ ${e}`).join("\n")}`;
      options.onChunk(summary);
      replyText += `\n\n${summary}`;
      // Mirror the re-gate into the workspace gate record so the UI badge updates.
      const workspace = loadWorkspace(id);
      workspace.gate = {
        ok: gate.ok,
        errors: gate.errors,
        warnings: gate.warnings,
        gatedAt: new Date().toISOString(),
        fragmentHash: recipeFragmentHash(""),
        thumbnails: gate.ok
          ? fs.readdirSync(path.join(workspaceProjectDir(id), "build", "thumbs")).filter((f) => f.endsWith(".png"))
          : [],
      };
      saveWorkspace(workspace);
    } catch (error) {
      options.onChunk(`\n[re-gate error] ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    const turn = await runOpenRouterTurn(
      id,
      options.message,
      options.provider as OpenRouterModel,
      options.images ?? [],
    );
    if (turn.visionDropped) {
      options.onChunk("_[this model can't see images — attached refs were dropped]_\n\n");
    }
    stream(turn.reply);
  }

  appendTranscript(id, {
    role: "agent",
    provider: options.provider,
    text: replyText,
    at: new Date().toISOString(),
  });
}
