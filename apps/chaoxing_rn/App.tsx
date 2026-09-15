import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import {
  ReminderAlarmScheduler,
  UnsupportedAlarmBackend,
  UnsupportedAlarmRuntime,
} from "@chaoxing-mcp/android-alarms";
import { createLocalSyncRunner } from "@chaoxing-mcp/domain";

import {
  createProductionAlarmBackend,
  createProductionAlarmRuntime,
} from "./src/alarm-module";
import { createAndroidCookieCollector } from "./src/auth/android-cookie-collector";
import { createExpoCookieVault } from "./src/auth/expo-cookie-vault";
import {
  createHomepageAuthProbe,
  createLoginAuthenticator,
} from "./src/auth/homepage-probe";
import { buildHomeViewModel } from "./src/auth/home-view-model";
import { SessionController } from "./src/auth/session-controller";
import { createSessionHttpClient } from "./src/http/fetch-client";
import { loadNativeHttpModule } from "./src/http/native-module";
import { AppDataStore } from "./src/persist/app-store";
import { createDeviceJsonStore } from "./src/persist/device-store";
import { MemoryJsonStore } from "./src/persist/json-store";
import { DetailScreen } from "./src/screens/DetailScreen";
import { DiagnosticsScreen } from "./src/screens/DiagnosticsScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { ManualCookieScreen } from "./src/screens/ManualCookieScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { ProductionAppController } from "./src/sync/app-controller";

type ScreenName = "home" | "login" | "manual" | "settings" | "diagnostics";

export default function App() {
  const runtime = useMemo(
    () => createProductionAlarmRuntime() ?? new UnsupportedAlarmRuntime(),
    [],
  );
  const controller = useMemo(() => {
    const session = new SessionController({
      vault: createExpoCookieVault(),
      authenticator: createLoginAuthenticator(createHomepageAuthProbe(fetch)),
      onExpiryEntered: () => {
        void runtime.notifyAuthenticationExpired();
      },
    });
    const nativeHttp = loadNativeHttpModule();
    return new ProductionAppController({
      session,
      store: new AppDataStore(createDeviceJsonStore() ?? new MemoryJsonStore()),
      createRunner: () =>
        createLocalSyncRunner({
          http: createSessionHttpClient({
            session: {
              getSource: () => session.getCookieSource(),
              persist: (source) => session.replaceCookieSource(source),
            },
            fetchImpl: fetch,
            native: nativeHttp,
          }),
        }),
      scheduler: new ReminderAlarmScheduler(
        createProductionAlarmBackend() ?? new UnsupportedAlarmBackend(),
      ),
      runtime,
    });
  }, [runtime]);
  const collector = useMemo(() => createAndroidCookieCollector(), []);
  const [, setTick] = useState(0);
  const [screen, setScreen] = useState<ScreenName>("home");

  useEffect(() => {
    const unsubscribe = controller.subscribe(() => {
      setTick((value) => value + 1);
    });
    void controller.load();
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  const viewModel = buildHomeViewModel({
    authenticationState: controller.session.state.authenticationState,
    hasCookie: controller.session.state.cookieSource.trim().length > 0,
    autoSyncStopped: controller.session.state.autoSyncStopped,
    error: controller.session.state.error ?? controller.state.error,
  });
  const selected = controller.selectedItem();

  if (controller.state.loading || controller.session.state.loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" />
        <StatusBar style="auto" />
      </View>
    );
  }

  if (screen === "login") {
    return (
      <>
        <LoginScreen
          collector={collector}
          onCookieCaptured={(source) => controller.importCookieSource(source)}
          onClose={() => setScreen("home")}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  if (screen === "manual") {
    return (
      <>
        <ManualCookieScreen
          hasSavedCookie={controller.session.state.cookieSource.trim().length > 0}
          onImport={(input) => controller.importManualCookie(input)}
          onClose={() => setScreen("home")}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  if (screen === "settings") {
    return (
      <>
        <SettingsScreen
          settings={controller.currentSettings()}
          catalog={controller.state.catalog}
          onSave={(settings) => controller.saveSettings(settings)}
          onToggleCourse={(courseKey, monitored) =>
            controller.setCourseMonitored(courseKey, monitored)
          }
          onRefreshCourses={() => controller.refreshCourses()}
          onClose={() => setScreen("home")}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  if (screen === "diagnostics") {
    return (
      <>
        <DiagnosticsScreen
          report={controller.exportDiagnostics()}
          failureCount={controller.state.failures.length}
          onClose={() => setScreen("home")}
        />
        <StatusBar style="auto" />
      </>
    );
  }

  if (selected) {
    return (
      <>
        <DetailScreen item={selected} onClose={() => controller.closeItem()} />
        <StatusBar style="auto" />
      </>
    );
  }

  return (
    <>
      <HomeScreen
        viewModel={viewModel}
        todo={controller.state}
        onOpenLogin={() => setScreen("login")}
        onOpenManualCookie={() => setScreen("manual")}
        onRefresh={() => {
          void controller.refresh("manual");
        }}
        onOpenItem={(itemId) => controller.openItem(itemId)}
        onOpenSettings={() => setScreen("settings")}
        onOpenDiagnostics={() => setScreen("diagnostics")}
      />
      <StatusBar style="auto" />
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f6f7fb",
  },
});
