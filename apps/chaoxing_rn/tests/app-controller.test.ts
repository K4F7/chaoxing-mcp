import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MemoryAlarmBackend,
  MemoryAlarmRuntime,
  ReminderAlarmScheduler,
} from "@chaoxing-mcp/android-alarms";
import {
  AuthenticationExpiredException,
  buildAppSyncResponse,
  emptySyncStats,
  reminderKey,
  SyncItemKind,
  type AppSyncResponse,
  type LocalSyncRunner,
  type SyncItem,
} from "@chaoxing-mcp/domain";

import { CookieVault } from "../src/auth/cookie-vault";
import { MemorySecureStore } from "../src/auth/secure-store";
import { SessionController } from "../src/auth/session-controller";
import { AppDataStore } from "../src/persist/app-store";
import { MemoryJsonStore } from "../src/persist/json-store";
import { ProductionAppController } from "../src/sync/app-controller";
import { groupTodoItems, trustedItemUrl } from "../src/sync/todo-groups";

function item(now: Date, hours: number): SyncItem {
  return {
    id: "work-1",
    kind: SyncItemKind.assignment,
    title: "线性代数作业",
    url: "https://mooc1.chaoxing.com/work",
    sourceTitle: "收件箱",
    dueAt: new Date(now.getTime() + hours * 3600_000),
    displayStatus: "upcoming",
  };
}

function syncResponse(now: Date, items: SyncItem[]): AppSyncResponse {
  return buildAppSyncResponse({
    now,
    lastSyncedAt: now,
    items,
    failures: [],
    stats: emptySyncStats,
    seenNotices: [
      {
        id: "notice-1",
        detailParsed: true,
        title: "作业",
        sendTime: null,
        content: null,
        taskLinks: ["https://mooc1.chaoxing.com/work"],
      },
    ],
  });
}

function fakeRunner(run: LocalSyncRunner["run"]): LocalSyncRunner {
  return {
    run,
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
  };
}

function controllerWith(options: {
  now: Date;
  runner: LocalSyncRunner;
  runtime?: MemoryAlarmRuntime;
  backend?: MemoryAlarmBackend;
}) {
  const runtime = options.runtime ?? new MemoryAlarmRuntime();
  const backend = options.backend ?? new MemoryAlarmBackend();
  const session = new SessionController({
    vault: new CookieVault(new MemorySecureStore()),
    onExpiryEntered: () => {
      void runtime.notifyAuthenticationExpired();
    },
  });
  const store = new AppDataStore(new MemoryJsonStore());
  const app = new ProductionAppController({
    session,
    store,
    createRunner: () => options.runner,
    scheduler: new ReminderAlarmScheduler(backend),
    runtime,
    clock: () => options.now,
  });
  return { app, session, store, runtime, backend };
}

