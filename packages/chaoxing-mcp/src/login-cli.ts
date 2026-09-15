import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import type { WritableCredentialStore } from "./credentials";
import {
  createFallbackPasswordLogin,
  createHttpPasswordLogin,
  redactLoginSecrets,
  type PasswordCredentials,
  type PasswordLoginRunner,
} from "./password-login";
import {
  createPlaywrightPasswordLogin,
  describeLoginFailure,
} from "./open-login";

export const LOGIN_OK = "LOGIN_OK has_cookie=true";

const USAGE = `Usage: npm run login --silent -- [-u|--username <user>]

Mirrors \`pu login -u/-p\`. Flags override env CHAOXING_USERNAME / CHAOXING_PASSWORD.
Prefer the env or a hidden prompt for the password; -p works but npm may reprint it unless --silent.
Missing values are prompted only in this CLI (MCP tools never take passwords).
On success prints "${LOGIN_OK}" and stores the cookie in the keychain.
Never prints the password or cookie value.
`;

export type ParsedLoginFlags = {
  username: string | undefined;
  password: string | undefined;
  help: boolean;
  error: string | null;
};

export type LoginCliIo = {
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
  promptUsername?: () => Promise<string>;
  promptPassword?: () => Promise<string>;
};

export function parseLoginArgv(argv: string[]): ParsedLoginFlags {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        username: { type: "string", short: "u" },
        password: { type: "string", short: "p" },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: false,
      strict: true,
    });
    return {
      username: values.username,
      password: values.password,
      help: values.help === true,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      username: undefined,
      password: undefined,
      help: false,
      error: message,
    };
  }
}

export function credentialsFromFlagsAndEnv(
  flags: ParsedLoginFlags,
  env: NodeJS.ProcessEnv,
): { username: string; password: string } {
  const username = flags.username?.trim() || env.CHAOXING_USERNAME?.trim() || "";
  const password =
    flags.password !== undefined && flags.password.length > 0
      ? flags.password
      : (env.CHAOXING_PASSWORD ?? "");
  return { username, password };
}

export async function runLoginCli(input: {
  argv: string[];
  env: NodeJS.ProcessEnv;
  credentials: WritableCredentialStore;
  passwordLogin: PasswordLoginRunner;
  io: LoginCliIo;
}): Promise<number> {
  const flags = parseLoginArgv(input.argv);
  if (flags.help) {
    input.io.stdout.write(USAGE);
    return 0;
  }
  if (flags.error != null) {
    input.io.stderr.write(`${flags.error}\n${USAGE}`);
    return 1;
  }

  let resolved = credentialsFromFlagsAndEnv(flags, input.env);
  try {
    if (resolved.username.length === 0 && input.io.promptUsername != null) {
      resolved = {
        ...resolved,
        username: (await input.io.promptUsername()).trim(),
      };
    }
    if (resolved.password.length === 0 && input.io.promptPassword != null) {
      resolved = { ...resolved, password: await input.io.promptPassword() };
    }
  } catch (error) {
    const message = redactLoginSecrets(describeLoginFailure(error), resolved);
    input.io.stderr.write(`${message}\n`);
    return 1;
  }

  if (resolved.username.length === 0 || resolved.password.length === 0) {
    input.io.stderr.write(
      "Username and password are required via -u/-p or CHAOXING_USERNAME/CHAOXING_PASSWORD.\n",
    );
    return 1;
  }

  const creds: PasswordCredentials = resolved;
  try {
    await input.passwordLogin.loginWithPassword(creds);
    const cookie = await input.credentials.getCookie();
    if (cookie == null || cookie.trim() === "") {
      input.io.stderr.write(
        "Password login (账密直登) failed: no cookie was stored in the keychain.\n",
      );
      return 1;
    }
    input.io.stdout.write(`${LOGIN_OK}\n`);
    return 0;
  } catch (error) {
    const message = redactLoginSecrets(describeLoginFailure(error), creds);
    input.io.stderr.write(`${message}\n`);
    return 1;
  }
}

function ttyPrompter(): Pick<LoginCliIo, "promptUsername" | "promptPassword"> {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    return {};
  }
  return {
    async promptUsername() {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        return await rl.question("Username: ");
      } finally {
        rl.close();
      }
    },
    async promptPassword() {
      return readHiddenPassword("Password: ");
    },
  };
}

async function readHiddenPassword(prompt: string): Promise<string> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  stdout.write(prompt);
  if (typeof stdin.setRawMode !== "function") {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      return await rl.question("");
    } finally {
      rl.close();
    }
  }

  const previousRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  let value = "";
  return new Promise((resolve, reject) => {
    const restore = () => {
      stdin.off("data", onData);
      stdin.setRawMode(previousRaw);
      stdin.pause();
    };
    const onData = (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (text === "\u0003") {
        restore();
        stdout.write("\n");
        reject(new Error("login cancelled"));
        return;
      }
      if (text === "\n" || text === "\r" || text === "\r\n") {
        restore();
        stdout.write("\n");
        resolve(value);
        return;
      }
      if (text === "\u007f" || text === "\b") {
        value = value.slice(0, -1);
        return;
      }
      value += text;
    };
    stdin.on("data", onData);
  });
}

export function createDefaultCliPasswordLogin(
  store: WritableCredentialStore,
  options: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
  } = {},
): PasswordLoginRunner {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  return createFallbackPasswordLogin(
    createHttpPasswordLogin(store),
    createPlaywrightPasswordLogin(store, { env, platform }),
  );
}

async function main(): Promise<void> {
  const { createKeychainCredentialStore } = await import("./credentials");
  const store = createKeychainCredentialStore();
  const code = await runLoginCli({
    argv: process.argv.slice(2),
    env: process.env,
    credentials: store,
    passwordLogin: createDefaultCliPasswordLogin(store),
    io: {
      stdout: process.stdout,
      stderr: process.stderr,
      ...ttyPrompter(),
    },
  });
  process.exit(code);
}

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
