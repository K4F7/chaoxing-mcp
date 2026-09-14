import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { ListTodosPorts } from "./list-todos";
import { createChaoxingMcpServer } from "./server";

function localStdioPorts(): ListTodosPorts {
  return {
    credentials: {
      async getCookie() {
        return null;
      },
    },
    http: {
      async request() {
        throw new Error("Chaoxing HTTP is not implemented");
      },
    },
    openLogin: {
      async openLogin() {},
    },
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
