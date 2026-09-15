# RN Android 登录、Cookie 与认证失效

对应日常可用规格的 Android 登录与失效可见性，以及 ticket 19 在 React Native 上的增量，而不是改 Flutter。

## 行为对照

| 产品行为 | RN 落点 |
|---|---|
| App 内登录学习通 | `src/screens/LoginScreen.tsx` + WebView |
| 只导航到学习通域名 | `src/auth/login-navigation.ts` |
| Android Cookie 只有 name/value/domain/path | `src/auth/android-cookies.ts` |
| Cookie 进安全存储 | `src/auth/cookie-vault.ts` + `expo-secure-store` |
| 手动导入整份拒绝换行 | `parseManualCookieInput` |
| 认证失效横幅 + 重新登录 | `buildHomeViewModel` + `AuthExpiryBanner` |
| 失效后停止自动同步 | `SessionController.requestSync("auto")` |
| 给同步包的会话 | `ChaoxingSyncSession` |

## 不要做的事

- 不要把 Cookie 写入普通偏好、诊断正文或日志。
- 不要在认证失效时安静地继续自动同步。
- 课程同步与闹钟调度在 `src/sync` / `src/http` 与 `@chaoxing-mcp/android-alarms`，不要把 Cookie 写进那些存储。
