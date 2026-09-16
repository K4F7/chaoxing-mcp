import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

import { applyDevVars, upsertDevVar } from "../src/dev-vars";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const LOOPBACK_HOST = "127.0.0.1";
const LOOPBACK_PORT = 8789;
const REDIRECT_URI = `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}/oauth2callback`;

await applyDevVars();

const client = await readOAuthClient();
const state = crypto.randomUUID();
const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
const challenge = base64UrlEncode(
  await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
);

const authorizationUrl = new URL(GOOGLE_AUTH_URL);
authorizationUrl.searchParams.set("client_id", client.clientId);
authorizationUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authorizationUrl.searchParams.set("response_type", "code");
authorizationUrl.searchParams.set("scope", GOOGLE_CALENDAR_SCOPE);
authorizationUrl.searchParams.set("access_type", "offline");
authorizationUrl.searchParams.set("prompt", "consent");
authorizationUrl.searchParams.set("state", state);
authorizationUrl.searchParams.set("code_challenge", challenge);
authorizationUrl.searchParams.set("code_challenge_method", "S256");

console.log("正在打开 Google 授权页面...");
openBrowser(authorizationUrl.toString());

const code = await waitForAuthorizationCode(state);
const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
  }),
});
const tokenData = (await tokenResponse.json()) as {
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

if (!tokenResponse.ok || !tokenData.refresh_token) {
  throw new Error(
    tokenData.error_description ||
      tokenData.error ||
      "google_refresh_token_not_returned",
  );
}

await upsertDevVar("GOOGLE_OAUTH_CLIENT_ID", client.clientId);
await upsertDevVar("GOOGLE_OAUTH_CLIENT_SECRET", client.clientSecret);
await upsertDevVar("GOOGLE_OAUTH_REFRESH_TOKEN", tokenData.refresh_token);

console.log("Google Calendar 授权完成，refresh token 已写入 .dev.vars。");

async function readOAuthClient(): Promise<{
  clientId: string;
  clientSecret: string;
}> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (clientId && clientSecret) {
    return { clientId, clientSecret };
  }

  const path =
    process.argv.find((arg) => arg.startsWith("--client="))?.split("=")[1] ||
    "google-oauth-client.json";
  if (!existsSync(path)) {
    throw new Error(
      `missing_google_oauth_client: set GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET or save OAuth client JSON as ${path}`,
    );
  }

  const data = JSON.parse(await readFile(path, "utf8")) as {
    installed?: {
      client_id?: string;
      client_secret?: string;
    };
    web?: {
      client_id?: string;
      client_secret?: string;
    };
  };
  const source = data.installed || data.web;
  if (!source?.client_id || !source.client_secret) {
    throw new Error("invalid_google_oauth_client_json");
  }

  return {
    clientId: source.client_id,
    clientSecret: source.client_secret,
  };
}

async function waitForAuthorizationCode(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(
        req.url ?? "/",
        `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}`,
      );
      if (url.pathname !== "/oauth2callback") {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }

      const error = url.searchParams.get("error");
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");

      const finish = (status: number, message: string) => {
        res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><meta charset="utf-8"><title>Google Calendar</title><p>${message}</p>`,
          () => {
            server.close();
            server.closeAllConnections();
          },
        );
      };

      if (error) {
        finish(400, "授权失败，可以关闭这个页面。");
        reject(new Error(error));
        return;
      }
      if (state !== expectedState || !code) {
        finish(400, "授权回调无效，可以关闭这个页面。");
        reject(new Error("invalid_oauth_callback"));
        return;
      }

      finish(200, "授权成功，可以回到终端。");
      resolve(code);
    });

    server.on("error", reject);
    server.listen(LOOPBACK_PORT, LOOPBACK_HOST, () => {
      console.log(`等待 Google 回调：${REDIRECT_URI}`);
    });
  });
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? (["open", url] as const)
      : process.platform === "win32"
        ? (["cmd", "/c", "start", url] as const)
        : (["xdg-open", url] as const);
  spawn(command[0], command.slice(1), {
    stdio: "ignore",
    detached: true,
    shell: process.platform === "win32",
  }).unref();
}

function base64UrlEncode(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
