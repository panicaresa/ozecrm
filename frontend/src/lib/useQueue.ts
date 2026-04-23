// Sprint 1.5 — React hook exposing the offline queue state.
import { useEffect, useState } from "react";
import { QueueOp, getQueue, onQueueChange } from "./offlineQueue";

export interface QueueCounts {
  total: number;
  pending: number;
  syncing: number;
  conflict: number;
  failed: number;
}

export function useQueue(): { ops: QueueOp[]; counts: QueueCounts } {
  const [ops, setOps] = useState<QueueOp[]>([]);
  useEffect(() => {
    let alive = true;
    getQueue()
      .then((qs) => {
        if (alive) setOps(qs);
      })
      .catch(() => {});
    const unsub = onQueueChange((qs) => {
      if (alive) setOps(qs);
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  const counts: QueueCounts = {
    total: ops.length,
    pending: ops.filter((o) => o.status === "pending").length,
    syncing: ops.filter((o) => o.status === "syncing").length,
    conflict: ops.filter((o) => o.status === "conflict").length,
    failed: ops.filter((o) => o.status === "failed").length,
  };
  return { ops, counts };
}
