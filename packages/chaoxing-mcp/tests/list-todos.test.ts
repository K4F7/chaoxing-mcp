import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { COURSE_LIST_URL, courseWorkListUrl } from "../src/chaoxing-urls";
import { listTodos, type ListTodosPorts } from "../src/index";
import { AUTH_PROBE_URL } from "../src/login-page";

type FakeStore = { cookie: string | null };
type FakeHttpResponse = { statusCode: number; url: string; body: string };

const VALID_COOKIE = "UID=1; vc3=abc";

function workListUrl(
  courseId: string,
  classId: string,
  cpi: string,
): string {
  return courseWorkListUrl({ courseId, classId, cpi });
}

function okHtml(url: string, body: string): FakeHttpResponse {
  return { statusCode: 200, url, body };
}

const AUTH_OK = okHtml(
  AUTH_PROBE_URL,
  "<title>个人空间</title><div>收件箱</div>",
);

function createPorts(options: {
  cookie?: string | null;
  httpResponse?: FakeHttpResponse;
  httpByUrl?: Record<string, FakeHttpResponse>;
  onOpenLogin?: (store: FakeStore) => Promise<void>;
} = {}): {
  ports: ListTodosPorts;
  store: FakeStore;
  openLoginCallCount: () => number;
  httpCallCount: () => number;
} {
  const store: FakeStore = { cookie: options.cookie ?? null };
  let openLoginCallCount = 0;
  let httpCallCount = 0;
  const ports: ListTodosPorts = {
    credentials: {
      async getCookie() {
        return store.cookie;
      },
    },
    http: {
      async request({ url }) {
        httpCallCount += 1;
        const mapped = options.httpByUrl?.[url];
        if (mapped !== undefined) {
          return mapped;
        }
        if (options.httpResponse) {
          return options.httpResponse;
        }
        throw new Error(
          `listTodos must not hit the network in this slice: ${url}`,
        );
      },
    },
    openLogin: {
      async openLogin() {
        openLoginCallCount += 1;
        if (options.onOpenLogin) {
          await options.onOpenLogin(store);
        }
      },
    },
  };
  return {
    ports,
    store,
    openLoginCallCount: () => openLoginCallCount,
    httpCallCount: () => httpCallCount,
  };
}

function enrolledCoursesHtml(
  courses: ReadonlyArray<{
    courseId: string;
    classId: string;
    cpi: string;
    title: string;
  }>,
): string {
  const items = courses
    .map(
      (course) => `
        <li class="course" courseid="${course.courseId}" clazzid="${course.classId}" personid="${course.cpi}">
          <h3 class="course-name">${course.title}</h3>
        </li>`,
    )
    .join("");
  return `<ul id="courseList">${items}</ul>`;
}

function courseSpaceHtml(
  tasks: ReadonlyArray<{
    id: string;
    title: string;
    status: string;
    due: string;
    courseId: string;
    classId: string;
  }>,
): string {
  const items = tasks
    .map(
      (task) => `
        <li data="/mooc-ans/work/phone/task-work?taskrefId=${task.id}&amp;courseId=${task.courseId}&amp;classId=${task.classId}">
          <p>${task.title}</p>
          <span class="status">${task.status}</span>
          <span>截止时间：${task.due}</span>
        </li>`,
    )
    .join("");
  return `<ul>${items}</ul>`;
}

