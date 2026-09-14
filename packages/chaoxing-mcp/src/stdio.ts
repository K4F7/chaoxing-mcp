import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createKeychainCredentialStore } from "./credentials";
import { createFetchChaoxingHttp } from "./http";
import type { ListTodosPorts } from "./list-todos";
import { createPassportOpenLogin } from "./open-login";
import { createChaoxingMcpServer } from "./server";

function localStdioPorts(): ListTodosPorts {
  const credentials = createKeychainCredentialStore();
  return {
    credentials,
    http: createFetchChaoxingHttp(),
    openLogin: createPassportOpenLogin(credentials),
  };
}

async function main(): Promise<void> {
  const server = createChaoxingMcpServer(localStdioPorts());
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
