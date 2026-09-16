import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  checkChaoxingAuth,
  detectLoginSignals,
  extractPageTitle,
} from "../src/auth";

describe("chaoxing auth detection", () => {
  test("reports missing cookie without calling fetch", async () => {
    let called = false;
    const result = await checkChaoxingAuth({
      fetcher: async () => {
        called = true;
        return new Response("unexpected");
      },
    });

    assert.equal(called, false);
    assert.equal(result.authenticated, false);
    assert.equal(result.failureReason, "missing CHAOXING_COOKIE");
  });

  test("detects chaoxing login page signals", () => {
    const html = '<title>用户登录</title><button id="loginBtn">登录</button>';
    const signals = detectLoginSignals(
      "https://passport2.chaoxing.com/login?fid=12",
      html,
    );

    assert.equal(signals.hasPassportLoginUrl, true);
    assert.equal(signals.hasLoginTitle, true);
    assert.equal(signals.hasLoginButton, true);
  });

  test("treats rendered login page as unauthenticated", async () => {
    const result = await checkChaoxingAuth({
      cookie: "UID=expired",
      fetcher: async () =>
        new Response('<html><title>用户登录</title><button id="loginBtn">登录</button></html>', {
          status: 200,
        }),
    });

    assert.equal(result.authenticated, false);
    assert.equal(result.failureReason, "redirected_or_rendered_login_page");
    assert.equal(JSON.stringify(result).includes("UID=expired"), false);
  });

  test("accepts a likely logged-in personal space page", async () => {
    const result = await checkChaoxingAuth({
      cookie: "UID=valid",
      fetcher: async () =>
        new Response("<html><title>学习通</title><body>个人空间 我的课程 收件箱</body></html>", {
          status: 200,
        }),
    });

    assert.equal(result.authenticated, true);
    assert.equal(result.title, "学习通");
    assert.equal(result.features.hasLikelySpaceText, true);
    assert.equal(result.features.hasCourseText, true);
    assert.equal(result.features.hasInboxText, true);
    assert.equal(JSON.stringify(result).includes("UID=valid"), false);
  });

  test("does not follow non-chaoxing redirects with cookies", async () => {
    const calls: Array<{ url: string; cookie: string | null }> = [];
    const result = await checkChaoxingAuth({
      cookie: "UID=secret",
      fetcher: async (input, init) => {
        const url = String(input);
        calls.push({
          url,
          cookie: new Headers(init?.headers).get("Cookie"),
        });
        return new Response("", {
          status: 302,
          headers: { Location: "https://evil.example/login" },
        });
      },
    });

    assert.equal(result.authenticated, false);
    assert.equal(result.failureReason, "untrusted_redirect_target");
    assert.deepEqual(calls, [
      {
        url: "https://i.chaoxing.com/base?ws=1&t=1780231212848",
        cookie: "UID=secret",
      },
    ]);
    assert.equal(JSON.stringify(result).includes("UID=secret"), false);
  });

  test("follows chaoxing redirects with cookies", async () => {
    const calls: Array<{ url: string; cookie: string | null }> = [];
    const result = await checkChaoxingAuth({
      cookie: "UID=valid",
      fetcher: async (input, init) => {
        const url = String(input);
        calls.push({
          url,
          cookie: new Headers(init?.headers).get("Cookie"),
        });

        if (url.startsWith("https://i.chaoxing.com/base")) {
          return new Response("", {
            status: 302,
            headers: { Location: "https://notice.chaoxing.com/pc/notice/myNotice" },
          });
        }

        return new Response(
          "<html><title>学习通</title><body>个人空间 我的课程 收件箱</body></html>",
          { status: 200 },
        );
      },
    });

    assert.equal(result.authenticated, true);
    assert.deepEqual(calls, [
      {
        url: "https://i.chaoxing.com/base?ws=1&t=1780231212848",
        cookie: "UID=valid",
      },
      {
        url: "https://notice.chaoxing.com/pc/notice/myNotice",
        cookie: "UID=valid",
      },
    ]);
  });

  test("extracts and normalizes page title", () => {
    assert.equal(
      extractPageTitle("<title> 学习通 &amp; 个人空间 </title>"),
      "学习通 & 个人空间",
    );
  });
});
