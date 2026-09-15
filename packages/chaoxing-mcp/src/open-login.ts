import { homedir } from "node:os";
import { join } from "node:path";

import { chromium, type BrowserContext, type Cookie, type Page } from "playwright-core";

import type { WritableCredentialStore } from "./credentials";
import type { OpenLogin } from "./list-todos";
import { AUTH_PROBE_URL, looksLikeLoginPage } from "./login-page";

const CHAOXING_LOGIN_URL =
  "https://passport2.chaoxing.com/login?fid=&refer=https%3A%2F%2Fi.chaoxing.com";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 2_000;
const PASSWORD_LOGIN_TIMEOUT_MS = 60_000;

const MISSING_CHROME_MESSAGE =
  "Chrome is not installed or the chrome channel is missing. Interactive 学习通 login needs Google Chrome.";

const NO_DISPLAY_MESSAGE =
  "Cannot open 学习通 login UI (no display / headless). Log in once on a machine with a desktop so the cookie is in the keychain, then retry.";

const PASSWORD_LOGIN_FAILED_PREFIX =
  "Password login (账密直登) failed";

export type PasswordCredentials = {
  username: string;
  password: string;
};

export type PasswordCredentialSource = {
  getPasswordCredentials(): Promise<PasswordCredentials | null>;
};

export type PasswordLoginRunner = {
  loginWithPassword(credentials: PasswordCredentials): Promise<void>;
};

export function envPasswordCredentialSource(
  env: NodeJS.ProcessEnv = process.env,
): PasswordCredentialSource {
  return {
    async getPasswordCredentials() {
      const username = env.CHAOXING_USERNAME?.trim() ?? "";
      const password = env.CHAOXING_PASSWORD ?? "";
      if (username.length === 0 || password.length === 0) {
        return null;
      }
      return { username, password };
    },
  };
}

export function cannotOpenLoginUiMessage(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (platform === "win32" || platform === "darwin") {
    return null;
  }
  const display = env.DISPLAY;
  if (display == null || display.trim() === "") {
    return NO_DISPLAY_MESSAGE;
  }
  return null;
}

export function describeLoginFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const text = raw.trim();
  if (
    /chromium distribution ['"]?chrome['"]? is not found/i.test(text) ||
    /executable doesn't exist/i.test(text) ||
    /browserType\.launch.*chrome/i.test(text)
  ) {
    return MISSING_CHROME_MESSAGE;
  }
  if (
    /missing x server/i.test(text) ||
    /headed browser without having a xserver/i.test(text) ||
    /no display/i.test(text) ||
    /\$DISPLAY/i.test(text)
  ) {
    return NO_DISPLAY_MESSAGE;
  }
  return text.length > 0 ? text : "认证失效";
}

export function createPassportOpenLogin(
  credentials: WritableCredentialStore,
  options: {
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    passwordCredentials?: PasswordCredentialSource;
    passwordLogin?: PasswordLoginRunner;
  } = {},
): OpenLogin {
  const timeoutMs = options.timeoutMs ?? LOGIN_TIMEOUT_MS;
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const passwordCredentials =
    options.passwordCredentials ?? envPasswordCredentialSource(env);
  const passwordLogin =
    options.passwordLogin ??
    createPlaywrightPasswordLogin(credentials, { env, platform });

  return {
    async openLogin() {
      const passwordCreds = await passwordCredentials.getPasswordCredentials();
      if (passwordCreds != null) {
        try {
          console.error(
            "Trying 学习通 password login (账密直登) via Playwright",
          );
          await passwordLogin.loginWithPassword(passwordCreds);
          return;
        } catch (error) {
          const detail = describeLoginFailure(error);
          const blocked = cannotOpenLoginUiMessage(env, platform);
          if (blocked != null) {
            const message = `${PASSWORD_LOGIN_FAILED_PREFIX}: ${detail}. Interactive fallback unavailable: ${blocked}`;
            console.error("学习通 login failed:", message);
            throw new Error(message, { cause: error });
          }
          console.error(
            "学习通 password login failed; falling back to interactive login:",
            detail,
          );
        }
      }

      console.error("Opening 学习通 login at passport2.chaoxing.com");
      let context: BrowserContext | undefined;
      try {
        const blocked = cannotOpenLoginUiMessage(env, platform);
        if (blocked != null) {
          throw new Error(blocked);
        }
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
        const message = describeLoginFailure(error);
        console.error("学习通 login failed:", message);
        throw new Error(message, { cause: error });
      } finally {
        await context?.close();
      }
    },
  };
}

function createPlaywrightPasswordLogin(
  credentials: WritableCredentialStore,
  options: {
    env: NodeJS.ProcessEnv;
    platform: NodeJS.Platform;
  },
): PasswordLoginRunner {
  return {
    async loginWithPassword(passwordCreds) {
      const blocked = cannotOpenLoginUiMessage(options.env, options.platform);
      // Password fill still needs a headed Chrome on Linux (captcha / risk controls).
      if (blocked != null) {
        throw new Error(blocked);
      }
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
        await fillPassportCredentials(page, passwordCreds);
        const cookie = await waitForValidCookie(
          context,
          PASSWORD_LOGIN_TIMEOUT_MS,
        );
        await credentials.setCookie(cookie);
      } finally {
        await context?.close();
      }
    },
  };
}

async function fillPassportCredentials(
  page: Page,
  credentials: PasswordCredentials,
): Promise<void> {
  const usernameSelectors = [
    "#phone",
    "input[name='uname']",
    "#uname",
    "input[name='phone']",
    "input[type='tel']",
  ];
  const passwordSelectors = ["#pwd", "input[name='password']", "input[type='password']"];
  const submitSelectors = [
    "#loginBtn",
    "button#loginBtn",
    "input#loginBtn",
    "button[type='submit']",
    "input[type='submit']",
  ];

  let filledUser = false;
  for (const selector of usernameSelectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      await locator.fill(credentials.username);
      filledUser = true;
      break;
    }
  }
  if (!filledUser) {
    throw new Error("password login: username field not found on passport page");
  }

  let filledPassword = false;
  for (const selector of passwordSelectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      await locator.fill(credentials.password);
      filledPassword = true;
      break;
    }
  }
  if (!filledPassword) {
    throw new Error("password login: password field not found on passport page");
  }

  let clicked = false;
  for (const selector of submitSelectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      await locator.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    await page.keyboard.press("Enter");
  }
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