function fixtureAResponses(): Record<string, FakeHttpResponse> {
  const oldCourse = {
    courseId: "101",
    classId: "201",
    cpi: "1",
    title: "253-旧课",
  };
  const currentCourse = {
    courseId: "102",
    classId: "202",
    cpi: "1",
    title: "261-新课",
  };
  const electiveCourse = {
    courseId: "103",
    classId: "203",
    cpi: "1",
    title: "选修无学期",
  };
  return {
    [AUTH_PROBE_URL]: AUTH_OK,
    [COURSE_LIST_URL]: okHtml(
      COURSE_LIST_URL,
      enrolledCoursesHtml([oldCourse, currentCourse, electiveCourse]),
    ),
    [workListUrl(oldCourse.courseId, oldCourse.classId, oldCourse.cpi)]:
      okHtml(
        workListUrl(oldCourse.courseId, oldCourse.classId, oldCourse.cpi),
        courseSpaceHtml([
          {
            id: "2531",
            title: "旧课作业",
            status: "未提交",
            due: "2026-09-10 23:59",
            courseId: oldCourse.courseId,
            classId: oldCourse.classId,
          },
        ]),
      ),
    [workListUrl(
      currentCourse.courseId,
      currentCourse.classId,
      currentCourse.cpi,
    )]: okHtml(
      workListUrl(
        currentCourse.courseId,
        currentCourse.classId,
        currentCourse.cpi,
      ),
      courseSpaceHtml([
        {
          id: "2611",
          title: "新课作业",
          status: "未提交",
          due: "2026-09-20 23:59",
          courseId: currentCourse.courseId,
          classId: currentCourse.classId,
        },
        {
          id: "2612",
          title: "新课打回",
          status: "打回重做",
          due: "2026-09-21 23:59",
          courseId: currentCourse.courseId,
          classId: currentCourse.classId,
        },
        {
          id: "2613",
          title: "新课已交",
          status: "已提交",
          due: "2026-09-18 23:59",
          courseId: currentCourse.courseId,
          classId: currentCourse.classId,
        },
        {
          id: "2614",
          title: "新课已结束",
          status: "已结束",
          due: "2026-09-01 23:59",
          courseId: currentCourse.courseId,
          classId: currentCourse.classId,
        },
        {
          id: "2615",
          title: "新课不可作答",
          status: "不可作答",
          due: "2026-09-01 23:59",
          courseId: currentCourse.courseId,
          classId: currentCourse.classId,
        },
        {
          id: "2616",
          title: "新课已完成",
          status: "已完成",
          due: "2026-09-01 23:59",
          courseId: currentCourse.courseId,
          classId: currentCourse.classId,
        },
      ]),
    ),
    [workListUrl(
      electiveCourse.courseId,
      electiveCourse.classId,
      electiveCourse.cpi,
    )]: okHtml(
      workListUrl(
        electiveCourse.courseId,
        electiveCourse.classId,
        electiveCourse.cpi,
      ),
      courseSpaceHtml([
        {
          id: "1031",
          title: "选修作业",
          status: "未提交",
          due: "2026-09-25 23:59",
          courseId: electiveCourse.courseId,
          classId: electiveCourse.classId,
        },
      ]),
    ),
  };
}

function fixtureBResponses(): Record<string, FakeHttpResponse> {
  const unlabeled = {
    courseId: "201",
    classId: "301",
    cpi: "1",
    title: "通识选修",
  };
  const alsoUnlabeled = {
    courseId: "202",
    classId: "302",
    cpi: "1",
    title: "讲座课",
  };
  return {
    [AUTH_PROBE_URL]: AUTH_OK,
    [COURSE_LIST_URL]: okHtml(
      COURSE_LIST_URL,
      enrolledCoursesHtml([unlabeled, alsoUnlabeled]),
    ),
    [workListUrl(unlabeled.courseId, unlabeled.classId, unlabeled.cpi)]:
      okHtml(
        workListUrl(unlabeled.courseId, unlabeled.classId, unlabeled.cpi),
        courseSpaceHtml([
          {
            id: "2011",
            title: "选修作业",
            status: "未提交",
            due: "2026-09-25 23:59",
            courseId: unlabeled.courseId,
            classId: unlabeled.classId,
          },
        ]),
      ),
    [workListUrl(
      alsoUnlabeled.courseId,
      alsoUnlabeled.classId,
      alsoUnlabeled.cpi,
    )]: okHtml(
      workListUrl(
        alsoUnlabeled.courseId,
        alsoUnlabeled.classId,
        alsoUnlabeled.cpi,
      ),
      courseSpaceHtml([
        {
          id: "2021",
          title: "讲座作业",
          status: "未提交",
          due: "2026-09-26 23:59",
          courseId: alsoUnlabeled.courseId,
          classId: alsoUnlabeled.classId,
        },
      ]),
    ),
  };
}

function portsWithoutCookie(): ListTodosPorts {
  return createPorts().ports;
}

describe("listTodos 认证失效", () => {
  test("returns auth_expired as an error when the credential port has no cookie, not a successful empty 待办事项 list", async () => {
    const result = await listTodos("current_semester", portsWithoutCookie());

    assert.equal(result.status, "auth_expired");
    assert.equal(result.isError, true);
    assert.notEqual(result.status, "ok");
  });

  test("opens 学习通 login once when there is no cookie", async () => {
    const fake = createPorts();

    const result = await listTodos("current_semester", fake.ports);

    assert.equal(fake.openLoginCallCount(), 1);
    assert.equal(result.status, "auth_expired");
    assert.equal(result.isError, true);
  });

  test("still returns auth_expired after openLogin writes a cookie, without listing 待办事项", async () => {
    const fake = createPorts({
      async onOpenLogin(store) {
        store.cookie = "UID=1; vc3=abc";
      },
    });

    const result = await listTodos("current_semester", fake.ports);

    assert.equal(fake.store.cookie, "UID=1; vc3=abc");
    assert.equal(fake.openLoginCallCount(), 1);
    assert.equal(result.status, "auth_expired");
    assert.equal(result.isError, true);
    assert.deepEqual(result.todos, []);
    assert.notEqual(result.status, "ok");
    assert.equal(fake.httpCallCount(), 0);
  });
});

