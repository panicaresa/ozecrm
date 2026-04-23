// Sprint 3a — global WebSocket hook for application-wide events.
// Single connection for the entire app; listeners are registered via onAppEvent(type, cb).
//
// Re-uses the auth pattern of useRepLocationsWS (token from SecureStore, first
// frame contains the JWT). Reconnects with exponential backoff (1s, 2s, 4s,
// max 30s). If no token is present (user not logged in), the hook silently
// sleeps and retries every 5s until a token appears.

import { useEffect, useRef, useState } from "react";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

export interface AppEvent {
  type: string;
  [key: string]: any;
}

type EventListener = (event: AppEvent) => void;

// Module-level singletons — one set of listeners, one active WS
const listeners = new Set<EventListener>();
let activeWs: WebSocket | null = null;
let activeToken: string | null = null;

function resolveWsUrl(): string | null {
  const http =
    process.env.EXPO_PUBLIC_BACKEND_URL ||
    (Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL as string);
  if (!http) return null;
  let ws = http.replace(/^http/, "ws");
  ws = ws.replace(/\/$/, "");
  return `${ws}/ws/events`;
}

function emit(event: AppEvent) {
  for (const l of Array.from(listeners)) {
    try {
      l(event);
    } catch {
      // ignore listener errors — one bad listener must not break others
    }
  }
}

/**
 * Subscribe to a specific event type. Returns an unsubscribe function.
 * Usage: useEffect(() => onAppEvent("contract_signed", handler), [])
 */
export function onAppEvent(
  type: string,
  callback: (event: AppEvent) => void
): () => void {
  const wrapped: EventListener = (e) => {
    if (e.type === type) callback(e);
  };
  listeners.add(wrapped);
  return () => {
    listeners.delete(wrapped);
  };
}

export interface AppEventsWSStatus {
  connected: boolean;
  error: string | null;
  reconnectAttempt: number;
}

/**
 * Call this hook ONCE from a top-level component (_layout.tsx's <AppEventsManager/>).
 * Maintains a single global connection with auto-reconnect. Safe to unmount
 * the host component during auth changes — hook cleans up its WS.
 */
export function useAppEventsWS(enabled: boolean = true): AppEventsWSStatus {
  const [status, setStatus] = useState<AppEventsWSStatus>({
    connected: false,
    error: null,
    reconnectAttempt: 0,
  });
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return;

    const scheduleReconnect = () => {
      if (!mountedRef.current) return;
      attemptRef.current += 1;
      const backoffs = [1000, 2000, 4000, 8000, 16000];
      const delay = backoffs[Math.min(attemptRef.current - 1, backoffs.length - 1)] || 30000;
      setStatus((s) => ({ ...s, connected: false, reconnectAttempt: attemptRef.current }));
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(() => {
        connect().catch(() => {});
      }, delay);
    };

    const connect = async () => {
      if (!mountedRef.current) return;
      const url = resolveWsUrl();
      if (!url) {
        setStatus((s) => ({ ...s, error: "Missing EXPO_PUBLIC_BACKEND_URL" }));
        return;
      }
      const token = await SecureStore.getItemAsync("oze_token");
      if (!token) {
        // Not logged in yet — wait a bit and retry
        setStatus((s) => ({ ...s, error: "No auth token — waiting for login" }));
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(() => {
          if (mountedRef.current) connect().catch(() => {});
        }, 5000);
        return;
      }
      activeToken = token;
      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;
        activeWs = ws;

        ws.onopen = () => {
          try {
            ws.send(JSON.stringify({ token }));
          } catch {}
        };

        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(String(evt.data || "{}"));
            if (msg?.type === "auth_ok") {
              attemptRef.current = 0;
              setStatus({ connected: true, error: null, reconnectAttempt: 0 });
              return;
            }
            if (msg?.type === "auth_error") {
              setStatus((s) => ({ ...s, error: "Auth error", connected: false }));
              try {
                ws.close();
              } catch {}
              return;
            }
            if (msg?.type === "pong") return;
            if (msg && typeof msg.type === "string") {
              emit(msg as AppEvent);
            }
          } catch {
            // ignore malformed frame
          }
        };

        ws.onerror = () => {
          setStatus((s) => ({ ...s, error: "WS error", connected: false }));
        };

        ws.onclose = () => {
          setStatus((s) => ({ ...s, connected: false }));
          if (mountedRef.current) scheduleReconnect();
        };
      } catch (e: any) {
        setStatus((s) => ({ ...s, error: String(e?.message || e), connected: false }));
        scheduleReconnect();
      }
    };

    connect().catch(() => {});

    // Keepalive — send ping every 25s to keep intermediaries happy
    const ping = setInterval(() => {
      const ws = wsRef.current;
      if (ws && ws.readyState === 1) {
        try {
          ws.send(JSON.stringify({ type: "ping" }));
        } catch {}
      }
    }, 25000);

    return () => {
      mountedRef.current = false;
      clearInterval(ping);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      try {
        wsRef.current?.close();
      } catch {}
      wsRef.current = null;
      activeWs = null;
      activeToken = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return status;
}
