import {
  nativeBackendFromModule,
  nativeRuntimeFromModule,
  type AlarmBackend,
  type AlarmRuntime,
  type NativeAlarmModule,
} from "@chaoxing-mcp/android-alarms";
import { requireOptionalNativeModule } from "expo-modules-core";

export function loadNativeAlarmModule(): NativeAlarmModule | null {
  return requireOptionalNativeModule<NativeAlarmModule>("ChaoxingAndroidAlarms");
}

export function createProductionAlarmBackend(): AlarmBackend | null {
  return nativeBackendFromModule(loadNativeAlarmModule());
}

export function createProductionAlarmRuntime(): AlarmRuntime | null {
  return nativeRuntimeFromModule(loadNativeAlarmModule());
}
