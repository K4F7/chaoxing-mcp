import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { listTodos, type ListTodosPorts } from "../src/index";

type FakeStore = { cookie: string | null };

function createPorts(options: {
  cookie?: string | null;
  httpResponse?: { statusCode: number; url: string; body: string };
  onOpenLogin?: (store: FakeStore) => Promise<void>;
} = {}): {
  ports: ListTodosPorts;
  store: FakeStore;
  openLoginCallCount: () => number;
  httpCallCount: () => number;
} {
  const store: FakeStore = { cookie: options.cookie ?? null };
  let openLoginCallCount = 0;
  let httpCallCount = 0;
  const ports: ListTodosPorts = {
    credentials: {
      async getCookie() {
        return store.cookie;
      },
    },
    http: {
      async request() {
        httpCallCount += 1;
        if (options.httpResponse) {
          return options.httpResponse;
        }
        throw new Error("listTodos must not hit the network in this slice");
      },
    },
    openLogin: {
      async openLogin() {
        openLoginCallCount += 1;
        if (options.onOpenLogin) {
          await options.onOpenLogin(store);
        }
      },
    },
  };
  return {
    ports,
    store,
    openLoginCallCount: () => openLoginCallCount,
    httpCallCount: () => httpCallCount,
  };
}

function portsWithoutCookie(): ListTodosPorts {
  return createPorts().ports;
}

describe("listTodos 认证失效", () => {
  test("returns auth_expired as an error when the credential port has no cookie, not a successful empty 待办事项 list", async () => {
    const result = await listTodos("current_semester", portsWithoutCookie());

    assert.equal(result.status, "auth_expired");
    assert.equal(result.isError, true);
    assert.notEqual(result.status, "ok");
  });

  test("opens 学习通 login once when there is no cookie", async () => {
    const fake = createPorts();

    const result = await listTodos("current_semester", fake.ports);

    assert.equal(fake.openLoginCallCount(), 1);
    assert.equal(result.status, "auth_expired");
    assert.equal(result.isError, true);
  });

  test("still returns auth_expired after openLogin writes a cookie, without listing 待办事项", async () => {
    const fake = createPorts({
      async onOpenLogin(store) {
        store.cookie = "UID=1; vc3=abc";
      },
    });

    const result = await listTodos("current_semester", fake.ports);

    assert.equal(fake.store.cookie, "UID=1; vc3=abc");
    assert.equal(fake.openLoginCallCount(), 1);
    assert.equal(result.status, "auth_expired");
    assert.equal(result.isError, true);
    assert.deepEqual(result.todos, []);
    assert.notEqual(result.status, "ok");
    assert.equal(fake.httpCallCount(), 0);
  });
});

describe("listTodos scope", () => {
  test("rejects an illegal scope instead of defaulting to current_semester", async () => {
    const fake = createPorts();

    const result = await listTodos("yesterday", fake.ports);

    assert.equal(result.isError, true);
    assert.notEqual(result.status, "ok");
    assert.notEqual(result.scope, "current_semester");
    assert.equal(fake.openLoginCallCount(), 0);
  });

  test("defaults omitted scope to current_semester without fetching courses", async () => {
    const result = await listTodos(undefined, portsWithoutCookie());

    assert.equal(result.scope, "current_semester");
    assert.equal(result.status, "auth_expired");
    assert.equal(result.isError, true);
  });
});

describe("listTodos existing cookie", () => {
  test("does not open login when a stored cookie does not land on a 学习通 login page", async () => {
    const fake = createPorts({
      cookie: "UID=1; vc3=abc",
      httpResponse: {
        statusCode: 200,
        url: "https://i.chaoxing.com/base",
        body: "<title>个人空间</title><div>收件箱</div>",
      },
    });

    await assert.rejects(
      () => listTodos("current_semester", fake.ports),
      /listing 待办事项 is not implemented/,
    );
    assert.equal(fake.httpCallCount(), 1);
    assert.equal(fake.openLoginCallCount(), 0);
  });

  test("opens login once when a stored cookie lands on a 学习通 login page", async () => {
    const fake = createPorts({
      cookie: "UID=stale; vc3=old",
      httpResponse: {
        statusCode: 200,
        url: "https://passport2.chaoxing.com/login?fid=1",
        body: '<title>用户登录</title><button id="loginBtn">登录</button>',
      },
    });

    const result = await listTodos("current_semester", fake.ports);

    assert.equal(fake.openLoginCallCount(), 1);
    assert.equal(result.status, "auth_expired");
    assert.equal(result.isError, true);
    assert.deepEqual(result.todos, []);
  });
});

describe("listTodos login wait", () => {
  test("returns auth_expired when openLogin times out waiting for login", async () => {
    const fake = createPorts({
      async onOpenLogin() {
        throw new Error("login wait timeout");
      },
    });

    const result = await listTodos("current_semester", fake.ports);

    assert.equal(fake.openLoginCallCount(), 1);
    assert.equal(result.status, "auth_expired");
    assert.equal(result.isError, true);
    assert.notEqual(result.status, "ok");
  });
});

describe("listTodos result secrecy", () => {
  test("does not put cookie or account strings in the listTodos result", async () => {
    const secretCookie = "UID=secret-cookie-value-xyz; uf=phone-13800138000";
    const fake = createPorts({
      cookie: secretCookie,
      httpResponse: {
        statusCode: 200,
        url: "https://passport2.chaoxing.com/login?fid=1",
        body: "<title>用户登录</title>",
      },
      async onOpenLogin(store) {
        store.cookie = `${secretCookie}; p_auth_token=account-token`;
      },
    });

    const result = await listTodos("current_semester", fake.ports);
    const json = JSON.stringify(result);

    assert.equal(result.status, "auth_expired");
    assert.equal("cookie" in result, false);
    assert.equal("account" in result, false);
    assert.equal(json.includes(secretCookie), false);
    assert.equal(json.includes("secret-cookie-value-xyz"), false);
    assert.equal(json.includes("13800138000"), false);
    assert.equal(json.includes("account-token"), false);
  });
});
