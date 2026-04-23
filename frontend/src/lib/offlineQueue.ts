// Sprint 1.5 — Offline Queue for POST /leads and POST /contracts.
//
// Design:
//  - Single AsyncStorage key `oze_offline_queue_v1` stores a JSON array of QueueOp.
//  - Photos are NOT kept in AsyncStorage (base64 is huge); instead they live in
//    FileSystem.documentDirectory/pending_leads/{uuid}.jpg
//  - At enqueue time, photos are compressed (see imageCompression.ts) and saved
//    to disk. The op only carries a path.
//  - syncNow() re-reads photo from disk, base64-encodes it, and POSTs with the
//    Idempotency-Key header. Backend is idempotent so retries are safe.
//  - On 409 with LEAD_DUPLICATE_HARD / LEAD_NEARBY_SOFT the op flips to
//    status="conflict" and awaits user decision on the /sync-status screen.
//  - startAutoSync() wires up three triggers: 15s interval, AppState "active",
//    and NetInfo "isConnected=true".
//  - cleanupOrphanedPhotos() runs on startAutoSync init to delete photos whose
//    owning op has been removed.
//
// Threading:
//   A lightweight in-module boolean `syncInProgress` prevents two concurrent
//   sync passes from clobbering each other. AsyncStorage reads/writes are
//   serialized by awaiting queue reloads before every mutation.

