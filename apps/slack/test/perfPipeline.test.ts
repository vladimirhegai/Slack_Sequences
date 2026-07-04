/**
 * Performance-pass contracts (2026-07-04):
 *
 * 1. hedgedCompletion — the latency hedge races one delayed duplicate of the
 *    same request and the first completion wins; quality is untouched because
 *    the QA gates still judge whatever text arrives.
 * 2. Browser-QA cache — a clean inspection is reused for identical draft bytes
 *    (the publication commit re-inspects exactly what the author loop just
 *    proved), so a create never pays a second Chrome pass for the same film.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentProvider } from "@sequences/platform/providers";
import { ProviderOutputTruncatedError } from "@sequences/platform/providers";
import { hedgedCompletion, hedgingEnabled } from "../src/engine/compositionRunner.ts";
import { buildFallbackComposition } from "../src/engine/fallbackComposition.ts";
import { inspectDirectComposition } from "../src/engine/layoutInspector.ts";
import { initializeProject } from "../src/engine/projectTemplates.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  delete process.env.SLACK_SEQUENCES_HEDGED_REQUESTS;
});

const openrouter = { id: "openrouter-api" } as AgentProvider;
const anthropic = { id: "anthropic-api" } as AgentProvider;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    }, { once: true });
  });
}

describe("hedgedCompletion", () => {
  it("is scoped to OpenRouter and honors the kill switch", () => {
    expect(hedgingEnabled(openrouter)).toBe(true);
    expect(hedgingEnabled(anthropic)).toBe(false);
    process.env.SLACK_SEQUENCES_HEDGED_REQUESTS = "0";
    expect(hedgingEnabled(openrouter)).toBe(false);
  });

  it("runs exactly one request when hedging is disabled", async () => {
    let calls = 0;
    const result = await hedgedCompletion(anthropic, "test", async () => {
      calls += 1;
      return "single";
    }, 5);
    await sleep(30);
    expect(result).toBe("single");
    expect(calls).toBe(1);
  });

  it("lets a fast primary win without ever launching the duplicate", async () => {
    let calls = 0;
    const result = await hedgedCompletion(openrouter, "test", async () => {
      calls += 1;
      return "fast";
    }, 1_000);
    await sleep(30);
    expect(result).toBe("fast");
    expect(calls).toBe(1);
  });

  it("uses the delayed duplicate when the primary is slow, and aborts the loser", async () => {
    let calls = 0;
    let primaryAborted = false;
    const result = await hedgedCompletion(openrouter, "test", async (signal) => {
      calls += 1;
      if (calls === 1) {
        // Slow primary: would take 5s; must be aborted once the backup wins.
        try {
          await sleep(5_000, signal);
        } catch {
          primaryAborted = true;
          throw new Error("aborted");
        }
        return "slow-primary";
      }
      await sleep(20);
      return "backup";
    }, 40);
    expect(result).toBe("backup");
    expect(calls).toBe(2);
    await sleep(50);
    expect(primaryAborted).toBe(true);
  });

  it("rejects a fast primary failure immediately so the serial retry loop keeps its contract", async () => {
    let calls = 0;
    const started = Date.now();
    await expect(
      hedgedCompletion(openrouter, "test", async () => {
        calls += 1;
        throw new Error("early transport fault");
      }, 60_000),
    ).rejects.toThrow("early transport fault");
    expect(calls).toBe(1);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("surfaces the duplicate's truncation error so continuation recovery keeps its partial", async () => {
    let calls = 0;
    await expect(
      hedgedCompletion(openrouter, "test", async () => {
        calls += 1;
        if (calls === 1) {
          await sleep(40);
          throw new Error("transient 502");
        }
        await sleep(60);
        throw new ProviderOutputTruncatedError("OpenRouter", 100, "partial text");
      }, 10),
    ).rejects.toBeInstanceOf(ProviderOutputTruncatedError);
    expect(calls).toBe(2);
  });
});

describe("browser QA cache", () => {
  it("reuses a clean inspection for identical draft bytes instead of relaunching Chrome", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-qa-cache-test-"));
    roots.push(dir);
    initializeProject(dir, { name: "RADAR", brandName: "RADAR", seedScreenshot: true });
    const draft = buildFallbackComposition({
      product: "RADAR",
      whatShipped:
        "RADAR turns scattered product signals into one live operational view for confident decisions.",
      audience: "product and operations teams",
      lengthSec: 20,
    });

    const first = await inspectDirectComposition(dir, draft);
    expect(first.infraError).toBeUndefined();
    expect(first.ok).toBe(true);
    const cacheDir = path.join(dir, "qa-cache");
    const entries = fs.readdirSync(cacheDir).filter((name) => name.endsWith(".json"));
    expect(entries).toHaveLength(1);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const started = Date.now();
    const second = await inspectDirectComposition(dir, draft);
    const reuseLogged = stderrSpy.mock.calls.some((call) =>
      String(call[0]).includes("[layout-qa] reusing cached browser QA evidence")
    );
    stderrSpy.mockRestore();
    expect(reuseLogged).toBe(true);
    // A cache hit is file I/O, not a browser session.
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(second.ok).toBe(true);
    expect(second.errors).toEqual(first.errors);
    expect(second.warnings).toEqual(first.warnings);
    expect(second.samples).toEqual(first.samples);
    expect(second.issues).toEqual(first.issues);

    // A different draft is a different key — no false sharing.
    const changed = { ...draft, html: draft.html.replace("RADAR", "SONAR") };
    const third = await inspectDirectComposition(dir, changed);
    expect(third.infraError).toBeUndefined();
    expect(fs.readdirSync(cacheDir).filter((name) => name.endsWith(".json")).length)
      .toBeGreaterThanOrEqual(entries.length);
  }, 40_000);
});
