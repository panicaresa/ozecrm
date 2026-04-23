// Sprint 1.5 — image compression for offline queue.
// Shrinks raw camera photos (1-2 MB data URLs) to ~150-300 KB JPEGs
// before storing them on disk, so that AsyncStorage / FileSystem never
// accumulates multi-megabyte payloads.
//
// Fallback: on web or if expo-image-manipulator isn't available,
// returns the original data URL unchanged.

import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";

const DEFAULT_MAX_WIDTH = 1200;
const DEFAULT_QUALITY = 0.5; // JPEG quality (0-1)

/**
 * Compress a base64 data URL (from ImagePicker) into a smaller JPEG.
 * Returns a NEW data URL ("data:image/jpeg;base64,...") ready to persist.
 *
 * On web this is a no-op (ImageManipulator may not support all ops) — we
 * just return the original data URL. Device (iOS/Android) does the real work.
 */
export async function compressPhoto(
  base64DataUrl: string,
  maxWidth: number = DEFAULT_MAX_WIDTH,
  quality: number = DEFAULT_QUALITY
): Promise<string> {
  if (!base64DataUrl || !base64DataUrl.startsWith("data:")) {
    return base64DataUrl;
  }
  if (Platform.OS === "web") {
    // Web: ImageManipulator is limited; keep original (queue will handle size).
    return base64DataUrl;
  }
  try {
    // Write the source to a temp file — manipulateAsync wants a URI.
    const match = base64DataUrl.match(/^data:(image\/[a-z]+);base64,(.*)$/);
    if (!match) return base64DataUrl;
    const ext = match[1].split("/")[1] || "jpg";
    const raw = match[2];
    const tmp = `${FileSystem.cacheDirectory || FileSystem.documentDirectory}tmp-src-${Date.now()}.${ext}`;
    await FileSystem.writeAsStringAsync(tmp, raw, { encoding: FileSystem.EncodingType.Base64 });

    const out = await ImageManipulator.manipulateAsync(
      tmp,
      [{ resize: { width: maxWidth } }],
      { compress: quality, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );

    // Remove the intermediate file best-effort
    try {
      await FileSystem.deleteAsync(tmp, { idempotent: true });
    } catch {}

    if (!out.base64) return base64DataUrl;
    return `data:image/jpeg;base64,${out.base64}`;
  } catch (e) {
    // On any error, fall back to the original (never lose data).
    // eslint-disable-next-line no-console
    console.warn("compressPhoto failed, returning original:", e);
    return base64DataUrl;
  }
}

/** Quick helper to estimate the size of a base64 data URL in KB. */
export function estimateDataUrlSizeKB(dataUrl: string): number {
  if (!dataUrl) return 0;
  const i = dataUrl.indexOf(",");
  const raw = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  // base64 expands 3 bytes → 4 chars → raw bytes = chars * 3 / 4
  return Math.round((raw.length * 3) / 4 / 1024);
}