describe("listTodos scope", () => {
  test("rejects an illegal scope instead of defaulting to current_semester", async () => {
    const fake = createPorts();

    const result = await listTodos("yesterday", fake.ports);

    assert.equal(result.isError, true);
    assert.notEqual(result.status, "ok");
    assert.notEqual(result.scope, "current_semester");
    assert.equal(fake.openLoginCallCount(), 0);
  });

  test("defaults omitted scope to current_semester without fetching courses", async () => {
    const result = await listTodos(undefined, portsWithoutCookie());

    assert.equal(result.scope, "current_semester");
    assert.equal(result.status, "auth_expired");
    assert.equal(result.isError, true);
  });
});

describe("listTodos existing cookie", () => {
  test("does not open login when a stored cookie does not land on a 学习通 login page", async () => {
    const fake = createPorts({
      cookie: "UID=1; vc3=abc",
      httpResponse: {
        statusCode: 200,
        url: "https://i.chaoxing.com/base",
        body: "<title>个人空间</title><div>收件箱</div>",
      },
    });

    const result = await listTodos("current_semester", fake.ports);

    assert.equal(fake.httpCallCount() >= 1, true);
    assert.equal(fake.openLoginCallCount(), 0);
    assert.notEqual(result.status, "auth_expired");
  });

  test("opens login once when a stored cookie lands on a 学习通 login page", async () => {
    const fake = createPorts({
      cookie: "UID=stale; vc3=old",
      httpResponse: {
        statusCode: 200,
        url: "https://passport2.chaoxing.com/login?fid=1",
        body: '<title>用户登录</title><button id="loginBtn">登录</button>',
      },
    });

    const result = await listTodos("current_semester", fake.ports);

    assert.equal(fake.openLoginCallCount(), 1);
    assert.equal(result.status, "auth_expired");
    assert.equal(result.isError, true);
    assert.deepEqual(result.todos, []);
  });
});

describe("listTodos login wait", () => {
  test("returns auth_expired when openLogin times out waiting for login", async () => {
    const fake = createPorts({
      async onOpenLogin() {
        throw new Error("login wait timeout");
      },
    });

    const result = await listTodos("current_semester", fake.ports);

    assert.equal(fake.openLoginCallCount(), 1);
    assert.equal(result.status, "auth_expired");
    assert.equal(result.isError, true);
    assert.notEqual(result.status, "ok");
  });
});

describe("listTodos result secrecy", () => {
  test("does not put cookie or account strings in the listTodos result", async () => {
    const secretCookie = "UID=secret-cookie-value-xyz; uf=phone-13800138000";
    const fake = createPorts({
      cookie: secretCookie,
      httpResponse: {
        statusCode: 200,
        url: "https://passport2.chaoxing.com/login?fid=1",
        body: "<title>用户登录</title>",
      },
      async onOpenLogin(store) {
        store.cookie = `${secretCookie}; p_auth_token=account-token`;
      },
    });

    const result = await listTodos("current_semester", fake.ports);
    const json = JSON.stringify(result);

    assert.equal(result.status, "auth_expired");
    assert.equal("cookie" in result, false);
    assert.equal("account" in result, false);
    assert.equal(json.includes(secretCookie), false);
    assert.equal(json.includes("secret-cookie-value-xyz"), false);
    assert.equal(json.includes("13800138000"), false);
    assert.equal(json.includes("account-token"), false);
  });
});

