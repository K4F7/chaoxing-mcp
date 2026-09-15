import {
  isTrustedChaoxingCookieDomain,
  normalizeChaoxingDomain,
} from "@chaoxing-mcp/domain";

export const COOKIE_STORE_FORMAT = "chaoxing-cookie-store-v1";

export const IDENTITY_COOKIE_NAMES = new Set([
  "_uid",
  "UID",
  "vc3",
  "uf",
  "p_auth_token",
  "cx_p_token",
  "xxtenc",
]);

const COOKIE_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export const UNSAFE_COOKIE_MESSAGE =
  "Cookie 格式不安全或无有效字段，请重新登录或检查手动输入";

export class CookieSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CookieSourceError";
  }
}

export type ChaoxingCookieRecord = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  hostOnly: boolean;
};

/**
 * Android WebView CookieManager only reliably exposes name / value / domain /
 * path. Secure and host-only flags are absent and must not be required.
 */
export type AndroidWebViewCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
};

export function isSafeCookieName(name: string): boolean {
  return COOKIE_NAME_RE.test(name);
}

export function isSafeCookieValue(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes(";") &&
    !value.includes("\r") &&
    !value.includes("\n")
  );
}

export function isValidCookieRecord(cookie: ChaoxingCookieRecord): boolean {
  return (
    isSafeCookieName(cookie.name) &&
    isSafeCookieValue(cookie.value) &&
    isTrustedChaoxingCookieDomain(cookie.domain) &&
    cookie.path.startsWith("/")
  );
}

export function encodeChaoxingCookieStore(
  cookies: Iterable<ChaoxingCookieRecord>,
): string {
  return JSON.stringify({
    format: COOKIE_STORE_FORMAT,
    cookies: [...cookies].map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      hostOnly: cookie.hostOnly,
    })),
  });
}

export function decodeChaoxingCookieStore(
  source: string,
): ChaoxingCookieRecord[] | null {
  const trimmed = source.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    const decoded: unknown = JSON.parse(trimmed);
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("format" in decoded) ||
      decoded.format !== COOKIE_STORE_FORMAT ||
      !("cookies" in decoded) ||
      !Array.isArray(decoded.cookies)
    ) {
      return null;
    }
    return decoded.cookies
      .filter(isCookieJson)
      .map(recordFromJson)
      .filter(isValidCookieRecord);
  } catch {
    return null;
  }
}

export function parseLegacyCookieHeader(header: string): ChaoxingCookieRecord[] {
  const records: ChaoxingCookieRecord[] = [];
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (isSafeCookieName(name) && isSafeCookieValue(value)) {
      records.push({
        name,
        value,
        domain: "chaoxing.com",
        path: "/",
        secure: true,
        hostOnly: false,
      });
    }
  }
  return records;
}

export function recordsFromCookieSource(source: string): ChaoxingCookieRecord[] {
  return decodeChaoxingCookieStore(source) ?? parseLegacyCookieHeader(source);
}

export function isSafeChaoxingCookieSource(source: string): boolean {
  if (source.includes("\r") || source.includes("\n")) {
    return false;
  }
  const structured = decodeChaoxingCookieStore(source);
  if (structured !== null) {
    return structured.length > 0;
  }
  return parseLegacyCookieHeader(source).length > 0;
}

export function hasChaoxingIdentityCookieSource(source: string): boolean {
  if (!isSafeChaoxingCookieSource(source)) {
    return false;
  }
  return recordsFromCookieSource(source).some((cookie) =>
    IDENTITY_COOKIE_NAMES.has(cookie.name),
  );
}

export function hasChaoxingIdentityCookie(source: string): boolean {
  return hasChaoxingIdentityCookieSource(source);
}

export function chaoxingCookieSecrets(source: string): string[] {
  const secrets: string[] = [];
  if (source.trim().length > 0) {
    secrets.push(source);
  }
  for (const cookie of decodeChaoxingCookieStore(source) ?? []) {
    if (cookie.value) {
      secrets.push(cookie.value);
    }
  }
  return secrets;
}

