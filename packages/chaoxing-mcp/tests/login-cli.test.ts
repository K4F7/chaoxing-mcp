import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { WritableCredentialStore } from "../src/credentials";
import {
  credentialsFromFlagsAndEnv,
  LOGIN_OK,
  parseLoginArgv,
  runLoginCli,
} from "../src/login-cli";
import type { PasswordLoginRunner } from "../src/password-login";

const SECRET = "s3cret-value";

function memoryStore(
  cookie: string | null = null,
): WritableCredentialStore & { cookie: string | null } {
  return {
    cookie,
    async getCookie() {
      return this.cookie;
    },
    async setCookie(value: string) {
      this.cookie = value;
    },
  };
}

function capturingIo() {
  let stdout = "";
  let stderr = "";
  return {
    stdout: {
      write(chunk: string) {
        stdout += chunk;
      },
    },
    stderr: {
      write(chunk: string) {
        stderr += chunk;
      },
    },
    getStdout() {
      return stdout;
    },
    getStderr() {
      return stderr;
    },
  };
}

describe("parseLoginArgv", () => {
  test("reads short -u/-p flags", () => {
    const parsed = parseLoginArgv(["-u", "alice", "-p", SECRET]);
    assert.equal(parsed.error, null);
    assert.equal(parsed.username, "alice");
    assert.equal(parsed.password, SECRET);
    assert.equal(parsed.help, false);
  });

  test("reads long --username/--password flags", () => {
    const parsed = parseLoginArgv([
      "--username",
      "alice",
      "--password",
      SECRET,
    ]);
    assert.equal(parsed.username, "alice");
    assert.equal(parsed.password, SECRET);
  });

  test("sets help for -h", () => {
    const parsed = parseLoginArgv(["-h"]);
    assert.equal(parsed.help, true);
  });

  test("returns an error for unknown flags", () => {
    const parsed = parseLoginArgv(["--bogus"]);
    assert.notEqual(parsed.error, null);
  });
});

describe("credentialsFromFlagsAndEnv", () => {
  test("uses env when flags are missing", () => {
    const creds = credentialsFromFlagsAndEnv(
      { username: undefined, password: undefined, help: false, error: null },
      { CHAOXING_USERNAME: "alice", CHAOXING_PASSWORD: SECRET },
    );
    assert.deepEqual(creds, { username: "alice", password: SECRET });
  });

  test("flags override env", () => {
    const creds = credentialsFromFlagsAndEnv(
      { username: "bob", password: "flag-secret", help: false, error: null },
      { CHAOXING_USERNAME: "alice", CHAOXING_PASSWORD: SECRET },
    );
    assert.deepEqual(creds, { username: "bob", password: "flag-secret" });
  });
});

describe("runLoginCli", () => {
  test("fake PasswordLogin success prints LOGIN_OK without cookie or password", async () => {
    const store = memoryStore();
    const io = capturingIo();
    const passwordLogin: PasswordLoginRunner = {
      async loginWithPassword(credentials) {
        assert.equal(credentials.username, "alice");
        assert.equal(credentials.password, SECRET);
        await store.setCookie("UID=1; vc3=abc");
      },
    };

    const code = await runLoginCli({
      argv: ["-u", "alice", "-p", SECRET],
      env: {},
      credentials: store,
      passwordLogin,
      io,
    });

    assert.equal(code, 0);
    assert.match(io.getStdout(), new RegExp(`^${LOGIN_OK}\\n$`));
    assert.doesNotMatch(io.getStdout(), /UID=1/);
    assert.doesNotMatch(io.getStdout(), new RegExp(SECRET));
    assert.doesNotMatch(io.getStderr(), new RegExp(SECRET));
    assert.equal(store.cookie, "UID=1; vc3=abc");
  });

  test("reads username and password from env when argv is empty", async () => {
    const store = memoryStore();
    const io = capturingIo();
    let seenUser = "";
    const code = await runLoginCli({
      argv: [],
      env: { CHAOXING_USERNAME: "alice", CHAOXING_PASSWORD: SECRET },
      credentials: store,
      passwordLogin: {
        async loginWithPassword(credentials) {
          seenUser = credentials.username;
          await store.setCookie("UID=1; vc3=abc");
        },
      },
      io,
    });
    assert.equal(code, 0);
    assert.equal(seenUser, "alice");
    assert.match(io.getStdout(), /LOGIN_OK has_cookie=true/);
  });

  test("prompts when flags and env are missing", async () => {
    const store = memoryStore();
    const io = capturingIo();
    const code = await runLoginCli({
      argv: [],
      env: {},
      credentials: store,
      passwordLogin: {
        async loginWithPassword() {
          await store.setCookie("UID=1; vc3=abc");
        },
      },
      io: {
        ...io,
        async promptUsername() {
          return "alice";
        },
        async promptPassword() {
          return SECRET;
        },
      },
    });
    assert.equal(code, 0);
    assert.match(io.getStdout(), /LOGIN_OK has_cookie=true/);
  });

  test("exits non-zero with a clear message when login fails, without printing the password", async () => {
    const store = memoryStore();
    const io = capturingIo();
    const code = await runLoginCli({
      argv: ["-u", "alice", "-p", SECRET],
      env: {},
      credentials: store,
      passwordLogin: {
        async loginWithPassword() {
          throw new Error("passport rejected s3cret-value");
        },
      },
      io,
    });
    assert.equal(code, 1);
    assert.equal(io.getStdout(), "");
    assert.match(io.getStderr(), /password|直登|passport|failed/i);
    assert.doesNotMatch(io.getStderr(), new RegExp(SECRET));
  });

  test("prompt cancellation exits non-zero without leaking the password", async () => {
    const io = capturingIo();
    const code = await runLoginCli({
      argv: ["-u", "alice"],
      env: {},
      credentials: memoryStore(),
      passwordLogin: {
        async loginWithPassword() {
          throw new Error("should not run");
        },
      },
      io: {
        ...io,
        async promptPassword() {
          throw new Error("login cancelled");
        },
      },
    });
    assert.equal(code, 1);
    assert.match(io.getStderr(), /cancelled|failed/i);
    assert.doesNotMatch(io.getStderr(), new RegExp(SECRET));
  });

  test("usage tells npm --silent so the password is not reprinted on the script banner", () => {
    const io = capturingIo();
    return runLoginCli({
      argv: ["-h"],
      env: {},
      credentials: memoryStore(),
      passwordLogin: {
        async loginWithPassword() {
          throw new Error("should not run");
        },
      },
      io,
    }).then((code) => {
      assert.equal(code, 0);
      assert.match(io.getStdout(), /--silent/);
      assert.match(io.getStdout(), /CHAOXING_PASSWORD/);
    });
  });

  test("exits non-zero when credentials are missing and there is no prompt", async () => {
    const io = capturingIo();
    const code = await runLoginCli({
      argv: [],
      env: {},
      credentials: memoryStore(),
      passwordLogin: {
        async loginWithPassword() {
          throw new Error("should not run");
        },
      },
      io,
    });
    assert.equal(code, 1);
    assert.match(io.getStderr(), /CHAOXING_USERNAME|username/i);
  });
});
