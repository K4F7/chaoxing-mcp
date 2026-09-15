import {
  appSyncResponseFromJson,
  appSyncResponseToJson,
  courseCatalogFromJson,
  courseCatalogToJson,
  defaultSyncConfig,
  emptyCourseCatalog,
  emptyReminderHistory,
  normalizeSyncConfig,
  type AppSyncResponse,
  type CourseCatalog,
  type ReminderHistory,
  type SyncConfig,
} from "@chaoxing-mcp/domain";

import { type JsonKeyValueStore } from "./json-store";

export type SyncSettings = Omit<SyncConfig, "cookie">;

export const CACHED_SYNC_KEY = "cached_app_sync";
export const COURSE_CATALOG_KEY = "course_catalog";
export const REMINDER_HISTORY_KEY = "reminder_history";
export const SYNC_SETTINGS_KEY = "sync_settings";

export function configFromSettings(settings: SyncSettings, cookie: string): SyncConfig {
  return normalizeSyncConfig({ ...settings, cookie });
}

export class AppDataStore {
  constructor(private readonly store: JsonKeyValueStore) {}

  async loadCachedSync(): Promise<AppSyncResponse | null> {
    return this.readJson(CACHED_SYNC_KEY, appSyncResponseFromJson);
  }

  async saveCachedSync(response: AppSyncResponse): Promise<void> {
    await this.writeJson(CACHED_SYNC_KEY, appSyncResponseToJson(response));
  }

  async loadCourseCatalog(): Promise<CourseCatalog> {
    return (
      (await this.readJson(COURSE_CATALOG_KEY, courseCatalogFromJson)) ??
      emptyCourseCatalog
    );
  }

  async saveCourseCatalog(catalog: CourseCatalog): Promise<void> {
    await this.writeJson(COURSE_CATALOG_KEY, courseCatalogToJson(catalog));
  }

  async loadReminderHistory(): Promise<ReminderHistory> {
    return (
      (await this.readJson(REMINDER_HISTORY_KEY, reminderHistoryFromJson)) ??
      emptyReminderHistory()
    );
  }

  async saveReminderHistory(history: ReminderHistory): Promise<void> {
    await this.writeJson(REMINDER_HISTORY_KEY, reminderHistoryToJson(history));
  }

  async loadSettings(): Promise<SyncSettings> {
    return (
      (await this.readJson(SYNC_SETTINGS_KEY, parseSettings)) ??
      settingsFromConfig(defaultSyncConfig)
    );
  }

  async saveSettings(settings: SyncSettings): Promise<void> {
    await this.writeJson(SYNC_SETTINGS_KEY, { ...settings });
  }

  private async readJson<T>(
    key: string,
    parse: (json: Record<string, unknown>) => T,
  ): Promise<T | null> {
    const raw = await this.store.getItem(key);
    if (raw == null || raw.length === 0) {
      return null;
    }
    try {
      const decoded = JSON.parse(raw) as unknown;
      if (decoded === null || typeof decoded !== "object") {
        await this.store.deleteItem(key);
        return null;
      }
      return parse(decoded as Record<string, unknown>);
    } catch {
      await this.store.deleteItem(key);
      return null;
    }
  }

  private async writeJson(key: string, value: Record<string, unknown>): Promise<void> {
    await this.store.setItem(key, JSON.stringify(value));
  }
}

function settingsFromConfig(config: SyncConfig): SyncSettings {
  const { cookie: _cookie, ...settings } = config;
  return settings;
}

function parseSettings(json: Record<string, unknown>): SyncSettings {
  return settingsFromConfig(
    normalizeSyncConfig({
      ...defaultSyncConfig,
      inboxPageLimit: numberOr(json.inboxPageLimit, defaultSyncConfig.inboxPageLimit),
      inboxItemLimit: numberOr(json.inboxItemLimit, defaultSyncConfig.inboxItemLimit),
      refreshMinutes: numberOr(json.refreshMinutes, defaultSyncConfig.refreshMinutes),
      remindersEnabled:
        typeof json.remindersEnabled === "boolean"
          ? json.remindersEnabled
          : defaultSyncConfig.remindersEnabled,
      showNotificationDetails:
        typeof json.showNotificationDetails === "boolean"
          ? json.showNotificationDetails
          : defaultSyncConfig.showNotificationDetails,
      courseSourcesEnabled:
        typeof json.courseSourcesEnabled === "boolean"
          ? json.courseSourcesEnabled
          : defaultSyncConfig.courseSourcesEnabled,
      courseLimit: numberOr(json.courseLimit, defaultSyncConfig.courseLimit),
      cookie: "",
    }),
  );
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function reminderHistoryFromJson(json: Record<string, unknown>): ReminderHistory {
  const raw = json.sent;
  if (raw === null || typeof raw !== "object") {
    return emptyReminderHistory();
  }
  const sent: Record<string, Date> = {};
  for (const [key, stamp] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof stamp !== "string" || stamp.length === 0) {
      continue;
    }
    const parsed = new Date(stamp);
    if (!Number.isNaN(parsed.getTime())) {
      sent[key] = parsed;
    }
  }
  return { sent };
}

function reminderHistoryToJson(history: ReminderHistory): Record<string, unknown> {
  return {
    sent: Object.fromEntries(
      Object.entries(history.sent).map(([key, sentAt]: [string, Date]) => [key, sentAt.toISOString()]),
    ),
  };
}
