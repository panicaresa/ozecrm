import axios, { AxiosInstance } from "axios";
import { Platform } from "react-native";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const TOKEN_KEY = "oze_token";
const isWeb = Platform.OS === "web";

// Conditionally import SecureStore only on native
let SecureStore: any = null;
if (!isWeb) {
  SecureStore = require("expo-secure-store");
}

const webStorage = {
  getItem: (k: string) => {
    try {
      return (globalThis as any).localStorage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  },
  setItem: (k: string, v: string) => {
    try {
      (globalThis as any).localStorage?.setItem(k, v);
    } catch {}
  },
  removeItem: (k: string) => {
    try {
      (globalThis as any).localStorage?.removeItem(k);
    } catch {}
  },
};

export const api: AxiosInstance = axios.create({
  baseURL: `${BASE}/api`,
  timeout: 20000,
});

api.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

// Batch B-fix #3E: surface 403 "Password change required" responses so that
// calling screens can redirect to the force-change flow. Full redirect wiring
// will be done in Batch C — for now we just log and propagate the error.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (
      error?.response?.status === 403 &&
      error?.response?.data?.detail === "Password change required"
    ) {
      // eslint-disable-next-line no-console
      console.warn(
        "Password change required — user should be redirected to /login (force-change flow)"
      );
    }
    return Promise.reject(error);
  }
);

export async function saveToken(token: string) {
  if (isWeb) webStorage.setItem(TOKEN_KEY, token);
  else await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken() {
  if (isWeb) webStorage.removeItem(TOKEN_KEY);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function getToken(): Promise<string | null> {
  if (isWeb) return webStorage.getItem(TOKEN_KEY);
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export function formatApiError(e: any, fallback = "Wystąpił błąd"): string {
  const d = e?.response?.data?.detail;
  if (d == null) return e?.message || fallback;
  if (typeof d === "string") return d;
  if (Array.isArray(d))
    return d.map((x) => (x && typeof x.msg === "string" ? x.msg : JSON.stringify(x))).join(" ");
  if (d && typeof d.msg === "string") return d.msg;
  return String(d);
}
