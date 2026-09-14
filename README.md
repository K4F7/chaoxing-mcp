# 学习通课程作业

本机 MCP server：让 agent 查询当前[受监控课程](CONTEXT.md)里的[待办事项](CONTEXT.md)。登录态只留在本机。术语见 [CONTEXT.md](CONTEXT.md)，方向见 [ADR-0002](docs/adr/0002-local-mcp-over-app.md)。

实现尚未开始。

## 分支

- `mcp`：当前方向，本机 MCP。
- `archive/local-todo-app`：原先的 Windows / Android 待办 App（含遗留 Cloudflare Worker），只读对照。
- `main`：归档时的快照，与 `archive/local-todo-app` 指向同一历史。
