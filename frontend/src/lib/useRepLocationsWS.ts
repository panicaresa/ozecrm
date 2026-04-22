// WebSocket hook for live rep-locations (Faza 2.0)
import { useEffect, useRef, useState } from "react";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

export interface LiveLocation {
  rep_id: string;
  rep_name?: string;
  latitude: number;
  longitude: number;
  battery?: number | null;
  is_active?: boolean;
  updated_at?: string;
  track?: { lat: number; lng: number; t: string }[];
}

export interface WSStatus {
  connected: boolean;
  error: string | null;
  reconnectAttempt: number;
}

function resolveWsUrl(): string | null {
  const http = process.env.EXPO_PUBLIC_BACKEND_URL || (Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL as string);
  if (!http) return null;
  // Convert https → wss, http → ws, always append /ws/rep-locations
  let ws = http.replace(/^http/, "ws");
  ws = ws.replace(/\/$/, "");
  return `${ws}/ws/rep-locations`;
}

export function useRepLocationsWS(enabled: boolean = true): {
  status: WSStatus;
  locations: Map<string, LiveLocation>;
  lastEvent: string | null;
} {
  const [status, setStatus] = useState<WSStatus>({ connected: false, error: null, reconnectAttempt: 0 });
  const [locations, setLocations] = useState<Map<string, LiveLocation>>(new Map());
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let mounted = true;

    const connect = async () => {
      const url = resolveWsUrl();
      if (!url) {
        setStatus((s) => ({ ...s, error: "Missing EXPO_PUBLIC_BACKEND_URL" }));
        return;
      }
      const token = await SecureStore.getItemAsync("auth_token");
      if (!token) {
        setStatus((s) => ({ ...s, error: "No auth token" }));
        return;
      }
      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          ws.send(JSON.stringify({ token }));
        };

        ws.onmessage = (e) => {
          if (!mounted) return;
          try {
            const msg = JSON.parse(e.data as string);
            if (msg.type === "auth_ok") {
              setStatus({ connected: true, error: null, reconnectAttempt: 0 });
              attemptRef.current = 0;
            } else if (msg.type === "auth_error") {
              setStatus((s) => ({ ...s, error: msg.detail || "Auth error" }));
            } else if (msg.type === "snapshot") {
              const map = new Map<string, LiveLocation>();
              (msg.locations || []).forEach((l: LiveLocation) => map.set(l.rep_id, l));
              setLocations(map);
              setLastEvent("snapshot");
            } else if (msg.type === "location_update") {
              setLocations((prev) => {
                const next = new Map(prev);
                const existing = next.get(msg.rep_id);
                next.set(msg.rep_id, {
                  ...(existing || {}),
                  rep_id: msg.rep_id,
                  rep_name: msg.rep_name,
                  latitude: msg.latitude,
                  longitude: msg.longitude,
                  battery: msg.battery,
                  is_active: msg.is_active,
                  updated_at: msg.updated_at,
                  // Append to track if server said "appended": true
                  track: msg.appended && existing?.track
                    ? [...existing.track, { lat: msg.latitude, lng: msg.longitude, t: msg.updated_at || new Date().toISOString() }].slice(-500)
                    : existing?.track,
                });
                return next;
              });
              setLastEvent(`update:${msg.rep_id}`);
            } else if (msg.type === "location_stop") {
              setLocations((prev) => {
                const next = new Map(prev);
                const existing = next.get(msg.rep_id);
                if (existing) next.set(msg.rep_id, { ...existing, is_active: false });
                return next;
              });
              setLastEvent(`stop:${msg.rep_id}`);
            } else if (msg.type === "pong") {
              // keepalive
            }
          } catch {}
        };

        ws.onerror = () => {
          setStatus((s) => ({ ...s, error: "WebSocket error" }));
        };

        ws.onclose = () => {
          wsRef.current = null;
          setStatus((s) => ({ ...s, connected: false, reconnectAttempt: attemptRef.current + 1 }));
          // Exponential backoff up to 30s
          const delay = Math.min(30_000, 1000 * Math.pow(2, attemptRef.current));
          attemptRef.current += 1;
          if (mounted && enabled) {
            reconnectTimer.current = setTimeout(connect, delay) as unknown as number;
          }
        };
      } catch (e) {
        setStatus((s) => ({ ...s, error: String(e) }));
      }
    };

    connect();

    // Ping every 25s to keep the tunnel alive
    const ping = setInterval(() => {
      try {
        wsRef.current?.send(JSON.stringify({ type: "ping" }));
      } catch {}
    }, 25_000);

    return () => {
      mounted = false;
      clearInterval(ping);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      try {
        wsRef.current?.close();
      } catch {}
      wsRef.current = null;
    };
  }, [enabled]);

  return { status, locations, lastEvent };
}