describe("listTodos fixture semester scope", () => {
  test("default scope returns only still-open 待办事项 from current 学期代码 261", async () => {
    const fake = createPorts({
      cookie: VALID_COOKIE,
      httpByUrl: fixtureAResponses(),
    });

    const result = await listTodos("current_semester", fake.ports);

    assert.equal(result.status, "ok");
    assert.equal(result.isError, false);
    assert.equal(result.current_semester, "261");
    assert.equal(result.scope, "current_semester");
    assert.equal(result.sources_scanned.course_space, true);
    assert.equal(result.sources_scanned.inbox, false);
    assert.equal(fake.openLoginCallCount(), 0);
    assert.deepEqual(
      result.todos.map((todo) => todo.title),
      ["新课作业", "新课打回"],
    );
    for (const todo of result.todos) {
      assert.equal(todo.course_title, "261-新课");
      assert.equal(todo.semester_code, "261");
      assert.equal(todo.source, "course_space");
    }
    const openHomework = result.todos.find((todo) => todo.title === "新课作业");
    assert.equal(openHomework?.due_at, "2026-09-20T23:59:00+08:00");
    assert.equal("cookie" in result, false);
    assert.equal("account" in result, false);
    assert.equal(JSON.stringify(result).includes(VALID_COOKIE), false);
  });

  test("scope=all returns still-open 待办事项 from all enrolled courses including 选修无学期", async () => {
    const fake = createPorts({
      cookie: VALID_COOKIE,
      httpByUrl: fixtureAResponses(),
    });

    const result = await listTodos("all", fake.ports);

    assert.equal(result.status, "ok");
    assert.equal(result.isError, false);
    assert.equal(result.scope, "all");
    assert.equal(result.current_semester, "261");
    assert.equal(result.sources_scanned.course_space, true);
    assert.equal(result.sources_scanned.inbox, false);
    assert.deepEqual(
      result.todos.map((todo) => ({
        title: todo.title,
        course_title: todo.course_title,
        semester_code: todo.semester_code,
        source: todo.source,
      })),
      [
        {
          title: "旧课作业",
          course_title: "253-旧课",
          semester_code: "253",
          source: "course_space",
        },
        {
          title: "新课作业",
          course_title: "261-新课",
          semester_code: "261",
          source: "course_space",
        },
        {
          title: "新课打回",
          course_title: "261-新课",
          semester_code: "261",
          source: "course_space",
        },
        {
          title: "选修作业",
          course_title: "选修无学期",
          semester_code: null,
          source: "course_space",
        },
      ],
    );
  });

  test("default scope returns no_semester_code as an error when no enrolled course has a 学期代码", async () => {
    const fake = createPorts({
      cookie: VALID_COOKIE,
      httpByUrl: fixtureBResponses(),
    });

    const result = await listTodos("current_semester", fake.ports);

    assert.equal(result.status, "no_semester_code");
    assert.equal(result.isError, true);
    assert.notEqual(result.status, "ok");
    assert.deepEqual(result.todos, []);
    assert.equal(result.current_semester, null);
    assert.equal(fake.openLoginCallCount(), 0);
  });

  test("excludes 已提交 已完成 已结束 不可作答 and keeps 打回重做", async () => {
    const fake = createPorts({
      cookie: VALID_COOKIE,
      httpByUrl: fixtureAResponses(),
    });

    const result = await listTodos("all", fake.ports);
    const titles = result.todos.map((todo) => todo.title);

    assert.equal(titles.includes("新课已交"), false);
    assert.equal(titles.includes("新课已完成"), false);
    assert.equal(titles.includes("新课已结束"), false);
    assert.equal(titles.includes("新课不可作答"), false);
    assert.equal(titles.includes("新课打回"), true);
    const redo = result.todos.find((todo) => todo.title === "新课打回");
    assert.equal(redo?.course_title, "261-新课");
    assert.equal(redo?.semester_code, "261");
    assert.equal(redo?.due_at, "2026-09-21T23:59:00+08:00");
    assert.equal(redo?.source, "course_space");
  });
});

