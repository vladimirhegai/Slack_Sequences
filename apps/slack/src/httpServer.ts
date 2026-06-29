import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { handleSlackOAuthRequest } from "./slackOAuth.ts";

export interface AppHttpServer {
  server: Server;
  markReady(): void;
  close(): Promise<void>;
}

export interface StartHttpServerOptions {
  host?: string;
  port?: number;
  log?: (message: string) => void;
}

function sendText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
}

function requestUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? "/", "http://localhost");
}

/**
 * A deliberately small HTTP surface beside Socket Mode.
 *
 * Socket Mode still owns Slack events and interactions. HTTP exists only for
 * hosting health checks and the future OAuth callback required by Slack's
 * per-user MCP authorization flow.
 */
export async function startAppHttpServer(
  options: StartHttpServerOptions = {},
): Promise<AppHttpServer> {
  const host = options.host ?? process.env.HOST ?? "0.0.0.0";
  const port = options.port ?? Number(process.env.PORT ?? 3000);
  const log = options.log ?? ((message: string) => console.log(message));
  let ready = false;

  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid PORT: ${String(port)}`);
  }

  const server = http.createServer(async (request, response) => {
    const url = requestUrl(request);
    if (request.method !== "GET") {
      sendText(response, 405, "Method not allowed.");
      return;
    }

    if (url.pathname === "/") {
      sendText(response, 200, "Sequences Slack app is online.");
      return;
    }

    if (url.pathname === "/healthz") {
      sendText(response, ready ? 200 : 503, ready ? "ready" : "starting");
      return;
    }

    if (await handleSlackOAuthRequest(request, response, url)) return;

    sendText(response, 404, "Not found.");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  log(`HTTP server listening on ${host}:${boundPort}`);

  return {
    server,
    markReady() {
      ready = true;
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
