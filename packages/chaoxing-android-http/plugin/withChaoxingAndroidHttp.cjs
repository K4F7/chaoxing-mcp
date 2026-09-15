function loadConfigPlugins() {
  try {
    return require("@expo/config-plugins");
  } catch (err) {
    return require(require.resolve("@expo/config-plugins", { paths: [process.cwd()] }));
  }
}

const { createRunOncePlugin } = loadConfigPlugins();

function withChaoxingAndroidHttp(config) {
  return config;
}

module.exports = createRunOncePlugin(
  withChaoxingAndroidHttp,
  "@chaoxing-mcp/android-http",
  "0.1.0",
);
