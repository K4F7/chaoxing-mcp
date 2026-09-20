import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { COURSE_LIST_URL, courseWorkListUrl } from "../src/chaoxing-urls";
import {
  getHomework,
  saveHomeworkAnswers,
  type HomeworkPorts,
} from "../src/homework";
import {
  assertDraftOnly,
  buildDraftSaveForm,
  draftSaveUrl,
} from "../src/homework-parse";
import { AUTH_PROBE_URL } from "../src/login-page";
import { createChaoxingMcpServer } from "../src/server";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/homework",
);

function load(name: string): string {
  return readFileSync(join(fixtures, name), "utf8");
}

type FakeHttpResponse = { statusCode: number; url: string; body: string };

const VALID_COOKIE = "UID=1; vc3=abc";
const WORK_ID = "55671703";
const COURSE = {
  courseId: "266240948",
  classId: "152370813",
  cpi: "CPI_FIXTURE",
  title: "261学期 概率论",
};

function okHtml(url: string, body: string): FakeHttpResponse {
  return { statusCode: 200, url, body };
}

const AUTH_OK = okHtml(
  AUTH_PROBE_URL,
  "<title>个人空间</title><div>收件箱</div>",
);

function enrolledCoursesHtml(): string {
  return `<ul id="courseList">
    <li class="course" courseid="${COURSE.courseId}" clazzid="${COURSE.classId}" personid="${COURSE.cpi}">
      <h3 class="course-name">${COURSE.title}</h3>
    </li>
  </ul>`;
}

function courseSpaceHtml(): string {
  const entry =
    `https://mooc1-api.chaoxing.com/mooc-ans/work/phonestudent?` +
    `courseId=${COURSE.courseId}&classId=${COURSE.classId}&cpi=${COURSE.cpi}&taskrefId=${WORK_ID}`;
  return `<ul>
    <li data="${entry}"><p>概率作业</p><span>剩余2天</span></li>
  </ul>`;
}

function taskWorkHtml(): string {
  return `<script>
    function jump() {
      window.location.href = "/mooc-ans/work/phone/doHomeWork?courseId=${COURSE.courseId}&workId=${WORK_ID}&cpi=${COURSE.cpi}&workAnswerId=55736373&classId=${COURSE.classId}&enc=ENC_FIXTURE";
    }
  </script>`;
}

function createPorts(options: {
  httpByUrl?: Record<string, FakeHttpResponse>;
  httpMatch?: Array<{
    test: (url: string, method?: string) => boolean;
    response: FakeHttpResponse | ((url: string) => FakeHttpResponse);
  }>;
  onRequest?: (input: {
    url: string;
    method?: string;
    form?: Record<string, string>;
  }) => void;
} = {}): {
  ports: HomeworkPorts;
  requests: Array<{
    url: string;
    method?: string;
    form?: Record<string, string>;
  }>;
} {
  const requests: Array<{
    url: string;
    method?: string;
    form?: Record<string, string>;
  }> = [];
  const ports: HomeworkPorts = {
    credentials: {
      async getCookie() {
        return VALID_COOKIE;
      },
    },
    http: {
      async request(input) {
        requests.push({
          url: input.url,
          method: input.method,
          form: input.form,
        });
        options.onRequest?.(input);
        const mapped = options.httpByUrl?.[input.url];
        if (mapped !== undefined) {
          return mapped;
        }
        for (const rule of options.httpMatch ?? []) {
          if (rule.test(input.url, input.method)) {
            const response =
              typeof rule.response === "function"
                ? rule.response(input.url)
                : rule.response;
            return response;
          }
        }
        throw new Error(`unexpected request: ${input.method ?? "GET"} ${input.url}`);
      },
    },
    openLogin: {
      async openLogin() {
        /* no-op */
      },
    },
  };
  return { ports, requests };
}

