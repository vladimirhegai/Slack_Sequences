/**
 * Demo-operator debug toggle (`/sequences debug on|off`). When on, result
 * messages append an argument-free receipt trail (stage attempts/durations,
 * tool calls, fallback attribution) so a presenter can show judges exactly
 * what the pipeline did — without digging through Railway logs.
 *
 * One live workspace (hackathon sandbox) → a single global flag, persisted
 * with the same naive read/modify/write JSON idiom as jobStore.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./engine/projectTemplates.ts";

interface DebugFlags {
  showReceipts: boolean;
  updatedAt: string;
}

function flagsFile(): string {
  return path.join(dataDir(), "debug-flags.json");
}

function read(): DebugFlags {
  try {
    return JSON.parse(fs.readFileSync(flagsFile(), "utf8")) as DebugFlags;
  } catch {
    return { showReceipts: false, updatedAt: "" };
  }
}

export function isDebugEnabled(): boolean {
  return read().showReceipts;
}

export function setDebugEnabled(enabled: boolean): void {
  const file = flagsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(
      { showReceipts: enabled, updatedAt: new Date().toISOString() } satisfies DebugFlags,
      null,
      2,
    ) + "\n",
  );
}
