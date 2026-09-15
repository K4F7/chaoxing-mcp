import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildAppSyncResponse,
  emptyReminderHistory,
  markReminderSent,
  pruneReminderHistory,
  SyncItemKind,
} from "@chaoxing-mcp/domain";

import { AppDataStore } from "../src/persist/app-store";
import { MemoryJsonStore } from "../src/persist/json-store";

describe("app data store", () => {
  test("persists course catalog, cached sync with 已见通知, and last sync", async () => {
    const store = new AppDataStore(new MemoryJsonStore());
    const now = new Date(2026, 7, 21, 12);
    const response = buildAppSyncResponse({
      now,
      lastSyncedAt: now,
      items: [
        {
          id: "work-1",
          kind: SyncItemKind.assignment,
          title: "作业",
          url: "https://mooc1.chaoxing.com/work",
          sourceTitle: "收件箱",
          dueAt: new Date(2026, 7, 22, 12),
        },
      ],
      failures: [],
      seenNotices: [
        {
          id: "n1",
          detailParsed: true,
          title: "作业通知",
          sendTime: "2026-08-20",
          content: "正文",
          taskLinks: ["https://mooc1.chaoxing.com/work"],
        },
      ],
    });

    await store.saveCachedSync(response);
    await store.saveCourseCatalog({
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

    const loaded = await store.loadCachedSync();
    const catalog = await store.loadCourseCatalog();
    assert.equal(loaded?.items[0]?.id, "work-1");
    assert.equal(loaded?.seenNotices[0]?.id, "n1");
    assert.equal(loaded?.lastSyncedAt?.getTime(), now.getTime());
    assert.equal(catalog.courses[0]?.course.title, "线性代数");
  });

  test("persists 提醒历史 and applies domain prune rules", async () => {
    const store = new AppDataStore(new MemoryJsonStore());
    const now = new Date(2026, 7, 21, 12);
    let history = emptyReminderHistory();
    history = markReminderSent(history, "fresh", now);
    history = markReminderSent(history, "old", new Date(2026, 4, 1));
    history = pruneReminderHistory(history, now);
    await store.saveReminderHistory(history);

    const loaded = await store.loadReminderHistory();
    assert.equal(Object.keys(loaded.sent).includes("fresh"), true);
    assert.equal(Object.keys(loaded.sent).includes("old"), false);
  });

  test("never writes a cookie field into settings JSON", async () => {
    const memory = new MemoryJsonStore();
    const store = new AppDataStore(memory);
    await store.saveSettings({
      inboxPageLimit: 3,
      inboxItemLimit: 60,
      refreshMinutes: 60,
      remindersEnabled: true,
      showNotificationDetails: false,
      courseSourcesEnabled: true,
      courseLimit: 20,
    });
    const raw = memory.peek("sync_settings") ?? "";
    assert.equal(raw.includes("cookie"), false);
    assert.equal(raw.includes("UID"), false);
  });
});
