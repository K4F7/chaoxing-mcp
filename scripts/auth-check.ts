import { checkChaoxingAuth } from "../src/auth";
import { applyDevVars } from "../src/dev-vars";

await applyDevVars();

try {
  const result = await checkChaoxingAuth({
    cookie: process.env.CHAOXING_COOKIE,
    homeUrl: process.env.CHAOXING_HOME_URL,
  });

  console.log(JSON.stringify(result, null, 2));

  if (!result.authenticated) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    JSON.stringify(
      {
        authenticated: false,
        failureReason: "request_failed",
        message: error instanceof Error ? error.message : "unknown error",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
