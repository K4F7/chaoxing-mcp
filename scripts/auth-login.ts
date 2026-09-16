import { chromium, type BrowserContext, type Cookie } from "playwright-core";

import { checkChaoxingAuth, DEFAULT_CHAOXING_HOME_URL } from "../src/auth";
import { applyDevVars, upsertDevVar } from "../src/dev-vars";

const CHAOXING_COOKIE_DOMAINS = [
  "chaoxing.com",
  "i.chaoxing.com",
  "passport2.chaoxing.com",
  "sso.chaoxing.com",
];
const PROFILE_DIR = ".auth/chrome-profile";
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 2_000;

await applyDevVars();

const homeUrl = process.env.CHAOXING_HOME_URL || DEFAULT_CHAOXING_HOME_URL;
const existing = await checkChaoxingAuth({
  cookie: process.env.CHAOXING_COOKIE,
  homeUrl,
});

if (existing.authenticated) {
  console.log(
    JSON.stringify(
      {
        authenticated: true,
        source: "existing_cookie",
        title: existing.title,
        finalUrl: existing.finalUrl,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log(
  JSON.stringify(
    {
      authenticated: false,
      action: "opening_chaoxing_login",
      reason: existing.failureReason,
      message:
        "请在弹出的 Chrome 窗口完成学习通登录。登录成功后，程序会自动保存新的 CHAOXING_COOKIE。",
    },
    null,
    2,
  ),
);

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  channel: "chrome",
  headless: false,
  viewport: { width: 1280, height: 860 },
});

try {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(homeUrl, { waitUntil: "domcontentloaded" });

  const result = await waitForValidCookie(context, homeUrl);
  await upsertDevVar("CHAOXING_COOKIE", result.cookieHeader);

  console.log(
    JSON.stringify(
      {
        authenticated: true,
        source: "browser_login",
        savedTo: ".dev.vars",
        title: result.auth.title,
        finalUrl: result.auth.finalUrl,
      },
      null,
      2,
    ),
  );
} finally {
  await context.close();
}

async function waitForValidCookie(
  context: BrowserContext,
  homeUrl: string,
): Promise<{
  cookieHeader: string;
  auth: Awaited<ReturnType<typeof checkChaoxingAuth>>;
}> {
  const expiresAt = Date.now() + LOGIN_TIMEOUT_MS;

  while (Date.now() < expiresAt) {
    const cookieHeader = await getChaoxingCookieHeader(context);
    if (cookieHeader) {
      const auth = await checkChaoxingAuth({ cookie: cookieHeader, homeUrl });
      if (auth.authenticated) {
        return { cookieHeader, auth };
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error("login_timeout_waiting_for_valid_cookie");
}

async function getChaoxingCookieHeader(
  context: BrowserContext,
): Promise<string> {
  const cookies = await collectCookies(context);
  return cookies
    .filter((cookie) => isChaoxingCookie(cookie))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

async function collectCookies(context: BrowserContext): Promise<Cookie[]> {
  const cookiesByNameAndDomain = new Map<string, Cookie>();

  for (const domain of CHAOXING_COOKIE_DOMAINS) {
    const cookies = await context.cookies(`https://${domain}`);
    for (const cookie of cookies) {
      cookiesByNameAndDomain.set(`${cookie.domain}:${cookie.name}`, cookie);
    }
  }

  return [...cookiesByNameAndDomain.values()];
}

function isChaoxingCookie(cookie: Cookie): boolean {
  return /(^|\.)chaoxing\.com$/i.test(cookie.domain);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
