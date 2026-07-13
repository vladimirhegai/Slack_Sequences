/** Replay every locally available refactor fixture without model calls. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStoryboardResponse } from "../src/engine/compositionRunner.ts";
import { replaySourceArtifact } from "./sourceReplay.ts";

interface Fixture {
  id: string;
  jobId: string;
  expectedRaw: Record<string, { artifactSha256: string; replaySha256?: string; outcome: "parsed" | "rejected" }>;
  expectedSource: Record<string, {
    artifactSha256: string;
    replaySha256: string;
    outcome?: "accepted" | "rejected";
  }>;
}

// These hashes are deliberately of the persisted local artifacts, not copies
// of the artifacts. A missing .data fixture is a warning; a changed fixture or
// changed deterministic replay is a failure.
const FIXTURES: Fixture[] = [
  {
    id: "LaunchRelay",
    jobId: "architecture-audit-live-1-20260711",
    expectedRaw: {
      "storyboard-1-rejected.raw.txt": { artifactSha256: "407697f1d40217126d1ecd26bcb48187a19db19fec9dafddb684235b21f4db26", replaySha256: "84ab29fa3b87527b3dd2c7ffa499f95e113beb91b733eb8c9848d385acd804e7", outcome: "parsed" },
      "storyboard-2-rejected.raw.txt": { artifactSha256: "4f3beae48ac8344686959464ce2aa18c980965a03bb75140803d00d6c275da24", replaySha256: "6df2a452162d6e9bd1861d665a988738eff2749f45fa3e67213d5263e693d113", outcome: "parsed" },
    },
    expectedSource: {
      "author-1-browser-rejected.html": { artifactSha256: "338d796da8e298d77f385d651de0ff9e111f76228813ffd7cf75afd3bba8f8be", replaySha256: "f2cba805ec7b6a9285856e948f9d71361ab6f61de648afd31e550e92246c8d4c" },
      "author-2-browser-rejected.html": { artifactSha256: "b25236859cfe1258141963b46e9fff5b9b8ca23bb0caf1f3e4a2bbf7e193f15d", replaySha256: "b28d0903d994423b4963769520f78daa0429630800f02c74824e948886641fbd" },
    },
  },
  {
    id: "PulseForge",
    jobId: "architecture-stress-2-20260711",
    expectedRaw: {
      "storyboard-1-rejected.raw.txt": { artifactSha256: "7f7633ca5c786dc18088681428f50cefbef46f6f2aa68e72ca314a181c3b0e26", replaySha256: "4d2b920fe4d557ce9e4e0c0909b0858884d79f22c7adbda5e129222204826222", outcome: "rejected" },
    },
    expectedSource: {},
  },
  {
    id: "GatePilot",
    jobId: "architecture-stress-3-20260711",
    expectedRaw: {},
    expectedSource: {
      "author-1-browser-rejected.html": { artifactSha256: "9c3ee94688d10e812159649b20ddffef6255e9e8c99ef431b66bce26ef122876", replaySha256: "b340ff5b6f744f1bd27f49816756d8728f7603d5910aa52918c53f84ec043e8e" },
    },
  },
  {
    id: "RelayGuard",
    jobId: "architecture-stress-4-20260711",
    expectedRaw: {
      "storyboard-1-truncated.raw.txt": { artifactSha256: "c114787284cd9e941069cfdd1c5060e25cd3721ff07959509adb4a1d79e5e018", replaySha256: "3dbc3fefa9378943d31c5491cc0fbd1032be30fda24fbf2de11d22441f9418e2", outcome: "rejected" },
      "storyboard-2-rejected.raw.txt": { artifactSha256: "087c4cbcea154fe5badfb5081981bb1d1f8b21f8d143d459e87a8b036c86a465", replaySha256: "b16e3241d7b8c3b0509fbf49efc1faf0a37c680eb048c3bfe5f43b23d2374f33", outcome: "parsed" },
    },
    expectedSource: {},
  },
  {
    id: "SignalDock",
    jobId: "architecture-stress-5-20260711",
    expectedRaw: {
      "storyboard-1-rejected.raw.txt": { artifactSha256: "7dfa968896f689e8a485f5daef62b40607c7d3fc4123b496980d5017ac4fa364", replaySha256: "bccef7656d570436edb3c28520f4685a03920a55bf940bc7ae60d01b9c6ff290", outcome: "rejected" },
    },
    expectedSource: {
      "author-1-browser-rejected.html": { artifactSha256: "a4c3f044f738b03e628d10a57f69976b9228b43fd04dd41a2650c2112dc6f597", replaySha256: "0f8e95fe9a3769b60a8c155d8c3bed4477986ec06f3a943baeba6734032cdddc", outcome: "rejected" },
      "author-2-browser-rejected.html": { artifactSha256: "ba82df19b8447ae7372bc58300b99a253acd4652677ed52f8726f9907c89f2fb", replaySha256: "aefc470ecbdf096e1cceda17640a29cdb71fd16b6719b2bda830e7ad15781c6a", outcome: "rejected" },
    },
  },
  {
    id: "Briefly",
    jobId: "refactor-review-normal-1-20260711",
    expectedRaw: {},
    expectedSource: {
      "author-1-browser-rejected.html": { artifactSha256: "615a5d6217a9a9a952502aa33dcbeee7220c0b30ca8a19f8c1c22369bc76aace", replaySha256: "549677430cedd0d02fe9013b23ace8da932c0cd428b3d2fd23f39dcd8be3b54c", outcome: "rejected" },
      "author-2-browser-rejected.html": { artifactSha256: "67c3fc17b64348c49a38da5aee1798306f4d1aa63377139843c2e2809b48e64d", replaySha256: "ef699e6fcfbc679ab0547b3097da99535a6867970a0bec629ea589ead9d9f360", outcome: "rejected" },
    },
  },
  {
    id: "CurrentProof D",
    jobId: "lp3-state-capsule-20260712-d",
    expectedRaw: {
      "storyboard-1-rejected.raw.txt": { artifactSha256: "7a6bd2d3534a9c73b636a3c20b1a0a7ef17bacd12edd8ab7170d6719b6b341ff", replaySha256: "de4d8f087289955a1042ebbd9f2013f01ae684340d6b3c0606b9ad0606adf9e5", outcome: "parsed" },
      "storyboard-2-rejected.raw.txt": { artifactSha256: "7c9540286b775ef84b6cd75b137e8c3681b4ecbf439676ecf121cbd14e53df3f", replaySha256: "10ed0dfb016a99dd9960b5f3a94cec414ffe3bd9c71b4ee5840aef7a02875f9f", outcome: "parsed" },
    },
    expectedSource: {
      "author-1-static-rejected.html": { artifactSha256: "c58162278b6a34fa61da8672b3ab0b98a422b830e9436fffbae02f3cf4079347", replaySha256: "7114b406e85034515dcc96f0f0f851ecdcdbb6e8bc6f148825a00926e32d1b79", outcome: "accepted" },
      "author-2-static-rejected.html": { artifactSha256: "e617d4ac161742073bf29796a369951677e2c643aa788523cfb53a28dfdfa794", replaySha256: "7114b406e85034515dcc96f0f0f851ecdcdbb6e8bc6f148825a00926e32d1b79", outcome: "accepted" },
    },
  },
  {
    id: "ProofLine E",
    jobId: "lp3-state-capsule-20260712-e",
    expectedRaw: {},
    expectedSource: {
      "author-1-browser-rejected.html": { artifactSha256: "38d5aaa59a78bab243e8094e27d7fd6967f16dc40f15a12d3840474bfbb9b74b", replaySha256: "32d994673371213e06d40e37112f74046235ed55b0de9647e6328dd0bf0b6107", outcome: "accepted" },
    },
  },
  {
    id: "ProofArc F",
    jobId: "lp3-state-capsule-20260712-f",
    expectedRaw: {
      "storyboard-1-rejected.raw.txt": { artifactSha256: "76edbc2aa75434637f3a190a22abe72aa39db14a9dacee19081c1f8a4778f604", replaySha256: "bece7ad90aa6523480f07a5b84623531dec3f4c75877eba22cc4879978f2e3f9", outcome: "parsed" },
      "storyboard-2-rejected.raw.txt": { artifactSha256: "e35654ae5cc203e7cd2383a0817156759d8f67e763b6fa733d80e5a10b05508f", replaySha256: "5c165f353d158073ee0799a8b9d438494d9e045aac2950453ac890e695e4f890", outcome: "parsed" },
    },
    expectedSource: {},
  },
  {
    id: "ProofSpan G",
    jobId: "lp3-state-capsule-20260712-g",
    expectedRaw: {
      "storyboard-1-rejected.raw.txt": { artifactSha256: "352bbbd90a797b46670fb2d15966aa4fa3ee91157493b2c10794d951617287d4", replaySha256: "ddf4b39a4e1d2fc978a2757f1203fb71b03150cc6aeac36dea71136e1254a184", outcome: "parsed" },
    },
    expectedSource: {
      "author-1-static-rejected.html": { artifactSha256: "6eb800644e5277b98cece51c8e115dcc5b428448e34c7fe3c10a2bf646b39e9c", replaySha256: "81979ac18a9cc18fbeea12db920c7435294af25e91b2cf7f03e404b5c276064c", outcome: "accepted" },
      "author-2-static-rejected.html": { artifactSha256: "d86866125252e68e0d16b07fefca2a487fa806ee1e40b0d12e23e9e4b138c782", replaySha256: "81979ac18a9cc18fbeea12db920c7435294af25e91b2cf7f03e404b5c276064c", outcome: "accepted" },
    },
  },
  {
    id: "ProofRail H",
    jobId: "lp3-state-capsule-20260712-h",
    expectedRaw: {
      "storyboard.json": { artifactSha256: "9d9911f737c4eeeecb0a12514f74da61ec96632d2a5d5092c81c3bc17ec5aeeb", replaySha256: "fd9413f7eaa00c9eff875c080fd9560fb9c2c803e474ce71878e6877ef28974c", outcome: "parsed" },
    },
    expectedSource: {},
  },
  {
    id: "ProofGrid I",
    jobId: "lp3-state-capsule-20260712-i",
    expectedRaw: {
      "storyboard.json": { artifactSha256: "5bc2f5e9b830f32b0123e14a35b62521088342b6b82b5a7975a37e16dcf46f2d", replaySha256: "c2dc46c920fee443fc33985b1670d2b2bacc833395b381b467b75a87040b73d3", outcome: "parsed" },
    },
    expectedSource: {},
  },
];

const appDir = path.resolve(import.meta.dirname, "..");
const projectsDir = path.join(appDir, ".data", "projects");

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableReplay(raw: string): string {
  const scenes = parseStoryboardResponse(raw, {}, { degradePacingFindings: true });
  return JSON.stringify(scenes.map((scene) => ({
    id: scene.id,
    startSec: scene.startSec,
    durationSec: scene.durationSec,
    beats: scene.beats?.map((beat) => `${beat.id}@${beat.atSec}`) ?? [],
    moments: scene.moments?.map((moment) => `${moment.id}@${moment.atSec}`) ?? [],
    normalizations: scene.sentinelNormalizations ?? [],
  })));
}

function rawFiles(
  projectDir: string,
  expected: Fixture["expectedRaw"],
): string[] {
  const attemptsDir = path.join(projectDir, "planning", "attempts");
  const attempts = fs.existsSync(attemptsDir)
    ? fs.readdirSync(attemptsDir)
      .filter((name) => name.startsWith("storyboard-") && name.endsWith(".raw.txt"))
      .sort()
      .map((name) => path.join(attemptsDir, name))
    : [];
  const accepted = path.join(projectDir, "planning", "storyboard.json");
  return Object.hasOwn(expected, "storyboard.json") && fs.existsSync(accepted)
    ? [...attempts, accepted]
    : attempts;
}

function sourceFiles(projectDir: string): string[] {
  const attemptsDir = path.join(projectDir, "planning", "attempts");
  if (!fs.existsSync(attemptsDir)) return [];
  return fs.readdirSync(attemptsDir)
    .filter((name) => name.endsWith(".html"))
    .sort()
    .map((name) => path.join(attemptsDir, name));
}

function expectedFor<T>(map: Record<string, T>, file: string): T | undefined {
  return map[path.basename(file)];
}

async function main(): Promise<number> {
  let failures = 0;
  let replayed = 0;
  let skipped = 0;
  for (const fixture of FIXTURES) {
    const projectDir = path.join(projectsDir, fixture.jobId);
    if (!fs.existsSync(projectDir)) {
      console.warn(`[replay:all] SKIP ${fixture.id}: missing ${projectDir}`);
      skipped += 1;
      continue;
    }
    console.log(`[replay:all] ${fixture.id} (${fixture.jobId})`);
    for (const file of rawFiles(projectDir, fixture.expectedRaw)) {
      const name = path.basename(file);
      const expected = expectedFor(fixture.expectedRaw, file);
      if (!expected) {
        console.warn(`  SKIP ${name}: no frozen expectation recorded`);
        skipped += 1;
        continue;
      }
      const raw = fs.readFileSync(file);
      if (sha256(raw) !== expected.artifactSha256) {
        console.error(`  FAIL ${name}: fixture bytes drifted`);
        failures += 1;
        continue;
      }
      try {
        const replayHash = sha256(stableReplay(raw.toString("utf8")));
        if (expected.outcome !== "parsed" || replayHash !== expected.replaySha256) {
          console.error(`  FAIL ${name}: replay outcome/hash drifted`);
          failures += 1;
        } else {
          console.log(`  PASS ${name}`);
          replayed += 1;
        }
      } catch (error) {
        const replayHash = sha256(String(error));
        if (expected.outcome === "rejected" && replayHash === expected.replaySha256) {
          console.log(`  PASS ${name} (expected rejection)`);
          replayed += 1;
        } else {
          console.error(`  FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
          failures += 1;
        }
      }
    }
    for (const file of sourceFiles(projectDir)) {
      const name = path.basename(file);
      const expected = expectedFor(fixture.expectedSource, file);
      if (!expected) {
        console.warn(`  SKIP ${name}: no frozen expectation recorded`);
        skipped += 1;
        continue;
      }
      if (sha256(fs.readFileSync(file)) !== expected.artifactSha256) {
        console.error(`  FAIL ${name}: fixture bytes drifted`);
        failures += 1;
        continue;
      }
      try {
        const result = await replaySourceArtifact(projectDir, file);
        const replayHash = sha256(result.repairedHtml + JSON.stringify(result.storyboard));
        if (expected.outcome === "rejected" || replayHash !== expected.replaySha256) {
          console.error(`  FAIL ${name}: strict source replay drifted`);
          failures += 1;
        } else {
          console.log(`  PASS ${name} (strict source)`);
          replayed += 1;
        }
      } catch (error) {
        const replayHash = sha256(String(error));
        if (expected.outcome === "rejected" && replayHash === expected.replaySha256) {
          console.log(`  PASS ${name} (expected strict-source rejection)`);
          replayed += 1;
        } else {
          console.error(`  FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
          failures += 1;
        }
      }
    }
  }
  console.log(`[replay:all] ${replayed} replay(s), ${skipped} skipped, ${failures} failure(s)`);
  return failures ? 1 : 0;
}

async function printExpectations(): Promise<void> {
  for (const fixture of FIXTURES) {
    const projectDir = path.join(projectsDir, fixture.jobId);
    if (!fs.existsSync(projectDir)) continue;
    console.log(`${fixture.id} ${fixture.jobId}`);
    for (const file of rawFiles(projectDir, fixture.expectedRaw)) {
      const raw = fs.readFileSync(file);
      try {
        console.log(`  raw ${path.basename(file)} ${JSON.stringify({ artifactSha256: sha256(raw), replaySha256: sha256(stableReplay(raw.toString("utf8"))), outcome: "parsed" })}`);
      } catch (error) {
        console.log(`  raw ${path.basename(file)} ${JSON.stringify({ artifactSha256: sha256(raw), replaySha256: sha256(String(error)), outcome: "rejected" })}`);
      }
    }
    for (const file of sourceFiles(projectDir)) {
      try {
        const result = await replaySourceArtifact(projectDir, file);
        console.log(`  source ${path.basename(file)} ${JSON.stringify({ artifactSha256: sha256(fs.readFileSync(file)), replaySha256: sha256(result.repairedHtml + JSON.stringify(result.storyboard)), outcome: "accepted" })}`);
      } catch (error) {
        console.log(`  source ${path.basename(file)} ${JSON.stringify({ artifactSha256: sha256(fs.readFileSync(file)), replaySha256: sha256(String(error)), outcome: "rejected" })}`);
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--print-expectations")) await printExpectations();
  else process.exitCode = await main();
}
