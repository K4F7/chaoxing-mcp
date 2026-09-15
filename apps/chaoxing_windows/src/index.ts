import { createLocalSyncRunner } from "@chaoxing-mcp/domain";

import { AutostartService, MemoryAutostartStore } from "./autostart";
import { WindowsHost, createHostHttpClient } from "./host";
import { resolveLaunch } from "./launch";
import { AppDataStore } from "./persist/app-store";
import { CookieVault, MemoryProtectedStore } from "./persist/cookie-vault";
import { MemoryJsonStore } from "./persist/json-store";
import { WindowsSession } from "./session";

/**
 * Node entry used by tests and by the C# shell over JSON-RPC.
 * Hidden launch initializes tray + timers without showing a window.
 */
export function createWindowsHost(options: {
  argv?: readonly string[];
  tryAcquire?: () => boolean;
} = {}): { host: WindowsHost; launch: ReturnType<typeof resolveLaunch> } {
  const launch = resolveLaunch({
    argv: options.argv ?? process.argv.slice(2),
    tryAcquire: options.tryAcquire ?? (() => true),
  });
  const session = new WindowsSession(new CookieVault(new MemoryProtectedStore()));
  const host = new WindowsHost({
    session,
    store: new AppDataStore(new MemoryJsonStore()),
    createRunner: () =>
      createLocalSyncRunner({
        http: createHostHttpClient(
          {
            async send() {
              throw new Error("Windows host needs a real HTTP adapter on device");
            },
          },
          session,
        ),
      }),
    notifier: {
      async show() {
        return false;
      },
    },
    autostart: new AutostartService(new MemoryAutostartStore(), process.execPath, false),
    argv: options.argv ?? process.argv.slice(2),
  });
  return { host, launch };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { host, launch } = createWindowsHost();
  if (launch.alreadyRunning) {
    process.exit(0);
  }
  void host.load();
}
