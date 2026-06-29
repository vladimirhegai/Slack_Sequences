import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { storeSlackUserToken } from "./slackTokenStore.ts";

const USER_SCOPES = [
  "search:read.public",
  "search:read.private",
  "search:read.files",
  "files:read",
  "channels:history",
  "groups:history",
] as const;

const STATE_COOKIE = "sequences_oauth_nonce";
const STATE_TTL_SECONDS = 10 * 60;

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  stateSecret: string;
}

interface StatePayload {
  nonce: string;
  expiresAt: number;
  teamId?: string;
}

export interface SlackTokenResponse {
  ok?: boolean;
  error?: string;
  access_token?: string;
  scope?: string;
  token_type?: string;
  user_id?: string;
  team_id?: string;
  authed_user?: {
    id?: string;
    scope?: string;
    access_token?: string;
    team_id?: string;
  };
  team?: { id?: string };
}

interface SlackAuthTestResponse {
  ok?: boolean;
  error?: string;
  user_id?: string;
  team_id?: string;
}

export interface SlackUserGrant {
  token?: string;
  userId?: string;
  teamId?: string;
  scopes: string[];
}

function config(): OAuthConfig {
  const values = {
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    redirectUri: process.env.SLACK_REDIRECT_URI,
    stateSecret: process.env.SLACK_STATE_SECRET,
  };
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Slack MCP OAuth is not configured (${missing.join(", ")})`);
  }
  return values as OAuthConfig;
}

function signature(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function makeState(teamId: string | undefined, secret: string): {
  state: string;
  nonce: string;
} {
  const nonce = crypto.randomBytes(24).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    nonce,
    expiresAt: Date.now() + STATE_TTL_SECONDS * 1_000,
    ...(teamId ? { teamId } : {}),
  } satisfies StatePayload)).toString("base64url");
  return { state: `${payload}.${signature(payload, secret)}`, nonce };
}

function parseCookies(request: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    (request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim().split("=", 2))
      .filter((parts): parts is [string, string] => parts.length === 2)
      .map(([key, value]) => [key, decodeURIComponent(value)]),
  );
}

function verifyState(state: string, nonce: string | undefined, secret: string): StatePayload {
  const [payload, suppliedSignature] = state.split(".");
  if (!payload || !suppliedSignature || !nonce) throw new Error("Invalid OAuth state");
  const expected = signature(payload, secret);
  const supplied = Buffer.from(suppliedSignature);
  const wanted = Buffer.from(expected);
  if (supplied.length !== wanted.length || !crypto.timingSafeEqual(supplied, wanted)) {
    throw new Error("Invalid OAuth state");
  }
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as StatePayload;
  if (parsed.nonce !== nonce || parsed.expiresAt < Date.now()) throw new Error("Expired OAuth state");
  return parsed;
}

function send(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
}

export function slackInstallUrl(teamId?: string): string | undefined {
  const base = process.env.SLACK_INSTALL_URL?.trim()
    ?? process.env.PUBLIC_BASE_URL?.trim();
  if (!base) return undefined;
  const url = new URL(
    process.env.SLACK_INSTALL_URL ? base : "/slack/install",
    base.endsWith("/") ? base : `${base}/`,
  );
  if (teamId) url.searchParams.set("team", teamId);
  return url.toString();
}

async function exchangeCode(code: string, oauth: OAuthConfig): Promise<SlackTokenResponse> {
  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    redirect_uri: oauth.redirectUri,
  });
  const response = await fetch("https://slack.com/api/oauth.v2.user.access", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${oauth.clientId}:${oauth.clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Slack token exchange failed (${response.status})`);
  return response.json() as Promise<SlackTokenResponse>;
}

