import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startAppHttpServer,
  type AppHttpServer,
} from "../src/httpServer.ts";

let activeServer: AppHttpServer | undefined;

afterEach(async () => {
  await activeServer?.close();
  activeServer = undefined;
  vi.unstubAllEnvs();
});

async function start(): Promise<{ baseUrl: string; app: AppHttpServer }> {
  const app = await startAppHttpServer({ host: "127.0.0.1", port: 0, log: () => undefined });
  activeServer = app;
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("HTTP test server did not bind");
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe("deployment HTTP server", () => {
  it("serves a stable root and readiness health check", async () => {
    const { app, baseUrl } = await start();

    const root = await fetch(`${baseUrl}/`);
    expect(root.status).toBe(200);
    expect(await root.text()).toContain("online");

    expect((await fetch(`${baseUrl}/healthz`)).status).toBe(503);
    app.markReady();
    expect((await fetch(`${baseUrl}/healthz`)).status).toBe(200);
  });

  it("keeps OAuth routes closed when deployment credentials are absent", async () => {
    const { baseUrl } = await start();

    const missing = await fetch(`${baseUrl}/slack/oauth_redirect`);
    expect(missing.status).toBe(503);

    const scaffold = await fetch(`${baseUrl}/slack/oauth_redirect?code=secret-code`);
    expect(scaffold.status).toBe(503);
    expect(await scaffold.text()).toContain("not configured");
  });

  it("starts a signed user-only Slack OAuth grant", async () => {
    vi.stubEnv("SLACK_CLIENT_ID", "123.456");
    vi.stubEnv("SLACK_CLIENT_SECRET", "client-secret");
    vi.stubEnv("SLACK_REDIRECT_URI", "https://example.test/slack/oauth_redirect");
    vi.stubEnv("SLACK_STATE_SECRET", "state-secret");
    const { baseUrl } = await start();

    const response = await fetch(`${baseUrl}/slack/install?team=T123`, {
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://slack.com/oauth/v2_user/authorize");
    expect(location.searchParams.get("client_id")).toBe("123.456");
    expect(location.searchParams.get("scope")).toContain("search:read.public");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://example.test/slack/oauth_redirect",
    );
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });
});
