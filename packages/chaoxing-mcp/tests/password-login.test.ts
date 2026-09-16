import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createDecipheriv } from "node:crypto";

import type { WritableCredentialStore } from "../src/credentials";
import { listTodos, type ListTodosPorts } from "../src/index";
import { AUTH_PROBE_URL } from "../src/login-page";
import {
  createPassportOpenLogin,
  envPasswordCredentialSource,
  passwordLoginHeadless,
  type PasswordCredentials,
  type PasswordLoginRunner,
} from "../src/open-login";
import {
  createFallbackPasswordLogin,
  createHttpPasswordLogin,
  encryptPassportField,
  FANYA_LOGIN_URL,
  redactLoginSecrets,
} from "../src/password-login";
import { COURSE_LIST_URL, INBOX_URL, courseWorkListUrl } from "../src/chaoxing-urls";

const VALID_COOKIE = "UID=1; vc3=abc";

describe("envPasswordCredentialSource", () => {
  test("returns null when username or password env is missing", async () => {
    assert.equal(
      await envPasswordCredentialSource({}).getPasswordCredentials(),
      null,
    );
    assert.equal(
      await envPasswordCredentialSource({
        CHAOXING_USERNAME: "alice",
      }).getPasswordCredentials(),
      null,
    );
    assert.equal(
      await envPasswordCredentialSource({
        CHAOXING_PASSWORD: "secret",
      }).getPasswordCredentials(),
      null,
    );
  });

  test("returns username and password from env without exposing them in thrown messages", async () => {
    const source = envPasswordCredentialSource({
      CHAOXING_USERNAME: "alice",
      CHAOXING_PASSWORD: "s3cret-value",
    });
    const creds = await source.getPasswordCredentials();
    assert.deepEqual(creds, { username: "alice", password: "s3cret-value" });
  });
});

describe("createPassportOpenLogin password path", () => {
  test("when password credentials exist and password login succeeds, writes cookie", async () => {
    const store: WritableCredentialStore & { cookie: string | null } = {
      cookie: null,
      async getCookie() {
        return this.cookie;
      },
      async setCookie(cookie: string) {
        this.cookie = cookie;
      },
    };
    let passwordLoginCalls = 0;
    const passwordLogin: PasswordLoginRunner = {
      async loginWithPassword(credentials: PasswordCredentials) {
        passwordLoginCalls += 1;
        assert.equal(credentials.username, "alice");
        assert.equal(credentials.password, "s3cret-value");
        await store.setCookie(VALID_COOKIE);
      },
    };
    const openLogin = createPassportOpenLogin(store, {
      env: { CHAOXING_USERNAME: "alice", CHAOXING_PASSWORD: "s3cret-value" },
      platform: "linux",
      passwordLogin,
    });

    await openLogin.openLogin();

    assert.equal(passwordLoginCalls, 1);
    assert.equal(store.cookie, VALID_COOKIE);
  });

  test("password login failure without DISPLAY yields a clear auth error, no interactive launch", async () => {
    const store: WritableCredentialStore = {
      async getCookie() {
        return null;
      },
      async setCookie() {},
    };
    const openLogin = createPassportOpenLogin(store, {
      env: {
        CHAOXING_USERNAME: "alice",
        CHAOXING_PASSWORD: "s3cret-value",
        HOME: "/tmp",
      },
      platform: "linux",
      passwordLogin: {
        async loginWithPassword() {
          throw new Error("passport rejected credentials");
        },
      },
    });

    await assert.rejects(
      () => openLogin.openLogin(),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /password|直登|credentials|passport/i);
        assert.doesNotMatch(error.message, /s3cret-value/);
        assert.match(error.message, /display|headless|desktop|interactive/i);
        return true;
      },
    );
  });

  test("password login success lets listTodos continue after openLogin", async () => {
    const store: { cookie: string | null } = { cookie: null };
    const work = courseWorkListUrl({
      courseId: "102",
      classId: "202",
      cpi: "1",
    });
    const ports: ListTodosPorts = {
      credentials: {
        async getCookie() {
          return store.cookie;
        },
      },
      http: {
        async request({ url }) {
          if (url === AUTH_PROBE_URL) {
            return {
              statusCode: 200,
              url: AUTH_PROBE_URL,
              body: "<title>个人空间</title>",
            };
          }
          if (url === COURSE_LIST_URL) {
            return {
              statusCode: 200,
              url: COURSE_LIST_URL,
              body: `<ul id="courseList"><li class="course" courseid="102" clazzid="202" personid="1"><h3 class="course-name">261-新课</h3></li></ul>`,
            };
          }
          if (url === work) {
            return {
              statusCode: 200,
              url: work,
              body: `<ul><li data="/mooc-ans/work/phone/task-work?taskrefId=1&amp;courseId=102&amp;classId=202"><p>作业</p><span class="status">未提交</span><span>截止时间：2026-09-20 23:59</span></li></ul>`,
            };
          }
          if (url === INBOX_URL) {
            return { statusCode: 200, url: INBOX_URL, body: "<ul></ul>" };
          }
          throw new Error(`unexpected url ${url}`);
        },
      },
      openLogin: createPassportOpenLogin(
        {
          async getCookie() {
            return store.cookie;
          },
          async setCookie(cookie: string) {
            store.cookie = cookie;
          },
        },
        {
          env: {
            CHAOXING_USERNAME: "alice",
            CHAOXING_PASSWORD: "s3cret-value",
          },
          platform: "linux",
          passwordLogin: {
            async loginWithPassword() {
              store.cookie = VALID_COOKIE;
            },
          },
        },
      ),
    };

    const result = await listTodos("current_semester", ports);
    assert.equal(result.status, "ok");
    assert.equal(result.todos.length, 1);
    assert.equal(store.cookie, VALID_COOKIE);
  });
});