describe("draft save hard rules", () => {
  test("buildDraftSaveForm always includes tempSave=true and never false", () => {
    const fields = buildDraftSaveForm(load("q3-blank.html"), {
      blanks: ["42"],
    });
    assert.equal(fields.tempSave, "true");
    assertDraftOnly(fields);
  });

  test("draftSaveUrl always contains tempSave=true and never false", () => {
    const url = draftSaveUrl();
    assert.match(url, /tempSave=true/);
    assert.equal(url.includes("tempSave=false"), false);
  });

  test("save_homework_answers rejects type 7 calc by default", async () => {
    const q0 = load("q0-calc.html");
    const q3 = load("q3-blank.html");
    const listUrl = courseWorkListUrl(COURSE);
    const entry =
      `https://mooc1-api.chaoxing.com/mooc-ans/work/phonestudent?` +
      `courseId=${COURSE.courseId}&classId=${COURSE.classId}&cpi=${COURSE.cpi}&taskrefId=${WORK_ID}`;
    const do0 =
      `https://mooc1-api.chaoxing.com/mooc-ans/work/phone/doHomeWork?courseId=${COURSE.courseId}&workId=${WORK_ID}&cpi=${COURSE.cpi}&workAnswerId=55736373&classId=${COURSE.classId}&enc=ENC_FIXTURE&mooc=1&source=0&index=0&knowledgeid=0`;
    const do3 = do0.replace("index=0", "index=3");

    const { ports, requests } = createPorts({
      httpByUrl: {
        [AUTH_PROBE_URL]: AUTH_OK,
        [COURSE_LIST_URL]: okHtml(COURSE_LIST_URL, enrolledCoursesHtml()),
        [listUrl]: okHtml(listUrl, courseSpaceHtml()),
        [entry]: okHtml(entry, taskWorkHtml()),
      },
      httpMatch: [
        {
          test: (url) => url.includes("doHomeWork") && url.includes("index=0"),
          response: okHtml(do0, q0),
        },
        {
          test: (url) => url.includes("doHomeWork") && url.includes("index=3"),
          response: okHtml(do3, q3),
        },
        {
          test: (url) => url.includes("doHomeWork"),
          response: (url) => okHtml(url, q0),
        },
        {
          test: (url) => url.includes("gotoWorkAnswerSheet"),
          response: okHtml(
            "https://mooc1-api.chaoxing.com/mooc-ans/work/phone/gotoWorkAnswerSheet",
            load("answer-sheet.html"),
          ),
        },
        {
          test: (url) => url.includes("doNormalHomeWorkSubmit"),
          response: okHtml(
            "https://mooc1-api.chaoxing.com/mooc-ans/work/phone/doNormalHomeWorkSubmit?tempSave=true",
            JSON.stringify({ status: true }),
          ),
        },
      ],
    });

    const result = await saveHomeworkAnswers(
      WORK_ID,
      [{ index: 0, rich_text: "should not save" }],
      ports,
    );

    assert.equal(result.results[0]?.status, "rejected");
    assert.equal(
      requests.some((r) => (r.url ?? "").includes("doNormalHomeWorkSubmit")),
      false,
    );
    assert.equal(JSON.stringify(result).includes("ENC_FIXTURE"), false);
    assert.equal(JSON.stringify(result).includes(VALID_COOKIE), false);
  });

  test("save_homework_answers draft-saves type 2 with tempSave=true only", async () => {
    const q0 = load("q0-calc.html");
    const q3 = load("q3-blank.html");
    const listUrl = courseWorkListUrl(COURSE);
    const entry =
      `https://mooc1-api.chaoxing.com/mooc-ans/work/phonestudent?` +
      `courseId=${COURSE.courseId}&classId=${COURSE.classId}&cpi=${COURSE.cpi}&taskrefId=${WORK_ID}`;

    const posted: Array<Record<string, string> | undefined> = [];
    const { ports } = createPorts({
      httpByUrl: {
        [AUTH_PROBE_URL]: AUTH_OK,
        [COURSE_LIST_URL]: okHtml(COURSE_LIST_URL, enrolledCoursesHtml()),
        [listUrl]: okHtml(listUrl, courseSpaceHtml()),
        [entry]: okHtml(entry, taskWorkHtml()),
      },
      httpMatch: [
        {
          test: (url) => url.includes("doHomeWork") && /index=3\b/.test(url),
          response: (url) => okHtml(url, q3),
        },
        {
          test: (url) => url.includes("doHomeWork") && /index=0\b/.test(url),
          response: (url) => okHtml(url, q0),
        },
        {
          test: (url) => url.includes("doHomeWork"),
          response: (url) => {
            // After index 0, next pages: return q0 again so walk stops on duplicate
            // unless index changes — use q3 only for index=3.
            if (/index=3\b/.test(url)) {
              return okHtml(url, q3);
            }
            // For index>=1 that isn't 3, echo last-ish page with same qid as q0 to stop
            return okHtml(url, q0);
          },
        },
        {
          test: (url) => url.includes("gotoWorkAnswerSheet"),
          response: (url) => okHtml(url, load("answer-sheet.html")),
        },
        {
          test: (url, method) =>
            method === "POST" && url.includes("doNormalHomeWorkSubmit"),
          response: (url) =>
            okHtml(url, JSON.stringify({ status: true })),
        },
      ],
      onRequest: (input) => {
        if (
          input.method === "POST" &&
          input.url.includes("doNormalHomeWorkSubmit")
        ) {
          posted.push(input.form);
        }
      },
    });

    const result = await saveHomeworkAnswers(
      WORK_ID,
      [{ index: 3, blanks: ["3.14"] }],
      ports,
    );

    assert.equal(result.results[0]?.status, "saved");
    assert.equal(posted.length, 1);
    assert.equal(posted[0]?.tempSave, "true");
    assert.equal(posted[0]?.answer4058235851, "3.14");
    assert.equal(
      posted.some((form) => form?.tempSave === "false"),
      false,
    );
  });

  test("refuses payload that asks for tempSave=false", async () => {
    const { ports } = createPorts({
      httpByUrl: { [AUTH_PROBE_URL]: AUTH_OK },
    });
    const result = await saveHomeworkAnswers(
      WORK_ID,
      [{ index: 3, blanks: ["x"], tempSave: false } as never],
      ports,
    );
    assert.equal(result.status, "rejected");
    assert.equal(result.isError, true);
  });
});