export function cookieHeaderForChaoxingUri(
  source: string,
  url: string,
): string {
  let uri: URL;
  try {
    uri = new URL(url);
  } catch {
    return "";
  }
  if (
    !isSafeChaoxingCookieSource(source) ||
    uri.protocol !== "https:" ||
    uri.hostname.toLowerCase() === "passport2.chaoxing.com"
  ) {
    return "";
  }
  const applicable = recordsFromCookieSource(source).filter((cookie) => {
    if (cookie.secure && uri.protocol !== "https:") {
      return false;
    }
    return (
      domainMatches(uri.hostname, cookie.domain, cookie.hostOnly) &&
      pathMatches(uri.pathname, cookie.path)
    );
  });
  applicable.sort((left, right) => {
    const pathOrder = right.path.length - left.path.length;
    return pathOrder !== 0 ? pathOrder : left.name.localeCompare(right.name);
  });
  return applicable.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

/**
 * Persist Android cookies through the structured store. Missing Secure /
 * host-only flags use the same defaults as Flutter's decoder so later sync
 * can still scope Cookie headers. A flat header remains a supported
 * compatibility path via {@link parseLegacyCookieHeader}.
 */
export function encodeAndroidCookieSource(
  cookies: Iterable<AndroidWebViewCookie>,
): string {
  const records = [...cookies]
    .map(androidCookieToRecord)
    .filter((cookie): cookie is ChaoxingCookieRecord => cookie !== null);
  return encodeChaoxingCookieStore(records);
}

export function androidCookiesToLegacyHeader(
  cookies: Iterable<AndroidWebViewCookie>,
): string {
  const byName = new Map<string, AndroidWebViewCookie>();
  const safe = [...cookies].filter((cookie) => {
    const domain = normalizeChaoxingDomain(cookie.domain ?? "chaoxing.com");
    return (
      isTrustedChaoxingCookieDomain(domain) &&
      isSafeCookieName(cookie.name) &&
      isSafeCookieValue(cookie.value)
    );
  });
  safe.sort((left, right) => {
    const leftDomain = normalizeChaoxingDomain(left.domain ?? "chaoxing.com");
    const rightDomain = normalizeChaoxingDomain(right.domain ?? "chaoxing.com");
    const domainOrder = (leftDomain === "chaoxing.com" ? 0 : 1) -
      (rightDomain === "chaoxing.com" ? 0 : 1);
    if (domainOrder !== 0) {
      return domainOrder;
    }
    const pathOrder = (right.path ?? "/").length - (left.path ?? "/").length;
    return pathOrder !== 0 ? pathOrder : left.name.localeCompare(right.name);
  });
  for (const cookie of safe) {
    if (!byName.has(cookie.name)) {
      byName.set(cookie.name, cookie);
    }
  }
  return [...byName.values()]
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

export function parseManualCookieInput(input: string): string {
  if (input.includes("\r") || input.includes("\n")) {
    throw new CookieSourceError(UNSAFE_COOKIE_MESSAGE);
  }
  const trimmed = input.trim();
  if (!isSafeChaoxingCookieSource(trimmed)) {
    throw new CookieSourceError(UNSAFE_COOKIE_MESSAGE);
  }
  return trimmed;
}

function androidCookieToRecord(
  cookie: AndroidWebViewCookie,
): ChaoxingCookieRecord | null {
  const domain = normalizeChaoxingDomain(cookie.domain ?? "chaoxing.com");
  const path = cookie.path && cookie.path.startsWith("/") ? cookie.path : "/";
  const record: ChaoxingCookieRecord = {
    name: cookie.name,
    value: cookie.value,
    domain,
    path,
    secure: true,
    hostOnly: false,
  };
  return isValidCookieRecord(record) ? record : null;
}

function isCookieJson(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recordFromJson(json: Record<string, unknown>): ChaoxingCookieRecord {
  return {
    name: typeof json.name === "string" ? json.name : "",
    value: typeof json.value === "string" ? json.value : "",
    domain: typeof json.domain === "string" ? json.domain : "",
    path: typeof json.path === "string" ? json.path : "/",
    secure: json.secure !== false,
    hostOnly: json.hostOnly === true,
  };
}

function domainMatches(
  host: string,
  domain: string,
  hostOnly: boolean,
): boolean {
  const normalizedHost = host.toLowerCase();
  const normalizedDomain = normalizeChaoxingDomain(domain);
  return (
    normalizedHost === normalizedDomain ||
    (!hostOnly && normalizedHost.endsWith(`.${normalizedDomain}`))
  );
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  const normalizedPath = cookiePath.length === 0 ? "/" : cookiePath;
  if (requestPath === normalizedPath) {
    return true;
  }
  if (!requestPath.startsWith(normalizedPath)) {
    return false;
  }
  return (
    normalizedPath.endsWith("/") ||
    requestPath.slice(normalizedPath.length).startsWith("/")
  );
}
