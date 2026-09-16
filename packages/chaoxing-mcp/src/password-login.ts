import { createCipheriv } from "node:crypto";

import type { WritableCredentialStore } from "./credentials";
import {
  fetchTrustedChaoxing,
  isTrustedChaoxingUrl,
  readSetCookieHeaders,
  type FetchLike,
  type TrustedFetchResult,
} from "./http";
import { AUTH_PROBE_URL, looksLikeLoginPage } from "./login-page";

export const FANYA_LOGIN_URL = "https://passport2.chaoxing.com/fanyalogin";

const PASSPORT_LOGIN_PAGE_URL =
  "https://passport2.chaoxing.com/login?fid=&refer=https%3A%2F%2Fi.chaoxing.com";

const I_CHAOXING_HOME = "https://i.chaoxing.com";

const LOGIN_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const SESSION_INCOMPLETE_MESSAGE =
  "Password login (账密直登) failed: session incomplete / SSO failed";

// Public client-side obfuscation key from passport2 login.js (not a secret).
const PASSPORT_AES_KEY = "u2oh6Vu^HWe4_AES";

const SESSION_COOKIE_NAMES = new Set(["uid", "_uid", "vc3", "uf"]);

export type PasswordCredentials = {
  username: string;
  password: string;
};

export type PasswordCredentialSource = {
  getPasswordCredentials(): Promise<PasswordCredentials | null>;
};

export type PasswordLoginRunner = {
  loginWithPassword(credentials: PasswordCredentials): Promise<void>;
};

export type LoginFetch = FetchLike;

export function envPasswordCredentialSource(
  env: NodeJS.ProcessEnv = process.env,
): PasswordCredentialSource {
  return {
    async getPasswordCredentials() {
      const username = env.CHAOXING_USERNAME?.trim() ?? "";
      const password = env.CHAOXING_PASSWORD ?? "";
      if (username.length === 0 || password.length === 0) {
        return null;
      }
      return { username, password };
    },
  };
}

export function encryptPassportField(value: string): string {
  const key = Buffer.from(PASSPORT_AES_KEY, "utf8");
  const cipher = createCipheriv("aes-128-cbc", key, key);
  return Buffer.concat([cipher.update(value, "utf8"), cipher.final()]).toString(
    "base64",
  );
}

export function redactLoginSecrets(
  message: string,
  credentials: PasswordCredentials,
): string {
  let result = message;
  for (const secret of [credentials.password, credentials.username]) {
    if (secret.length === 0) {
      continue;
    }
    result = result.split(secret).join("[已隐藏]");
  }
  return result;
}

export function createFallbackPasswordLogin(
  primary: PasswordLoginRunner,
  fallback: PasswordLoginRunner,
): PasswordLoginRunner {
  return {
    async loginWithPassword(credentials) {
      try {
        await primary.loginWithPassword(credentials);
      } catch (primaryError) {
        try {
          await fallback.loginWithPassword(credentials);
        } catch (fallbackError) {
          const primaryMsg = redactLoginSecrets(
            primaryError instanceof Error
              ? primaryError.message
              : String(primaryError),
            credentials,
          );
          const fallbackMsg = redactLoginSecrets(
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError),
            credentials,
          );
          throw new Error(
            `Password login (账密直登) failed: ${primaryMsg}; Playwright fallback: ${fallbackMsg}`,
            { cause: new Error(fallbackMsg) },
          );
        }
      }
    },
  };
}

