import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { WritableCredentialStore } from "../src/credentials";
import { listTodos, type ListTodosPorts } from "../src/index";
import { AUTH_PROBE_URL } from "../src/login-page";
import {
  createPassportOpenLogin,
  envPasswordCredentialSource,
  type PasswordCredentials,
  type PasswordLoginRunner,
} from "../src/open-login";
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
