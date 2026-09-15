import { isTrustedChaoxingUrl } from "@chaoxing-mcp/domain";

export const CHAOXING_LOGIN_URL =
  "https://passport2.chaoxing.com/login?fid=&refer=https%3A%2F%2Fi.chaoxing.com";

export const CHAOXING_HOME_URL = "https://i.chaoxing.com/";

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

export function shouldAllowLoginNavigation(url: string): boolean {
  return classifyLoginNavigation(url) !== "block";
}