import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { AppState, Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { api } from "./api";
import { compressPhoto } from "./imageCompression";

// ── Types ────────────────────────────────────────────────────────────────────

export type QueueOpType = "POST_LEAD" | "POST_CONTRACT";
export type QueueOpStatus = "pending" | "syncing" | "conflict" | "failed";

export interface QueueConflict {
  code: "LEAD_DUPLICATE_HARD" | "LEAD_NEARBY_SOFT";
  existing_lead_id: string;
  existing_lead_name?: string;
  existing_assigned_to_name?: string;
  distance_m?: number;
  message: string;
}

export interface QueueOp {
  id: string;
  type: QueueOpType;
  idempotency_key: string;
  body: Record<string, any>;
  photo_path?: string;
  created_at: string;
  attempts: number;
  last_error?: string;
  last_attempt_at?: string;
  status: QueueOpStatus;
  conflict?: QueueConflict;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "oze_offline_queue_v1";
const PENDING_DIR = `${FileSystem.documentDirectory || ""}pending_leads/`;
const AUTO_SYNC_INTERVAL_MS = 15_000;

// ── Internal state ───────────────────────────────────────────────────────────

let syncInProgress = false;
const listeners = new Set<(ops: QueueOp[]) => void>();

// ── Tiny helpers ─────────────────────────────────────────────────────────────

function uuidLike(): string {
  // Lightweight — not cryptographic
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readQueue(): Promise<QueueOp[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("offlineQueue: corrupt storage, resetting", e);
    await AsyncStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

async function writeQueue(ops: QueueOp[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ops));
  emit(ops);
}

function emit(ops: QueueOp[]) {
  for (const l of listeners) {
    try {
      l(ops);
    } catch {}
  }
}

async function ensurePendingDir(): Promise<void> {
  if (!FileSystem.documentDirectory) return; // web or unsupported
  try {
    const info = await FileSystem.getInfoAsync(PENDING_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(PENDING_DIR, { intermediates: true });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("offlineQueue: could not ensure pending dir", e);
  }
}

async function savePhotoToDisk(base64DataUrl: string): Promise<string | null> {
  if (!FileSystem.documentDirectory) return null;
  await ensurePendingDir();
  const match = base64DataUrl.match(/^data:(image\/[a-z]+);base64,(.*)$/);
  if (!match) return null;
  const ext = match[1].split("/")[1] || "jpg";
  const path = `${PENDING_DIR}${uuidLike()}.${ext}`;
  try {
    await FileSystem.writeAsStringAsync(path, match[2], {
      encoding: FileSystem.EncodingType.Base64,
    });
    return path;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("offlineQueue: savePhotoToDisk failed", e);
    return null;
  }
}

async function readPhotoFromDisk(path: string): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return raw; // return RAW base64 (no data: prefix — backend stores as-is)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("offlineQueue: readPhotoFromDisk failed", e);
    return null;
  }
}

async function deletePhotoFromDisk(path?: string): Promise<void> {
  if (!path) return;
  try {
    await FileSystem.deleteAsync(path, { idempotent: true });
  } catch {}
}

async function cleanupOrphanedPhotos(): Promise<void> {
  if (!FileSystem.documentDirectory) return;
  try {
    const info = await FileSystem.getInfoAsync(PENDING_DIR);
    if (!info.exists) return;
    const files = await FileSystem.readDirectoryAsync(PENDING_DIR);
    if (files.length === 0) return;
    const ops = await readQueue();
    const known = new Set(ops.map((o) => o.photo_path).filter(Boolean) as string[]);
    for (const f of files) {
      const full = `${PENDING_DIR}${f}`;
      if (!known.has(full)) {
        await deletePhotoFromDisk(full);
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("offlineQueue: cleanup failed", e);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function getQueue(): Promise<QueueOp[]> {
  return readQueue();
}

export function onQueueChange(listener: (ops: QueueOp[]) => void): () => void {
  listeners.add(listener);
  // Prime the listener with the current state on subscribe (best-effort)
  readQueue()
    .then(listener)
    .catch(() => {});
  return () => {
    listeners.delete(listener);
  };
}

export async function enqueueLead(
  body: Record<string, any>,
  photoDataUrl: string | null
): Promise<string> {
  const opId = uuidLike();
  const idempKey = `lead-${opId}`;
  let photoPath: string | null = null;
  if (photoDataUrl) {
    const compressed = await compressPhoto(photoDataUrl);
    photoPath = await savePhotoToDisk(compressed);
  }
  // Do NOT include raw photo in body — it will be re-attached at sync time
  const { photo_base64: _drop, ...bodySansPhoto } = body;
  const op: QueueOp = {
    id: opId,
    type: "POST_LEAD",
    idempotency_key: idempKey,
    body: bodySansPhoto,
    photo_path: photoPath || undefined,
    created_at: new Date().toISOString(),
    attempts: 0,
    status: "pending",
  };
  const ops = await readQueue();
  ops.push(op);
  await writeQueue(ops);
  // Fire sync in background — don't block caller
  syncNow().catch(() => {});
  return opId;
}

export async function enqueueContract(body: Record<string, any>): Promise<string> {
  const opId = uuidLike();
  const idempKey = `contract-${opId}`;
  const op: QueueOp = {
    id: opId,
    type: "POST_CONTRACT",
    idempotency_key: idempKey,
    body,
    created_at: new Date().toISOString(),
    attempts: 0,
    status: "pending",
  };
  const ops = await readQueue();
  ops.push(op);
  await writeQueue(ops);
  syncNow().catch(() => {});
  return opId;
}

export async function removeOp(id: string): Promise<void> {
  const ops = await readQueue();
  const op = ops.find((o) => o.id === id);
  if (op) await deletePhotoFromDisk(op.photo_path);
  const next = ops.filter((o) => o.id !== id);
  await writeQueue(next);
}

export async function retryOp(
  id: string,
  overrides?: { confirmed_nearby_duplicate?: boolean; apartment_number?: string }
): Promise<void> {
  const ops = await readQueue();
  const op = ops.find((o) => o.id === id);
  if (!op) return;
  if (overrides) {
    op.body = { ...op.body, ...overrides };
  }
  op.status = "pending";
  op.last_error = undefined;
  op.conflict = undefined;
  await writeQueue(ops);
  syncNow().catch(() => {});
}

// ── Sync engine ──────────────────────────────────────────────────────────────

async function isOnline(): Promise<boolean> {
  try {
    const s = await NetInfo.fetch();
    // isConnected can be null on web in some browsers — treat null as online.
    return s.isConnected !== false;
  } catch {
    return true;
  }
}

async function syncOne(op: QueueOp): Promise<"ok" | "conflict" | "fail"> {
  const headers: Record<string, string> = { "Idempotency-Key": op.idempotency_key };
  try {
    if (op.type === "POST_LEAD") {
      let body = { ...op.body };
      if (op.photo_path) {
        const raw = await readPhotoFromDisk(op.photo_path);
        if (raw) body.photo_base64 = raw;
      }
      await api.post("/leads", body, { headers, timeout: 15_000 });
      await deletePhotoFromDisk(op.photo_path);
      return "ok";
    }
    if (op.type === "POST_CONTRACT") {
      await api.post("/contracts", op.body, { headers, timeout: 15_000 });
      return "ok";
    }
    return "fail";
  } catch (e: any) {
    const status = e?.response?.status;
    const detail = e?.response?.data?.detail;
    // 409 conflict with structured detail → user decision needed
    if (
      status === 409 &&
      detail &&
      typeof detail === "object" &&
      (detail.code === "LEAD_DUPLICATE_HARD" || detail.code === "LEAD_NEARBY_SOFT")
    ) {
      op.conflict = {
        code: detail.code,
        existing_lead_id: detail.existing_lead_id,
        existing_lead_name: detail.existing_lead_name,
        existing_assigned_to_name: detail.existing_assigned_to_name,
        distance_m: detail.distance_m,
        message: String(detail.message || "Konflikt anti-collision"),
      };
      op.last_error = detail.code;
      return "conflict";
    }
    // Network error / timeout / 5xx → leave pending for next cycle
    const isNet =
      !e?.response ||
      e?.code === "ECONNABORTED" ||
      e?.message?.toLowerCase?.().includes("network");
    op.last_error = isNet
      ? `network: ${e?.message || "timeout"}`
      : `${status || "error"}: ${
          typeof detail === "string" ? detail : JSON.stringify(detail || e?.message || "")
        }`;
    return "fail";
  }
}

export async function syncNow(): Promise<{ synced: number; failed: number; conflicts: number }> {
  if (syncInProgress) return { synced: 0, failed: 0, conflicts: 0 };
  syncInProgress = true;
  let synced = 0;
  let failed = 0;
  let conflicts = 0;
  try {
    if (!(await isOnline())) {
      return { synced, failed, conflicts };
    }
    const ops = await readQueue();
    if (ops.length === 0) return { synced, failed, conflicts };

    for (const op of ops) {
      if (op.status === "conflict") continue; // needs user decision
      if (op.status !== "pending") continue;
      op.status = "syncing";
      op.attempts += 1;
      op.last_attempt_at = new Date().toISOString();
      await writeQueue(ops); // reflect "syncing" state in UI

      const result = await syncOne(op);
      // Re-read queue in case it was mutated externally
      const fresh = await readQueue();
      const idx = fresh.findIndex((x) => x.id === op.id);
      if (idx < 0) continue;
      if (result === "ok") {
        fresh.splice(idx, 1);
        synced += 1;
      } else if (result === "conflict") {
        fresh[idx] = { ...op, status: "conflict" };
        conflicts += 1;
      } else {
        fresh[idx] = { ...op, status: "pending" };
        failed += 1;
      }
      await writeQueue(fresh);
    }
    return { synced, failed, conflicts };
  } finally {
    syncInProgress = false;
  }
}

// ── Auto-sync ────────────────────────────────────────────────────────────────

export function startAutoSync(): () => void {
  // Cleanup orphaned photos on startup (fire-and-forget)
  cleanupOrphanedPhotos().catch(() => {});

  const interval = setInterval(() => {
    syncNow().catch(() => {});
  }, AUTO_SYNC_INTERVAL_MS);

  const appSub = AppState.addEventListener("change", (s) => {
    if (s === "active") syncNow().catch(() => {});
  });

  let netUnsub: (() => void) | null = null;
  try {
    netUnsub = NetInfo.addEventListener((s) => {
      if (s.isConnected) syncNow().catch(() => {});
    });
  } catch {
    netUnsub = null;
  }

  // Kick off a first sync shortly after startup in case we're already online
  const bootTimer = setTimeout(() => {
    syncNow().catch(() => {});
  }, 2_000);

  return () => {
    clearInterval(interval);
    clearTimeout(bootTimer);
    try {
      appSub.remove();
    } catch {}
    try {
      netUnsub && netUnsub();
    } catch {}
  };
}

// ── Detector helper used by add-lead / add-contract ─────────────────────────

export function isNetworkError(e: any): boolean {
  if (!e) return false;
  if (!e.response) return true;
  if (e.code === "ECONNABORTED") return true;
  const msg = (e.message || "").toString().toLowerCase();
  return msg.includes("network") || msg.includes("timeout");
}

// Re-export Platform type narrowly so callers don't need to import RN here
export const __queueMeta = { Platform };
