import { spawn } from "node:child_process";

import { checkChaoxingAuth } from "../src/auth";
import { applyDevVars } from "../src/dev-vars";

await applyDevVars();

const result = await checkChaoxingAuth({
  cookie: process.env.CHAOXING_COOKIE,
  homeUrl: process.env.CHAOXING_HOME_URL,
});

if (!result.authenticated) {
  console.log("学习通 Cookie 不可用，正在打开登录窗口...");
  const loginExitCode = await runNpmScript("auth:login");
  if (loginExitCode !== 0) {
    process.exit(loginExitCode);
  }

  await applyDevVars(".dev.vars", { overwrite: true });
  const refreshed = await checkChaoxingAuth({
    cookie: process.env.CHAOXING_COOKIE,
    homeUrl: process.env.CHAOXING_HOME_URL,
  });

  if (!refreshed.authenticated) {
    console.error("学习通登录后仍未通过认证，请重新运行 npm start。");
    process.exit(1);
  }
}

console.log("学习通认证已通过，可以进入主界面。");

function runNpmScript(script: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", script], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}
