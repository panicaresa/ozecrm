// Background GPS tracking task (Faza 2.0)
// Registered via TaskManager.defineTask at app startup and started via expo-location
// Location.startLocationUpdatesAsync with background permission.
import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

export const BACKGROUND_LOCATION_TASK = "oze-crm-background-location";

function getBackendUrl(): string {
  return (
    process.env.EXPO_PUBLIC_BACKEND_URL ||
    (Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL as string) ||
    ""
  );
}

// Define the background task (must be in a file loaded at app startup)
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn("[BG-LOC] task error", error.message);
    return;
  }
  if (!data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations || locations.length === 0) return;

  const token = await SecureStore.getItemAsync("auth_token");
  if (!token) return;

  const backend = getBackendUrl();
  if (!backend) return;

  // Push most recent location to backend
  const loc = locations[locations.length - 1];
  try {
    await fetch(`${backend}/api/rep/location`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracy: loc.coords.accuracy ?? null,
        battery: null,
        battery_state: "unknown",
      }),
    });
  } catch (e) {
    console.warn("[BG-LOC] push failed", e);
  }
});

/** Start background tracking. Returns true if successfully started. */
export async function startBackgroundTracking(): Promise<boolean> {
  try {
    // 1) request foreground first (required for iOS)
    const { status: fg } = await Location.requestForegroundPermissionsAsync();
    if (fg !== "granted") return false;
    // 2) request background
    const { status: bg } = await Location.requestBackgroundPermissionsAsync();
    if (bg !== "granted") return false;
    // 3) prevent re-registration
    const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
    if (running) return true;
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 30_000, // 30s
      distanceInterval: 25, // meters
      deferredUpdatesInterval: 30_000,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "OZE CRM — praca w terenie",
        notificationBody: "Aplikacja rejestruje Twoją pozycję dla zespołu.",
        notificationColor: "#1E40AF",
      },
      pausesUpdatesAutomatically: false,
    });
    return true;
  } catch (e) {
    console.warn("startBackgroundTracking error", e);
    return false;
  }
}

/** Stop background tracking. */
export async function stopBackgroundTracking(): Promise<void> {
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
    if (running) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  } catch (e) {
    console.warn("stopBackgroundTracking error", e);
  }
}

export async function isBackgroundTrackingActive(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  } catch {
    return false;
  }
}
