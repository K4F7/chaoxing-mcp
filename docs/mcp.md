# 学习通 MCP（stdio）

`packages/chaoxing-mcp` 是给 Grok Bot / Cursor 用的本机 stdio MCP。体验对齐 [K4F7/PU](https://github.com/K4F7/PU)：一个进程、stdio、凭据不进工具参数。

工具：`list_todos`、`get_homework`、`save_homework_answers`。Cookie 存在本机钥匙串（`@napi-rs/keyring`），不出现在工具入参或返回值里。

## 与 PU 的差异

| | PU | 学习通 MCP |
| --- | --- | --- |
| 会话 | 钥匙串里的 **token** | 钥匙串里的 **cookie**（service `chaoxinghelper.mcp` / account `cookie`） |
| 登录 CLI | `pu login -u/-p`，env `PU_USERNAME` / `PU_PASSWORD` | `npm run login --silent`（在 `packages/chaoxing-mcp`），env `CHAOXING_USERNAME` / `CHAOXING_PASSWORD` |
| 协议 | 稳定 HTTP JSON：`/uc/user/login` 明文账密 + sid → token | 先 POST `https://passport2.chaoxing.com/fanyalogin`（官方页同款 AES 混淆）；失败再 Playwright 填 passport |
| 验证码 / 风控 | 检测到验证码/风控即停，不求解 | 可能要 CXCaptcha、双因子或风控页；**不实现验证码求解**，失败信息说清楚 |
| MCP | 工具不收密码 | 工具不收密码，也不返回 cookie |

CLI 成功只打印 `LOGIN_OK has_cookie=true`，不打印 cookie 或密码。缺账号密码时 **仅 CLI** 可提示输入；MCP 从不提示、也不接收凭据。

### 调研结论（passport HTTP，只 GET 过公开登录页）

公开页 `GET https://passport2.chaoxing.com/login`（无凭据）不是 PU 那种可填表单 action：`<form action="">`，提交由 `login.js` 的 `POST /fanyalogin` 完成。字段包括 `fid`（页上默认 `-1`）、AES-CBC 混淆后的 `uname`/`password`（密钥写在公开 JS 里，是混淆不是密钥托管）、可空的 `validate`。页上有 CXCaptcha（`captcha.chaoxing.com`，点击/图文）；`needVcode` 为空时常见路径可以不弹验证码。另有短信码 `/fanyaloginbycode`、双因子跳转、以及社区里常见的风控 HTML（「暂时不能访问」）。

**结论：常见无验证码情况下 HTTP 直登可行**（因此 CLI / `openLogin` 先走 fanyalogin，成功则写钥匙串）。这仍不像 PU：必须客户端 AES、可能 captcha/2FA/风控，失败要清晰，并回退已有 Playwright 填表。无 `DISPLAY` 时 Playwright 用 `headless: true`，有显示时用有界面；两条都失败则报错。不实现验证码求解，测试不向学习通 POST 真实密码。

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

必须由登录 CLI 或 `createPassportOpenLogin` 写入。HTTP 直登成功时不弹窗；否则用 Playwright 持久化目录 `~/.chaoxinghelper/chrome-profile`，`channel: "chrome"`（本机 Google Chrome）。无显示时走 headless，有 `DISPLAY` 时有界面。

### Linux / Grok Bot

- 交互登录需要可用的 **`DISPLAY`**。后台跑 `openLogin` 时，把 **Playwright 弹出的那个** 登录窗交给用户操作；不要让用户只去登系统里的普通 Chrome。
- 无头 / 无 `DISPLAY` / 未装 Chrome / 钥匙串不可写时：stderr 打出原因；`list_todos` 返回 `status: "auth_expired"`、`isError: true`（不是「没有作业」）。

### 成功标志

1. `openLogin` 正常结束（无抛错）
2. 钥匙串 `getCookie` 非空（例如探针日志 `LOGIN_OK has_cookie=true`）

登录成功并把 cookie 写入钥匙串后，**同一次** `list_todos` 会继续查待办，不必为「刚登录」再调一次。

### 账密直登（CLI 优先，对齐 `pu login`）

在 `packages/chaoxing-mcp`：

```sh
npm run login --silent -- -u <账号>
# 密码用 CHAOXING_PASSWORD 或 CLI 隐藏提示。
# --silent 避免 npm 把命令行（含 -p）印到 stdout。
# 等价：node --import tsx src/login-cli.ts -u <账号>
```

| 来源 | 含义 |
| --- | --- |
| `-u` / `--username`，或 `CHAOXING_USERNAME` | 学习通账号（手机号/学号等） |
| `CHAOXING_PASSWORD`，隐藏提示，或 `-p` / `--password` | 学习通密码。优先 env / 提示；`-p` 可用，但不要让 npm 横幅把它打出来 |

只在进程环境、CLI 参数或本机安全输入里配置；**不要写进 git、PR、MCP 配置或工具参数**。日志和成功输出不会打印账号、密码或 cookie 的值。

行为：

1. CLI / MCP 有账密 → 先 HTTP `fanyalogin`（URL 信任分级）。`status:true` 之后仍须带着 cookie 跟随返回的 `url`（或 `https://i.chaoxing.com`）完成 i 站 SSO，再 GET `https://i.chaoxing.com/base`（AUTH_PROBE）。探针仍是登录页则视为会话未建立，不写钥匙串，错误须说清（session incomplete / SSO failed），以便 Playwright 回退。
2. HTTP 失败（验证码、风控、2FA、SSO 未完成、错误口令等）→ Playwright 填 passport（无 `DISPLAY` 时 `headless: true`，有显示时有界面）
3. 仍失败且 MCP 有 `DISPLAY` → 回退交互登录窗
4. 仍失败且无 `DISPLAY` → `auth_expired`（MCP）或 CLI 非零退出，错误说明直登失败且无法弹窗

`LOGIN_OK has_cookie=true` 表示 AUTH_PROBE 已通过（不是仅 passport `Set-Cookie`）。MCP 从不接收密码。

可选：先在有桌面的机器登录一次写入钥匙串；之后同一钥匙串在无头环境可读时，查询可不再弹窗。

## `list_todos`

- 默认 `scope=current_semester`：只保留在读课程名里最高的学期代码（课名以三位数字开头，如 `261学期 …` / `261-新课`）。
- 若鉴权成功但解析不到任何学期码 → `status: "no_semester_code"`（`isError`）。不要用假学期码凑数。
- `scope=all`：学期交界或怀疑漏了旧课未完成待办时再用；鉴权成功后空 `todos` 表示范围内没有仍须完成的待办，不是认证失败。
- `status: ok` 且 `todos` 为空表示当前没有未完成待办，不是失败。
- `auth_expired` 以及其他失败都是 `isError`，不会伪装成「没有作业」。
- 结果里的 `courses_scanned` 随 `scope`：默认 `current_semester` 只含当前学期课（无学期码的课不进默认范围、也不进摘要）；`scope=all` 才是全部在读课（含无学期码）。摘要字段为 `id` / `title` / `semester_code`。`courses_in_scope_count` 等于 `courses_scanned.length`；`courses_enrolled_count` 是过滤前的在读课总数。不含 cookie。

课表拉取会对 `courselistdata` 使用学生侧参数（`courseType=1` 的 POST/form）。不加时页面常落在「教」侧（`clazzId=0`、课名为空），从而误报 `no_semester_code`。


## `get_homework`

- 入参：`work_id`（`list_todos` 的 id / taskrefId）。
- 读取手机端 doHomeWork 各题页，返回 `questions[]`：`index`、`question_id`、`type`、`type_label`、`title`、`stem_text`、`stem_image_urls`、`blanks`、`current_answer`、`supports_save`。
- 题干常为图片；计算/证明等题型 `supports_save=false`（需用户自行拍照上传）。
- 不返回 cookie、enc、密码或 token。

## `save_homework_answers`

- 入参：`work_id` + `answers[]`（按 `index` 和/或 `question_id`；填空用 `blanks`，单选 `choice` / 多选 `choices`）。
- **只保存草稿**：请求永远 `tempSave=true`。禁止正式提交（`tempSave=false`）；若检测到提交意图直接拒绝。
- 计算/证明（type 4/7）默认拒绝写入；仅当显式 `allow_rich_text=true` 才可写纯文本草稿（仍不代交、不上传照片）。
- 不返回 cookie、enc、密码或 token。

