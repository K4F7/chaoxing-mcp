function loadConfigPlugins() {
  try {
    return require("@expo/config-plugins");
  } catch (err) {
    return require(require.resolve("@expo/config-plugins", { paths: [process.cwd()] }));
  }
}

const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
} = loadConfigPlugins();

const PACKAGE_NAME = "@chaoxing-mcp/android-alarms";
const RECEIVER_FIRE = "com.chaoxinghelper.alarms.ChaoxingAlarmReceiver";
const RECEIVER_BOOT = "com.chaoxinghelper.alarms.ChaoxingBootReceiver";

const PERMISSIONS = [
  "android.permission.USE_EXACT_ALARM",
  "android.permission.RECEIVE_BOOT_COMPLETED",
  "android.permission.WAKE_LOCK",
  "android.permission.VIBRATE",
  "android.permission.POST_NOTIFICATIONS",
];

function hasReceiver(application, name) {
  return (application.receiver ?? []).some(
    (receiver) =>
      receiver.$?.["android:name"] === name ||
      receiver.$?.["android:name"]?.endsWith(`.${name.split(".").pop()}`),
  );
}

function ensureReceivers(androidManifest) {
  const application =
    AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  application.receiver = application.receiver ?? [];
  if (!hasReceiver(application, RECEIVER_FIRE)) {
    application.receiver.push({
      $: {
        "android:name": RECEIVER_FIRE,
        "android:exported": "false",
      },
    });
  }
  if (!hasReceiver(application, RECEIVER_BOOT)) {
    application.receiver.push({
      $: {
        "android:name": RECEIVER_BOOT,
        "android:enabled": "true",
        "android:exported": "true",
      },
      "intent-filter": [
        {
          action: [
            {
              $: {
                "android:name": "android.intent.action.BOOT_COMPLETED",
              },
            },
          ],
        },
      ],
    });
  }
  return androidManifest;
}

function withChaoxingAndroidAlarms(config) {
  config = AndroidConfig.Permissions.withPermissions(config, PERMISSIONS);
  config = AndroidConfig.Permissions.withBlockedPermissions(config, [
    "android.permission.SCHEDULE_EXACT_ALARM",
  ]);
  return withAndroidManifest(config, (mod) => {
    mod.modResults = ensureReceivers(mod.modResults);
    return mod;
  });
}

module.exports = createRunOncePlugin(
  withChaoxingAndroidAlarms,
  PACKAGE_NAME,
  "0.1.0",
);
