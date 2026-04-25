// ──────────────────────────────────────────────────────────────────────────────
// inputFormatters.ts (Sprint 5-pre-pent)
//
// Reusable input masks + validators for Polish-formatted form fields.
//
// Strategy:
//   • State stores RAW digits ("500123456" / "80309").
//   • Display formatters produce "500-123-456" / "80-309" for the UI.
//   • Legacy display formatters absorb mixed historical formats from the DB
//     (e.g. "+48 500 123 456", "500-123-456", " 500 123 456 ", "80309") so
//     existing data renders cleanly without a migration job.
//   • Validators tolerate empty strings (fields are optional) and reject
//     anything that's neither empty nor the canonical digit count.
//
// IMPORTANT: backend stores phone as raw 9 digits and postal_code as "XX-XXX"
// (with hyphen — Polish standard). Any future field that uses these helpers
// MUST follow the same convention or we break tel:/maps integrations.
// ──────────────────────────────────────────────────────────────────────────────

// ─── PHONE — Polish 9-digit (no +48 prefix) ──────────────────────────────────

/**
 * Strip all non-digits, cap at 9 digits.
 * Used as the onChangeText sink so we never hold a non-canonical value.
 */
export function normalizePhoneDigits(input: string): string {
  if (!input) return "";
  return input.replace(/\D/g, "").slice(0, 9);
}

/**
 * Format raw digits as XXX-XXX-XXX, partial input formatted progressively:
 *   "5"          → "5"
 *   "50"         → "50"
 *   "500"        → "500"
 *   "5001"       → "500-1"
 *   "500123"     → "500-123"
 *   "5001234"    → "500-123-4"
 *   "500123456"  → "500-123-456"
 *   "5001234567" → "500-123-456"   (extra trimmed by normalize)
 */
export function formatPhoneDisplay(rawDigits: string): string {
  const digits = normalizePhoneDigits(rawDigits);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** True if phone is empty OR exactly 9 digits. */
export function isPhoneValid(rawDigits: string): boolean {
  const digits = normalizePhoneDigits(rawDigits);
  return digits.length === 0 || digits.length === 9;
}

/**
 * Display ANY legacy phone format as XXX-XXX-XXX where possible.
 *   "+48 500 123 456"  → "500-123-456"
 *   "0500123456"       → "500-123-456"
 *   "500123456"        → "500-123-456"
 *   "500-123-456"      → "500-123-456"
 *   "  500 123 456  "  → "500-123-456"
 *   "abc"              → "abc"          (unrecognized — return as-is, never lose data)
 */
export function displayLegacyPhone(stored: string | null | undefined): string {
  if (!stored) return "";
  const digits = String(stored).replace(/\D/g, "");
  let nine = digits;
  if (digits.length === 11 && digits.startsWith("48")) {
    nine = digits.slice(2);
  } else if (digits.length === 12 && digits.startsWith("048")) {
    // Some forms historically inserted a leading 0 before the country code.
    nine = digits.slice(3);
  } else if (digits.length === 10 && digits.startsWith("0")) {
    // Legacy local prefix, drop the leading 0
    nine = digits.slice(1);
  }
  if (nine.length === 9) return formatPhoneDisplay(nine);
  // Fallback — return original verbatim so we never silently drop data.
  return String(stored);
}

// ─── ZIP — Polish 5-digit postal code (XX-XXX) ───────────────────────────────

/** Strip non-digits, cap at 5. */
export function normalizeZipDigits(input: string): string {
  if (!input) return "";
  return input.replace(/\D/g, "").slice(0, 5);
}

/**
 * Format raw digits as XX-XXX. Partial:
 *   ""     → ""
 *   "1"    → "1"
 *   "12"   → "12"
 *   "123"  → "12-3"
 *   "1234" → "12-34"
 *   "12345"→ "12-345"
 */
export function formatZipDisplay(rawDigits: string): string {
  const digits = normalizeZipDigits(rawDigits);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

/** True if zip is empty OR exactly 5 digits. */
export function isZipValid(rawDigits: string): boolean {
  const digits = normalizeZipDigits(rawDigits);
  return digits.length === 0 || digits.length === 5;
}

/**
 * Display legacy zip values as XX-XXX:
 *   "80309"  → "80-309"
 *   "80-309" → "80-309"
 *   "80 309" → "80-309"
 *   "abc"    → "abc"  (unrecognized — return as-is)
 */
export function displayLegacyZip(stored: string | null | undefined): string {
  if (!stored) return "";
  const digits = String(stored).replace(/\D/g, "");
  if (digits.length === 5) return formatZipDisplay(digits);
  return String(stored);
}

// ─── tel: helpers (centralised so tap-to-call uses one canonical form) ───────

/**
 * Build a tel: URL from a stored phone (any format). Returns null when the
 * input has fewer than 6 digits — caller should hide the action button.
 *
 * Polish numbers: stored as 9 digits → tel:+48500123456 (international form
 * is most universally accepted by mobile dialers and SIP gateways).
 */
export function buildTelUrl(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const digits = String(stored).replace(/\D/g, "");
  if (digits.length < 6) return null;
  // 9-digit Polish number → prefix with +48
  if (digits.length === 9) return `tel:+48${digits}`;
  // 11 digits starting with 48 → ensure leading +
  if (digits.length === 11 && digits.startsWith("48")) return `tel:+${digits}`;
  // Anything else (international or unrecognised) — keep verbatim with a +
  return `tel:+${digits}`;
}