export function extractSlackUserGrant(
  response: SlackTokenResponse,
  stateTeamId?: string,
): SlackUserGrant {
  return {
    // oauth.v2.user.access documents a top-level token. Accepting the nested
    // oauth.v2.access shape as well makes the callback resilient to Slack grant
    // variants without ever accepting a bot token.
    token: response.access_token ?? response.authed_user?.access_token,
    userId: response.authed_user?.id ?? response.user_id,
    teamId: response.team?.id
      ?? response.team_id
      ?? response.authed_user?.team_id
      ?? stateTeamId,
    scopes: (response.authed_user?.scope ?? response.scope ?? "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
  };
}

async function identifyGrant(
  grant: SlackUserGrant,
): Promise<SlackUserGrant> {
  if (!grant.token || (grant.userId && grant.teamId)) return grant;
  const response = await fetch("https://slack.com/api/auth.test", {
    headers: { authorization: `Bearer ${grant.token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Slack identity check failed (${response.status})`);
  const identity = await response.json() as SlackAuthTestResponse;
  if (!identity.ok) {
    throw new Error(`Slack identity check failed (${identity.error ?? "unknown error"})`);
  }
  return {
    ...grant,
    userId: grant.userId ?? identity.user_id,
    teamId: grant.teamId ?? identity.team_id,
  };
}

/** Handles only the two per-user OAuth routes needed by Slack's hosted MCP server. */
export async function handleSlackOAuthRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== "/slack/install" && url.pathname !== "/slack/oauth_redirect") {
    return false;
  }

  let oauth: OAuthConfig;
  try {
    oauth = config();
  } catch (error) {
    send(response, 503, error instanceof Error ? error.message : "Slack MCP OAuth is unavailable");
    return true;
  }

  if (url.pathname === "/slack/install") {
    const { state, nonce } = makeState(url.searchParams.get("team") ?? undefined, oauth.stateSecret);
    // Slack's hosted-MCP OAuth metadata (mcp.slack.com/.well-known/
    // oauth-authorization-server) sets authorization_endpoint to /oauth/v2_user/
    // authorize and token_endpoint to oauth.v2.user.access. The v2_user endpoint
    // issues a user-only grant for the requested user scopes.
    const authorize = new URL("https://slack.com/oauth/v2_user/authorize");
    authorize.searchParams.set("client_id", oauth.clientId);
    authorize.searchParams.set("scope", USER_SCOPES.join(","));
    authorize.searchParams.set("redirect_uri", oauth.redirectUri);
    authorize.searchParams.set("state", state);
    if (url.searchParams.get("team")) authorize.searchParams.set("team", url.searchParams.get("team")!);
    response.writeHead(302, {
      location: authorize.toString(),
      "set-cookie": `${STATE_COOKIE}=${encodeURIComponent(nonce)}; Path=/slack; HttpOnly; Secure; SameSite=Lax; Max-Age=${STATE_TTL_SECONDS}`,
      "cache-control": "no-store",
    });
    response.end();
    return true;
  }

  if (url.searchParams.has("error")) {
    send(response, 400, "Slack authorization was denied. You can close this tab.");
    return true;
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    send(response, 400, "Missing OAuth code or state.");
    return true;
  }

  try {
    const verified = verifyState(state, parseCookies(request)[STATE_COOKIE], oauth.stateSecret);
    const tokenResponse = await exchangeCode(code, oauth);
    if (!tokenResponse.ok) {
      throw new Error(
        `Slack rejected authorization (${tokenResponse.error ?? "unknown error"})`,
      );
    }
    const grant = await identifyGrant(extractSlackUserGrant(tokenResponse, verified.teamId));
    const missing = [
      !grant.token && "user token",
      !grant.userId && "user ID",
      !grant.teamId && "workspace ID",
    ].filter(Boolean);
    if (!grant.token || !grant.userId || !grant.teamId) {
      throw new Error(`Slack authorization response was missing ${missing.join(", ")}`);
    }
    storeSlackUserToken({
      teamId: grant.teamId,
      userId: grant.userId,
      token: grant.token,
      scopes: grant.scopes,
    });
    response.setHeader(
      "set-cookie",
      `${STATE_COOKIE}=; Path=/slack; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    );
    send(response, 200, "Sequences is connected to your Slack workspace. You can close this tab.");
  } catch (error) {
    send(
      response,
      400,
      error instanceof Error ? error.message : "Slack authorization could not be completed.",
    );
  }
  return true;
}
