import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isAllowedLunaAssetPackPreviewUrl,
  validateLunaAssetPack,
} from "../src/engine/lunaAssetPack.ts";

const CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; " +
  "img-src 'self'; font-src 'self'; connect-src 'none'; media-src 'none'; " +
  "frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function defaultPack(): Record<string, unknown> {
  return {
    version: 1,
    name: "Relay UI",
    visualThesis: "A calm operational surface with one high-signal action.",
    sourceEvidence: "Recreated from the approved product screenshots.",
    tokens: {
      accent: "#7057ff",
      radius: 14,
    },
    components: [
      {
        id: "relay-card",
        purpose: "Show one deploy moving from queued to ready.",
        rootSelector: "#relay-card",
        states: [
          { id: "queued", description: "The deploy is waiting." },
          { id: "ready", description: "The deploy is ready." },
        ],
        parts: [
          {
            id: "title",
            selector: "#relay-card .title",
            purpose: "Persistent deploy identity.",
            morphAnchor: true,
          },
          {
            id: "status",
            selector: "#relay-card [data-part='status']",
            purpose: "Stateful status label.",
          },
        ],
        interactions: [{ trigger: "activate", from: "queued", to: "ready" }],
      },
    ],
  };
}

function defaultHtml(body = ""): string {
  return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Security-Policy" content="${CSP}">
    <style>
      :root { color-scheme: dark; }
      #relay-card { background: #17171d; color: #fff; }
    </style>
  </head>
  <body>
    <section id="relay-card">
      <h1 class="title">Relay</h1>
      <span data-part="status">Ready</span>
      ${body}
    </section>
  </body>
</html>`;
}

function files(overrides: {
  pack?: Record<string, unknown>;
  html?: string;
  manifest?: unknown;
  assets?: Record<string, Buffer | string>;
} = {}): Map<string, Buffer> {
  const result = new Map<string, Buffer>([
    [
      "deliverables/asset-pack.json",
      Buffer.from(JSON.stringify(overrides.pack ?? defaultPack())),
    ],
    ["deliverables/ui-kit.html", Buffer.from(overrides.html ?? defaultHtml())],
    [
      "deliverables/assets-manifest.json",
      Buffer.from(JSON.stringify(overrides.manifest ?? [])),
    ],
  ]);
  for (const [relative, value] of Object.entries(overrides.assets ?? {})) {
    result.set(`deliverables/${relative}`, Buffer.isBuffer(value) ? value : Buffer.from(value));
  }
  return result;
}

describe("Luna UI asset-pack contract", () => {
  it("accepts a complete code-native pack and fingerprints every accepted byte", () => {
    const input = files();
    const validated = validateLunaAssetPack(input);

    expect(validated.pack).toMatchObject({
      version: 1,
      name: "Relay UI",
      components: [
        {
          id: "relay-card",
          rootSelector: "#relay-card",
          states: [{ id: "queued" }, { id: "ready" }],
          parts: [
            { id: "title", morphAnchor: true },
            { id: "status" },
          ],
        },
      ],
    });
    expect(validated.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(validateLunaAssetPack(new Map(input)).fingerprint).toBe(validated.fingerprint);

    const changed = files({ html: defaultHtml("<p>One more approved preview byte.</p>") });
    expect(validateLunaAssetPack(changed).fingerprint).not.toBe(validated.fingerprint);
  });

  it("rejects malformed versions and duplicate semantic ids", () => {
    expect(() => validateLunaAssetPack(files({
      pack: { ...defaultPack(), version: 2 },
    }))).toThrow(/protocol version must be 1/);

    const duplicateComponentPack = defaultPack();
    const component = (duplicateComponentPack.components as Array<Record<string, unknown>>)[0]!;
    duplicateComponentPack.components = [component, { ...component }];
    expect(() => validateLunaAssetPack(files({ pack: duplicateComponentPack })))
      .toThrow(/unsafe or duplicate id/);

    const duplicateStatePack = defaultPack();
    const duplicateStateComponent = (
      duplicateStatePack.components as Array<Record<string, unknown>>
    )[0]!;
    const state = (duplicateStateComponent.states as Array<Record<string, unknown>>)[0]!;
    duplicateStateComponent.states = [state, { ...state }];
    expect(() => validateLunaAssetPack(files({ pack: duplicateStatePack })))
      .toThrow(/duplicate state id/);
  });

  it("rejects values that do not satisfy the typed token and interaction schema", () => {
    const nestedTokenPack = defaultPack();
    nestedTokenPack.tokens = { accent: { unsafe: "nested" } };
    expect(() => validateLunaAssetPack(files({ pack: nestedTokenPack })))
      .toThrow(/token/i);

    const malformedInteractionPack = defaultPack();
    (malformedInteractionPack.components as Array<Record<string, unknown>>)[0]!.interactions = [
      "activate-without-a-structured-contract",
    ];
    expect(() => validateLunaAssetPack(files({ pack: malformedInteractionPack })))
      .toThrow(/interaction/i);
  });

  it("requires each declared component root and part selector to match exactly once", () => {
    const missingRootPack = defaultPack();
    (missingRootPack.components as Array<Record<string, unknown>>)[0]!.rootSelector = "#missing";
    expect(() => validateLunaAssetPack(files({ pack: missingRootPack })))
      .toThrow(/rootSelector must match exactly one/);

    const invalidPartPack = defaultPack();
    const invalidPart = (
      (invalidPartPack.components as Array<Record<string, unknown>>)[0]!.parts as
        Array<Record<string, unknown>>
    )[0]!;
    invalidPart.selector = "[";
    expect(() => validateLunaAssetPack(files({ pack: invalidPartPack })))
      .toThrow(/not a valid selector/);

    const duplicatePartHtml = defaultHtml('<h2 class="title">Duplicate title</h2>');
    expect(() => validateLunaAssetPack(files({ html: duplicatePartHtml })))
      .toThrow(/part title selector must match exactly one/);
  });

  it.each([
    [
      "a weakened Content Security Policy",
      defaultHtml().replace(CSP, "default-src 'none'"),
      /exact local-only Content Security Policy/,
    ],
    [
      "an executable element",
      defaultHtml("<script>document.body.remove()</script>"),
      /forbidden executable/,
    ],
    [
      "an inline event handler",
      defaultHtml('<button onclick="alert(1)">Go</button>'),
      /event handler/,
    ],
    [
      "a remote element resource",
      defaultHtml('<img src="https://example.com/tracker.png">'),
      /non-local resource/,
    ],
    [
      "a remote CSS resource",
      defaultHtml('<div style="background:url(https://example.com/tracker.png)"></div>'),
      /CSS references a non-local resource/,
    ],
    [
      "a meta refresh to an external URL",
      defaultHtml().replace("<style>", '<meta http-equiv="refresh" content="0;url=https://example.com"><style>'),
      /exactly one head-scoped/,
    ],
    [
      "a CSP outside the document head",
      defaultHtml().replace(
        `    <meta http-equiv="Content-Security-Policy" content="${CSP}">`,
        "",
      ).replace("<body>", `<body><meta http-equiv="Content-Security-Policy" content="${CSP}">`),
      /head-scoped/,
    ],
    [
      "a remote CSS import",
      defaultHtml().replace("<style>", '<style>@import "https://example.com/tracker.css";'),
      /external-loading construct/,
    ],
    [
      "a remote srcset candidate",
      defaultHtml('<img srcset="https://example.com/tracker.png 2x">'),
      /forbidden URL attribute srcset/,
    ],
  ])("rejects previews containing %s", (_label, html, finding) => {
    expect(() => validateLunaAssetPack(files({ html }))).toThrow(finding);
  });

  it("accepts a declared local asset whose type, hash, preview reference, and bytes agree", () => {
    const icon = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M2 8h12"/></svg>',
    );
    const manifest = [{
      path: "assets/luna/relay-mark.svg",
      purpose: "Product mark recreated from the supplied screenshot.",
      provenance: "agent-created",
      mediaType: "image/svg+xml",
      sha256: sha256(icon),
    }];
    const validated = validateLunaAssetPack(files({
      html: defaultHtml('<img src="assets/luna/relay-mark.svg" alt="">'),
      manifest,
      assets: { "assets/luna/relay-mark.svg": icon },
    }));

    expect(JSON.parse(validated.assetManifest)).toEqual(manifest);
  });

  it("allows preview requests only for file URLs contained by the deliverables root", () => {
    const root = path.join(os.tmpdir(), "sequences-luna-pack-preview");
    expect(isAllowedLunaAssetPackPreviewUrl(root, pathToFileURL(path.join(root, "ui-kit.html")).href))
      .toBe(true);
    expect(isAllowedLunaAssetPackPreviewUrl(root, pathToFileURL(path.join(root, "assets", "luna", "mark.svg")).href))
      .toBe(true);
    expect(isAllowedLunaAssetPackPreviewUrl(root, pathToFileURL(path.join(root, "..", "secret.txt")).href))
      .toBe(false);
    expect(isAllowedLunaAssetPackPreviewUrl(root, "https://example.com/tracker.png")).toBe(false);
    expect(isAllowedLunaAssetPackPreviewUrl(root, "data:text/html,unsafe")).toBe(false);
  });

  it("rejects asset paths, hashes, coverage, and active SVG content that do not agree", () => {
    const icon = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M2 8h12"/></svg>',
    );
    const manifestEntry = {
      path: "assets/luna/relay-mark.svg",
      purpose: "Product mark.",
      provenance: "agent-created",
      mediaType: "image/svg+xml",
      sha256: sha256(icon),
    };
    const html = defaultHtml('<img src="assets/luna/relay-mark.svg" alt="">');

    expect(() => validateLunaAssetPack(files({
      html,
      manifest: [{ ...manifestEntry, path: "assets/luna/../relay-mark.svg" }],
      assets: { "assets/luna/../relay-mark.svg": icon },
    }))).toThrow(/unsafe or duplicated/);

    expect(() => validateLunaAssetPack(files({
      html,
      manifest: [{ ...manifestEntry, sha256: "0".repeat(64) }],
      assets: { "assets/luna/relay-mark.svg": icon },
    }))).toThrow(/failed its declared SHA-256/);

    expect(() => validateLunaAssetPack(files({
      html,
      manifest: [],
      assets: { "assets/luna/relay-mark.svg": icon },
    }))).toThrow(/manifest does not exactly cover/);

    const activeSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(() => validateLunaAssetPack(files({
      html,
      manifest: [{ ...manifestEntry, sha256: sha256(activeSvg) }],
      assets: { "assets/luna/relay-mark.svg": activeSvg },
    }))).toThrow(/SVG contains active or external content/);
  });
});