describe("listTodos course fetch failures", () => {
  test("returns an error when enrolled course list fetch fails, not ok with empty 待办事项", async () => {
    const fake = createPorts({
      cookie: VALID_COOKIE,
      httpByUrl: {
        [AUTH_PROBE_URL]: AUTH_OK,
      },
    });

    const result = await listTodos("current_semester", fake.ports);

    assert.equal(result.isError, true);
    assert.notEqual(result.status, "ok");
    assert.deepEqual(result.todos, []);
    assert.equal(result.errors.length > 0, true);
    assert.equal(result.sources_scanned.course_space, false);
    assert.equal(fake.openLoginCallCount(), 0);
  });

  test("returns an error when enrolled course list HTTP status is not successful, not ok with empty 待办事项", async () => {
    const fake = createPorts({
      cookie: VALID_COOKIE,
      httpByUrl: {
        [AUTH_PROBE_URL]: AUTH_OK,
        [COURSE_LIST_URL]: {
          statusCode: 500,
          url: COURSE_LIST_URL,
          body: "internal error",
        },
      },
    });

    const result = await listTodos("all", fake.ports);

    assert.equal(result.isError, true);
    assert.notEqual(result.status, "ok");
    assert.deepEqual(result.todos, []);
    assert.equal(result.errors.length > 0, true);
    assert.equal(result.sources_scanned.course_space, false);
  });

  test("returns incomplete with remaining 待办事项 when one course space fails", async () => {
    const responses = fixtureAResponses();
    const failedCourse = {
      courseId: "102",
      classId: "202",
      cpi: "1",
      title: "261-新课",
    };
    delete responses[workListUrl(failedCourse.courseId, failedCourse.classId, failedCourse.cpi)];
    const fake = createPorts({
      cookie: VALID_COOKIE,
      httpByUrl: responses,
    });

    const result = await listTodos("all", fake.ports);

    assert.equal(result.status, "incomplete");
    assert.notEqual(result.status, "ok");
    assert.equal(result.isError, false);
    assert.equal(result.scope, "all");
    assert.equal(result.current_semester, "261");
    assert.deepEqual(
      result.todos.map((todo) => todo.title),
      ["旧课作业", "选修作业"],
    );
    assert.equal(
      result.errors.some((error) => error.where.includes("261-新课")),
      true,
    );
    assert.equal(result.sources_scanned.course_space, true);
    assert.equal(result.sources_scanned.inbox, false);
    assert.equal(JSON.stringify(result).includes(VALID_COOKIE), false);
  });

  test("returns incomplete when one course space HTTP status is not successful", async () => {
    const responses = fixtureAResponses();
    const failedUrl = workListUrl("101", "201", "1");
    responses[failedUrl] = {
      statusCode: 502,
      url: failedUrl,
      body: "bad gateway",
    };
    const fake = createPorts({
      cookie: VALID_COOKIE,
      httpByUrl: responses,
    });

    const result = await listTodos("all", fake.ports);

    assert.equal(result.status, "incomplete");
    assert.equal(result.isError, false);
    assert.equal(
      result.todos.some((todo) => todo.course_title === "253-旧课"),
      false,
    );
    assert.equal(
      result.todos.some((todo) => todo.title === "新课作业"),
      true,
    );
    assert.equal(
      result.errors.some((error) => error.where.includes("253-旧课")),
      true,
    );
  });

  test("does not return ok with empty 待办事项 when every course space fails", async () => {
    const responses = fixtureAResponses();
    delete responses[workListUrl("101", "201", "1")];
    delete responses[workListUrl("102", "202", "1")];
    delete responses[workListUrl("103", "203", "1")];
    const fake = createPorts({
      cookie: VALID_COOKIE,
      httpByUrl: responses,
    });

    const result = await listTodos("all", fake.ports);

    assert.notEqual(result.status, "ok");
    assert.equal(result.status, "incomplete");
    assert.equal(result.isError, true);
    assert.deepEqual(result.todos, []);
    assert.equal(result.errors.length, 3);
    assert.equal(
      result.errors.some((error) => error.where.includes("253-旧课")),
      true,
    );
    assert.equal(
      result.errors.some((error) => error.where.includes("261-新课")),
      true,
    );
    assert.equal(
      result.errors.some((error) => error.where.includes("选修无学期")),
      true,
    );
    assert.equal(result.sources_scanned.course_space, false);
  });

  test("returns an error incomplete when a course space succeeds with no still-open 待办事项 and others fail", async () => {
    const responses = fixtureAResponses();
    responses[workListUrl("102", "202", "1")] = okHtml(
      workListUrl("102", "202", "1"),
      courseSpaceHtml([
        {
          id: "2613",
          title: "新课已交",
          status: "已提交",
          due: "2026-09-18 23:59",
          courseId: "102",
          classId: "202",
        },
      ]),
    );
    delete responses[workListUrl("101", "201", "1")];
    delete responses[workListUrl("103", "203", "1")];
    const fake = createPorts({
      cookie: VALID_COOKIE,
      httpByUrl: responses,
    });

    const result = await listTodos("all", fake.ports);

    assert.equal(result.status, "incomplete");
    assert.notEqual(result.status, "ok");
    assert.equal(result.isError, true);
    assert.deepEqual(result.todos, []);
    assert.equal(result.errors.length, 2);
    assert.equal(result.sources_scanned.course_space, true);
  });
});
