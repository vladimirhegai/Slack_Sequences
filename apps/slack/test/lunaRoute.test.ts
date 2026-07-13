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
  lunaDurationBounds,
  normalizeLunaSourceMechanics,
  parseLunaMotionIntent,
  reconcileLunaSessionAfterUndo,
  reviseLunaComposition,
  resolveAuthorRoute,
  selfReviewLunaComposition,
} from "../src/engine/lunaRoute.ts";
import { lunaWorkerHealthIsExact } from "../src/engine/lunaWorkerClient.ts";
import { validateLunaAssetPack } from "../src/engine/lunaAssetPack.ts";

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

const uiKitHtml = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>body{margin:0;background:#101114;color:#fff}</style></head><body><main id="route-card"><span id="route-value">Ready</span></main></body></html>\n`;

const assetPack = {
  version: 1,
  name: "Synthetic route UI",
  visualThesis: "One restrained release card carries the verified state.",
  tokens: { accent: "#8b9cff", background: "#101114" },
  components: [{
    id: "route-card",
    purpose: "Show the release state",
    rootSelector: "#route-card",
    states: [{ id: "ready", description: "The release is ready." }],
    parts: [{
      id: "route-value",
      selector: "#route-value",
      purpose: "Carry the verified value",
      morphAnchor: true,
    }],
  }],
  sourceEvidence: "Synthetic UI generated from the verified brief.",
};

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

async function fakeWorker(options: {
  assetSvg?: string;
  compositionHtml?: string;
  compositionHtmlByRunCount?: Readonly<Record<number, string>>;
  storyboardScenes?: unknown[];
  corruptRawEnvelopeHash?: boolean;
  corruptRawEnvelopeHashOnRunCount?: number;
  corruptMaterializedFingerprint?: boolean;
  invalidHtmlOnRunCount?: number;
  omitMotionIntentVersion?: boolean;
  finalRestingHoldSelectorAlias?: boolean;
} = {}): Promise<{
  url: string;
  requests: Array<{ authorization?: string; body: Record<string, unknown> }>;
  close(): Promise<void>;
}> {
  const requests: Array<{ authorization?: string; body: Record<string, unknown> }> = [];
  const responseHtml = options.compositionHtml ?? html;
  const responseAssetSvg = options.assetSvg ?? assetSvg;
  const runCounts = new Map<string, number>();
  let latest: {
    jobId: string;
    operationId: string;
    runCount: number;
    artifactContract: { id: string; requiredPaths: string[] };
    expectedBaseFingerprint: string | null;
  } | undefined;
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET") {
      if (!latest) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { code: "job_not_found", message: "missing" } }));
        return;
      }
      const aliasedIntent = options.finalRestingHoldSelectorAlias
        ? {
            ...intent,
            finalRestingHold: {
              startSec: intent.finalRestingHold.startSec,
              endSec: intent.finalRestingHold.endSec,
              selector: intent.finalRestingHold.primarySelector,
            },
          }
        : intent;
      const { version: _motionIntentVersion, ...motionIntentWithoutVersion } = aliasedIntent;
      const responseIntent = options.omitMotionIntentVersion ? motionIntentWithoutVersion : aliasedIntent;
      const directionDeliverables = [
        deliverable(
          "director-treatment.md",
          "# Treatment\nOne verified release signal becomes a calm, unified product state while the same visual anchor carries continuity across the cut.\n",
        ),
        deliverable(
          "storyboard.json",
          JSON.stringify({ storyboard: options.storyboardScenes ?? storyboard }, null, 2) + "\n",
        ),
      ];
      const syntheticPackDeliverables = [
        deliverable("asset-pack.json", JSON.stringify(assetPack, null, 2) + "\n"),
        deliverable("ui-kit.html", uiKitHtml),
        deliverable("assets-manifest.json", "[]\n"),
      ];
      const runHtml = options.compositionHtmlByRunCount?.[latest.runCount] ??
        (options.invalidHtmlOnRunCount === latest.runCount
          ? "<html><body>invalid</body></html>"
          : responseHtml);
      const filmDeliverables = [
        deliverable("composition.html", runHtml),
        deliverable(
          "storyboard.json",
          JSON.stringify({ storyboard: options.storyboardScenes ?? storyboard }, null, 2) + "\n",
        ),
        deliverable("motion-intent.json", JSON.stringify(responseIntent, null, 2) + "\n"),
        deliverable("director-treatment.md", "# Treatment\nOne state becomes the next.\n"),
        deliverable("assets-manifest.json", JSON.stringify([{
          path: "assets/luna/mark.svg",
          purpose: "Persistent handoff mark",
          provenance: "agent-created",
          mediaType: "image/svg+xml",
          sha256: sha256(Buffer.from(responseAssetSvg)),
        }], null, 2) + "\n"),
        deliverable("assets/luna/mark.svg", responseAssetSvg),
      ];
      const required = new Set(latest.artifactContract.requiredPaths);
      const deliverables = required.has("deliverables/composition.html")
        ? filmDeliverables
        : required.has("deliverables/asset-pack.json")
          ? [...directionDeliverables, ...syntheticPackDeliverables]
          : directionDeliverables;
      const artifactContractSha256 = sha256(Buffer.from(JSON.stringify({
        id: latest.artifactContract.id,
        requiredPaths: [...latest.artifactContract.requiredPaths].sort(),
      })));
      const finalMessage = JSON.stringify({
        decision: "replace",
        baseFingerprint: latest.expectedBaseFingerprint,
        files: deliverables.map((file) => ({
          path: file.path,
          action: "replace",
          content: Buffer.from(file.contentBase64, "base64").toString("utf8"),
          copyFromInput: null,
          sha256: null,
        })),
      });
      const payload = {
        jobId: latest.jobId,
        operationId: latest.operationId,
        runCount: latest.runCount,
        threadId: "019f5a36-c85c-7541-94d7-c474a8e26d33",
        status: "completed",
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
        codexVersion: "0.144.1",
        artifactContractSha256,
        rawEnvelopeSha256: options.corruptRawEnvelopeHash ||
            options.corruptRawEnvelopeHashOnRunCount === latest.runCount
          ? "1".repeat(64)
          : sha256(Buffer.from(finalMessage)),
        materializedFingerprint: options.corruptMaterializedFingerprint
          ? "2".repeat(64)
          : sha256(Buffer.from(JSON.stringify({
            contractSha256: artifactContractSha256,
            files: deliverables
              .map((file) => ({ path: file.path, sha256: file.sha256 }))
              .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
          }))),
        rolloutSha256: String(latest.runCount).repeat(64),
        rolloutResponseItems: 4,
        finalMessage,
        deliverables,
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    requests.push({ authorization: request.headers.authorization, body });
    const jobId = String(body.jobId ?? "luna-route-proof");
    const runCount = (runCounts.get(jobId) ?? 0) + 1;
    runCounts.set(jobId, runCount);
    latest = {
      jobId,
      operationId: String(body.operationId),
      runCount,
      artifactContract: body.artifactContract as { id: string; requiredPaths: string[] },
      expectedBaseFingerprint: typeof body.expectedBaseFingerprint === "string"
        ? body.expectedBaseFingerprint
        : null,
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
      artifactProtocol: "luna-tool-less-artifact-v2",
      artifactSchemaSha256: "7fa551fb261b6dee573aca74507202f5ab0b30ca00fe60cd04141dea8dfe104d",
      permissionProfileSha256: "ebd9f548aaa2f1d48df15ea1e124462350791ede65267f7677e9a834fa0060c6",
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
      // Direction + build + optional rendered self-review stay on one thread.
      expect(worker.requests).toHaveLength(3);
      expect(result.stages).toEqual(expect.arrayContaining([
        expect.objectContaining({ stage: "luna-direction", attempts: 1 }),
        expect.objectContaining({ stage: "luna-build", attempts: 1 }),
      ]));
      expect(loadLunaSession(result.projectDir)).toMatchObject({
        threadId: "019f5a36-c85c-7541-94d7-c474a8e26d33",
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
      });
    } finally {
      await worker.close();
    }
  }, 60_000);

  it("persists the paid worker receipt before rejecting bad provenance hashes", async () => {
    for (const [option, message] of [
      ["corruptRawEnvelopeHash", /raw artifact-envelope hash/],
      ["corruptMaterializedFingerprint", /materialized fingerprint/],
    ] as const) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-provenance-"));
      roots.push(root);
      const worker = await fakeWorker({ [option]: true });
      vi.stubEnv("SLACK_SEQUENCES_LUNA_WORKER_URL", worker.url);
      vi.stubEnv("SLACK_SEQUENCES_LUNA_WORKER_TOKEN", "test-worker-token-that-is-at-least-thirty-two-characters");
      try {
        await expect(authorLunaComposition({
          projectDir: root,
          jobId: `luna-${option}`,
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
        })).rejects.toThrow(message);
        const runsRoot = path.join(root, "planning", "luna", "runs");
        const runs = fs.readdirSync(runsRoot);
        expect(runs).toHaveLength(1);
        expect(fs.existsSync(path.join(runsRoot, runs[0]!, "worker-receipt.json"))).toBe(true);
        expect(fs.existsSync(path.join(runsRoot, runs[0]!, "worker-response.json"))).toBe(true);
      } finally {
        await worker.close();
      }
    }
  });

  it("keeps a build integrity failure terminal instead of buying an authored repair", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-integrity-terminal-"));
    roots.push(root);
    const worker = await fakeWorker({ corruptRawEnvelopeHashOnRunCount: 2 });
    vi.stubEnv("SLACK_SEQUENCES_DATA_DIR", root);
    vi.stubEnv("SLACK_SEQUENCES_LUNA_WORKER_URL", worker.url);
    vi.stubEnv(
      "SLACK_SEQUENCES_LUNA_WORKER_TOKEN",
      "test-worker-token-that-is-at-least-thirty-two-characters",
    );
    try {
      await expect(createVideo({
        jobId: "luna-integrity-terminal",
        product: "Harborview",
        whatShipped: "Feedback routing",
        lengthSec: 6,
        render: false,
        preferMcp: false,
        allowDeterministicFallback: false,
      })).rejects.toThrow(/raw artifact-envelope hash/i);
      // Direction + corrupt build only. A third request would be an unsafe
      // attempt to ask Luna to repair host transport/integrity evidence.
      expect(worker.requests).toHaveLength(2);
    } finally {
      await worker.close();
    }
  }, 30_000);

  it("rejects semantically valid prepared-pack byte drift against its accepted fingerprint", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-pack-fingerprint-"));
    roots.push(root);
    const deliverablesDir = path.join(root, "accepted-pack", "deliverables");
    fs.mkdirSync(deliverablesDir, { recursive: true });
    const packFiles = new Map<string, Buffer>([
      ["deliverables/asset-pack.json", Buffer.from(JSON.stringify(assetPack, null, 2) + "\n")],
      ["deliverables/ui-kit.html", Buffer.from(uiKitHtml)],
      ["deliverables/assets-manifest.json", Buffer.from("[]\n")],
    ]);
    for (const [filePath, bytes] of packFiles) {
      const destination = path.join(deliverablesDir, filePath.slice("deliverables/".length));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes);
    }
    const acceptedFingerprint = validateLunaAssetPack(packFiles).fingerprint;
    const worker = await fakeWorker();
    vi.stubEnv("SLACK_SEQUENCES_LUNA_WORKER_URL", worker.url);
    vi.stubEnv(
      "SLACK_SEQUENCES_LUNA_WORKER_TOKEN",
      "test-worker-token-that-is-at-least-thirty-two-characters",
    );
    const facts = {
      version: 1 as const,
      product: "Harborview",
      brandName: "Harborview",
      whatShipped: "Feedback routing",
      targetDurationSec: 6,
      provenance: {
        source: "slack-user-and-authorized-workspace-context" as const,
        unsupportedClaimsAllowed: false as const,
      },
    };
    try {
      await authorLunaComposition({
        projectDir: path.join(root, "first-film"),
        jobId: "luna-pack-fingerprint-valid",
        facts,
        preparedAssetPackDir: deliverablesDir,
        preparedAssetPackRoot: root,
        preparedAssetPackFingerprint: acceptedFingerprint,
      });
      expect(worker.requests).toHaveLength(2);

      fs.writeFileSync(
        path.join(deliverablesDir, "ui-kit.html"),
        uiKitHtml.replace("Ready", "Still ready"),
      );
      await expect(authorLunaComposition({
        projectDir: path.join(root, "second-film"),
        jobId: "luna-pack-fingerprint-drift",
        facts,
        preparedAssetPackDir: deliverablesDir,
        preparedAssetPackRoot: root,
        preparedAssetPackFingerprint: acceptedFingerprint,
      })).rejects.toThrow(/accepted fingerprint/);
      expect(worker.requests).toHaveLength(2);
    } finally {
      await worker.close();
    }
  }, 30_000);

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

  it("accepts a boundary that carries nothing while validating declared anchors", () => {
    const hardCutBoundary = {
      id: "problem-solution",
      atSec: 3,
      fromScene: "problem",
      toScene: "solution",
      strategy: "motivated-hard-cut",
      mechanicalOwner: "authored",
      cause: "The register changes deliberately; nothing carries across.",
    };
    expect(parseLunaMotionIntent(
      JSON.stringify({ ...intent, boundaries: [hardCutBoundary] }),
      html,
      storyboard,
    ).boundaries[0]!.outgoingAnchorSelector).toBeUndefined();
    expect(() => parseLunaMotionIntent(
      JSON.stringify({
        ...intent,
        boundaries: [{ ...hardCutBoundary, outgoingAnchorSelector: "#does-not-exist" }],
      }),
      html,
      storyboard,
    )).toThrow(/matches no element/);
  });

  it("accepts any duration inside the envelope window and rejects outside it", () => {
    expect(lunaDurationBounds({ targetDurationSec: 16, minDurationSec: 12, maxDurationSec: 19 }))
      .toEqual({ minSec: 12, maxSec: 19 });
    expect(lunaDurationBounds({ targetDurationSec: 16 })).toEqual({ minSec: 16, maxSec: 16 });
    expect(() => lunaDurationBounds({ targetDurationSec: 20, minDurationSec: 12, maxDurationSec: 19 }))
      .toThrow(/duration window/);
    expect(() => lunaDurationBounds({ targetDurationSec: 0 })).toThrow(/duration window/);
  });

  it("supplies omitted v1 protocol metadata but rejects explicit unknown motion-intent versions", () => {
    const { version: _version, ...withoutVersion } = intent;
    expect(parseLunaMotionIntent(JSON.stringify(withoutVersion), html, storyboard))
      .toMatchObject({ version: 1, compositionId: "route-proof" });
    expect(() => parseLunaMotionIntent(
      JSON.stringify({
        ...withoutVersion,
        acts: [
          { ...intent.acts[0], primarySelector: ".missing" },
          intent.acts[1],
        ],
      }),
      html,
      storyboard,
    )).toThrow(/matches no element/);
    for (const version of [2, "1", null]) {
      expect(() => parseLunaMotionIntent(
        JSON.stringify({ ...intent, version }),
        html,
        storyboard,
      )).toThrow(/must use version 1/);
    }
  });

  it("canonicalizes the incident final-hold selector alias in memory while preserving its raw bytes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-hold-alias-"));
    roots.push(root);
    const projectDir = path.join(root, "project");
    const worker = await fakeWorker({ finalRestingHoldSelectorAlias: true });
    vi.stubEnv("SLACK_SEQUENCES_LUNA_WORKER_URL", worker.url);
    vi.stubEnv(
      "SLACK_SEQUENCES_LUNA_WORKER_TOKEN",
      "test-worker-token-that-is-at-least-thirty-two-characters",
    );
    const aliasedIntent = {
      ...intent,
      finalRestingHold: {
        startSec: intent.finalRestingHold.startSec,
        endSec: intent.finalRestingHold.endSec,
        selector: intent.finalRestingHold.primarySelector,
      },
    };
    const rawIntent = JSON.stringify(aliasedIntent, null, 2) + "\n";
    try {
      const authored = await authorLunaComposition({
        projectDir,
        jobId: "luna-final-hold-alias-proof",
        facts: {
          version: 1,
          product: "Relay",
          brandName: "Relay",
          whatShipped: "Incident routing",
          targetDurationSec: 6,
          provenance: {
            source: "slack-user-and-authorized-workspace-context",
            unsupportedClaimsAllowed: false,
          },
        },
      });

      expect(authored.intent.finalRestingHold.primarySelector).toBe("#solution-primary");
      expect(fs.readFileSync(
        path.join(authored.runDir, "deliverables", "motion-intent.json"),
        "utf8",
      )).toBe(rawIntent);
    } finally {
      await worker.close();
    }
  });

  it("normalizes only the proved composition's dotted timeline binding", () => {
    const invalid = html.replace(
      "window.__timelines[compositionId]=master",
      "window.__timelines.route-proof=master",
    );
    const normalized = normalizeLunaSourceMechanics(invalid, "route-proof");
    expect(normalized).toContain('window.__timelines["route-proof"]=master');
    expect(normalizeLunaSourceMechanics(normalized, "route-proof")).toBe(normalized);
    expect(normalizeLunaSourceMechanics(
      "window.__timelines.somewhereElse=master",
      "route-proof",
    )).toBe("window.__timelines.somewhereElse=master");
  });

  it("materializes inside the duration window, binds declared subjects, and normalizes typed cuts", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-window-"));
    roots.push(root);
    const worker = await fakeWorker({
      storyboardScenes: [
        { ...storyboard[0], cut: { version: 1, style: "dissolve" } },
        { ...storyboard[1], cut: { version: 1, style: "object-match", focalPartOut: "mark", focalPartIn: "mark" } },
      ],
    });
    vi.stubEnv("SLACK_SEQUENCES_LUNA_WORKER_URL", worker.url);
    vi.stubEnv("SLACK_SEQUENCES_LUNA_WORKER_TOKEN", "test-worker-token-that-is-at-least-thirty-two-characters");
    const facts = {
      version: 1 as const,
      product: "Harborview",
      brandName: "Harborview",
      whatShipped: "Feedback routing",
      provenance: {
        source: "slack-user-and-authorized-workspace-context" as const,
        unsupportedClaimsAllowed: false as const,
      },
    };
    try {
      // The film is 6.0s. A 5s target with a 4-7s accepted window takes it.
      const authored = await authorLunaComposition({
        projectDir: path.join(root, "windowed"),
        jobId: "luna-duration-window-proof",
        facts: { ...facts, targetDurationSec: 5, minDurationSec: 4, maxDurationSec: 7 },
      });
      expect(authored.intent.durationSec).toBe(6);
      expect(authored.draft.declaredPrimarySelectors).toEqual({
        problem: "#problem-primary",
        solution: "#solution-primary",
      });
      // Unknown style degrades to no cut; legacy names canonicalize.
      expect(authored.draft.storyboard[0]!.cut).toBeUndefined();
      expect(authored.draft.storyboard[1]!.cut).toMatchObject({ style: "match" });
      // Without a window the target stays exact, as on self-review/revision.
      await expect(authorLunaComposition({
        projectDir: path.join(root, "exact"),
        jobId: "luna-duration-exact-proof",
        facts: { ...facts, targetDurationSec: 5 },
      })).rejects.toThrow(/accepts 5-5s/);
    } finally {
      await worker.close();
    }
  });

  it("drops malformed optional camera declarations before direct publication", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-camera-shape-"));
    roots.push(root);
    const worker = await fakeWorker({
      storyboardScenes: [
        { ...storyboard[0], camera: { version: 1 } },
        storyboard[1],
      ],
    });
    vi.stubEnv("SLACK_SEQUENCES_LUNA_WORKER_URL", worker.url);
    vi.stubEnv("SLACK_SEQUENCES_LUNA_WORKER_TOKEN", "test-worker-token-that-is-at-least-thirty-two-characters");
    try {
      const authored = await authorLunaComposition({
        projectDir: path.join(root, "camera-shape"),
        jobId: "luna-camera-shape-proof",
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
      });
      expect(authored.draft.storyboard[0]!.camera).toBeUndefined();
    } finally {
      await worker.close();
    }
  });

  it("preserves exact raw source bytes, hashes approved assets, and persists the exact thread", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-route-"));
    roots.push(root);
    const projectDir = path.join(root, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    const reference = path.join(root, "brand.png");
    fs.writeFileSync(reference, Buffer.from("approved-brand-bytes"));
    const worker = await fakeWorker({ omitMotionIntentVersion: true });
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
      const { version: _version, ...motionIntentWithoutVersion } = intent;
      expect(fs.readFileSync(
        path.join(authored.runDir, "deliverables", "motion-intent.json"),
        "utf8",
      )).toBe(JSON.stringify(motionIntentWithoutVersion, null, 2) + "\n");
      expect(authored.intent.version).toBe(1);
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

  it("refuses to resume when the accepted canonical bundle was changed on disk", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-accepted-bundle-"));
    roots.push(root);
    const projectDir = path.join(root, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    const worker = await fakeWorker();
    vi.stubEnv("SLACK_SEQUENCES_LUNA_WORKER_URL", worker.url);
    vi.stubEnv("SLACK_SEQUENCES_LUNA_WORKER_TOKEN", "test-worker-token-that-is-at-least-thirty-two-characters");
    try {
      const authored = await authorLunaComposition({
        projectDir,
        jobId: "luna-accepted-bundle-proof",
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
      });
      fs.mkdirSync(path.join(projectDir, "composition"), { recursive: true });
      fs.writeFileSync(path.join(projectDir, "composition", "index.html"), html);
      fs.writeFileSync(path.join(projectDir, "composition", "manifest.json"), '{"revision":1}\n');
      confirmLunaComposition(projectDir, authored);
      fs.writeFileSync(
        path.join(authored.runDir, "deliverables", "director-treatment.md"),
        "# Tampered\n",
      );
      await expect(selfReviewLunaComposition({ projectDir, thumbnailPaths: [] }))
        .rejects.toThrow(/accepted materialized fingerprint/i);
      expect(worker.requests).toHaveLength(2);
    } finally {
      await worker.close();
    }
  });

  it("advances the exact worker cursor after rejecting a review and resumes from the accepted cut", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-rejected-review-"));
    roots.push(root);
    const projectDir = path.join(root, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    // Direction=1, accepted build=2, rejected self-review=3, revision=4.
    const worker = await fakeWorker({ invalidHtmlOnRunCount: 3 });
    vi.stubEnv("SLACK_SEQUENCES_LUNA_WORKER_URL", worker.url);
    vi.stubEnv("SLACK_SEQUENCES_LUNA_WORKER_TOKEN", "test-worker-token-that-is-at-least-thirty-two-characters");
    try {
      const authored = await authorLunaComposition({
        projectDir,
        jobId: "luna-rejected-review-proof",
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
      });
      fs.mkdirSync(path.join(projectDir, "composition"), { recursive: true });
      fs.writeFileSync(path.join(projectDir, "composition", "index.html"), html);
      fs.writeFileSync(path.join(projectDir, "composition", "manifest.json"), '{"revision":1}\n');
      confirmLunaComposition(projectDir, authored);

      await expect(selfReviewLunaComposition({ projectDir, thumbnailPaths: [] }))
        .rejects.toThrow(/content security policy|composition root/i);
      expect(loadLunaSession(projectDir)).toMatchObject({
        workerRunCount: 3,
        workerCursorDisposition: "unaccepted",
        latestRolloutSha256: "2".repeat(64),
        workerCursorRolloutSha256: "3".repeat(64),
        latestRunDir: path.relative(projectDir, authored.runDir).replace(/\\/g, "/"),
        latestMaterializedFingerprint: authored.worker.materializedFingerprint,
      });

      const revised = await reviseLunaComposition({
        projectDir,
        instruction: "Make the resolution more concise.",
      });
      expect(revised.worker.runCount).toBe(4);
      expect(worker.requests[3]!.body.expectedRunCount).toBe(3);
      expect(revised.draft.html).toBe(html);
      expect(loadLunaSession(projectDir)).toMatchObject({
        workerRunCount: 4,
        workerCursorDisposition: "unaccepted",
        latestRolloutSha256: "2".repeat(64),
        workerCursorRolloutSha256: "4".repeat(64),
        latestRunDir: path.relative(projectDir, authored.runDir).replace(/\\/g, "/"),
      });

      fs.writeFileSync(path.join(projectDir, "composition", "index.html"), revised.draft.html);
      fs.writeFileSync(path.join(projectDir, "composition", "manifest.json"), '{"revision":2}\n');
      confirmLunaComposition(projectDir, revised);
      expect(loadLunaSession(projectDir)).toMatchObject({
        workerRunCount: 4,
        workerCursorDisposition: "accepted",
        latestRolloutSha256: "4".repeat(64),
        workerCursorRolloutSha256: "4".repeat(64),
        latestRunDir: path.relative(projectDir, revised.runDir).replace(/\\/g, "/"),
      });
    } finally {
      await worker.close();
    }
  });

  it("round-trips one hard create failure through the exact fake-worker thread", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-repair-"));
    roots.push(root);
    const invalidHtml = html.replace(
      "const master=gsap.timeline({paused:true});",
      "const seed=Math.random();const master=gsap.timeline({paused:true});",
    );
    const worker = await fakeWorker({
      // Direction=1, rejected build=2, repaired build=3, self-review=4.
      compositionHtmlByRunCount: { 2: invalidHtml, 3: html, 4: html },
    });
    vi.stubEnv("SLACK_SEQUENCES_DATA_DIR", root);
    vi.stubEnv("SLACK_SEQUENCES_LUNA_WORKER_URL", worker.url);
    vi.stubEnv(
      "SLACK_SEQUENCES_LUNA_WORKER_TOKEN",
      "test-worker-token-that-is-at-least-thirty-two-characters",
    );
    try {
      const result = await createVideo({
        jobId: "luna-one-repair-proof",
        product: "Harborview",
        brandName: "Harborview",
        whatShipped: "Feedback routing",
        lengthSec: 6,
        render: false,
        preferMcp: false,
        allowDeterministicFallback: false,
      });
      expect(result.fallback).toBeUndefined();
      expect(result.stages).toEqual(expect.arrayContaining([
        expect.objectContaining({ stage: "luna-repair", status: "succeeded", attempts: 1 }),
      ]));
      expect(worker.requests).toHaveLength(4);
      expect(worker.requests[1]!.body.expectedRunCount).toBe(1);
      expect(worker.requests[2]!.body.expectedRunCount).toBe(2);
      expect(worker.requests[3]!.body.expectedRunCount).toBe(3);
      const repairFiles = worker.requests[2]!.body.files as Array<{
        path: string;
        contentBase64: string;
      }>;
      const rejectedHtml = repairFiles.find(
        (file) => file.path === "inputs/rejected-bundle/composition.html",
      );
      expect(Buffer.from(rejectedHtml!.contentBase64, "base64").toString("utf8"))
        .toBe(invalidHtml);
      const hardFindings = repairFiles.find(
        (file) => file.path === "inputs/repair/hard-findings.json",
      );
      const findings = JSON.parse(
        Buffer.from(hardFindings!.contentBase64, "base64").toString("utf8"),
      ) as { findings: string[]; advisoryFindingsIncluded: boolean };
      expect(findings.advisoryFindingsIncluded).toBe(false);
      expect(findings.findings.join("\n")).toContain("Math.random is not deterministic");
      expect(loadLunaSession(result.projectDir)).toMatchObject({
        workerRunCount: 4,
        workerCursorDisposition: "accepted",
      });
    } finally {
      await worker.close();
    }
  }, 60_000);

  it("publishes the labeled deterministic fallback when the Luna worker is unreachable", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-luna-fallback-"));
    roots.push(root);
    const unavailable = http.createServer();
    await new Promise<void>((resolve) => unavailable.listen(0, "127.0.0.1", resolve));
    const address = unavailable.address();
    const port = typeof address === "object" && address ? address.port : 0;
    await new Promise<void>((resolve, reject) => unavailable.close((error) =>
      error ? reject(error) : resolve()
    ));
    vi.stubEnv("SLACK_SEQUENCES_DATA_DIR", root);
    vi.stubEnv("SLACK_SEQUENCES_LUNA_WORKER_URL", `http://127.0.0.1:${port}`);
    vi.stubEnv(
      "SLACK_SEQUENCES_LUNA_WORKER_TOKEN",
      "test-worker-token-that-is-at-least-thirty-two-characters",
    );
    const result = await createVideo({
      jobId: "luna-worker-unreachable-fallback",
      product: "Relay",
      whatShipped: "Incident routing",
      lengthSec: 6,
      render: false,
      preferMcp: false,
      allowDeterministicFallback: true,
    });
    expect(result.authorRoute).toBe("luna-direct");
    expect(result.fallback).toMatchObject({ stage: "luna-direction" });
    expect(result.outline).toContain("Relay shipped");
    expect(result.thumbnailPaths.length).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(result.projectDir, "FAILURE.md"), "utf8"))
      .toContain("Job ID: luna-worker-unreachable-fallback");
  }, 60_000);

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
