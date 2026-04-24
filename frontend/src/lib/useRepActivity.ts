import { useEffect, useRef, useState } from "react";
import { api } from "./api";

// Sprint 4 — per-rep activity status poll (refresh every 60 s).
// Used by the Manager Dashboard to colour a small status dot next to each rep:
//   active  → acted within last 30 min
//   idle    → acted today but >= 30 min ago
//   offline → never acted today (or never at all)

export type RepActivityStatus = "active" | "idle" | "offline";

export interface RepActivity {
  rep_id: string;
  rep_name: string;
  status: RepActivityStatus;
  last_action_at: string | null;
  minutes_ago: number | null;
}

export function useRepActivity(enabled = true, intervalMs = 60_000) {
  const [data, setData] = useState<RepActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const firstLoadRef = useRef(true);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let alive = true;
    const fetchOnce = async () => {
      try {
        const res = await api.get<{ reps: RepActivity[] }>("/rep-activity");
        if (!alive) return;
        setData(res.data?.reps || []);
      } catch {
        // Swallow — the widget is decorative; an error shouldn't leak to UI.
      } finally {
        if (alive && firstLoadRef.current) {
          firstLoadRef.current = false;
          setLoading(false);
        }
      }
    };
    fetchOnce();
    const timer = intervalMs > 0 ? setInterval(fetchOnce, intervalMs) : null;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [enabled, intervalMs]);

  return { data, loading };
}

// Helper used by both the dashboard list and the LeadMap rep-pin colouring.
export function getActivityColor(
  status: RepActivityStatus | undefined,
  colors: { activeStatus: string; idleStatus: string; offlineStatus: string }
) {
  switch (status) {
    case "active":
      return colors.activeStatus;
    case "idle":
      return colors.idleStatus;
    default:
      return colors.offlineStatus;
  }
}

export function getActivityLabel(s: RepActivityStatus | undefined): string {
  switch (s) {
    case "active":
      return "Aktywny";
    case "idle":
      return "Bezczynny";
    default:
      return "Offline";
  }
}
