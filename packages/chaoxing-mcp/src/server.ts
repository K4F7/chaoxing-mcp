import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getHomework, saveHomeworkAnswers, type HomeworkPorts } from "./homework";
import { listTodos } from "./list-todos";

const LIST_TODOS_DESCRIPTION = [
  "List still-open 待办事项 (homework, exams, and quizzes) from 学习通.",
  "Default scope is current_semester: only courses whose names start with the highest 学期代码 among enrolled courses.",
  "Pass scope=all at a semester boundary, or when older enrolled courses may still have unfinished 待办事项; do not merge semesters silently.",
  "status ok with an empty todos list means none are still open.",
  "认证失效 (auth_expired) and other failures are errors (isError), never a successful empty list.",
  "Each todo may include a plain-text 题干 summary and optional kind (e.g. 简答题) from doHomeWork; summary is null when that page is missing or fails.",
  "Do not pass accounts or cookies; this tool never returns them.",
].join(" ");

const GET_HOMEWORK_DESCRIPTION = [
  "Read all questions for a 学习通 homework by work_id (list_todos id / taskrefId).",
  "Returns index, question_id, type, type_label, title, stem_text, stem_image_urls, blanks, current_answer, supports_save.",
  "Stems are often images only. Calculation/proof types have supports_save=false (user photos themselves).",
  "Never returns cookies, enc, passwords, or tokens.",
].join(" ");

const SAVE_HOMEWORK_ANSWERS_DESCRIPTION = [
  "Save fill-in / choice answers for a homework as DRAFT only (tempSave=true).",
  "NEVER submits homework. Formal submit (tempSave=false) is refused.",
  "answers[]: identify by index and/or question_id; blanks for 填空, choice/choices for 选择.",
  "Calculation/proof (types 4/7) are rejected unless allow_rich_text=true (still draft-only; no photo upload).",
  "Do not pass accounts or cookies; this tool never returns them.",
].join(" ");

const saveAnswerSchema = z.object({
  index: z.number().int().optional().describe("0-based question index"),
  question_id: z.string().optional().describe("Chaoxing questionId"),
  blanks: z.array(z.string()).optional().describe("Fill-in answers in slot order"),
  choice: z.string().optional().describe("Single-choice value"),
  choices: z.array(z.string()).optional().describe("Multi-choice values"),
  rich_text: z.string().optional().describe("Optional rich text when allow_rich_text"),
  allow_rich_text: z
    .boolean()
    .optional()
    .describe("Opt-in to draft-save text for types 4/7; default false"),
});

export function createChaoxingMcpServer(ports: HomeworkPorts): McpServer {
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

  server.registerTool(
    "get_homework",
    {
      title: "Get homework questions",
      description: GET_HOMEWORK_DESCRIPTION,
      inputSchema: {
        work_id: z
          .string()
          .describe("Homework work_id from list_todos (taskrefId)"),
      },
    },
    async ({ work_id }) => {
      const result = await getHomework(work_id, ports);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: { ...result },
        isError: result.isError,
      };
    },
  );

  server.registerTool(
    "save_homework_answers",
    {
      title: "Save homework answers (draft only)",
      description: SAVE_HOMEWORK_ANSWERS_DESCRIPTION,
      inputSchema: {
        work_id: z
          .string()
          .describe("Homework work_id from list_todos (taskrefId)"),
        answers: z
          .array(saveAnswerSchema)
          .describe("Answers to draft-save; never submitted"),
      },
    },
    async ({ work_id, answers }) => {
      const result = await saveHomeworkAnswers(work_id, answers, ports);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: { ...result },
        isError: result.isError,
      };
    },
  );

  return server;
}
