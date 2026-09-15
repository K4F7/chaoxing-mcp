import { trustedChaoxingRequestHosts } from "@chaoxing-mcp/domain";

import {
  type AndroidWebViewCookie,
  encodeAndroidCookieSource,
  hasChaoxingIdentityCookieSource,
} from "./cookie-store";

export type NativeCookieFields = {
  name?: string;
  value?: string;
  domain?: string;
  path?: string;
};

export type NativeCookieBag = Record<string, NativeCookieFields>;

/**
 * Native CookieManager surface. Tests inject a memory jar; the Android
 * adapter wraps `@react-native-cookies/cookies`.
 */
export type NativeCookieCollector = {
  get(url: string, includeHttpOnly?: boolean): Promise<NativeCookieBag>;
  getAll?(useWebKit?: boolean): Promise<NativeCookieBag | Record<string, NativeCookieBag>>;
};

export const ANDROID_COOKIE_COLLECTION_URLS = [
  ...trustedChaoxingRequestHosts,
].map((host) => `https://${host}/`);

export function flattenNativeCookieBag(
  bag: NativeCookieBag | Record<string, NativeCookieBag>,
): AndroidWebViewCookie[] {
  const cookies: AndroidWebViewCookie[] = [];
  for (const value of Object.values(bag)) {
    if (isCookieFields(value)) {
      const cookie = toAndroidCookie(value);
      if (cookie) {
        cookies.push(cookie);
      }
      continue;
    }
    if (value && typeof value === "object") {
      for (const nested of Object.values(value as NativeCookieBag)) {
        const cookie = toAndroidCookie(nested);
        if (cookie) {
          cookies.push(cookie);
        }
      }
    }
  }
  return cookies;
}

export async function collectAndroidLoginCookies(
  collector: NativeCookieCollector,
): Promise<AndroidWebViewCookie[]> {
  if (collector.getAll) {
    const all = await collector.getAll(true);
    const flattened = flattenNativeCookieBag(all);
    if (flattened.length > 0) {
      return flattened;
    }
  }
  const collected: AndroidWebViewCookie[] = [];
  for (const url of ANDROID_COOKIE_COLLECTION_URLS) {
    const bag = await collector.get(url, true);
    collected.push(...flattenNativeCookieBag(bag));
  }
  return dedupeCookies(collected);
}

export async function captureLoginCookieSource(
  collector: NativeCookieCollector,
): Promise<string> {
  const source = encodeAndroidCookieSource(
    await collectAndroidLoginCookies(collector),
  );
  return hasChaoxingIdentityCookieSource(source) ? source : "";
}

function isCookieFields(value: unknown): value is NativeCookieFields {
  return (
    typeof value === "object" &&
    value !== null &&
    ("name" in value || "value" in value)
  );
}

function toAndroidCookie(
  fields: NativeCookieFields,
): AndroidWebViewCookie | null {
  if (typeof fields.name !== "string" || typeof fields.value !== "string") {
    return null;
  }
  return {
    name: fields.name,
    value: fields.value,
    domain: typeof fields.domain === "string" ? fields.domain : undefined,
    path: typeof fields.path === "string" ? fields.path : undefined,
  };
}

function dedupeCookies(
  cookies: AndroidWebViewCookie[],
): AndroidWebViewCookie[] {
  const seen = new Set<string>();
  const unique: AndroidWebViewCookie[] = [];
  for (const cookie of cookies) {
    const key = `${cookie.name}\n${cookie.domain ?? ""}\n${cookie.path ?? "/"}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(cookie);
  }
  return unique;
}
