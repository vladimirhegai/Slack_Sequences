import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROVIDERS, type AgentProvider } from "@sequences/platform/providers";
import { createVideo } from "../src/orchestrator.ts";
import {
  activateLunaAssets,
  authorLunaComposition,
  confirmLunaComposition,
  loadLunaSession,
  parseLunaMotionIntent,
  reconcileLunaSessionAfterUndo,
  resolveAuthorRoute,
} from "../src/engine/lunaRoute.ts";
import { lunaWorkerHealthIsExact } from "../src/engine/lunaWorkerClient.ts";

const roots: string[] = [];
const originalOpenRouter = PROVIDERS["openrouter-api"];

afterEach(() => {
  PROVIDERS["openrouter-api"] = originalOpenRouter;
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const html = `<!doctype html>
<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"></head><body>
<main id="film" data-composition-id="route-proof" data-width="1920" data-height="1080" data-duration="6" data-start="0">
  <section id="problem" data-scene="problem" data-start="0" data-duration="3"><h1 id="problem-primary">Scattered</h1><div id="handoff-out"></div><img src="assets/luna/mark.svg" alt=""></section>
  <section id="solution" data-scene="solution" data-start="3" data-duration="3"><h1 id="solution-primary">Together</h1><div id="handoff-in"></div></section>
</main>
<script src="gsap.min.js"></script>
<script>const compositionId="route-proof";const master=gsap.timeline({paused:true});window.__timelines=window.__timelines||{};window.__timelines[compositionId]=master;window.__seek=(s)=>master.seek(s,false);</script>
</body></html>
`;

const assetSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>\n`;

const storyboard = [
  { id: "problem", title: "Problem", purpose: "Establish fragmentation", startSec: 0, durationSec: 3 },
  { id: "solution", title: "Solution", purpose: "Resolve into one state", startSec: 3, durationSec: 3 },
];

const intent = {
  version: 1,
  compositionId: "route-proof",
  durationSec: 6,
  creativeOwner: "single-luna-director-session",
  acts: [
    { sceneId: "problem", startSec: 0, endSec: 3, primarySelector: "#problem-primary" },
    { sceneId: "solution", startSec: 3, endSec: 6, primarySelector: "#solution-primary" },
  ],
  boundaries: [{
    id: "problem-solution",
    atSec: 3,
    fromScene: "problem",
    toScene: "solution",
    strategy: "object-match",
    mechanicalOwner: "authored",
    outgoingAnchorSelector: "#handoff-out",
    incomingAnchorSelector: "#handoff-in",
    cause: "The outgoing object docks into the resolved state.",
  }],
  cameraMoves: [],
  interactions: [],
  energyPeak: { startSec: 2.4, endSec: 3.4 },
  finalRestingHold: { startSec: 5, endSec: 6, primarySelector: "#solution-primary" },
  geometryPolicy: { measuredPairs: [["#handoff-out", "#handoff-in"]] },
};

function deliverable(relativePath: string, text: string) {
  const bytes = Buffer.from(text, "utf8");
  return {
    path: `deliverables/${relativePath}`,
    contentBase64: bytes.toString("base64"),
    sha256: sha256(bytes),
    size: bytes.length,
  };
}

async function fakeWorker(options: { assetSvg?: string; compositionHtml?: string } = {}): Promise<{
  url: string;
  requests: Array<{ authorization?: string; body: Record<string, unknown> }>;
  close(): Promise<void>;
}> {
  const requests: Array<{ authorization?: string; body: Record<string, unknown> }> = [];
  const responseHtml = options.compositionHtml ?? html;
  const responseAssetSvg = options.assetSvg ?? assetSvg;
  let latest: { jobId: string; operationId: string; runCount: number } | undefined;
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET") {
      if (!latest) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { code: "job_not_found", message: "missing" } }));
        return;
      }
      const payload = {
        jobId: latest.jobId,
        operationId: latest.operationId,
        runCount: latest.runCount,
        threadId: "019f5a36-c85c-7541-94d7-c474a8e26d33",
        status: "completed",
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
        codexVersion: "0.144.1",
        finalMessage: "Deliverables complete.",
        deliverables: [
          deliverable("composition.html", responseHtml),
          deliverable("storyboard.json", JSON.stringify({ storyboard }, null, 2) + "\n"),
          deliverable("motion-intent.json", JSON.stringify(intent, null, 2) + "\n"),
          deliverable("director-treatment.md", "# Treatment\nOne state becomes the next.\n"),
          deliverable("assets-manifest.json", JSON.stringify([{
            path: "assets/luna/mark.svg",
            purpose: "Persistent handoff mark",
            provenance: "agent-created",
            mediaType: "image/svg+xml",
            sha256: sha256(Buffer.from(responseAssetSvg)),
          }], null, 2) + "\n"),
          deliverable("assets/luna/mark.svg", responseAssetSvg),
        ],
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    requests.push({ authorization: request.headers.authorization, body });
    latest = {
      jobId: String(body.jobId ?? "luna-route-proof"),
      operationId: String(body.operationId),
      runCount: requests.length,
    };
    response.writeHead(202, { "content-type": "application/json" });
    response.end(JSON.stringify({ ...latest, status: "queued" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())),
  };
}

describe("Luna direct route", () => {
  it("is the default while an explicit provider preserves the legacy rollback", () => {
    expect(resolveAuthorRoute()).toBe("luna-direct");
    expect(resolveAuthorRoute("openrouter-api")).toBe("legacy-provider");
    expect(resolveAuthorRoute(undefined, { SLACK_SEQUENCES_AUTHOR_ROUTE: "legacy-provider" }))
      .toBe("legacy-provider");
    expect(resolveAuthorRoute(undefined, { SLACK_SEQUENCES_AUTHOR_ROUTE: "openrouter" }))
      .toBe("legacy-provider");
  });

  it("requires the exact authenticated Luna/high worker health envelope", () => {
    expect(lunaWorkerHealthIsExact({
      ok: true,
      status: "ready",
      version: "0.144.1",
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      authenticated: true,
    })).toBe(true);
    expect(lunaWorkerHealthIsExact({
      ok: true,
      version: "0.144.1",
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
      authenticated: true,
    })).toBe(false);
    expect(lunaWorkerHealthIsExact({
      ok: true,
      version: "0.144.1",
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      authenticated: false,
    })).toBe(false);
  });

  it("runs an ordinary create through Luna without entering OpenRouter", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-orchestrator-"));
    roots.push(root);
    const worker = await fakeWorker();
    vi.stubEnv("SLACK_SEQUENCES_DATA_DIR", root);
    vi.stubEnv("SLACK_SEQUENCES_LUNA_WORKER_URL", worker.url);
    vi.stubEnv(
      "SLACK_SEQUENCES_LUNA_WORKER_TOKEN",
      "test-worker-token-that-is-at-least-thirty-two-characters",
    );
    const complete = vi.fn(async () => {
      throw new Error("OpenRouter must not run on the Luna route");
    });
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "forbidden OpenRouter test double",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    PROVIDERS["openrouter-api"] = provider;
    try {
      const result = await createVideo({
        jobId: "luna-default-no-openrouter",
        product: "Harborview",
        brandName: "Harborview",
        whatShipped: "Feedback routing",
        lengthSec: 6,
        render: false,
        preferMcp: false,
        allowDeterministicFallback: false,
      });
      expect(result.authorRoute).toBe("luna-direct");
      expect(result.provider).toBe("codex-cli");
      expect(complete).not.toHaveBeenCalled();
      expect(worker.requests).toHaveLength(2);
      expect(loadLunaSession(result.projectDir)).toMatchObject({
        threadId: "019f5a36-c85c-7541-94d7-c474a8e26d33",
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
      });
    } finally {
      await worker.close();
    }
  }, 60_000);

  it("validates the director's semantic subjects and declared timing without choosing motion", () => {
    expect(parseLunaMotionIntent(JSON.stringify(intent), html, storyboard).compositionId)
      .toBe("route-proof");
    expect(() => parseLunaMotionIntent(
      JSON.stringify({
        ...intent,
        acts: [
          { ...intent.acts[0], primarySelector: ".missing" },
          intent.acts[1],
        ],
      }),
      html,
      storyboard,
    )).toThrow(/matches no element/);
  });

  it("preserves exact raw source bytes, hashes approved assets, and persists the exact thread", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-route-"));
    roots.push(root);
    const projectDir = path.join(root, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    const reference = path.join(root, "brand.png");
    fs.writeFileSync(reference, Buffer.from("approved-brand-bytes"));
    const worker = await fakeWorker();
    vi.stubEnv("SLACK_SEQUENCES_LUNA_WORKER_URL", worker.url);
    vi.stubEnv("SLACK_SEQUENCES_LUNA_WORKER_TOKEN", "test-worker-token-that-is-at-least-thirty-two-characters");
    try {
      const authored = await authorLunaComposition({
        projectDir,
        jobId: "luna-route-proof",
        facts: {
          version: 1,
          product: "Harborview",
          brandName: "Harborview",
          whatShipped: "Feedback routing",
          targetDurationSec: 6,
          provenance: {
            source: "slack-user-and-authorized-workspace-context",
            unsupportedClaimsAllowed: false,
          },
        },
        assetReferencePaths: [reference],
        assetReferenceRoot: root,
      });
      expect(authored.draft.html).toBe(html);
      expect(fs.readFileSync(
        path.join(authored.runDir, "deliverables", "composition.html"),
        "utf8",
      )).toBe(html);
      expect(authored.rawSourceSha256).toBe(sha256(Buffer.from(html)));
      expect(authored.assetFiles).toEqual([
        { relativePath: "mark.svg", bytes: Buffer.from(assetSvg) },
      ]);
      expect(JSON.parse(fs.readFileSync(path.join(authored.runDir, "host-assets.json"), "utf8")))
        .toMatchObject({
          version: 1,
          assets: [{ path: "assets/luna/mark.svg", verifiedSha256: sha256(Buffer.from(assetSvg)) }],
        });
      const sentFiles = worker.requests[0]!.body.files as Array<{ path: string; sha256: string }>;
      expect(sentFiles.some((file) => file.path.startsWith("inputs/brand-assets/"))).toBe(true);
      expect(sentFiles.find((file) => file.path.startsWith("inputs/brand-assets/"))?.sha256)
        .toBe(sha256(Buffer.from("approved-brand-bytes")));
      expect(worker.requests[0]!.authorization).toMatch(/^Bearer /);

      fs.mkdirSync(path.join(projectDir, "composition"), { recursive: true });
      fs.writeFileSync(path.join(projectDir, "composition", "index.html"), html);
      fs.writeFileSync(
        path.join(projectDir, "composition", "manifest.json"),
        JSON.stringify({ revision: 1 }) + "\n",
      );
      confirmLunaComposition(projectDir, authored);
      expect(loadLunaSession(projectDir)).toMatchObject({
        workerJobId: "luna-route-proof",
        threadId: "019f5a36-c85c-7541-94d7-c474a8e26d33",
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
        latestRawSourceSha256: authored.rawSourceSha256,
        committedRevision: 1,
      });

      const revisionTwoHtml = `${html}\n<!-- revision two -->\n`;
      fs.writeFileSync(path.join(projectDir, "composition", "index.html"), revisionTwoHtml);
      fs.writeFileSync(
        path.join(projectDir, "composition", "manifest.json"),
        JSON.stringify({ revision: 2 }) + "\n",
      );
      confirmLunaComposition(projectDir, {
        ...authored,
        rawSourceSha256: sha256(Buffer.from(revisionTwoHtml)),
        artifactFingerprint: sha256(Buffer.from(`revision-two:${revisionTwoHtml}`)),
        worker: {
          ...authored.worker,
          operationId: "b".repeat(64),
          runCount: 2,
        },
      });
      fs.writeFileSync(path.join(projectDir, "composition", "index.html"), html);
      fs.writeFileSync(
        path.join(projectDir, "composition", "manifest.json"),
        JSON.stringify({ revision: 1 }) + "\n",
      );
      expect(reconcileLunaSessionAfterUndo(projectDir)).toBe(true);
      expect(loadLunaSession(projectDir)?.committedRevision).toBe(1);
    } finally {
      await worker.close();
    }
  });

  it("rolls Luna asset activation back transactionally", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-assets-"));
    roots.push(root);
    const old = path.join(root, "assets", "luna", "mark.svg");
    fs.mkdirSync(path.dirname(old), { recursive: true });
    fs.writeFileSync(old, "old");
    const transaction = activateLunaAssets(root, [
      { relativePath: "mark.svg", bytes: Buffer.from("new") },
    ]);
    expect(fs.readFileSync(old, "utf8")).toBe("new");
    transaction.rollback();
    expect(fs.readFileSync(old, "utf8")).toBe("old");
  });

  it("rejects symbolic-link asset intake before contacting Luna", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-symlink-"));
    roots.push(root);
    const target = path.join(root, "target.png");
    const link = path.join(root, "link.png");
    fs.writeFileSync(target, "bytes");
    try {
      fs.symlinkSync(target, link, "file");
    } catch {
      return;
    }
    await expect(authorLunaComposition({
      projectDir: path.join(root, "project"),
      jobId: "symlink-proof",
      facts: {
        version: 1,
        product: "Proof",
        brandName: "Proof",
        whatShipped: "Proof",
        targetDurationSec: 6,
        provenance: {
          source: "slack-user-and-authorized-workspace-context",
          unsupportedClaimsAllowed: false,
        },
      },
      assetReferencePaths: [link],
      assetReferenceRoot: root,
    })).rejects.toThrow(/approved regular file/);
  });

  it("rejects regular asset files outside the channel-approved root", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-root-boundary-"));
    roots.push(root);
    const approved = path.join(root, "approved");
    fs.mkdirSync(approved);
    const outside = path.join(root, "outside.png");
    fs.writeFileSync(outside, "not approved");
    await expect(authorLunaComposition({
      projectDir: path.join(root, "project"),
      jobId: "root-boundary-proof",
      facts: {
        version: 1,
        product: "Proof",
        brandName: "Proof",
        whatShipped: "Proof",
        targetDurationSec: 6,
        provenance: {
          source: "slack-user-and-authorized-workspace-context",
          unsupportedClaimsAllowed: false,
        },
      },
      assetReferencePaths: [outside],
      assetReferenceRoot: approved,
    })).rejects.toThrow(/outside the approved host root/);
  });

  it("rejects active SVG payloads before host commit", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-active-asset-"));
    roots.push(root);
    const activeSvg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`;
    const worker = await fakeWorker({ assetSvg: activeSvg });
    vi.stubEnv("SLACK_SEQUENCES_LUNA_WORKER_URL", worker.url);
    vi.stubEnv("SLACK_SEQUENCES_LUNA_WORKER_TOKEN", "test-worker-token-that-is-at-least-thirty-two-characters");
    try {
      await expect(authorLunaComposition({
        projectDir: path.join(root, "project"),
        jobId: "active-asset-proof",
        facts: {
          version: 1,
          product: "Proof",
          brandName: "Proof",
          whatShipped: "Proof",
          targetDurationSec: 6,
          provenance: {
            source: "slack-user-and-authorized-workspace-context",
            unsupportedClaimsAllowed: false,
          },
        },
      })).rejects.toThrow(/active or external content/);
    } finally {
      await worker.close();
    }
  });
});
