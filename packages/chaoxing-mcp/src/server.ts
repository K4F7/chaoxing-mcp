import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listTodos, type ListTodosPorts } from "./list-todos";

const LIST_TODOS_DESCRIPTION = [
  "List still-open 待办事项 (homework, exams, and quizzes) from 学习通.",
  "Default scope is current_semester: only courses whose names start with the highest 学期代码 among enrolled courses.",
  "Pass scope=all at a semester boundary, or when older enrolled courses may still have unfinished 待办事项; do not merge semesters silently.",
  "status ok with an empty todos list means none are still open.",
  "认证失效 (auth_expired) and other failures are errors (isError), never a successful empty list.",
  "Do not pass accounts or cookies; this tool never returns them.",
].join(" ");

export function createChaoxingMcpServer(ports: ListTodosPorts): McpServer {
  const server = new McpServer({
    name: "chaoxing-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "list_todos",
    {
      title: "List 待办事项",
      description: LIST_TODOS_DESCRIPTION,
      inputSchema: {
        scope: z
          .enum(["current_semester", "all"])
          .optional()
          .describe(
            "current_semester (default) or all. Use all only at a semester boundary or when you suspect 待办事项 from older enrolled courses are missing.",
          ),
      },
    },
    async ({ scope }) => {
      const result = await listTodos(scope, ports);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: { ...result },
        isError: result.isError,
      };
    },
  );

  return server;
}
