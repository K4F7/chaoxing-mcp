import {
  AuthenticationExpiredException,
  buildDiagnosticsReport,
  createCookieAwareHttpClient,
  defaultSyncConfig,
  emptyCourseCatalog,
  emptyReminderHistory,
  redactSensitiveText,
  chaoxingCookieSecrets,
  setCourseMonitored,
  type AppSyncResponse,
  type ChaoxingHttpClient,
  type CourseCatalog,
  type LocalSyncRunner,
  type ReminderHistory,
} from "@chaoxing-mcp/domain";

import { AutostartService } from "./autostart";
import { parseLaunchArguments } from "./launch";
import { authenticationExpiredNotification, deliverDueReminders, type NotificationBridge } from "./reminders";
import { AppDataStore, configFromSettings, type SyncSettings } from "./persist/app-store";
import { WindowsSession } from "./session";
import { buildTrayState, TrayController, type TrayAction } from "./tray";

export type WindowsHostOptions = {
  session: WindowsSession;
  store: AppDataStore;
  createRunner: () => LocalSyncRunner;
  notifier: NotificationBridge;
  autostart: AutostartService;
  argv?: readonly string[];
  clock?: () => Date;
};

export class WindowsHost {
  readonly session: WindowsSession;
  readonly tray: TrayController;
  windowVisible: boolean;
  private readonly store: AppDataStore;
  private readonly createRunner: () => LocalSyncRunner;
  private readonly notifier: NotificationBridge;
  readonly autostart: AutostartService;
  private readonly clock: () => Date;
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
  catalog: CourseCatalog = emptyCourseCatalog;
  refreshing = false;
  lastError: string | null = null;
  exited = false;
  selectedItemId: string | null = null;

  constructor(options: WindowsHostOptions) {
    this.session = options.session;
    this.store = options.store;
    this.createRunner = options.createRunner;
    this.notifier = options.notifier;
    this.autostart = options.autostart;
    this.clock = options.clock ?? (() => new Date());
    this.windowVisible = !parseLaunchArguments(options.argv ?? []).hidden;
    this.tray = new TrayController({
      onOpenWindow: () => {
        this.windowVisible = true;
      },
      onSyncNow: () => this.refresh(),
      onToggleNotifications: () =>
        this.saveSettings({
          ...this.settings,
          remindersEnabled: !this.settings.remindersEnabled,
        }),
      onOpenLoginStatus: () => {
        this.windowVisible = true;
      },
      onExit: () => {
        this.exited = true;
        this.windowVisible = false;
      },
    });
  }

  currentSettings(): SyncSettings {
    return { ...this.settings };
  }

  trayState() {
    return buildTrayState({
      refreshing: this.refreshing,
      remindersEnabled: this.settings.remindersEnabled,
      authenticationExpired: this.session.state.authenticationState === "expired",
      lastSyncedAt: this.sync?.lastSyncedAt ?? null,
    });
  }

  handleWindowClose(): "hide" | "exit" {
    if (this.tray.shouldHideOnClose()) {
      this.windowVisible = false;
      return "hide";
    }
    this.exited = true;
    return "exit";
  }

  async handleTray(action: TrayAction): Promise<void> {
    await this.tray.handleMenuAction(action);
  }

  async load(): Promise<void> {
    await this.session.load();
    this.settings = await this.store.loadSettings();
    this.sync = await this.store.loadCachedSync();
    this.history = await this.store.loadReminderHistory();
    this.catalog = await this.store.loadCourseCatalog();
    if (this.session.canAutoSync()) {
      await this.refresh();
    }
  }

  async importCookieSource(source: string): Promise<void> {
    await this.session.importCookieSource(source);
    await this.refresh();
  }

  async saveSettings(next: SyncSettings): Promise<void> {
    this.settings = next;
    await this.store.saveSettings(next);
  }

  async setCourseMonitored(courseKey: string, monitored: boolean): Promise<void> {
    this.catalog = setCourseMonitored(this.catalog, courseKey, monitored);
    await this.store.saveCourseCatalog(this.catalog);
  }

  exportDiagnostics(generatedAt?: Date): string {
    return buildDiagnosticsReport({
      cookieSource: this.session.getCookieSource(),
      sync: this.sync,
      lastError: this.lastError ?? this.session.state.error,
      generatedAt,
    });
  }

  async refresh(): Promise<void> {
    if (!this.session.canAutoSync()) {
      this.lastError = this.session.state.error ?? "登录已失效，请重新登录后再刷新";
      return;
    }
    this.refreshing = true;
    this.lastError = null;
    const cookie = this.session.getCookieSource();
    try {
      const response = await this.createRunner().run({
        config: configFromSettings(this.settings, cookie),
        previous: this.sync,
        courseCatalog: this.catalog,
        onCourseCatalogChanged: async (catalog: CourseCatalog) => {
          this.catalog = catalog;
          await this.store.saveCourseCatalog(catalog);
        },
      });
      this.session.markValid();
      this.sync = response;
      await this.store.saveCachedSync(response);
      this.history = await deliverDueReminders({
        items: response.items,
        history: this.history,
        now: this.clock(),
        showDetails: this.settings.showNotificationDetails,
        remindersEnabled: this.settings.remindersEnabled,
        notifier: this.notifier,
      });
      await this.store.saveReminderHistory(this.history);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : String(caught);
      this.lastError = redactSensitiveText(message, chaoxingCookieSecrets(cookie));
      if (caught instanceof AuthenticationExpiredException) {
        this.session.markExpired();
        await this.notifier.show(authenticationExpiredNotification());
      }
    } finally {
      this.refreshing = false;
    }
  }
}

export function createHostHttpClient(
  inner: ChaoxingHttpClient,
  session: WindowsSession,
): ChaoxingHttpClient {
  return createCookieAwareHttpClient({
    inner,
    session: {
      getSource: () => session.getCookieSource(),
      persist: (source: string) => session.replaceCookieSource(source),
    },
  });
}
