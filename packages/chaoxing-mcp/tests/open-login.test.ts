import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { WritableCredentialStore } from "../src/credentials";
import {
  cannotOpenLoginUiMessage,
  createPassportOpenLogin,
  describeLoginFailure,
} from "../src/open-login";

const emptyStore: WritableCredentialStore = {
  async getCookie() {
    return null;
  },
  async setCookie() {},
};

describe("describeLoginFailure", () => {
  test("explains a missing Chrome channel without looking like empty 待办事项", () => {
    const message = describeLoginFailure(
      new Error(
        "browserType.launchPersistentContext: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome",
      ),
    );

    assert.match(message, /Chrome/i);
    assert.doesNotMatch(message, /待办事项/);
    assert.notEqual(message, "认证失效");
  });

  test("explains a headed browser with no X server / DISPLAY", () => {
    const message = describeLoginFailure(
      new Error(
        "Looks like you launched a headed browser without having a XServer running. Set either 'headless: true' or use 'xvfb-run'",
      ),
    );

    assert.match(message, /display|headless|desktop/i);
    assert.doesNotMatch(message, /待办事项/);
  });

  test("keeps a login wait timeout message", () => {
    assert.equal(
      describeLoginFailure(new Error("login wait timeout")),
      "login wait timeout",
    );
  });
});

describe("cannotOpenLoginUiMessage", () => {
  test("is set on linux without DISPLAY", () => {
    const message = cannotOpenLoginUiMessage({ HOME: "/tmp" }, "linux");

    assert.notEqual(message, null);
    assert.match(String(message), /display|headless|desktop/i);
  });

  test("is null on linux with DISPLAY", () => {
    assert.equal(
      cannotOpenLoginUiMessage({ DISPLAY: ":0" }, "linux"),
      null,
    );
  });

  test("is null on darwin without DISPLAY", () => {
    assert.equal(cannotOpenLoginUiMessage({}, "darwin"), null);
  });
});

describe("createPassportOpenLogin", () => {
  test("throws a display message on linux without DISPLAY, without launching Chrome", async () => {
    const openLogin = createPassportOpenLogin(emptyStore, {
      env: { HOME: "/tmp" },
      platform: "linux",
    });

    await assert.rejects(
      () => openLogin.openLogin(),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /display|headless|desktop/i);
        return true;
      },
    );
  });
});