export function createHttpPasswordLogin(
  credentials: WritableCredentialStore,
  options: {
    fetchImpl?: LoginFetch;
    loginUrl?: string;
    encrypt?: (value: string) => string;
  } = {},
): PasswordLoginRunner {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const loginUrl = options.loginUrl ?? FANYA_LOGIN_URL;
  const encrypt = options.encrypt ?? encryptPassportField;

  return {
    async loginWithPassword(passwordCreds) {
      if (!isTrustedChaoxingUrl(loginUrl)) {
        throw new Error("untrusted_cookie_request_target");
      }

      const response = await fetchImpl(loginUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          accept: "application/json, text/javascript, */*; q=0.01",
          origin: "https://passport2.chaoxing.com",
          referer: PASSPORT_LOGIN_PAGE_URL,
          "x-requested-with": "XMLHttpRequest",
          "user-agent": LOGIN_USER_AGENT,
        },
        body: encodeForm({
          fid: "-1",
          uname: encrypt(passwordCreds.username),
          password: encrypt(passwordCreds.password),
          refer: "https://i.chaoxing.com",
          t: "true",
          forbidotherlogin: "0",
          validate: "",
          doubleFactorLogin: "0",
          independentId: "0",
          independentNameId: "0",
        }),
        redirect: "manual",
      });

      const body = await response.text();
      const safeBody = redactLoginSecrets(body, passwordCreds);
      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          describeFanyaLoginFailure(
            safeBody,
            `HTTP ${String(response.status)}`,
          ),
        );
      }

      const parsed = parseFanyaLoginJson(body);
      if (parsed == null) {
        throw new Error(describeFanyaLoginFailure(safeBody, "non-JSON body"));
      }
      if (parsed.containTwoFactorLogin === true) {
        throw new Error(
          "Password login (账密直登) failed: two-factor login required; HTTP cannot continue",
        );
      }
      if (parsed.status !== true) {
        const msg2Hint =
          typeof parsed.msg2 === "string"
            ? redactLoginSecrets(parsed.msg2, passwordCreds)
            : "login failed";
        throw new Error(describeFanyaLoginFailure(safeBody, msg2Hint));
      }

      const jar = cookieJarFromSetCookie(
        readSetCookieHeaders(response.headers),
      );
      let cookie = headerFromJar(jar);
      if (cookie == null) {
        throw new Error(
          "Password login (账密直登) failed: login succeeded but no session cookie was returned",
        );
      }

      const followUrl = followUrlFromFanya(parsed);
      try {
        const followed = await fetchTrustedChaoxing(
          fetchImpl,
          {
            url: followUrl,
            cookie,
            headers: {
              accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "user-agent": LOGIN_USER_AGENT,
            },
          },
          { mergeSetCookie: mergeCookieHeader },
        );
        if (followed.cookie.length > 0) {
          cookie = followed.cookie;
        }
      } catch (error) {
        throw new Error(SESSION_INCOMPLETE_MESSAGE, { cause: error });
      }

      let probe: TrustedFetchResult;
      try {
        probe = await fetchTrustedChaoxing(
          fetchImpl,
          {
            url: AUTH_PROBE_URL,
            cookie,
            headers: {
              accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "user-agent": LOGIN_USER_AGENT,
            },
          },
          { mergeSetCookie: mergeCookieHeader },
        );
      } catch (error) {
        throw new Error(SESSION_INCOMPLETE_MESSAGE, { cause: error });
      }
      if (probe.cookie.length > 0) {
        cookie = probe.cookie;
      }
      if (looksLikeLoginPage(probe.url, probe.body)) {
        throw new Error(
          `${SESSION_INCOMPLETE_MESSAGE}; AUTH_PROBE still looks like a login page`,
        );
      }
      if (probe.statusCode < 200 || probe.statusCode >= 300) {
        throw new Error(
          `${SESSION_INCOMPLETE_MESSAGE}; AUTH_PROBE HTTP ${String(probe.statusCode)}`,
        );
      }

      const stored = headerFromJar(cookieJarFromHeader(cookie));
      if (stored == null) {
        throw new Error(SESSION_INCOMPLETE_MESSAGE);
      }
      await credentials.setCookie(stored);
    },
  };
}

type FanyaLoginJson = {
  status?: unknown;
  msg2?: unknown;
  containTwoFactorLogin?: unknown;
  url?: unknown;
};

function followUrlFromFanya(parsed: FanyaLoginJson): string {
  if (typeof parsed.url === "string" && isTrustedChaoxingUrl(parsed.url)) {
    return parsed.url;
  }
  return I_CHAOXING_HOME;
}

function parseFanyaLoginJson(body: string): FanyaLoginJson | null {
  try {
    const value: unknown = JSON.parse(body);
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as FanyaLoginJson;
  } catch {
    return null;
  }
}

export function describeFanyaLoginFailure(
  body: string,
  fallback: string,
): string {
  const text = body.trim();
  const hint = fallback.trim() || "login failed";
  if (/暂时不能访问|风控/.test(text)) {
    return "Password login (账密直登) failed: 学习通 风控 blocked HTTP login. This tool does not bypass 风控.";
  }
  if (/验证码|captcha/i.test(text) || /验证码|captcha/i.test(hint)) {
    return "Password login (账密直登) failed: captcha required. This tool does not solve captchas.";
  }
  return `Password login (账密直登) failed: ${hint}`;
}

function encodeForm(form: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) {
    params.append(key, value);
  }
  return params.toString();
}

type CookieJar = Map<string, string>;

function cookieJarFromSetCookie(setCookies: string[]): CookieJar {
  const jar: CookieJar = new Map();
  applySetCookies(jar, setCookies);
  return jar;
}

function cookieJarFromHeader(header: string): CookieJar {
  const jar: CookieJar = new Map();
  if (header.trim() === "") {
    return jar;
  }
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    jar.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1));
  }
  return jar;
}

function applySetCookies(jar: CookieJar, setCookies: string[]): void {
  for (const raw of setCookies) {
    const first = raw.split(";")[0]?.trim() ?? "";
    const eq = first.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1);
    if (name.length === 0) {
      continue;
    }
    const domain = cookieAttribute(raw, "domain");
    if (domain != null && !/(^|\.)chaoxing\.com$/i.test(domain)) {
      continue;
    }
    if (/(?:^|;\s*)max-age=0\b/i.test(raw)) {
      jar.delete(name);
      continue;
    }
    jar.set(name, value);
  }
}

function serializeJar(jar: CookieJar): string {
  return [...jar.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function headerFromJar(jar: CookieJar): string | null {
  if (
    ![...jar.keys()].some((name) => SESSION_COOKIE_NAMES.has(name.toLowerCase()))
  ) {
    return null;
  }
  return serializeJar(jar);
}

function mergeCookieHeader(cookie: string, setCookies: string[]): string {
  const jar = cookieJarFromHeader(cookie);
  applySetCookies(jar, setCookies);
  return serializeJar(jar);
}

function cookieAttribute(raw: string, name: string): string | null {
  const match = raw.match(new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*([^;]*)`, "i"));
  const value = match?.[1]?.trim();
  return value == null || value.length === 0 ? null : value;
}
