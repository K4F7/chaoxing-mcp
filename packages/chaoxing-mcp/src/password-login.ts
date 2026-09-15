import { createCipheriv } from "node:crypto";

import type { WritableCredentialStore } from "./credentials";
import { isTrustedChaoxingUrl } from "./http";

export const FANYA_LOGIN_URL = "https://passport2.chaoxing.com/fanyalogin";

const PASSPORT_LOGIN_PAGE_URL =
  "https://passport2.chaoxing.com/login?fid=&refer=https%3A%2F%2Fi.chaoxing.com";

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

export type LoginFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "status" | "url" | "headers" | "text">>;

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
          "user-agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
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

      const cookie = cookieHeaderFromSetCookie(readSetCookies(response.headers));
      if (cookie == null) {
        throw new Error(
          "Password login (账密直登) failed: login succeeded but no session cookie was returned",
        );
      }
      await credentials.setCookie(cookie);
    },
  };
}

type FanyaLoginJson = {
  status?: unknown;
  msg2?: unknown;
  containTwoFactorLogin?: unknown;
};

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

function readSetCookies(headers: Pick<Headers, "get">): string[] {
  const withGetSetCookie = headers as Pick<Headers, "get"> & {
    getSetCookie?: () => string[];
  };
  if (typeof withGetSetCookie.getSetCookie === "function") {
    return withGetSetCookie.getSetCookie();
  }
  // Node < 18.14 / undici without getSetCookie collapses multiple Set-Cookie
  // headers; Expires commas make safe splitting unreliable. Require getSetCookie.
  const combined = headers.get("set-cookie");
  if (combined == null || combined.trim() === "") {
    return [];
  }
  // Single cookie responses still work; multi-cookie needs getSetCookie.
  if (!combined.includes(",")) {
    return [combined];
  }
  // Heuristic: split on ", <cookie-name>=" patterns typical of collapsed headers.
  const parts = combined.split(/,(?=\s*[^;=,]+=)/);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function cookieHeaderFromSetCookie(setCookies: string[]): string | null {
  const parts: { name: string; value: string }[] = [];
  for (const raw of setCookies) {
    const first = raw.split(";")[0]?.trim() ?? "";
    const eq = first.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1);
    if (name.length === 0 || /(?:^|;\s*)max-age=0\b/i.test(raw)) {
      continue;
    }
    const domain = cookieAttribute(raw, "domain");
    if (domain != null && !/(^|\.)chaoxing\.com$/i.test(domain)) {
      continue;
    }
    parts.push({ name, value });
  }
  if (
    !parts.some((part) => SESSION_COOKIE_NAMES.has(part.name.toLowerCase()))
  ) {
    return null;
  }
  return parts
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((part) => `${part.name}=${part.value}`)
    .join("; ");
}

function cookieAttribute(raw: string, name: string): string | null {
  const match = raw.match(new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*([^;]*)`, "i"));
  const value = match?.[1]?.trim();
  return value == null || value.length === 0 ? null : value;
}
