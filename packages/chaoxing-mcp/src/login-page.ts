export const AUTH_PROBE_URL = "https://i.chaoxing.com/base";

export function looksLikeLoginPage(url: string, html: string): boolean {
  return (
    /passport2\.chaoxing\.com\/login/i.test(url) ||
    /passport2\.chaoxing\.com\/login/i.test(html) ||
    /<title[^>]*>\s*用户登录\s*<\/title>/i.test(html) ||
    /\bid=["']loginBtn["']/i.test(html)
  );
}
