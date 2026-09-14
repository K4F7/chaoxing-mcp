# 仓库改为本机 MCP 查询，不再做独立待办 App

这个仓库原先是 Windows / Android 上的学习通待办与提醒 App。现在的目标改成：让本机上的 agent 能查到当前受监控课程里的待办事项。产品形态从独立 App 换成跑在本机的 MCP server；登录态必须留在本机，不经过我们自己运营的远程服务。

**为什么不把 MCP 附在现有 App 上。** App 的核心是提醒、托盘、安装包和双端各自为政的同步。Agent 查询不需要这些，继续背着会让两套产品共用一套认证和存储，边界会糊。旧实现整棵树冻结在 `archive/local-todo-app`，需要对照解析行为时去那条分支，而不是在本分支里兼做。

**为什么不用远程 HTTP MCP。** `build-mcp-server` 默认推荐 Remote Streamable HTTP，适合云端 API。学习通是 cookie 会话，不是 OAuth。把 cookie 放到我们托管的远端，等于重新引入已经放弃的自建服务端，也让[认证失效](../../CONTEXT.md)变成远端状态、调用方更难看见。本机 stdio（进程跑在用户机器上，凭据不出那台机器）是唯一不和这条约束打架的部署方式。MCPB 安装包以后若要分发再考虑，现在不需要。

**这个选择带来的约束。**

- [ADR-0001](./0001-android-prescheduled-alarms.md)（Android 预排闹钟）不再适用，已被本决策取代。提醒规则、双端独立、安装包都不在范围内。
- 空结果不能表示「没有作业」。查询在[认证失效](../../CONTEXT.md)时必须把该状态返回给调用方，否则就是[静默失效](../../CONTEXT.md)。
- 旧 App 与遗留 Worker 的代码不在本分支演进；解析细节以 `archive/local-todo-app` 为只读对照。
