# 学习通 MCP（stdio）

`packages/chaoxing-mcp` 是给 Grok Bot / Cursor 用的本机 stdio MCP。体验对齐 [K4F7/PU](https://github.com/K4F7/PU)：一个进程、stdio、凭据不进工具参数。

工具只有 `list_todos`。Cookie 存在本机钥匙串（`@napi-rs/keyring`），不出现在工具入参或返回值里。

## 安装

在仓库根目录：

```sh
cd packages/chaoxing-mcp && npm ci
```

之后从仓库根启动（`--silent` 避免 npm 把脚本横幅写进 stdout，否则会破坏 MCP JSON-RPC）：

```sh
npm start --silent --prefix packages/chaoxing-mcp
```

等价：在 `packages/chaoxing-mcp` 里执行 `npm start --silent`（`package.json` 的 `start` 是 `node --import tsx src/stdio.ts`）。

## 挂到 Grok Bot / Cursor

工作区必须是**仓库根**。Grok 读仓库根 `.grok/config.toml`；Cursor `AddMcpServer` 用同一组 `command` / `args`。

```toml
[mcp_servers.chaoxing]
command = "npm"
args = ["start", "--silent", "--prefix", "packages/chaoxing-mcp"]
startup_timeout_sec = 60
```

Cursor 示例：

```json
{
  "mcpServers": {
    "chaoxing": {
      "command": "npm",
      "args": ["start", "--silent", "--prefix", "packages/chaoxing-mcp"]
    }
  }
}
```

不要把 cookie、账号或密码写进 MCP 配置或 `list_todos` 参数。

## 登录踩坑（系统 Chrome ≠ MCP）

**普通桌面 Chrome 登进 `i.chaoxing.com` ≠ MCP 已登录。**

MCP 凭据只走本机钥匙串：

| 项 | 值 |
| --- | --- |
| service | `chaoxinghelper.mcp` |
| account | `cookie` |

必须由 `createPassportOpenLogin` 写入。它用 Playwright 持久化目录 `~/.chaoxinghelper/chrome-profile`，`channel: "chrome"`（本机 Google Chrome，有界面）。

### Linux / Grok Bot

- 交互登录需要可用的 **`DISPLAY`**。后台跑 `openLogin` 时，把 **Playwright 弹出的那个** 登录窗交给用户操作；不要让用户只去登系统里的普通 Chrome。
- 无头 / 无 `DISPLAY` / 未装 Chrome / 钥匙串不可写时：stderr 打出原因；`list_todos` 返回 `status: "auth_expired"`、`isError: true`（不是「没有作业」）。

### 成功标志

1. `openLogin` 正常结束（无抛错）
2. 钥匙串 `getCookie` 非空（例如探针日志 `LOGIN_OK has_cookie=true`）

登录成功并把 cookie 写入钥匙串后，**同一次** `list_todos` 会继续查待办，不必为「刚登录」再调一次。

### 账密直登（非交互优先）

若环境里已有账号密码，MCP 会先尝试 Playwright 自动填 passport 登录，再写入同一把钥匙串：

| 环境变量 | 含义 |
| --- | --- |
| `CHAOXING_USERNAME` | 学习通账号（手机号/学号等） |
| `CHAOXING_PASSWORD` | 学习通密码 |

只在进程环境或本机安全输入里配置这些变量；**不要写进 git、PR、MCP 配置或工具参数**。日志不会打印账号或密码的值。

行为：

1. 有 `CHAOXING_USERNAME` + `CHAOXING_PASSWORD` → 先账密直登
2. 直登失败且有 `DISPLAY` → 回退交互登录窗
3. 直登失败且无 `DISPLAY` → `auth_expired`，错误信息说明直登失败且无法弹窗

账密直登在 Linux 上仍需要可见 Chrome（验证码/风控）；不是无头 API 登录。

可选 fallback：先在有桌面的机器登录一次写入钥匙串；之后同一钥匙串在无头环境可读时，查询可不再弹窗。

## `list_todos`

- 默认 `scope=current_semester`：只保留在读课程名里最高的学期代码（课名以三位数字开头，如 `261学期 …` / `261-新课`）。
- 若鉴权成功但解析不到任何学期码 → `status: "no_semester_code"`（`isError`）。不要用假学期码凑数。
- `scope=all`：学期交界或怀疑漏了旧课未完成待办时再用；鉴权成功后空 `todos` 表示范围内没有仍须完成的待办，不是认证失败。
- `status: ok` 且 `todos` 为空表示当前没有未完成待办，不是失败。
- `auth_expired` 以及其他失败都是 `isError`，不会伪装成「没有作业」。
- 结果里的 `courses_scanned` 随 `scope`：默认 `current_semester` 只含当前学期课（无学期码的课不进默认范围、也不进摘要）；`scope=all` 才是全部在读课（含无学期码）。摘要字段为 `id` / `title` / `semester_code`。`courses_in_scope_count` 等于 `courses_scanned.length`；`courses_enrolled_count` 是过滤前的在读课总数。不含 cookie。

课表拉取会对 `courselistdata` 使用学生侧参数（`courseType=1` 的 POST/form）。不加时页面常落在「教」侧（`clazzId=0`、课名为空），从而误报 `no_semester_code`。
