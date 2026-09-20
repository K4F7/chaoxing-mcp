import { COURSE_LIST_URL, courseWorkListUrl } from "./chaoxing-urls";
import { isTrustedChaoxingUrl } from "./http";
import { AUTH_PROBE_URL, looksLikeLoginPage } from "./login-page";
import {
  currentSemesterOf,
  extractDoHomeworkUrls,
  parseCourseSpaceTodos,
  parseEnrolledCourses,
  semesterCodeOf,
} from "./parse";
import type { ListTodosPorts } from "./list-todos";
import {
  RICH_TEXT_TYPES,
  answerSheetUrl,
  assertDraftOnly,
  buildDraftSaveForm,
  doHomeworkUrl,
  draftSaveUrl,
  parseAnswerSheet,
  parseHomeworkQuestionPage,
  parseHomeworkSession,
  type HomeworkSessionFields,
  type ParsedHomeworkQuestion,
} from "./homework-parse";

const WORK_DETAIL_BASE = "https://mooc1-api.chaoxing.com";
const MAX_QUESTIONS = 200;

const STUDENT_COURSE_LIST_FORM = {
  courseType: "1",
  courseFolderId: "0",
  baseEducation: "0",
  superstarClass: "",
  courseFolderSize: "0",
} as const;

const STUDENT_COURSE_LIST_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  Origin: "https://mooc1-1.chaoxing.com",
  Referer: "https://mooc1-1.chaoxing.com/visit/interaction",
  "X-Requested-With": "XMLHttpRequest",
} as const;

export type HomeworkPorts = ListTodosPorts;

export type HomeworkQuestionResult = {
  index: number;
  question_id: string;
  type: number;
  type_label: string;
  title: string;
  stem_text: string | null;
  stem_image_urls: string[];
  blanks: Array<{ slot: string; name: string; current: string }>;
  current_answer: string | null;
  supports_save: boolean;
};

export type GetHomeworkResult = {
  isError: boolean;
  status: "ok" | "auth_expired" | "not_found" | "incomplete";
  work_id: string;
  questions: HomeworkQuestionResult[];
  question_count: number | null;
  errors: Array<{ where: string; message: string }>;
};

export type SaveAnswerInput = {
  index?: number;
  question_id?: string;
  blanks?: string[];
  choice?: string;
  choices?: string[];
  rich_text?: string;
  /** Explicit opt-in for types 4/7. Default false — never submit photos for the user. */
  allow_rich_text?: boolean;
};

export type SaveAnswerItemResult = {
  index: number | null;
  question_id: string | null;
  status: "saved" | "rejected" | "failed";
  message: string;
};

export type SaveHomeworkAnswersResult = {
  isError: boolean;
  status: "ok" | "auth_expired" | "not_found" | "incomplete" | "rejected";
  work_id: string;
  results: SaveAnswerItemResult[];
  errors: Array<{ where: string; message: string }>;
};

function isSuccessfulHttp(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

function isUsableCookie(cookie: string | null): cookie is string {
  return cookie != null && cookie.trim() !== "";
}

function thrownMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : "认证失效";
}

function resolveTrustedUrl(raw: string | null): string | null {
  if (raw == null || raw.length === 0) {
    return null;
  }
  try {
    const url = new URL(raw, WORK_DETAIL_BASE).toString();
    return isTrustedChaoxingUrl(url) ? url : null;
  } catch {
    return null;
  }
}

async function resolveAuthenticatedCookie(
  ports: HomeworkPorts,
): Promise<string | GetHomeworkResult> {
  const fail = (message: string): GetHomeworkResult => ({
    isError: true,
    status: "auth_expired",
    work_id: "",
    questions: [],
    question_count: null,
    errors: [{ where: "credentials", message }],
  });

  const existing = await ports.credentials.getCookie();
  if (isUsableCookie(existing)) {
    try {
      const probe = await ports.http.request({
        url: AUTH_PROBE_URL,
        cookie: existing,
      });
      if (!looksLikeLoginPage(probe.url, probe.body)) {
        return existing;
      }
    } catch (error) {
      return fail(thrownMessage(error));
    }
  }

  try {
    await ports.openLogin.openLogin();
  } catch (error) {
    return fail(thrownMessage(error));
  }
  const after = await ports.credentials.getCookie();
  if (!isUsableCookie(after)) {
    return fail("认证失效");
  }
  try {
    const probe = await ports.http.request({
      url: AUTH_PROBE_URL,
      cookie: after,
    });
    if (looksLikeLoginPage(probe.url, probe.body)) {
      return fail("认证失效");
    }
  } catch (error) {
    return fail(thrownMessage(error));
  }
  return after;
}

