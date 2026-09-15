# `@chaoxing-mcp/android-http`

Android 同步用的 Cookie 感知 HTTP 客户端。

JS `fetch` 经常读不到 `Set-Cookie`，会话续期会弱于 Flutter 的 `http`。
这里用 OkHttp + `CookieManager` 作为原生 cookie jar：登录 WebView 写入的 Cookie
和后续同步响应里的 `Set-Cookie` 落在同一份罐子里，再合并回安全存储。

请求仍然只对学习通可信 HTTPS 主机带 Cookie；重定向保持手动，由领域 runner 拒绝白名单外跳转。
