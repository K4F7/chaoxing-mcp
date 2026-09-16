# 学习通作业考试待办

从学习通收件箱和课程空间识别作业与考试，解析截止时间，在本机汇总成待办列表并在截止前提醒。

工具在本机直接访问学习通，不经过任何自建服务端，凭据只保存在本机安全存储中。Windows 与 Android 各自独立完成抓取、存储与提醒，装一端即可使用，不需要配对。术语见 [CONTEXT.md](./CONTEXT.md)。

## 项目结构

- `apps/chaoxing_rn/`：Android 生产应用（Expo / React Native）。应用内登录、真同步、待办、设置与受监控课程、诊断导出、AlarmManager 预排提醒。
- `apps/chaoxing_windows/`：Windows 生产应用（TypeScript 本机宿主 + C# 外壳）。WebView2 登录、托盘、「此刻该触发的」提醒、开机自启、Inno Setup 安装器。
- `packages/chaoxing-domain/`：可移植的 TypeScript 领域切片（同步、解析、认证、提醒规则、URL 信任分级、诊断脱敏）。
- `packages/chaoxing-android-alarms/`：Android 预排闹钟。
- `packages/chaoxing-android-http/`：OkHttp + CookieManager，补上 JS `fetch` 读不到 `Set-Cookie` 的缺口。
- `packages/chaoxing-mcp/`：本机 stdio MCP（唯一工具 `list_todos`）。见 [`docs/mcp.md`](./docs/mcp.md)。
- `legacy/chaoxing_app/`：Flutter 参考实现，**不是**生产出货路径。
- `docs/`：产品文档与架构决策记录。
- `src/`、`scripts/`、`tests/`：早期 Cloudflare Worker 实现的遗留代码，已不参与 App 运行路径。若要跑这些脚本或测试，在仓库根使用 Node + npm（`npm ci && npm test && npm run typecheck`；脚本是 `node --import tsx`）。

## 使用

- Android：见 [`apps/chaoxing_rn/README.md`](./apps/chaoxing_rn/README.md)。需要开发构建（`npx expo run:android`）才能读 HttpOnly Cookie。
- Windows：见 [`apps/chaoxing_windows/README.md`](./apps/chaoxing_windows/README.md)。C# 外壳与安装器在 Windows SDK 上构建。
- MCP（Grok Bot / Cursor stdio）：见 [`docs/mcp.md`](./docs/mcp.md)（登录踩坑、账密直登、`list_todos` scope）。先 `cd packages/chaoxing-mcp && npm ci`，工作区用仓库根。`.grok/config.toml` 与 Cursor `AddMcpServer` 同一组参数：

```toml
[mcp_servers.chaoxing]
command = "npm"
args = ["start", "--silent", "--prefix", "packages/chaoxing-mcp"]
startup_timeout_sec = 60
```

工具只有 `list_todos`。凭据在本机钥匙串（service `chaoxinghelper.mcp` / account `cookie`）；**系统 Chrome 已登录 ≠ MCP 已登录**。登录对齐 PU 的 CLI：`cd packages/chaoxing-mcp && npm run login --silent -- -u …`（密码用 env `CHAOXING_PASSWORD` 或隐藏提示；勿写入仓库）。先 HTTP `fanyalogin`，失败再 Playwright（无 `DISPLAY` 时走 headless，有显示时有界面；验证码需人工，headless 下可能仍失败）；可能仍要验证码。HTTP 与 Playwright 都失败、无 Chrome、或无可用 cookie 时返回 `auth_expired`（不是「没有作业」）。MCP 工具不收密码。

## 验证

生产路径（不需要 Flutter）：

```sh
cd packages/chaoxing-domain && npm test && npm run typecheck
cd ../chaoxing-android-alarms && npm test && npm run typecheck
cd ../chaoxing-android-http && npm ci && npm test && npm run typecheck
cd ../chaoxing-mcp && npm ci && npm test && npm run typecheck
cd ../../apps/chaoxing_rn && npm test && npm run typecheck
cd ../chaoxing_windows && npm ci && npm test && npm run typecheck
```

Flutter 参考实现只在改 `legacy/chaoxing_app` 时由遗留 CI 跑 `flutter analyze` / `flutter test`，不再打生产包。
