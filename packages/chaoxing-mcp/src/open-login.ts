import { homedir } from "node:os";
import { join } from "node:path";

import { chromium, type BrowserContext, type Cookie } from "playwright-core";

import type { WritableCredentialStore } from "./credentials";
import type { OpenLogin } from "./list-todos";
import { AUTH_PROBE_URL, looksLikeLoginPage } from "./login-page";

const CHAOXING_LOGIN_URL =
  "https://passport2.chaoxing.com/login?fid=&refer=https%3A%2F%2Fi.chaoxing.com";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 2_000;

export function createPassportOpenLogin(
  credentials: WritableCredentialStore,
  options: { timeoutMs?: number } = {},
): OpenLogin {
  const timeoutMs = options.timeoutMs ?? LOGIN_TIMEOUT_MS;
  return {
    async openLogin() {
      console.error("Opening 学习通 login at passport2.chaoxing.com");
      let context: BrowserContext | undefined;
      try {
        context = await chromium.launchPersistentContext(
          join(homedir(), ".chaoxinghelper", "chrome-profile"),
          {
            channel: "chrome",
            headless: false,
            viewport: { width: 1280, height: 860 },
          },
        );
        const page = context.pages()[0] ?? (await context.newPage());
        await page.goto(CHAOXING_LOGIN_URL, { waitUntil: "domcontentloaded" });
        const cookie = await waitForValidCookie(context, timeoutMs);
        await credentials.setCookie(cookie);
      } catch (error) {
        console.error(
          "学习通 login failed:",
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      } finally {
        await context?.close();
      }
    },
  };
}

async function waitForValidCookie(
  context: BrowserContext,
  timeoutMs: number,
): Promise<string> {
  const expiresAt = Date.now() + timeoutMs;
  while (Date.now() < expiresAt) {
    const header = cookieHeaderFrom(await context.cookies());
    if (header != null && (await cookieAuthenticates(header))) {
      return header;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error("login wait timeout");
}

async function cookieAuthenticates(cookie: string): Promise<boolean> {
  try {
    const response = await fetch(AUTH_PROBE_URL, {
      headers: { cookie },
      redirect: "follow",
    });
    const body = await response.text();
    return (
      response.status >= 200 &&
      response.status < 300 &&
      !looksLikeLoginPage(response.url, body)
    );
  } catch {
    return false;
  }
}

function cookieHeaderFrom(cookies: Cookie[]): string | null {
  const chaoxing = cookies.filter((cookie) =>
    /(^|\.)chaoxing\.com$/i.test(cookie.domain),
  );
  if (chaoxing.length === 0) {
    return null;
  }
  return chaoxing
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