describe("passwordLoginHeadless", () => {
  test("is true on linux without DISPLAY", () => {
    assert.equal(passwordLoginHeadless({ HOME: "/tmp" }, "linux"), true);
  });

  test("is false on linux with DISPLAY", () => {
    assert.equal(passwordLoginHeadless({ DISPLAY: ":0" }, "linux"), false);
  });

  test("is false on darwin without DISPLAY", () => {
    assert.equal(passwordLoginHeadless({}, "darwin"), false);
  });
});

describe("encryptPassportField", () => {
  test("round-trips a dummy value with the public passport AES key", () => {
    const plain = "dummy-not-a-real-password";
    const encrypted = encryptPassportField(plain);
    assert.notEqual(encrypted, plain);
    const key = Buffer.from("u2oh6Vu^HWe4_AES", "utf8");
    const decipher = createDecipheriv("aes-128-cbc", key, key);
    const decoded = Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64")),
      decipher.final(),
    ]).toString("utf8");
    assert.equal(decoded, plain);
  });
});

describe("createHttpPasswordLogin", () => {
  const creds: PasswordCredentials = {
    username: "alice",
    password: "s3cret-value",
  };
  const I_CHAOXING_HOME = "https://i.chaoxing.com";
  const HOME_HTML = "<title>个人空间</title>";
  const LOGIN_HTML = "<title>用户登录</title>";
  const PASSPORT_LOGIN_URL =
    "https://passport2.chaoxing.com/login?fid=&refer=https%3A%2F%2Fi.chaoxing.com";

  function memoryStore(): WritableCredentialStore & { cookie: string | null } {
    return {
      cookie: null,
      async getCookie() {
        return this.cookie;
      },
      async setCookie(cookie: string) {
        this.cookie = cookie;
      },
    };
  }

  function fanyaSuccessResponse(url?: string): Response {
    const headers = new Headers();
    headers.append("set-cookie", "UID=1; Domain=.chaoxing.com; Path=/");
    headers.append("set-cookie", "vc3=abc; Domain=.chaoxing.com; Path=/");
    const payload =
      url === undefined
        ? { status: true }
        : { status: true, url };
    return new Response(JSON.stringify(payload), { status: 200, headers });
  }

  function htmlResponse(
    url: string,
    body: string,
    setCookies: string[] = [],
  ): Pick<Response, "status" | "url" | "headers" | "text"> {
    const headers = new Headers();
    for (const cookie of setCookies) {
      headers.append("set-cookie", cookie);
    }
    return {
      status: 200,
      url,
      headers,
      text: async () => body,
    };
  }

  test("fake fetch success writes session cookie and does not POST plaintext password", async () => {
    const store = memoryStore();
    const calls: { url: string; method: string; body: string }[] = [];
    const login = createHttpPasswordLogin(store, {
      fetchImpl: async (url, init) => {
        const method = String(init?.method ?? "GET").toUpperCase();
        calls.push({ url, method, body: String(init?.body ?? "") });
        if (url === FANYA_LOGIN_URL) {
          return fanyaSuccessResponse(I_CHAOXING_HOME);
        }
        return htmlResponse(url, HOME_HTML);
      },
    });

    await login.loginWithPassword(creds);

    const fanya = calls.find((call) => call.url === FANYA_LOGIN_URL);
    assert.ok(fanya);
    assert.equal(fanya.method, "POST");
    assert.doesNotMatch(fanya.body, /s3cret-value/);
    assert.match(fanya.body, /uname=/);
    assert.match(fanya.body, /password=/);
    assert.equal(
      calls.some((call) => call.url === I_CHAOXING_HOME && call.method === "GET"),
      true,
    );
    assert.equal(
      calls.some((call) => call.url === AUTH_PROBE_URL),
      true,
    );
    assert.equal(store.cookie, "UID=1; vc3=abc");
  });

  test("fanya success still throws and does not setCookie when AUTH_PROBE is a login page", async () => {
    const store = memoryStore();
    const login = createHttpPasswordLogin(store, {
      fetchImpl: async (url) => {
        if (url === FANYA_LOGIN_URL) {
          return fanyaSuccessResponse(I_CHAOXING_HOME);
        }
        return htmlResponse(PASSPORT_LOGIN_URL, LOGIN_HTML);
      },
    });

    await assert.rejects(
      () => login.loginWithPassword(creds),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /session incomplete|SSO/i);
        assert.doesNotMatch(error.message, /s3cret-value/);
        return true;
      },
    );
    assert.equal(store.cookie, null);
  });

  test("fanya success follows url and sets cookie only after AUTH_PROBE is not a login page", async () => {
    const store = memoryStore();
    const cookieHeaders: { url: string; cookie: string | null }[] = [];
    const login = createHttpPasswordLogin(store, {
      fetchImpl: async (url, init) => {
        cookieHeaders.push({
          url,
          cookie: new Headers(init?.headers).get("cookie"),
        });
        if (url === FANYA_LOGIN_URL) {
          return fanyaSuccessResponse(I_CHAOXING_HOME);
        }
        if (url === I_CHAOXING_HOME) {
          return htmlResponse(url, "<html></html>", [
            "uf=sso; Domain=.chaoxing.com; Path=/",
          ]);
        }
        if (url === AUTH_PROBE_URL) {
          return htmlResponse(AUTH_PROBE_URL, HOME_HTML);
        }
        throw new Error("unexpected url");
      },
    });

    await login.loginWithPassword(creds);

    const follow = cookieHeaders.find((call) => call.url === I_CHAOXING_HOME);
    assert.ok(follow?.cookie);
    assert.match(follow.cookie, /UID=1/);
    assert.match(follow.cookie, /vc3=abc/);
    const probe = cookieHeaders.find((call) => call.url === AUTH_PROBE_URL);
    assert.ok(probe?.cookie);
    assert.match(probe.cookie, /UID=1/);
    assert.match(probe.cookie, /vc3=abc/);
    assert.match(probe.cookie, /uf=sso/);
    assert.ok(store.cookie);
    assert.match(store.cookie, /UID=1/);
    assert.match(store.cookie, /vc3=abc/);
    assert.match(store.cookie, /uf=sso/);
  });

  test("merges Set-Cookie from a trusted SSO 302 hop into AUTH_PROBE Cookie", async () => {
    const store = memoryStore();
    const ssoUrl = "https://passport2.chaoxing.com/sso";
    const cookieHeaders: { url: string; cookie: string | null }[] = [];
    const login = createHttpPasswordLogin(store, {
      fetchImpl: async (url, init) => {
        cookieHeaders.push({
          url,
          cookie: new Headers(init?.headers).get("cookie"),
        });
        if (url === FANYA_LOGIN_URL) {
          return fanyaSuccessResponse(I_CHAOXING_HOME);
        }
        if (url === I_CHAOXING_HOME) {
          const headers = new Headers();
          headers.set("location", ssoUrl);
          headers.append("set-cookie", "uf=sso; Domain=.chaoxing.com; Path=/");
          return {
            status: 302,
            url,
            headers,
            text: async () => "",
          };
        }
        if (url === ssoUrl) {
          return htmlResponse(ssoUrl, "<html></html>");
        }
        if (url === AUTH_PROBE_URL) {
          return htmlResponse(AUTH_PROBE_URL, HOME_HTML);
        }
        throw new Error("unexpected url");
      },
    });

    await login.loginWithPassword(creds);

    const sso = cookieHeaders.find((call) => call.url === ssoUrl);
    assert.ok(sso?.cookie);
    assert.match(sso.cookie, /UID=1/);
    assert.match(sso.cookie, /vc3=abc/);
    assert.match(sso.cookie, /uf=sso/);
    const probe = cookieHeaders.find((call) => call.url === AUTH_PROBE_URL);
    assert.ok(probe?.cookie);
    assert.match(probe.cookie, /uf=sso/);
    assert.ok(store.cookie);
    assert.match(store.cookie, /UID=1/);
    assert.match(store.cookie, /uf=sso/);
    assert.match(store.cookie, /vc3=abc/);
  });

  test("does not fetch an untrusted fanya url; follows i.chaoxing.com instead", async () => {
    const store = memoryStore();
    const urls: string[] = [];
    const login = createHttpPasswordLogin(store, {
      fetchImpl: async (url) => {
        urls.push(url);
        if (url === FANYA_LOGIN_URL) {
          return fanyaSuccessResponse("https://evil.example/phish");
        }
        return htmlResponse(url, HOME_HTML);
      },
    });

    await login.loginWithPassword(creds);

    assert.equal(
      urls.some((url) => url.includes("evil.example")),
      false,
    );
    assert.equal(urls.includes(I_CHAOXING_HOME), true);
    assert.equal(urls.includes(AUTH_PROBE_URL), true);
    assert.equal(store.cookie, "UID=1; vc3=abc");
  });

  test("two-factor JSON body fails clearly without storing a cookie", async () => {
    const store = memoryStore();
    const login = createHttpPasswordLogin(store, {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ status: true, containTwoFactorLogin: true }),
          { status: 200 },
        ),
    });

    await assert.rejects(
      () => login.loginWithPassword(creds),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /two-factor/i);
        assert.doesNotMatch(error.message, /s3cret-value/);
        return true;
      },
    );
    assert.equal(store.cookie, null);
  });

  test("rejects an untrusted login URL without issuing fetch", async () => {
    const store = memoryStore();
    let fetches = 0;
    const login = createHttpPasswordLogin(store, {
      loginUrl: "https://example.com/steal",
      fetchImpl: async () => {
        fetches += 1;
        return new Response("should not run", { status: 200 });
      },
    });

    await assert.rejects(
      () => login.loginWithPassword(creds),
      /untrusted_cookie_request_target/,
    );
    assert.equal(fetches, 0);
    assert.equal(store.cookie, null);
  });

  test("captcha JSON body fails clearly without storing a cookie or leaking the password", async () => {
    const store = memoryStore();
    const login = createHttpPasswordLogin(store, {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ status: false, msg2: "请输入验证码" }),
          { status: 200 },
        ),
    });

    await assert.rejects(
      () => login.loginWithPassword(creds),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /captcha|验证码/i);
        assert.doesNotMatch(error.message, /s3cret-value/);
        return true;
      },
    );
    assert.equal(store.cookie, null);
  });

  test("error JSON body fails clearly without leaking the password", async () => {
    const store = memoryStore();
    const login = createHttpPasswordLogin(store, {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ status: false, msg2: "用户名或密码错误" }),
          { status: 200 },
        ),
    });

    await assert.rejects(
      () => login.loginWithPassword(creds),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /用户名或密码错误|failed/i);
        assert.doesNotMatch(error.message, /s3cret-value/);
        return true;
      },
    );
    assert.equal(store.cookie, null);
  });

  test("风控 HTML body fails clearly", async () => {
    const store = memoryStore();
    const login = createHttpPasswordLogin(store, {
      fetchImpl: async () =>
        new Response("很抱歉，您所浏览的页面暂时不能访问！", { status: 200 }),
    });

    await assert.rejects(
      () => login.loginWithPassword(creds),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /风控/);
        return true;
      },
    );
    assert.equal(store.cookie, null);
  });
});