describe("production app controller", () => {
  test("login starts a real sync, persists catalog/已见通知, and reschedules live alarms", async () => {
    const now = new Date(2026, 7, 21, 9);
    const todo = item(now, 25);
    let ran = 0;
    const { app, store, backend, runtime } = controllerWith({
      now,
      runner: fakeRunner(async (input) => {
        ran += 1;
        assert.match(input.config.cookie, /UID=1/);
        await input.onCourseCatalogChanged?.({
          courses: [
            {
              course: {
                courseId: "c1",
                classId: "k1",
                cpi: "p1",
                title: "线性代数",
              },
              monitored: true,
            },
          ],
          lastDiscoveredAt: now,
        });
        return syncResponse(now, [todo]);
      }),
    });

    await app.importCookieSource("UID=1; vc3=secret");
    app.dispose();

    assert.equal(ran, 1);
    assert.equal(runtime.permissionRequested, true);
    assert.equal(app.state.items[0]?.id, "work-1");
    assert.equal((await store.loadCachedSync())?.seenNotices[0]?.id, "notice-1");
    assert.equal((await store.loadCourseCatalog()).courses[0]?.course.title, "线性代数");
    const listed = await backend.list();
    assert.ok(listed.length >= 2);
    assert.ok(listed.every((plan) => plan.itemId === "work-1"));
    assert.ok(
      listed.every((plan) => plan.alarmManagerApi === "setExactAndAllowWhileIdle"),
    );
  });

  test("ingests delivered reminders into 提醒历史 before the next reschedule", async () => {
    const now = new Date(2026, 7, 21, 9);
    const todo = item(now, 25);
    const key = reminderKey(todo, "due-24h", todo.dueAt!);
    const runtime = new MemoryAlarmRuntime();
    runtime.recordDelivered({
      key,
      itemId: todo.id,
      firedAtMs: now.getTime(),
    });
    const { app, store, backend } = controllerWith({
      now,
      runtime,
      runner: fakeRunner(async () => syncResponse(now, [todo])),
    });

    await app.importCookieSource("UID=1; vc3=secret");
    app.dispose();

    const history = await store.loadReminderHistory();
    assert.equal(Object.keys(history.sent).includes(key), true);
    const listed = await backend.list();
    assert.equal(
      listed.some((plan) => plan.key === key),
      false,
    );
    assert.equal(runtime.delivered.length, 0);
  });

  test("认证失效 notifies once, persists across reload, and stops auto sync", async () => {
    const now = new Date(2026, 7, 21, 9);
    const runtime = new MemoryAlarmRuntime();
    const vaultStore = new MemorySecureStore();
    const session = new SessionController({
      vault: new CookieVault(vaultStore),
      onExpiryEntered: () => {
        void runtime.notifyAuthenticationExpired();
      },
    });
    const first = new ProductionAppController({
      session,
      store: new AppDataStore(new MemoryJsonStore()),
      createRunner: () =>
        fakeRunner(async () => {
          throw new AuthenticationExpiredException();
        }),
      scheduler: new ReminderAlarmScheduler(new MemoryAlarmBackend()),
      runtime,
      clock: () => now,
    });

    await first.importCookieSource("UID=1; vc3=secret");
    first.dispose();
    first.session.markExpired();
    first.session.markExpired();

    assert.equal(runtime.expiryNotifications, 1);
    assert.equal(first.session.requestSync("auto").allowed, false);
    assert.equal((await new CookieVault(vaultStore).load()).authenticationState, "expired");

    const restored = new SessionController({
      vault: new CookieVault(vaultStore),
    });
    await restored.load();
    assert.equal(restored.state.authenticationState, "expired");
    assert.equal(restored.state.autoSyncStopped, true);
  });

  test("cold start shows cached 待办 and opens a launch-target item", async () => {
    const now = new Date(2026, 7, 21, 9);
    const todo = item(now, 10);
    const json = new MemoryJsonStore();
    const store = new AppDataStore(json);
    await store.saveCachedSync(syncResponse(now, [todo]));
    const runtime = new MemoryAlarmRuntime();
    runtime.launchTarget = { itemId: "work-1", reminderKey: "k" };
    const session = new SessionController({
      vault: new CookieVault(new MemorySecureStore()),
    });
    await session.importCookieSource("UID=1; vc3=secret");
    const app = new ProductionAppController({
      session,
      store,
      createRunner: () =>
        fakeRunner(async () => {
          throw new Error("should use fresh cache");
        }),
      scheduler: new ReminderAlarmScheduler(new MemoryAlarmBackend()),
      runtime,
      clock: () => now,
    });

    await app.load();

    assert.equal(app.state.items[0]?.title, "线性代数作业");
    assert.equal(app.selectedItem()?.id, "work-1");
    assert.ok(groupTodoItems(app.state.items).length > 0);
    app.dispose();
  });

  test("URL 信任分级 refuses non-Chaoxing links", () => {
    assert.equal(
      trustedItemUrl("https://mooc1.chaoxing.com/work"),
      "https://mooc1.chaoxing.com/work",
    );
    assert.equal(trustedItemUrl("https://evil.example/work"), null);
  });

  test("expired session does not call the sync runner", async () => {
    let ran = 0;
    const { app } = controllerWith({
      now: new Date(2026, 7, 21, 9),
      runner: fakeRunner(async () => {
        ran += 1;
        return syncResponse(new Date(), []);
      }),
    });
    await app.importCookieSource("UID=1; vc3=secret");
    ran = 0;
    app.session.markExpired();
    await app.refresh("auto");
    app.dispose();
    assert.equal(ran, 0);
  });
});
