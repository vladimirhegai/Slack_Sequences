/**
 * Managed headless-browser lifecycle.
 *
 * Every Sequences-owned puppeteer launch (browser QA, thumbnails, temporal
 * inspector, brand capture, browser tests) goes through `launchHeadlessBrowser`
 * so an interrupted gate or a hard-killed test worker can never permanently
 * strand a Chromium tree on the operator's machine:
 *
 *  1. every launch is TAGGED: its `--user-data-dir` lives under
 *     `<tmp>/sequences-headless-profiles/`, so a Sequences headless browser is
 *     identifiable from its command line alone;
 *  2. a process-exit hook force-kills any still-tracked browser (covers
 *     process.exit / uncaught exceptions; puppeteer's own SIGINT/SIGTERM
 *     hooks cover signals);
 *  3. `sweepOrphanBrowsers()` reaps what nothing in-process can: browsers
 *     whose parent died with SIGKILL (vitest fork timeouts, killed CLIs).
 *     It also recognizes LEGACY orphans — headless puppeteer browsers using
 *     the default `puppeteer_dev_chrome_profile` temp profile (e.g. the
 *     HyperFrames producer's render browser) whose parent is gone.
 *
 * `npm run browsers:clean --workspace @sequences/slack` runs the sweeper from
 * the terminal (see scripts/cleanupBrowsers.ts).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { Browser, LaunchOptions } from "puppeteer-core";

/** Marker every managed launch carries in its command line (user-data-dir). */
export const BROWSER_PROFILE_MARKER = "sequences-headless-profiles";

export function browserProfileRoot(): string {
  return path.join(os.tmpdir(), BROWSER_PROFILE_MARKER);
}

const tracked = new Set<Browser>();
const trackedProfiles = new Map<Browser, string>();
let exitHookInstalled = false;
let profileCounter = 0;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    // Synchronous last resort: browser.close() is not awaitable here.
    for (const browser of tracked) {
      try {
        browser.process()?.kill("SIGKILL");
      } catch {
        // already gone
      }
    }
    for (const dir of trackedProfiles.values()) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // locked on Windows while chrome dies — the next sweep finishes it
      }
    }
  });
}

/**
 * Launch a tracked, tagged headless browser. Callers keep their ordinary
 * `finally { await browser.close(); }` — tracking is released automatically
 * on disconnect and the profile dir is deleted.
 */
export async function launchHeadlessBrowser(options: LaunchOptions): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default;
  installExitHook();
  const profileDir = path.join(
    browserProfileRoot(),
    `${process.pid}-${++profileCounter}-${Math.random().toString(36).slice(2, 8)}`,
  );
  fs.mkdirSync(profileDir, { recursive: true });
  const args = [...(options.args ?? [])];
  if (!args.some((arg) => arg.startsWith("--user-data-dir="))) {
    args.push(`--user-data-dir=${profileDir}`);
  }
  const browser = await puppeteer.launch({ headless: true, ...options, args });
  tracked.add(browser);
  trackedProfiles.set(browser, profileDir);
  browser.once("disconnected", () => {
    tracked.delete(browser);
    trackedProfiles.delete(browser);
    // Give chrome a beat to release file locks, then remove the profile.
    setTimeout(() => {
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
      } catch {
        // the sweeper's stale-profile pass finishes it
      }
    }, 250).unref?.();
  });
  return browser;
}

interface ProcessInfo {
  pid: number;
  ppid: number;
  command: string;
}

function listBrowserProcesses(): ProcessInfo[] {
  try {
    if (process.platform === "win32") {
      const script =
        "Get-CimInstance Win32_Process -Filter \"Name like '%chrome%' or Name like '%msedge%' or Name like '%chromium%'\" | " +
        "Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress";
      const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        encoding: "utf8",
        timeout: 30_000,
        windowsHide: true,
      });
      if (result.status !== 0 || !result.stdout.trim()) return [];
      const parsed = JSON.parse(result.stdout) as
        | { ProcessId: number; ParentProcessId: number; CommandLine: string | null }
        | Array<{ ProcessId: number; ParentProcessId: number; CommandLine: string | null }>;
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows.map((row) => ({
        pid: row.ProcessId,
        ppid: row.ParentProcessId,
        command: row.CommandLine ?? "",
      }));
    }
    const result = spawnSync("ps", ["-eo", "pid=,ppid=,args="], {
      encoding: "utf8",
      timeout: 30_000,
    });
    if (result.status !== 0) return [];
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
        return match
          ? { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? "" }
          : undefined;
      })
      .filter((row): row is ProcessInfo => Boolean(row));
  } catch {
    return [];
  }
}

function processAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = alive but not ours; ESRCH = gone.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface SweepOptions {
  /**
   * Also kill TAGGED browsers whose parent is still alive (a deliberate
   * "kill everything Sequences launched" from the cleanup script). Legacy
   * untagged browsers are only ever reaped as orphans.
   */
  includeLive?: boolean;
  log?: (line: string) => void;
}

/**
 * Reap stranded headless browsers. Safe by construction:
 *  - tagged (ours): killed when their parent process is dead — or always
 *    with `includeLive` (never the current process's own tracked browsers);
 *  - legacy: `--headless` puppeteer browsers (default temp profile or
 *    remote-debugging pipe) killed ONLY when their parent is dead — an
 *    orphan's control pipe has no controller left, so nothing can miss it.
 * Also deletes profile dirs whose launching pid is gone. Returns the number
 * of processes killed.
 */
export async function sweepOrphanBrowsers(options: SweepOptions = {}): Promise<number> {
  const log = options.log ?? (() => undefined);
  const ownPids = new Set<number>();
  for (const browser of tracked) {
    const pid = browser.process()?.pid;
    if (pid) ownPids.add(pid);
  }
  let killed = 0;
  for (const info of listBrowserProcesses()) {
    if (info.pid === process.pid || ownPids.has(info.pid)) continue;
    const tagged = info.command.includes(BROWSER_PROFILE_MARKER);
    const legacyHeadless =
      /--headless/.test(info.command) &&
      (info.command.includes("puppeteer_dev_chrome_profile") ||
        info.command.includes("--remote-debugging-pipe"));
    if (!tagged && !legacyHeadless) continue;
    const orphaned = !processAlive(info.ppid);
    if (!orphaned && !(tagged && options.includeLive)) continue;
    try {
      process.kill(info.pid, "SIGKILL");
      killed += 1;
      log(`killed ${info.pid} (${tagged ? "sequences" : "legacy puppeteer"}${orphaned ? ", orphaned" : ""})`);
    } catch {
      // raced its own exit — fine
    }
  }
  // Stale profile dirs: name is "<pid>-<n>-<rand>"; reap when the pid is gone.
  const root = browserProfileRoot();
  if (fs.existsSync(root)) {
    for (const name of fs.readdirSync(root)) {
      const ownerPid = Number(name.split("-")[0]);
      if (ownerPid === process.pid || processAlive(ownerPid)) continue;
      try {
        fs.rmSync(path.join(root, name), { recursive: true, force: true });
      } catch {
        // still locked — next sweep
      }
    }
  }
  return killed;
}
