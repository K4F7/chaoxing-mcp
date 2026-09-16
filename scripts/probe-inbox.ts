import { mkdir, writeFile } from "node:fs/promises";

import { DEFAULT_CHAOXING_HOME_URL } from "../src/auth";
import { applyDevVars } from "../src/dev-vars";

const OUTPUT_DIR = "/tmp/chaoxing-probe";
const HOME_HTML_PATH = `${OUTPUT_DIR}/home.html`;
const INBOX_HTML_PATH = `${OUTPUT_DIR}/inbox.html`;

await applyDevVars();

const cookie = process.env.CHAOXING_COOKIE;
if (!cookie) {
  throw new Error("missing CHAOXING_COOKIE");
}
const cookieHeader = cookie;

await mkdir(OUTPUT_DIR, { recursive: true });

const homeUrl = process.env.CHAOXING_HOME_URL || DEFAULT_CHAOXING_HOME_URL;
const home = await fetchText(homeUrl, homeUrl);
await writeFile(HOME_HTML_PATH, home.text);

const inboxUrl = findInboxUrl(home.text, home.finalUrl);
if (!inboxUrl) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        reason: "inbox_url_not_found",
        home: summarizePage(home),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const inbox = await fetchText(inboxUrl, home.finalUrl);
await writeFile(INBOX_HTML_PATH, inbox.text);

console.log(
  JSON.stringify(
    {
      ok: true,
      home: summarizePage(home),
      inbox: {
        ...summarizePage(inbox),
        url: inboxUrl,
        loginDetected: isLoginPage(inbox.finalUrl, inbox.text),
        likelyApis: extractLikelyApis(inbox.text, inbox.finalUrl),
        likelyMessages: extractLikelyMessages(inbox.text).slice(0, 20),
      },
      files: {
        homeHtml: HOME_HTML_PATH,
        inboxHtml: INBOX_HTML_PATH,
      },
    },
    null,
    2,
  ),
);

async function fetchText(
  url: string,
  referer: string,
): Promise<{
  status: number;
  finalUrl: string;
  title: string | null;
  length: number;
  text: string;
}> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
      Cookie: cookieHeader,
      Referer: referer,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    },
  });
  const text = await response.text();

  return {
    status: response.status,
    finalUrl: response.url || url,
    title: extractTitle(text),
    length: text.length,
    text,
  };
}

function findInboxUrl(html: string, baseUrl: string): string | null {
  const exact = html.match(
    /https:\/\/notice\.chaoxing\.com\/pc\/notice\/myNotice\?s=[^"'\s<)]+/,
  )?.[0];
  if (exact) {
    return exact;
  }

  const relative = html.match(/\/pc\/notice\/myNotice\?s=[^"'\s<)]+/)?.[0];
  if (relative) {
    return new URL(relative, baseUrl).toString();
  }

  return null;
}

function summarizePage(page: {
  status: number;
  finalUrl: string;
  title: string | null;
  length: number;
}): {
  status: number;
  finalUrl: string;
  title: string | null;
  length: number;
} {
  return {
    status: page.status,
    finalUrl: page.finalUrl,
    title: page.title,
    length: page.length,
  };
}

function extractTitle(html: string): string | null {
  return (
    html
      .match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/\s+/g, " ")
      .trim() || null
  );
}

function isLoginPage(url: string, html: string): boolean {
  return /passport2\.chaoxing\.com\/login|<title[^>]*>\s*用户登录\s*<\/title>|id=["']loginBtn["']/i.test(
    `${url}\n${html}`,
  );
}

function extractLikelyApis(html: string, baseUrl: string): string[] {
  const matches = new Set<string>();
  const patterns = [
    /["']([^"']*(?:notice|message|msg|inbox|letter|mail)[^"']*)["']/gi,
    /\burl\s*:\s*["']([^"']+)["']/gi,
    /\b(?:href|src)=["']([^"']+)["']/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html))) {
      const candidate = match[1]?.trim();
      if (!candidate || candidate.startsWith("#") || candidate.startsWith("javascript:")) {
        continue;
      }
      if (!/notice|message|msg|inbox|letter|mail|noticeType|readStatus/i.test(candidate)) {
        continue;
      }

      try {
        matches.add(new URL(candidate, baseUrl).toString());
      } catch {
        matches.add(candidate);
      }
    }
  }

  return [...matches].slice(0, 80);
}

function extractLikelyMessages(html: string): Array<{
  text: string;
}> {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  const chunks = withoutScripts
    .split(/<\/(?:li|tr|div|p)>/i)
    .map((chunk) =>
      chunk
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((text) => text.length >= 8 && /通知|消息|收件箱|已读|未读|发件|系统/.test(text));

  return [...new Set(chunks)].map((text) => ({ text }));
}
