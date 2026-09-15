import { isTrustedChaoxingUrl } from "@chaoxing-mcp/domain";

export const CHAOXING_LOGIN_URL =
  "https://passport2.chaoxing.com/login?fid=&refer=https%3A%2F%2Fi.chaoxing.com";

export type LoginNavigationDecision = "allow" | "ignore" | "block";

export function classifyLoginNavigation(url: string): LoginNavigationDecision {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return "ignore";
  }
  if (trimmed === "about:blank" || trimmed.toLowerCase().startsWith("about:")) {
    return "ignore";
  }
  return isTrustedChaoxingUrl(trimmed) ? "allow" : "block";
}

export type WebView2Bridge = {
  navigate(url: string): Promise<void> | void;
  collectCookies(): Promise<string>;
};

export type LoginCapture = {
  blocked: boolean;
  cookieSource: string | null;
};

export async function runWebView2Login(
  bridge: WebView2Bridge,
  input: {
    startUrl?: string;
    navigations?: readonly string[];
  } = {},
): Promise<LoginCapture> {
  const startUrl = input.startUrl ?? CHAOXING_LOGIN_URL;
  if (classifyLoginNavigation(startUrl) === "block") {
    return { blocked: true, cookieSource: null };
  }
  await bridge.navigate(startUrl);
  for (const url of input.navigations ?? []) {
    if (classifyLoginNavigation(url) === "block") {
      return { blocked: true, cookieSource: null };
    }
  }
  const cookieSource = await bridge.collectCookies();
  return { blocked: false, cookieSource };
}
