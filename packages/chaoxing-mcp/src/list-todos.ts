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

function resolveScope(scope: string | undefined): TodoScope | null {
  if (scope === undefined) {
    return "current_semester";
  }
  if (scope === "current_semester" || scope === "all") {
    return scope;
  }
  return null;
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
    return unscannedResult("auth_expired", resolved, [
      { where: "credentials", message: "认证失效" },
    ]);
  }

  throw new Error("listing 待办事项 is not implemented");
}