type LocatedHomework = {
  workId: string;
  courseId: string;
  classId: string;
  cpi: string;
  entryUrl: string | null;
};

async function locateHomework(
  ports: HomeworkPorts,
  cookie: string,
  workId: string,
): Promise<LocatedHomework | { error: string }> {
  let coursesResponse;
  try {
    coursesResponse = await ports.http.request({
      url: COURSE_LIST_URL,
      cookie,
      method: "POST",
      form: { ...STUDENT_COURSE_LIST_FORM },
      headers: { ...STUDENT_COURSE_LIST_HEADERS },
    });
  } catch {
    return { error: "在读课程列表拉取失败" };
  }
  if (!isSuccessfulHttp(coursesResponse.statusCode)) {
    return { error: "在读课程列表拉取失败" };
  }
  const courses = parseEnrolledCourses(coursesResponse.body);
  const current = currentSemesterOf(courses);
  const ordered =
    current == null
      ? courses
      : [
          ...courses.filter((c) => semesterCodeOf(c.title) === current),
          ...courses.filter((c) => semesterCodeOf(c.title) !== current),
        ];

  for (const course of ordered) {
    const listUrl = courseWorkListUrl(course);
    let space;
    try {
      space = await ports.http.request({ url: listUrl, cookie });
    } catch {
      continue;
    }
    if (!isSuccessfulHttp(space.statusCode)) {
      continue;
    }
    for (const task of parseCourseSpaceTodos(space.body, course)) {
      if (task.id !== workId) {
        continue;
      }
      return {
        workId,
        courseId: course.courseId,
        classId: course.classId,
        cpi: course.cpi,
        entryUrl: task.entry_url,
      };
    }
  }
  return { error: `未找到作业 work_id=${workId}` };
}