describe("get_homework", () => {
  test("returns questions without secrets", async () => {
    const q0 = load("q0-calc.html");
    const q3 = load("q3-blank.html");
    const listUrl = courseWorkListUrl(COURSE);
    const entry =
      `https://mooc1-api.chaoxing.com/mooc-ans/work/phonestudent?` +
      `courseId=${COURSE.courseId}&classId=${COURSE.classId}&cpi=${COURSE.cpi}&taskrefId=${WORK_ID}`;

    const { ports } = createPorts({
      httpByUrl: {
        [AUTH_PROBE_URL]: AUTH_OK,
        [COURSE_LIST_URL]: okHtml(COURSE_LIST_URL, enrolledCoursesHtml()),
        [listUrl]: okHtml(listUrl, courseSpaceHtml()),
        [entry]: okHtml(entry, taskWorkHtml()),
      },
      httpMatch: [
        {
          test: (url) => url.includes("gotoWorkAnswerSheet"),
          response: (url) => okHtml(url, load("answer-sheet.html")),
        },
        {
          test: (url) => url.includes("doHomeWork") && /index=0\b/.test(url),
          response: (url) => okHtml(url, q0),
        },
        {
          test: (url) => url.includes("doHomeWork") && /index=3\b/.test(url),
          response: (url) => okHtml(url, q3),
        },
        {
          test: (url) => url.includes("doHomeWork"),
          response: (url) => okHtml(url, q0),
        },
      ],
    });

    const result = await getHomework(WORK_ID, ports);
    assert.equal(result.status, "ok");
    assert.ok(result.questions.length >= 1);
    assert.equal(result.questions[0]?.type, 7);
    assert.equal(result.questions[0]?.supports_save, false);
    assert.ok((result.questions[0]?.stem_image_urls.length ?? 0) >= 1);
    const blob = JSON.stringify(result);
    assert.equal(blob.includes("ENC_FIXTURE"), false);
    assert.equal(blob.includes(VALID_COOKIE), false);
    assert.equal(blob.includes("UID_FIXTURE"), false);
  });
});

describe("createChaoxingMcpServer", () => {
  test("registers get_homework and save_homework_answers", () => {
    const { ports } = createPorts({
      httpByUrl: { [AUTH_PROBE_URL]: AUTH_OK },
    });
    const server = createChaoxingMcpServer(ports);
    const tools = (
      server as unknown as {
        _registeredTools: Record<string, unknown>;
      }
    )._registeredTools;
    assert.equal("list_todos" in tools, true);
    assert.equal("get_homework" in tools, true);
    assert.equal("save_homework_answers" in tools, true);
  });
});
