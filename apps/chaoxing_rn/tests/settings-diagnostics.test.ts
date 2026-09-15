import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MemoryAlarmBackend,
  MemoryAlarmRuntime,
  ReminderAlarmScheduler,
} from "@chaoxing-mcp/android-alarms";
import {
  buildAppSyncResponse,
  emptySyncStats,
  type LocalSyncRunner,
} from "@chaoxing-mcp/domain";

import { CookieVault } from "../src/auth/cookie-vault";
import { MemorySecureStore } from "../src/auth/secure-store";
import { SessionController } from "../src/auth/session-controller";
import { AppDataStore } from "../src/persist/app-store";
import { MemoryJsonStore } from "../src/persist/json-store";
import { ProductionAppController } from "../src/sync/app-controller";

function emptyRunner(overrides: Partial<LocalSyncRunner> = {}): LocalSyncRunner {
  return {
    async run(input) {
      await input.onCourseCatalogChanged?.({
        lastDiscoveredAt: new Date("2026-08-21T04:00:00.000Z"),
        courses: [
          {
            monitored: true,
            course: {
              courseId: "c1",
              classId: "k1",
              cpi: "p1",
              title: "线性代数",
            },
          },
        ],
      });
      return buildAppSyncResponse({
        now: new Date("2026-08-21T04:00:00.000Z"),
        lastSyncedAt: new Date("2026-08-21T04:00:00.000Z"),
        items: [],
        failures: [
          {
            entryUrl: "https://mooc1.chaoxing.com/work?uid=9",
            sourceTitle: "收件箱",
            message: "timeout Cookie: UID=super-secret",
          },
        ],
        stats: emptySyncStats,
        seenNotices: [],
      });
    },
    async checkAuth() {
      return {
        authenticated: true,
        statusCode: 200,
        loginDetected: false,
        finalUrl: "https://i.chaoxing.com/",
        title: "首页",
      };
    },
    async fetchInboxMessages() {
      return {
        inboxUrl: "",
        pagesFetched: 0,
        totalFetched: 0,
        messages: [],
        stoppedAtSeenNotice: false,
      };
    },
    async fetchDetailSummary() {
      return { title: "", sendTime: null, content: null, assignmentLinks: [] };
    },
    async fetchAssignmentRequirement() {
      return {
        sourceTitle: "",
        sourceSendTime: null,
        sourceContent: null,
        entryUrl: "",
        finalUrl: "",
        pageTitle: null,
        status: 200,
        courseId: null,
        classId: null,
        workId: null,
        answerId: null,
        workStatus: "",
        timeWindowStart: null,
        timeWindowEnd: null,
        source: "inbox",
      };
    },
    async fetchCourseSpaces() {
      return [];
    },
    ...overrides,
  };
}

async function app() {
  const session = new SessionController({
    vault: new CookieVault(new MemorySecureStore()),
  });
  const controller = new ProductionAppController({
    session,
    store: new AppDataStore(new MemoryJsonStore()),
    createRunner: () => emptyRunner(),
    scheduler: new ReminderAlarmScheduler(new MemoryAlarmBackend()),
    runtime: new MemoryAlarmRuntime(),
    clock: () => new Date("2026-08-21T04:00:00.000Z"),
  });
  await controller.importCookieSource("UID=super-secret; vc3=token");
  return controller;
}

describe("settings, 受监控课程, diagnostics", () => {
  test("opt-out unchecks a monitored course without echoing Cookie", async () => {
    const controller = await app();
    assert.equal(controller.state.catalog.courses[0]?.monitored, true);
    await controller.setCourseMonitored("c1:k1", false);
    assert.equal(controller.state.catalog.courses[0]?.monitored, false);
    assert.equal(controller.currentSettings().remindersEnabled, true);
    await controller.saveSettings({
      ...controller.currentSettings(),
      remindersEnabled: false,
    });
    assert.equal(controller.currentSettings().remindersEnabled, false);
    controller.dispose();
  });

  test("refreshCourses forces discovery on the next sync", async () => {
    let forced: boolean | undefined;
    const session = new SessionController({
      vault: new CookieVault(new MemorySecureStore()),
    });
    const controller = new ProductionAppController({
      session,
      store: new AppDataStore(new MemoryJsonStore()),
      createRunner: () =>
        emptyRunner({
          async run(input) {
            forced = input.forceCourseDiscovery;
            return emptyRunner().run(input);
          },
        }),
      scheduler: new ReminderAlarmScheduler(new MemoryAlarmBackend()),
      runtime: new MemoryAlarmRuntime(),
    });
    await controller.importCookieSource("UID=super-secret; vc3=token");
    await controller.refreshCourses();
    assert.equal(forced, true);
    controller.dispose();
  });

  test("diagnostics export redacts Cookie and keeps failure count", async () => {
    const controller = await app();
    const report = controller.exportDiagnostics(new Date("2026-08-21T04:00:00.000Z"));
    assert.match(report, /"failureCount": 1/);
    assert.match(report, /"hasCookie": true/);
    assert.doesNotMatch(report, /super-secret/);
    assert.doesNotMatch(report, /UID=super-secret/);
    controller.dispose();
  });
});
