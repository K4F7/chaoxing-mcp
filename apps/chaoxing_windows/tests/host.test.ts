import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AuthenticationExpiredException,
  buildAppSyncResponse,
  emptySyncStats,
  SyncItemKind,
  type LocalSyncRunner,
  type SyncItem,
} from "@chaoxing-mcp/domain";

import { AutostartService, MemoryAutostartStore } from "../src/autostart";
import { WindowsHost } from "../src/host";
import { AppDataStore } from "../src/persist/app-store";
import { CookieVault, MemoryProtectedStore } from "../src/persist/cookie-vault";
import { MemoryJsonStore } from "../src/persist/json-store";
import { WindowsSession } from "../src/session";

function item(now: Date): SyncItem {
  return {
    id: "work-1",
    kind: SyncItemKind.assignment,
    title: "作业",
    url: "https://mooc1.chaoxing.com/work",
    sourceTitle: "课",
    dueAt: new Date(now.getTime() + 60 * 60_000),
    displayStatus: "upcoming",
  };
}

function runner(run: LocalSyncRunner["run"]): LocalSyncRunner {
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

function hostWith(run: LocalSyncRunner["run"], argv: string[] = []) {
  const shown: string[] = [];
  const session = new WindowsSession(new CookieVault(new MemoryProtectedStore()), () => {
    shown.push("expired");
  });
  const host = new WindowsHost({
    session,
    store: new AppDataStore(new MemoryJsonStore()),
    createRunner: () => runner(run),
    notifier: {
      show(notification) {
        shown.push(notification.title);
        return true;
      },
    },
    autostart: new AutostartService(new MemoryAutostartStore(), "chaoxing_windows.exe"),
    argv,
    clock: () => new Date(2026, 7, 21, 9),
  });
  return { host, session, shown };
}

describe("Windows host", () => {
  test("hidden launch starts without a window; close hides; exit ends", async () => {
    const { host } = hostWith(async () => {
      throw new Error("no sync");
    }, ["--hidden"]);
    assert.equal(host.windowVisible, false);
    assert.equal(host.handleWindowClose(), "hide");
    assert.equal(host.windowVisible, false);
    await host.handleTray("exit");
    assert.equal(host.exited, true);
    assert.equal(host.handleWindowClose(), "exit");
  });

  test("sync delivers due-now reminders and exports redacted diagnostics", async () => {
    const now = new Date(2026, 7, 21, 9);
    const { host, session } = hostWith(async () =>
      buildAppSyncResponse({
        now,
        lastSyncedAt: now,
        items: [item(now)],
        failures: [
          {
            entryUrl: "https://mooc1.chaoxing.com/work?uid=1",
            sourceTitle: "收件箱",
            message: "fail Cookie: UID=super-secret",
          },
        ],
        stats: emptySyncStats,
        seenNotices: [],
      }),
    );
    await session.importCookieSource("UID=super-secret; vc3=token");
    await host.refresh();
    const report = host.exportDiagnostics(now);
    assert.match(report, /"failureCount": 1/);
    assert.doesNotMatch(report, /super-secret/);
    assert.match(host.trayState().authSummary, /上次同步/);
  });

  test("auth expiry is visible, stops auto sync, and notifies once", async () => {
    const { host, session, shown } = hostWith(async () => {
      throw new AuthenticationExpiredException();
    });
    await session.importCookieSource("UID=1; vc3=token");
    await host.refresh();
    await host.refresh();
    assert.equal(session.state.authenticationState, "expired");
    assert.equal(session.canAutoSync(), false);
    assert.equal(shown.filter((value) => value === "expired" || value === "学习通登录已失效").length >= 1, true);
    assert.match(host.trayState().authSummary, /登录已失效/);
  });
});