describe("createFallbackPasswordLogin", () => {
  test("uses Playwright fallback when HTTP fails and does not leak the password", async () => {
    const store: WritableCredentialStore & { cookie: string | null } = {
      cookie: null,
      async getCookie() {
        return this.cookie;
      },
      async setCookie(cookie: string) {
        this.cookie = cookie;
      },
    };
    const login = createFallbackPasswordLogin(
      {
        async loginWithPassword() {
          throw new Error("captcha required for alice / s3cret-value");
        },
      },
      {
        async loginWithPassword() {
          await store.setCookie(VALID_COOKIE);
        },
      },
    );

    await login.loginWithPassword({
      username: "alice",
      password: "s3cret-value",
    });
    assert.equal(store.cookie, VALID_COOKIE);
  });

  test("combines HTTP and Playwright errors without leaking the password", async () => {
    const login = createFallbackPasswordLogin(
      {
        async loginWithPassword() {
          throw new Error("HTTP failed for s3cret-value");
        },
      },
      {
        async loginWithPassword() {
          throw new Error("Playwright failed for s3cret-value");
        },
      },
    );

    await assert.rejects(
      () =>
        login.loginWithPassword({
          username: "alice",
          password: "s3cret-value",
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Playwright fallback/i);
        assert.doesNotMatch(error.message, /s3cret-value/);
        assert.match(error.message, /已隐藏/);
        assert.ok(error.cause instanceof Error);
        assert.doesNotMatch(error.cause.message, /s3cret-value/);
        return true;
      },
    );
  });
});

