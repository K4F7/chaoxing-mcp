import {
  MemoryAlarmRuntime,
  ReminderAlarmScheduler,
  type AlarmRuntime,
} from "@chaoxing-mcp/android-alarms";
import {
  AuthenticationExpiredException,
  chaoxingCookieSecrets,
  defaultSyncConfig,
  emptyCourseCatalog,
  emptyReminderHistory,
  markReminderSent,
  planReminders,
  pruneReminderHistory,
  redactSensitiveText,
  setCourseMonitored,
  buildDiagnosticsReport,
  type AppSyncFailure,
  type AppSyncResponse,
  type CourseCatalog,
  type LocalSyncRunner,
  type ReminderHistory,
  type SyncItem,
  type SyncProgress,
} from "@chaoxing-mcp/domain";

import { SessionController } from "../auth/session-controller";
import {
  AppDataStore,
  configFromSettings,
  type SyncSettings,
} from "../persist/app-store";

export const STARTUP_CACHE_FRESHNESS_MS = 5 * 60 * 1000;

export type SyncRequestKind = "manual" | "auto";

export type ProductionAppState = {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  items: SyncItem[];
  selectedItemId: string | null;
  lastSyncedAt: Date | null;
  failures: AppSyncFailure[];
  catalog: CourseCatalog;
  progress: SyncProgress | null;
  alarmError: string | null;
  scheduledCount: number;
};

export type ProductionAppControllerOptions = {
  session: SessionController;
  store: AppDataStore;
  createRunner: () => LocalSyncRunner;
  scheduler: ReminderAlarmScheduler;
  runtime?: AlarmRuntime;
  clock?: () => Date;
};

export class ProductionAppController {
  readonly session: SessionController;
  private readonly store: AppDataStore;
  private readonly createRunner: () => LocalSyncRunner;
  private readonly scheduler: ReminderAlarmScheduler;
  private readonly runtime: AlarmRuntime;
  private readonly clock: () => Date;
  private readonly listeners = new Set<() => void>();
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null;
  private refreshInFlight: Promise<void> | null = null;
  private forceCourseDiscovery = false;
  private sync: AppSyncResponse | null = null;
  private history: ReminderHistory = emptyReminderHistory();
  private settings: SyncSettings = {
    inboxPageLimit: defaultSyncConfig.inboxPageLimit,
    inboxItemLimit: defaultSyncConfig.inboxItemLimit,
    refreshMinutes: defaultSyncConfig.refreshMinutes,
    remindersEnabled: defaultSyncConfig.remindersEnabled,
    showNotificationDetails: defaultSyncConfig.showNotificationDetails,
    courseSourcesEnabled: defaultSyncConfig.courseSourcesEnabled,
    courseLimit: defaultSyncConfig.courseLimit,
  };

  private current: ProductionAppState = {
    loading: true,
    refreshing: false,
    error: null,
    items: [],
    selectedItemId: null,
    lastSyncedAt: null,
    failures: [],
    catalog: emptyCourseCatalog,
    progress: null,
    alarmError: null,
    scheduledCount: 0,
  };

  constructor(options: ProductionAppControllerOptions) {
    this.session = options.session;
    this.store = options.store;
    this.createRunner = options.createRunner;
    this.scheduler = options.scheduler;
    this.runtime = options.runtime ?? new MemoryAlarmRuntime();
    this.clock = options.clock ?? (() => new Date());
  }

  get state(): ProductionAppState {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    const stopSession = this.session.subscribe(() => {
      if (this.session.state.autoSyncStopped) {
        this.stopAutoSync();
      }
      listener();
    });
    return () => {
      this.listeners.delete(listener);
      stopSession();
    };
  }

  selectedItem(): SyncItem | null {
    const id = this.current.selectedItemId;
    if (id == null) {
      return null;
    }
    return this.current.items.find((item) => item.id === id) ?? null;
  }

  openItem(itemId: string): void {
    this.patch({ selectedItemId: itemId });
  }

  closeItem(): void {
    this.patch({ selectedItemId: null });
  }

  dispose(): void {
    this.stopAutoSync();
  }

  currentSettings(): SyncSettings {
    return { ...this.settings };
  }

  exportDiagnostics(generatedAt?: Date): string {
    return buildDiagnosticsReport({
      cookieSource: this.session.getCookieSource(),
      sync: this.sync,
      lastError: this.current.error ?? this.session.state.error,
      alarmError: this.current.alarmError,
      generatedAt,
    });
  }

  async saveSettings(next: SyncSettings): Promise<void> {
    this.settings = next;
    await this.store.saveSettings(next);
    this.startAutoSync();
    await this.rescheduleLive();
  }

  async setCourseMonitored(courseKey: string, monitored: boolean): Promise<void> {
    const catalog = setCourseMonitored(this.current.catalog, courseKey, monitored);
    await this.store.saveCourseCatalog(catalog);
    this.patch({ catalog });
  }

  async refreshCourses(): Promise<void> {
    this.forceCourseDiscovery = true;
    try {
      await this.refresh("manual");
    } finally {
      this.forceCourseDiscovery = false;
    }
  }

