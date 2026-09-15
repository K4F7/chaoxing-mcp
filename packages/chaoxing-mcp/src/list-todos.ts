import { COURSE_LIST_URL, INBOX_URL, courseWorkListUrl } from "./chaoxing-urls";
import { AUTH_PROBE_URL, looksLikeLoginPage } from "./login-page";
import {
  currentSemesterOf,
  parseCourseSpaceTodos,
  parseEnrolledCourses,
  parseInboxNotices,
  semesterCodeOf,
} from "./parse";

export type TodoScope = "current_semester" | "all";

export type ListTodosStatus =
  | "ok"
  | "auth_expired"
  | "no_semester_code"
  | "incomplete"
  | "invalid_scope";

export type ListTodosError = {
  where: string;
  message: string;
};

export type TodoItem = {
  id: string;
  title: string;
  course_title: string;
  semester_code: string | null;
  due_at: string | null;
  source: string;
  course_id: string | null;
  class_id: string | null;
};

export type SourcesScanned = {
  course_space: boolean;
  inbox: boolean;
};

export type ScannedCourseSummary = {
  id: string;
  title: string;
  semester_code: string | null;
};

export type ListTodosResult = {
  isError: boolean;
  status: ListTodosStatus;
  scope: TodoScope | null;
  current_semester: string | null;
  sources_scanned: SourcesScanned;
  courses_scanned: ScannedCourseSummary[];
  courses_in_scope_count: number;
  courses_enrolled_count: number;
  todos: TodoItem[];
  unmatched_assignment_notices: number;
  errors: ListTodosError[];
};

export type CredentialStore = {
  getCookie(): Promise<string | null>;
};

export type ChaoxingHttpRequest = {
  url: string;
  cookie: string;
  method?: "GET" | "POST";
  form?: Record<string, string>;
  headers?: Record<string, string>;
};

export type ChaoxingHttpResponse = {
  statusCode: number;
  url: string;
  body: string;
};

export type ChaoxingHttp = {
  request(input: ChaoxingHttpRequest): Promise<ChaoxingHttpResponse>;
};

export type OpenLogin = {
  openLogin(): Promise<void>;
};

export type ListTodosPorts = {
  credentials: CredentialStore;
  http: ChaoxingHttp;
  openLogin: OpenLogin;
};

function unscannedResult(
  status: ListTodosStatus,
  scope: TodoScope | null,
  errors: ListTodosError[],
  courses_scanned: ScannedCourseSummary[] = [],
  courses_enrolled_count = 0,
): ListTodosResult {
  return {
    isError: true,
    status,
    scope,
    current_semester: null,
    sources_scanned: { course_space: false, inbox: false },
    courses_scanned,
    courses_in_scope_count: courses_scanned.length,
    courses_enrolled_count,
    todos: [],
    unmatched_assignment_notices: 0,
    errors,
  };
}

function summarizeCourses(
  courses: readonly { courseId: string; title: string }[],
): ScannedCourseSummary[] {
  return courses.map((course) => ({
    id: course.courseId,
    title: course.title,
    semester_code: semesterCodeOf(course.title),
  }));
}

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

function isSuccessfulHttp(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

function resolveScope(scope: string | undefined): TodoScope | null {
  if (scope === undefined) {
    return "current_semester";
  }
  if (scope === "current_semester" || scope === "all") {
    return scope;
  }
  return null;
}

function authExpiredResult(
  scope: TodoScope,
  message = "认证失效",
): ListTodosResult {
  return unscannedResult("auth_expired", scope, [
    { where: "credentials", message },
  ]);
}

function isUsableCookie(cookie: string | null): cookie is string {
  return cookie != null && cookie.trim() !== "";
}

function thrownLoginMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : "认证失效";
}

async function cookieAfterOpenLogin(
  ports: ListTodosPorts,
  scope: TodoScope,
): Promise<string | ListTodosResult> {
  try {
    await ports.openLogin.openLogin();
  } catch (error) {
    return authExpiredResult(scope, thrownLoginMessage(error));
  }
  const cookie = await ports.credentials.getCookie();
  if (!isUsableCookie(cookie)) {
    return authExpiredResult(scope);
  }
  return cookie;
}

async function probeAuth(
  ports: ListTodosPorts,
  cookie: string,
  scope: TodoScope,
): Promise<"ok" | "login_page" | ListTodosResult> {
  try {
    const response = await ports.http.request({
      url: AUTH_PROBE_URL,
      cookie,
    });
    if (looksLikeLoginPage(response.url, response.body)) {
      return "login_page";
    }
    return "ok";
  } catch (error) {
    return unscannedResult("incomplete", scope, [
      { where: "credentials", message: thrownLoginMessage(error) },
    ]);
  }
}

async function resolveAuthenticatedCookie(
  ports: ListTodosPorts,
  scope: TodoScope,
): Promise<string | ListTodosResult> {
  const existing = await ports.credentials.getCookie();
  if (isUsableCookie(existing)) {
    const probed = await probeAuth(ports, existing, scope);
    if (probed === "ok") {
      return existing;
    }
    if (probed !== "login_page") {
      return probed;
    }
  }

  const afterLogin = await cookieAfterOpenLogin(ports, scope);
  if (typeof afterLogin !== "string") {
    return afterLogin;
  }

  const probed = await probeAuth(ports, afterLogin, scope);
  if (probed === "login_page") {
    return authExpiredResult(scope);
  }
  if (probed !== "ok") {
    return probed;
  }
  return afterLogin;
}

