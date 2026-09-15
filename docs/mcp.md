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

## `list_todos`

- 默认 `scope=current_semester`：只保留在读课程名里最高的学期代码。
- `scope=all`：学期交界或怀疑漏了旧课未完成待办时再用。
- `status: ok` 且 `todos` 为空表示当前没有未完成待办，不是失败。
- `auth_expired` 以及其他失败都是 `isError`，不会伪装成「没有作业」。

无 cookie 或探测落到登录页时，会打开学习通登录页。登录成功并把 cookie 写入钥匙串后，**同一次** `list_todos` 继续查待办，不必为「刚登录」再调一次。

## Linux / Grok Bot 电脑

交互登录需要本机 **Google Chrome**（Playwright `channel: "chrome"`，有界面，`headless: false`）和可用的钥匙串。

无头 / 无 `DISPLAY` / 未装 Chrome / 钥匙串不可写时：

- stderr 会打出原因（缺 Chrome、无显示、钥匙串失败、登录等待超时等）
- `list_todos` 返回 `status: "auth_expired"`、`isError: true`，`errors[].message` 带同一句说明
- 这不是「没有作业」

可选 fallback：先在一台有桌面环境的机器上成功登录一次，让 cookie 进钥匙串；之后只要同一把钥匙串在无头环境里仍可读，查询可以不再弹登录窗。当前**不支持**无头登录（验证码/风控需要可见页面）。
