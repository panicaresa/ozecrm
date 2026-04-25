// ──────────────────────────────────────────────────────────────────────────────
// pushRegistration.ts (Sprint 5a — push notifications groundwork)
//
// Minimal wrapper around expo-notifications that:
//   1. Asks the user for notification permission (Android 13+ runtime ask)
//   2. Acquires an Expo Push token using the project's EAS projectId
//   3. POSTs the token to /api/devices/register so Sprint 5b triggers can fan out
//
// Triggers (sending the actual pushes) are NOT implemented here — they will
// land in Sprint 5b once we know which events users actually care about
// (new lead assigned, daily report due, contract signed, etc.).
//
// IMPORTANT — this file is best-effort and never throws. Push permission is
// optional from the user's perspective; offering rich features without push
// is acceptable. All errors are logged and swallowed.
// ──────────────────────────────────────────────────────────────────────────────

import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { api } from "./api";

// Configure how foreground pushes are surfaced. Without this, expo-notifications
// silently drops them. Triggers in Sprint 5b can override per-channel.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Pulled from app.json → expo.extra.eas.projectId (set by `eas init`).
// During development without a projectId set, we still want the rest of the
// flow to work — registration is just a no-op with a warning.
function readProjectId(): string | null {
  try {
    const id =
      (Constants?.expoConfig as any)?.extra?.eas?.projectId ||
      (Constants as any)?.easConfig?.projectId ||
      null;
    return id || null;
  } catch {
    return null;
  }
}

function readAppVersion(): string {
  try {
    return Constants?.expoConfig?.version || "1.0.0";
  } catch {
    return "1.0.0";
  }
}

/**
 * Top-level entry point. Call once after a user logs in.
 *
 * Returns the acquired Expo Push token on success, or null when:
 *   • running on simulator/emulator (Device.isDevice === false)
 *   • running on web (no native push channel)
 *   • permission denied by user
 *   • EAS projectId is missing (dev / preview-without-init scenario)
 *   • token retrieval threw (Expo backend down, etc.)
 *
 * Backend POST is best-effort — failures don't bubble.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  // 1. Skip non-physical devices entirely
  if (!Device.isDevice) {
    // eslint-disable-next-line no-console
    console.log("[push] skipped: simulator/emulator");
    return null;
  }
  // 2. Skip web — RN-Web has no native push channel
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-console
    console.log("[push] skipped: web");
    return null;
  }

  // 3. Android 13+ requires runtime POST_NOTIFICATIONS request even when the
  //    permission is in the manifest. expo-notifications wraps both flows.
  let finalStatus: Notifications.PermissionStatus;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    finalStatus = status;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      finalStatus = req.status;
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[push] permission check failed:", e);
    return null;
  }

  if (finalStatus !== "granted") {
    // eslint-disable-next-line no-console
    console.log("[push] permission denied — user opted out");
    return null;
  }

  // 4. Android channel — required for >= API 26 to display anything.
  if (Platform.OS === "android") {
    try {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Powiadomienia",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#0F172A",
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[push] channel setup failed:", e);
    }
  }

  // 5. Acquire the Expo Push token
  const projectId = readProjectId();
  if (!projectId) {
    // eslint-disable-next-line no-console
    console.warn(
      "[push] EAS projectId missing — run `eas init` to enable push token acquisition"
    );
    return null;
  }

  let token: string;
  try {
    const tokenResp = await Notifications.getExpoPushTokenAsync({ projectId });
    token = tokenResp.data;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[push] token retrieval failed:", e);
    return null;
  }

  // 6. Best-effort backend register — silent on failure
  try {
    await api.post("/devices/register", {
      token,
      platform: Platform.OS, // "android" | "ios" — never reaches here on web
      app_version: readAppVersion(),
      device_info: {
        brand: Device.brand,
        model_name: Device.modelName,
        os_version: Device.osVersion,
        os_build_id: Device.osBuildId,
      },
    });
    // eslint-disable-next-line no-console
    console.log("[push] token registered with backend");
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[push] backend register failed (non-fatal):", e);
  }

  return token;
}

/**
 * Unregister a token (call from logout flow). Best-effort, never throws.
 */
export async function unregisterPushToken(token: string): Promise<void> {
  if (!token) return;
  try {
    await api.delete(
      `/devices/register?token=${encodeURIComponent(token)}`
    );
    // eslint-disable-next-line no-console
    console.log("[push] token unregistered");
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[push] unregister failed (non-fatal):", e);
  }
}
