import {
  hasChaoxingIdentityCookieSource,
  isSafeChaoxingCookieSource,
} from "@chaoxing-mcp/domain";

import { CookieVault } from "./persist/cookie-vault";

export type WindowsSessionState = {
  cookieSource: string;
  authenticationState: "unconfigured" | "unknown" | "valid" | "expired";
  autoSyncStopped: boolean;
  error: string | null;
};

export class WindowsSession {
  private current: WindowsSessionState = {
    cookieSource: "",
    authenticationState: "unconfigured",
    autoSyncStopped: false,
    error: null,
  };
  private expiryNotified = false;

  constructor(
    private readonly vault: CookieVault,
    private readonly onExpiryEntered?: () => void,
  ) {}

  get state(): WindowsSessionState {
    return this.current;
  }

  getCookieSource(): string {
    return this.current.cookieSource;
  }

  async load(): Promise<void> {
    const loaded = await this.vault.load();
    const expired = loaded.authenticationState === "expired";
    this.expiryNotified = expired;
    this.current = {
      cookieSource: loaded.cookieSource,
      authenticationState: loaded.cookieSource.trim().length === 0
        ? "unconfigured"
        : expired
          ? "expired"
          : loaded.authenticationState,
      autoSyncStopped: expired,
      error: null,
    };
  }

  async importCookieSource(source: string): Promise<void> {
    const trimmed = source.trim();
    if (!isSafeChaoxingCookieSource(trimmed) || !hasChaoxingIdentityCookieSource(trimmed)) {
      throw new Error("Cookie 无效或缺少身份字段");
    }
    await this.vault.saveCookieSource(trimmed);
    this.expiryNotified = false;
    this.current = {
      cookieSource: trimmed,
      authenticationState: "valid",
      autoSyncStopped: false,
      error: null,
    };
  }

  async replaceCookieSource(source: string): Promise<void> {
    const trimmed = source.trim();
    if (trimmed === this.current.cookieSource) {
      return;
    }
    if (!isSafeChaoxingCookieSource(trimmed) || !hasChaoxingIdentityCookieSource(trimmed)) {
      return;
    }
    await this.vault.saveCookieSource(trimmed);
    this.current = { ...this.current, cookieSource: trimmed };
  }

  markExpired(): void {
    if (this.current.authenticationState === "expired" || this.current.authenticationState === "unconfigured") {
      return;
    }
    this.current = {
      ...this.current,
      authenticationState: "expired",
      autoSyncStopped: true,
      error: "登录已失效，请重新登录后再刷新",
    };
    void this.vault.saveAuthenticationState("expired");
    if (!this.expiryNotified) {
      this.expiryNotified = true;
      this.onExpiryEntered?.();
    }
  }

  markValid(): void {
    if (this.current.cookieSource.trim().length === 0) {
      return;
    }
    this.expiryNotified = false;
    this.current = {
      ...this.current,
      authenticationState: "valid",
      autoSyncStopped: false,
      error: null,
    };
    void this.vault.saveAuthenticationState("valid");
  }

  canAutoSync(): boolean {
    return this.current.authenticationState === "valid" || this.current.authenticationState === "unknown";
  }
}