  async load(): Promise<void> {
    this.patch({ loading: true });
    await this.session.load();
    this.settings = await this.store.loadSettings();
    this.sync = await this.store.loadCachedSync();
    this.history = await this.store.loadReminderHistory();
    const catalog = await this.store.loadCourseCatalog();
    await this.ingestDeliveredReminders();
    const launch = await this.runtime.getLaunchTarget();
    this.patch({
      loading: false,
      items: this.sync?.items ?? [],
      lastSyncedAt: this.sync?.lastSyncedAt ?? null,
      failures: this.sync?.failures ?? [],
      catalog,
      selectedItemId: launch?.itemId ?? null,
      error: this.session.state.error,
    });
    if (this.session.requestSync("auto").allowed) {
      this.startAutoSync();
      if (this.hasFreshCache()) {
        await this.rescheduleLive();
      } else {
        await this.refresh("auto");
      }
    }
  }

  async importCookieSource(source: string): Promise<void> {
    await this.session.importCookieSource(source);
    await this.runtime.requestPostNotifications();
    await this.refresh("manual");
  }

  async importManualCookie(input: string): Promise<void> {
    await this.session.importManualCookie(input);
    await this.runtime.requestPostNotifications();
    await this.refresh("manual");
  }

  async refresh(kind: SyncRequestKind = "manual"): Promise<void> {
    const decision = this.session.requestSync(kind);
    if (!decision.allowed) {
      if (decision.message) {
        this.patch({ error: decision.message });
      }
      return;
    }
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    const run = this.runSync();
    this.refreshInFlight = run;
    try {
      await run;
    } finally {
      this.refreshInFlight = null;
    }
  }

  private async runSync(): Promise<void> {
    this.patch({ refreshing: true, error: null, progress: null });
    const cookie = this.session.getCookieSource();
    try {
      const response = await this.createRunner().run({
        config: configFromSettings(this.settings, cookie),
        previous: this.sync,
        courseCatalog: this.current.catalog,
        forceCourseDiscovery: this.forceCourseDiscovery,
        onProgress: (progress) => {
          this.patch({ progress });
        },
        onCourseCatalogChanged: async (catalog) => {
          await this.store.saveCourseCatalog(catalog);
          this.patch({ catalog });
        },
      });
      this.session.markValid();
      this.sync = response;
      await this.store.saveCachedSync(response);
      await this.ingestDeliveredReminders();
      await this.rescheduleLive();
      this.patch({
        items: response.items,
        lastSyncedAt: response.lastSyncedAt,
        failures: response.failures,
        error: null,
        progress: null,
        refreshing: false,
      });
      this.startAutoSync();
    } catch (caught) {
      const message = this.safeError(caught, cookie);
      if (caught instanceof AuthenticationExpiredException) {
        this.session.markExpired();
        this.stopAutoSync();
      }
      this.patch({
        error: message,
        progress: null,
        refreshing: false,
      });
    }
  }

  private async ingestDeliveredReminders(): Promise<void> {
    const delivered = await this.runtime.listDelivered();
    if (delivered.length === 0) {
      return;
    }
    let history = this.history;
    for (const row of delivered) {
      history = markReminderSent(history, row.key, new Date(row.firedAtMs));
    }
    history = pruneReminderHistory(history, this.clock());
    this.history = history;
    await this.store.saveReminderHistory(history);
    await this.runtime.consumeDelivered(delivered.map((row) => row.key));
  }

  private async rescheduleLive(): Promise<void> {
    if (!this.settings.remindersEnabled) {
      return;
    }
    const planned = planReminders({
      items: this.sync?.items ?? [],
      history: this.history,
      now: this.clock(),
    });
    try {
      const result = await this.scheduler.rescheduleAll(planned, {
        now: this.clock(),
        showDetails: this.settings.showNotificationDetails,
      });
      this.patch({
        scheduledCount: result.scheduled.length,
        alarmError: null,
      });
    } catch (caught) {
      this.patch({
        alarmError:
          caught instanceof Error
            ? caught.message
            : "预排闹钟失败，提醒可能不会响。",
      });
    }
  }

  private hasFreshCache(): boolean {
    const lastSyncedAt = this.sync?.lastSyncedAt;
    if (lastSyncedAt == null) {
      return false;
    }
    const age = this.clock().getTime() - lastSyncedAt.getTime();
    return age >= 0 && age <= STARTUP_CACHE_FRESHNESS_MS;
  }

  private startAutoSync(): void {
    this.stopAutoSync();
    if (
      this.settings.refreshMinutes <= 0 ||
      !this.session.requestSync("auto").allowed
    ) {
      return;
    }
    const periodMs = this.settings.refreshMinutes * 60_000;
    this.autoSyncTimer = setInterval(() => {
      void this.refresh("auto");
    }, periodMs);
    const handle = this.autoSyncTimer as { unref?: () => void };
    handle.unref?.();
  }

  private stopAutoSync(): void {
    if (this.autoSyncTimer != null) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
  }

  private safeError(caught: unknown, cookie: string): string {
    const message =
      caught instanceof Error ? caught.message : String(caught);
    return redactSensitiveText(message, chaoxingCookieSecrets(cookie));
  }

  private patch(partial: Partial<ProductionAppState>): void {
    this.current = { ...this.current, ...partial };
    for (const listener of this.listeners) {
      listener();
    }
  }
}
