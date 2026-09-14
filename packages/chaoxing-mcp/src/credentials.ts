import { AsyncEntry } from "@napi-rs/keyring";

import type { CredentialStore } from "./list-todos";

const SERVICE = "chaoxinghelper.mcp";
const ACCOUNT = "cookie";

export type WritableCredentialStore = CredentialStore & {
  setCookie(cookie: string): Promise<void>;
};

export function createKeychainCredentialStore(): WritableCredentialStore {
  const entry = new AsyncEntry(SERVICE, ACCOUNT);
  return {
    async getCookie() {
      try {
        const value = await entry.getPassword();
        if (value == null || value.trim() === "") {
          return null;
        }
        return value;
      } catch (error) {
        console.error(
          "Failed to read 学习通 cookie from keychain:",
          error instanceof Error ? error.message : String(error),
        );
        return null;
      }
    },
    async setCookie(cookie: string) {
      try {
        await entry.setPassword(cookie);
      } catch (error) {
        console.error(
          "Failed to write 学习通 cookie to keychain:",
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    },
  };
}
