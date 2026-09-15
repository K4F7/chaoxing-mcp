const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const domainRoot = path.resolve(workspaceRoot, "packages/chaoxing-domain");
const alarmsRoot = path.resolve(workspaceRoot, "packages/chaoxing-android-alarms");
const httpRoot = path.resolve(workspaceRoot, "packages/chaoxing-android-http");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [domainRoot, alarmsRoot, httpRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.extraNodeModules = {
  "@chaoxing-mcp/domain": domainRoot,
  "@chaoxing-mcp/android-alarms": alarmsRoot,
  "@chaoxing-mcp/android-http": httpRoot,
};

module.exports = config;