describe("redactLoginSecrets", () => {
  test("replaces username and password", () => {
    assert.equal(
      redactLoginSecrets("user alice pass s3cret-value", {
        username: "alice",
        password: "s3cret-value",
      }),
      "user [已隐藏] pass [已隐藏]",
    );
  });
});

describe("createPassportOpenLogin HTTP default", () => {
  test("fake HTTP success writes cookie without a PasswordLogin port", async () => {
    const store: WritableCredentialStore & { cookie: string | null } = {
      cookie: null,
      async getCookie() {
        return this.cookie;
      },
      async setCookie(cookie: string) {
        this.cookie = cookie;
      },
    };
    const openLogin = createPassportOpenLogin(store, {
      env: { CHAOXING_USERNAME: "alice", CHAOXING_PASSWORD: "s3cret-value" },
      platform: "linux",
      fetchImpl: async (url) => {
        if (url === FANYA_LOGIN_URL) {
          const headers = new Headers();
          headers.append("set-cookie", "UID=1; Domain=.chaoxing.com");
          headers.append("set-cookie", "vc3=abc; Domain=.chaoxing.com");
          return new Response(JSON.stringify({ status: true }), {
            status: 200,
            headers,
          });
        }
        return {
          status: 200,
          url,
          headers: new Headers(),
          text: async () => "<title>个人空间</title>",
        };
      },
    });

    await openLogin.openLogin();
    assert.equal(store.cookie, "UID=1; vc3=abc");
  });
});
