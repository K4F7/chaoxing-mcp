import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { listTodos, type ListTodosPorts } from "../src/index";

function portsWithoutCookie(): ListTodosPorts {
  return {
    credentials: {
      async getCookie() {
        return null;
      },
    },
    http: {
      async request() {
        throw new Error("listTodos must not hit the network in this slice");
      },
    },
    openLogin: {
      async openLogin() {
        throw new Error("listTodos must not require opening login in this slice");
      },
    },
  };
}

describe("listTodos 认证失效", () => {
  test("returns auth_expired as an error when the credential port has no cookie, not a successful empty 待办事项 list", async () => {
    const result = await listTodos("current_semester", portsWithoutCookie());

    assert.equal(result.status, "auth_expired");
    assert.equal(result.isError, true);
    assert.notEqual(result.status, "ok");
  });
});

describe("listTodos scope", () => {
  test("rejects an illegal scope instead of defaulting to current_semester", async () => {
    const result = await listTodos("yesterday", portsWithoutCookie());

    assert.equal(result.isError, true);
    assert.notEqual(result.status, "ok");
    assert.notEqual(result.scope, "current_semester");
  });

  test("defaults omitted scope to current_semester without fetching courses", async () => {
    const result = await listTodos(undefined, portsWithoutCookie());

    assert.equal(result.scope, "current_semester");
    assert.equal(result.status, "auth_expired");
    assert.equal(result.isError, true);
  });
});
