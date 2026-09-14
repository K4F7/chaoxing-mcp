import { COURSE_LIST_URL, courseWorkListUrl } from "./chaoxing-urls";
import { AUTH_PROBE_URL, looksLikeLoginPage } from "./login-page";
import {
  currentSemesterOf,
  parseCourseSpaceTodos,
  parseEnrolledCourses,
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

export type ListTodosResult = {
  isError: boolean;
  status: ListTodosStatus;
  scope: TodoScope | null;
  current_semester: string | null;
  sources_scanned: SourcesScanned;
  todos: TodoItem[];
  unmatched_assignment_notices: number;
  errors: ListTodosError[];
};

export type CredentialStore = {
  getCookie(): Promise<string | null>;
};

export type ChaoxingHttp = {
  request(input: { url: string; cookie: string }): Promise<{
    statusCode: number;
    url: string;
    body: string;
  }>;
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
): ListTodosResult {
  return {
    isError: true,
    status,
    scope,
    current_semester: null,
    sources_scanned: { course_space: false, inbox: false },
    todos: [],
    unmatched_assignment_notices: 0,
    errors,
  };
}

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

async function openLoginAndExpire(
  ports: ListTodosPorts,
  scope: TodoScope,
): Promise<ListTodosResult> {
  try {
    await ports.openLogin.openLogin();
  } catch {
    // Login wait timeout (or other login failure) is still 认证失效.
  }
  return unscannedResult("auth_expired", scope, [
    { where: "credentials", message: "认证失效" },
  ]);
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

  const cookie = await ports.credentials.getCookie();
  if (cookie == null || cookie.trim() === "") {
    return openLoginAndExpire(ports, resolved);
  }

  const response = await ports.http.request({ url: AUTH_PROBE_URL, cookie });
  if (looksLikeLoginPage(response.url, response.body)) {
    return openLoginAndExpire(ports, resolved);
  }

  let coursesResponse: Awaited<ReturnType<ChaoxingHttp["request"]>> | undefined;
  try {
    coursesResponse = await ports.http.request({
      url: COURSE_LIST_URL,
      cookie,
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
    return unscannedResult("no_semester_code", resolved, [
      { where: "courses", message: "解析不到学期代码" },
    ]);
  }

  const inScope =
    resolved === "all"
      ? courses
      : courses.filter(
          (course) => semesterCodeOf(course.title) === currentSemester,
        );

  const todos: TodoItem[] = [];
  const errors: ListTodosError[] = [];
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

  const incomplete = errors.length > 0;
  return {
    isError: incomplete && todos.length === 0,
    status: incomplete ? "incomplete" : "ok",
    scope: resolved,
    current_semester: currentSemester,
    sources_scanned: {
      course_space: !incomplete || courseSpaceSuccesses > 0,
      inbox: false,
    },
    todos,
    unmatched_assignment_notices: 0,
    errors,
  };
}
