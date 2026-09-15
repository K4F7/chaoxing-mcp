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

  test("fake fetch success writes session cookie and does not POST plaintext password", async () => {
    const store = memoryStore();
    const calls: { url: string; body: string }[] = [];
    const login = createHttpPasswordLogin(store, {
      fetchImpl: async (url, init) => {
        calls.push({ url, body: String(init?.body ?? "") });
        const headers = new Headers();
        headers.append("set-cookie", "UID=1; Domain=.chaoxing.com; Path=/");
        headers.append("set-cookie", "vc3=abc; Domain=.chaoxing.com; Path=/");
        return new Response(JSON.stringify({ status: true, url: "https://i.chaoxing.com" }), {
          status: 200,
          headers,
        });
      },
    });

    await login.loginWithPassword(creds);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, FANYA_LOGIN_URL);
    assert.doesNotMatch(calls[0]?.body ?? "", /s3cret-value/);
    assert.match(calls[0]?.body ?? "", /uname=/);
    assert.match(calls[0]?.body ?? "", /password=/);
    assert.equal(store.cookie, "UID=1; vc3=abc");
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
      fetchImpl: async () => {
        const headers = new Headers();
        headers.append("set-cookie", "UID=1; Domain=.chaoxing.com");
        headers.append("set-cookie", "vc3=abc; Domain=.chaoxing.com");
        return new Response(JSON.stringify({ status: true }), {
          status: 200,
          headers,
        });
      },
    });

    await openLogin.openLogin();
    assert.equal(store.cookie, "UID=1; vc3=abc");
  });
});