export async function listTodos(
  scope: string | undefined,
  ports: ListTodosPorts,
): Promise<ListTodosResult> {
  const resolved = resolveScope(scope);
  if (resolved === null) {
    return unscannedResult("invalid_scope", null, [
      { where: "scope", message: "scope must be current_semester or all" },
    ]);
  }

  const cookieOrExpired = await resolveAuthenticatedCookie(ports, resolved);
  if (typeof cookieOrExpired !== "string") {
    return cookieOrExpired;
  }
  const cookie = cookieOrExpired;

  let coursesResponse: Awaited<ReturnType<ChaoxingHttp["request"]>> | undefined;
  try {
    coursesResponse = await ports.http.request({
      url: COURSE_LIST_URL,
      cookie,
      method: "POST",
      form: { ...STUDENT_COURSE_LIST_FORM },
      headers: { ...STUDENT_COURSE_LIST_HEADERS },
    });
  } catch {
    coursesResponse = undefined;
  }
  if (
    coursesResponse === undefined ||
    !isSuccessfulHttp(coursesResponse.statusCode)
  ) {
    return unscannedResult("incomplete", resolved, [
      { where: "courses", message: "在读课程列表拉取失败" },
    ]);
  }
  const courses = parseEnrolledCourses(coursesResponse.body);
  const currentSemester = currentSemesterOf(courses);
  if (resolved === "current_semester" && currentSemester === null) {
    return unscannedResult(
      "no_semester_code",
      resolved,
      [{ where: "courses", message: "解析不到学期代码" }],
      summarizeCourses(courses),
      courses.length,
    );
  }

  const inScope =
    resolved === "all"
      ? courses
      : courses.filter(
          (course) => semesterCodeOf(course.title) === currentSemester,
        );

  const todos: TodoItem[] = [];
  const errors: ListTodosError[] = [];
  const seenIds = new Set<string>();
  let courseSpaceSuccesses = 0;
  for (const course of inScope) {
    const listUrl = courseWorkListUrl(course);
    let space: Awaited<ReturnType<ChaoxingHttp["request"]>> | undefined;
    try {
      space = await ports.http.request({ url: listUrl, cookie });
    } catch {
      space = undefined;
    }
    if (space === undefined || !isSuccessfulHttp(space.statusCode)) {
      errors.push({
        where: course.title,
        message: "课程空间拉取失败",
      });
      continue;
    }
    courseSpaceSuccesses += 1;
    for (const task of parseCourseSpaceTodos(space.body, course)) {
      seenIds.add(`${course.courseId}:${task.id}`);
      if (task.closed) {
        continue;
      }
      todos.push({
        id: task.id,
        title: task.title,
        course_title: course.title,
        semester_code: semesterCodeOf(course.title),
        due_at: task.due_at,
        source: "course_space",
        course_id: course.courseId,
        class_id: course.classId,
      });
    }
  }

  let inboxScanned = false;
  let unmatchedAssignmentNotices = 0;
  let inboxResponse: Awaited<ReturnType<ChaoxingHttp["request"]>> | undefined;
  try {
    inboxResponse = await ports.http.request({ url: INBOX_URL, cookie });
  } catch {
    inboxResponse = undefined;
  }
  if (inboxResponse !== undefined && isSuccessfulHttp(inboxResponse.statusCode)) {
    inboxScanned = true;
    for (const notice of parseInboxNotices(inboxResponse.body)) {
      if (!notice.assignmentLike) {
        continue;
      }
      const course = inScope.find(
        (candidate) =>
          candidate.courseId === notice.courseId &&
          (notice.classId == null || candidate.classId === notice.classId),
      );
      if (course === undefined) {
        unmatchedAssignmentNotices += 1;
        continue;
      }
      const identity = `${course.courseId}:${notice.id}`;
      if (seenIds.has(identity)) {
        continue;
      }
      seenIds.add(identity);
      todos.push({
        id: notice.id,
        title: notice.title,
        course_title: course.title,
        semester_code: semesterCodeOf(course.title),
        due_at: notice.due_at,
        source: "inbox",
        course_id: course.courseId,
        class_id: course.classId,
      });
    }
  } else {
    errors.push({ where: "inbox", message: "收件箱拉取失败" });
  }

  const incomplete = errors.length > 0;
  return {
    isError: incomplete && todos.length === 0,
    status: incomplete ? "incomplete" : "ok",
    scope: resolved,
    current_semester: currentSemester,
    sources_scanned: {
      course_space: courseSpaceSuccesses > 0,
      inbox: inboxScanned,
    },
    courses_scanned: summarizeCourses(inScope),
    courses_in_scope_count: inScope.length,
    courses_enrolled_count: courses.length,
    todos,
    unmatched_assignment_notices: unmatchedAssignmentNotices,
    errors,
  };
}
