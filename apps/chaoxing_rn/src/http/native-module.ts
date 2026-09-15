import { type NativeHttpModule } from "@chaoxing-mcp/android-http";

type ExpoModules = {
  requireNativeModule?: (name: string) => NativeHttpModule;
};

export function loadNativeHttpModule(): NativeHttpModule | null {
  try {
    const expoModules = require("expo-modules-core") as ExpoModules;
    const loaded = expoModules.requireNativeModule?.("ChaoxingAndroidHttp");
    return loaded ?? null;
  } catch {
    return null;
  }
}
