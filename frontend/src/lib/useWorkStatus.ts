// Lightweight work-mode status hook (Faza 2.1)
// Used by handlowiec to gate "Add lead" & "Offer generator" buttons.
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export interface WorkStatus {
  is_working: boolean;
  session_seconds: number;
  session_distance_m: number;
  latitude?: number | null;
  longitude?: number | null;
}

const EMPTY: WorkStatus = { is_working: false, session_seconds: 0, session_distance_m: 0 };

export function useWorkStatus(pollIntervalMs: number = 15000): {
  status: WorkStatus;
  refresh: () => Promise<void>;
  loading: boolean;
} {
  const [status, setStatus] = useState<WorkStatus>(EMPTY);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<WorkStatus>("/rep/work-status");
      setStatus(res.data || EMPTY);
    } catch {
      setStatus(EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    if (pollIntervalMs > 0) {
      const t = setInterval(refresh, pollIntervalMs);
      return () => clearInterval(t);
    }
    return undefined;
  }, [refresh, pollIntervalMs]);

  return { status, refresh, loading };
}

export function fmtDuration(totalSec: number): string {
  if (!totalSec || totalSec < 0) return "0 min";
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}min`;
  return `${m} min`;
}

export function fmtDistanceKm(meters: number): string {
  if (!meters || meters < 0) return "0 m";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