async function openDoHomeworkEntry(
  ports: HomeworkPorts,
  cookie: string,
  located: LocatedHomework,
): Promise<{ html: string; url: string } | { error: string }> {
  const entry = resolveTrustedUrl(located.entryUrl);
  if (entry != null) {
    try {
      const response = await ports.http.request({ url: entry, cookie });
      if (isSuccessfulHttp(response.statusCode)) {
        const doUrls = extractDoHomeworkUrls(response.body);
        for (const raw of doUrls) {
          const url = resolveTrustedUrl(raw);
          if (url == null) {
            continue;
          }
          const withIndex = new URL(url);
          if (!withIndex.searchParams.has("index")) {
            withIndex.searchParams.set("index", "0");
          }
          const page = await ports.http.request({
            url: withIndex.toString(),
            cookie,
          });
          if (isSuccessfulHttp(page.statusCode)) {
            return { html: page.body, url: page.url || withIndex.toString() };
          }
        }
        // Entry itself may already be a doHomeWork page.
        if (
          /doHomeWork/i.test(entry) ||
          /id=["']questionId["']/i.test(response.body)
        ) {
          return { html: response.body, url: response.url || entry };
        }
      }
    } catch {
      // fall through
    }
  }
  return { error: "无法打开作业答题页" };
}

function publicQuestion(parsed: ParsedHomeworkQuestion): HomeworkQuestionResult {
  return {
    index: parsed.index,
    question_id: parsed.question_id,
    type: parsed.type,
    type_label: parsed.type_label,
    title: parsed.title,
    stem_text: parsed.stem_text,
    stem_image_urls: parsed.stem_image_urls,
    blanks: parsed.blanks.map((blank) => ({
      slot: blank.slot,
      name: blank.name,
      current: blank.current,
    })),
    current_answer: parsed.current_answer,
    supports_save: parsed.supports_save,
  };
}

function titleDisplayIndex(title: string): number | null {
  const match = title.match(/^(\d+)\s*[.、．]/);
  if (match == null) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}

async function walkQuestions(
  ports: HomeworkPorts,
  cookie: string,
  session: HomeworkSessionFields,
  firstHtml: string,
  firstUrl: string,
): Promise<{
  questions: HomeworkQuestionResult[];
  errors: Array<{ where: string; message: string }>;
}> {
  const questions: HomeworkQuestionResult[] = [];
  const errors: Array<{ where: string; message: string }> = [];
  const seen = new Set<string>();
  let html = firstHtml;
  let index = 0;
  let lastDisplay: number | null = null;
  const origin = (() => {
    try {
      return new URL(firstUrl).origin;
    } catch {
      return WORK_DETAIL_BASE;
    }
  })();

  for (let step = 0; step < MAX_QUESTIONS; step += 1) {
    const parsed = parseHomeworkQuestionPage(html);
    if (parsed.question_id.length === 0) {
      errors.push({ where: `index=${index}`, message: "页面缺少 questionId" });
      break;
    }
    const key = `${parsed.question_id}:${parsed.index}`;
    if (seen.has(key)) {
      break;
    }
    const display = titleDisplayIndex(parsed.title);
    if (
      lastDisplay != null &&
      display != null &&
      display < lastDisplay &&
      step > 0
    ) {
      break;
    }
    seen.add(key);
    questions.push(publicQuestion(parsed));
    if (display != null) {
      lastDisplay = display;
    }
    index = parsed.index + 1;
    const nextUrl = doHomeworkUrl(session, index, origin);
    if (!isTrustedChaoxingUrl(nextUrl)) {
      errors.push({ where: `index=${index}`, message: "下一题 URL 不受信任" });
      break;
    }
    try {
      const response = await ports.http.request({ url: nextUrl, cookie });
      if (!isSuccessfulHttp(response.statusCode)) {
        break;
      }
      html = response.body;
    } catch (error) {
      errors.push({ where: `index=${index}`, message: thrownMessage(error) });
      break;
    }
  }

  return { questions, errors };
}

export async function getHomework(
  workId: string,
  ports: HomeworkPorts,
): Promise<GetHomeworkResult> {
  const trimmed = workId.trim();
  if (trimmed.length === 0) {
    return {
      isError: true,
      status: "not_found",
      work_id: workId,
      questions: [],
      question_count: null,
      errors: [{ where: "work_id", message: "work_id 不能为空" }],
    };
  }

  const cookieOrError = await resolveAuthenticatedCookie(ports);
  if (typeof cookieOrError !== "string") {
    return { ...cookieOrError, work_id: trimmed };
  }
  const cookie = cookieOrError;

  const located = await locateHomework(ports, cookie, trimmed);
  if ("error" in located) {
    return {
      isError: true,
      status: "not_found",
      work_id: trimmed,
      questions: [],
      question_count: null,
      errors: [{ where: "work_id", message: located.error }],
    };
  }

  const entry = await openDoHomeworkEntry(ports, cookie, located);
  if ("error" in entry) {
    return {
      isError: true,
      status: "incomplete",
      work_id: trimmed,
      questions: [],
      question_count: null,
      errors: [{ where: "doHomeWork", message: entry.error }],
    };
  }

  const session = parseHomeworkSession(entry.html);
  if (session.courseId.length === 0 || session.workRelationId.length === 0) {
    // Prefer ids from locate when page omitted them.
    if (session.courseId.length === 0) {
      session.courseId = located.courseId;
    }
    if (session.classId.length === 0) {
      session.classId = located.classId;
    }
    if (session.cpi.length === 0) {
      session.cpi = located.cpi;
    }
    if (session.workRelationId.length === 0) {
      session.workRelationId = trimmed;
    }
  }

  let questionCount: number | null = null;
  try {
    const origin = new URL(entry.url).origin;
    const sheetUrl = answerSheetUrl(session, 0, origin);
    if (isTrustedChaoxingUrl(sheetUrl)) {
      const sheet = await ports.http.request({ url: sheetUrl, cookie });
      if (isSuccessfulHttp(sheet.statusCode)) {
        const entries = parseAnswerSheet(sheet.body);
        if (entries.length > 0) {
          questionCount = entries.length;
        }
      }
    }
  } catch {
    // optional
  }

  const walked = await walkQuestions(
    ports,
    cookie,
    session,
    entry.html,
    entry.url,
  );

  const incomplete = walked.errors.length > 0 && walked.questions.length === 0;
  return {
    isError: incomplete,
    status: incomplete ? "incomplete" : "ok",
    work_id: trimmed,
    questions: walked.questions,
    question_count: questionCount ?? walked.questions.length,
    errors: walked.errors,
  };
}


export async function saveHomeworkAnswers(
  workId: string,
  answers: SaveAnswerInput[],
  ports: HomeworkPorts,
): Promise<SaveHomeworkAnswersResult> {
  const trimmed = workId.trim();
  if (trimmed.length === 0) {
    return {
      isError: true,
      status: "not_found",
      work_id: workId,
      results: [],
      errors: [{ where: "work_id", message: "work_id 不能为空" }],
    };
  }

  // Refuse any payload that looks like a real submit.
  for (const answer of answers) {
    const maybe = answer as SaveAnswerInput & {
      tempSave?: unknown;
      submit?: unknown;
    };
    if (maybe.tempSave === false || maybe.tempSave === "false") {
      return {
        isError: true,
        status: "rejected",
        work_id: trimmed,
        results: [],
        errors: [
          {
            where: "tempSave",
            message: "拒绝提交：save_homework_answers 仅允许 tempSave=true 草稿保存",
          },
        ],
      };
    }
    if (maybe.submit === true || maybe.submit === "true") {
      return {
        isError: true,
        status: "rejected",
        work_id: trimmed,
        results: [],
        errors: [
          {
            where: "submit",
            message: "拒绝提交：本工具禁止上交作业",
          },
        ],
      };
    }
  }

  const cookieOrError = await resolveAuthenticatedCookie(ports);
  if (typeof cookieOrError !== "string") {
    return {
      isError: true,
      status: "auth_expired",
      work_id: trimmed,
      results: [],
      errors: cookieOrError.errors,
    };
  }
  const cookie = cookieOrError;

  const located = await locateHomework(ports, cookie, trimmed);
  if ("error" in located) {
    return {
      isError: true,
      status: "not_found",
      work_id: trimmed,
      results: [],
      errors: [{ where: "work_id", message: located.error }],
    };
  }

  const entry = await openDoHomeworkEntry(ports, cookie, located);
  if ("error" in entry) {
    return {
      isError: true,
      status: "incomplete",
      work_id: trimmed,
      results: [],
      errors: [{ where: "doHomeWork", message: entry.error }],
    };
  }

  const session = parseHomeworkSession(entry.html);
  if (session.courseId.length === 0) {
    session.courseId = located.courseId;
  }
  if (session.classId.length === 0) {
    session.classId = located.classId;
  }
  if (session.cpi.length === 0) {
    session.cpi = located.cpi;
  }
  if (session.workRelationId.length === 0) {
    session.workRelationId = trimmed;
  }

  const entryHtml = entry.html;
  const entryUrl = entry.url;
  const origin = (() => {
    try {
      return new URL(entryUrl).origin;
    } catch {
      return WORK_DETAIL_BASE;
    }
  })();

  // Cache a full walk only when we must resolve by question_id without index.
  let walkedQuestions: HomeworkQuestionResult[] | null = null;
  async function questionsCatalog(): Promise<HomeworkQuestionResult[]> {
    if (walkedQuestions == null) {
      const walked = await walkQuestions(
        ports,
        cookie,
        session,
        entryHtml,
        entryUrl,
      );
      walkedQuestions = walked.questions;
    }
    return walkedQuestions;
  }

  const results: SaveAnswerItemResult[] = [];
  const errors: Array<{ where: string; message: string }> = [];

  for (const answer of answers) {
    let targetIndex = answer.index;
    let expectedQuestionId = answer.question_id ?? null;

    if (targetIndex == null && expectedQuestionId != null) {
      const catalog = await questionsCatalog();
      const found = catalog.find((q) => q.question_id === expectedQuestionId);
      if (found == null) {
        results.push({
          index: null,
          question_id: expectedQuestionId,
          status: "failed",
          message: "未找到对应题目",
        });
        continue;
      }
      targetIndex = found.index;
    }

    if (targetIndex == null || !Number.isFinite(targetIndex)) {
      results.push({
        index: answer.index ?? null,
        question_id: expectedQuestionId,
        status: "failed",
        message: "需要提供 index 或 question_id",
      });
      continue;
    }

    const pageUrl = doHomeworkUrl(session, targetIndex, origin);
    if (!isTrustedChaoxingUrl(pageUrl)) {
      results.push({
        index: targetIndex,
        question_id: expectedQuestionId,
        status: "failed",
        message: "题目 URL 不受信任",
      });
      continue;
    }

    let pageHtml: string;
    try {
      const page = await ports.http.request({ url: pageUrl, cookie });
      if (!isSuccessfulHttp(page.statusCode)) {
        results.push({
          index: targetIndex,
          question_id: expectedQuestionId,
          status: "failed",
          message: `打开题目失败 HTTP ${page.statusCode}`,
        });
        continue;
      }
      pageHtml = page.body;
    } catch (error) {
      results.push({
        index: targetIndex,
        question_id: expectedQuestionId,
        status: "failed",
        message: thrownMessage(error),
      });
      continue;
    }

    const parsed = parseHomeworkQuestionPage(pageHtml);
    const target = publicQuestion(parsed);
    if (
      expectedQuestionId != null &&
      expectedQuestionId.length > 0 &&
      target.question_id !== expectedQuestionId
    ) {
      results.push({
        index: targetIndex,
        question_id: expectedQuestionId,
        status: "failed",
        message: "question_id 与 index 对应题目不一致",
      });
      continue;
    }

    if (RICH_TEXT_TYPES.has(target.type) && answer.allow_rich_text !== true) {
      results.push({
        index: target.index,
        question_id: target.question_id,
        status: "rejected",
        message:
          "计算/证明等题型默认拒绝写入（需用户自行拍照）；若仅保存纯文本请显式 allow_rich_text=true",
      });
      continue;
    }

    if (!target.supports_save && answer.allow_rich_text !== true) {
      results.push({
        index: target.index,
        question_id: target.question_id,
        status: "rejected",
        message: "该题型不支持草稿保存",
      });
      continue;
    }

    let form: Record<string, string>;
    try {
      form = buildDraftSaveForm(pageHtml, {
        blanks: answer.blanks,
        choice: answer.choice,
        choices: answer.choices,
        rich_text:
          answer.allow_rich_text === true ? answer.rich_text : undefined,
      });
      assertDraftOnly(form);
    } catch (error) {
      results.push({
        index: target.index,
        question_id: target.question_id,
        status: "rejected",
        message: thrownMessage(error),
      });
      continue;
    }

    // Absolute hard rule: never POST with tempSave=false.
    if (form.tempSave !== "true") {
      results.push({
        index: target.index,
        question_id: target.question_id,
        status: "rejected",
        message: "refusing_submit: tempSave must be true",
      });
      continue;
    }

    const saveUrl = draftSaveUrl(origin);
    if (!isTrustedChaoxingUrl(saveUrl) || !saveUrl.includes("tempSave=true")) {
      results.push({
        index: target.index,
        question_id: target.question_id,
        status: "rejected",
        message: "refusing_submit: save URL must include tempSave=true",
      });
      continue;
    }
    if (saveUrl.includes("tempSave=false")) {
      results.push({
        index: target.index,
        question_id: target.question_id,
        status: "rejected",
        message: "refusing_submit: tempSave=false is forbidden",
      });
      continue;
    }

    try {
      const response = await ports.http.request({
        url: saveUrl,
        cookie,
        method: "POST",
        form,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
      });
      if (!isSuccessfulHttp(response.statusCode)) {
        results.push({
          index: target.index,
          question_id: target.question_id,
          status: "failed",
          message: `保存失败 HTTP ${response.statusCode}`,
        });
        continue;
      }
      // Chaoxing often returns JSON {status:true}; treat non-explicit failure as saved.
      const body = response.body.trim();
      if (body.startsWith("{")) {
        try {
          const json = JSON.parse(body) as { status?: boolean; msg?: string };
          if (json.status === false) {
            results.push({
              index: target.index,
              question_id: target.question_id,
              status: "failed",
              message: json.msg ?? "保存失败",
            });
            continue;
          }
        } catch {
          // ignore parse errors
        }
      }
      results.push({
        index: target.index,
        question_id: target.question_id,
        status: "saved",
        message: "草稿已保存",
      });
    } catch (error) {
      results.push({
        index: target.index,
        question_id: target.question_id,
        status: "failed",
        message: thrownMessage(error),
      });
      errors.push({
        where: `question=${target.question_id}`,
        message: thrownMessage(error),
      });
    }
  }

  const anySaved = results.some((r) => r.status === "saved");
  const allRejected =
    results.length > 0 && results.every((r) => r.status === "rejected");
  return {
    isError: !anySaved && results.some((r) => r.status === "failed"),
    status: allRejected ? "rejected" : anySaved || results.length === 0 ? "ok" : "incomplete",
    work_id: trimmed,
    results,
    errors,
  };
}
