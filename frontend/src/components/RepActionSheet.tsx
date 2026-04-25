// ──────────────────────────────────────────────────────────────────────────────
// RepActionSheet (Sprint 5-pre-quad)
// Bottom sheet shown when a manager/admin taps a rep marker on the map.
// Mirrors the LeadActionSheet pattern (Modal + Pressable backdrop + slide
// animation on native, fade on web). Shows:
//   • Identity (name, online dot, work-time/last-seen, battery)
//   • One-tap "Zadzwoń" (uses native dialer via Linking.openURL("tel:…"))
//   • KPI of the day (signed / total leads / target / progress %)
//   • Primary action: open the rep's full profile screen
//
// Native maps Callout has a long-standing Android interactivity bug (touches
// inside a tooltip don't always reach <TouchableOpacity>); shipping the
// actions in a bottom sheet TRIGGERED by the marker tap sidesteps that bug
// entirely while keeping the read-only callout for at-a-glance info.
// ──────────────────────────────────────────────────────────────────────────────

import React, { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  Linking,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, radius, spacing } from "../theme";

export interface RepActionSheetRep {
  user_id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  active?: boolean | null;
  battery?: number | null; // 0..1
  battery_state?: string | null;
  last_seen_seconds?: number | null;
  session_seconds?: number | null;
  // Optional KPI from /dashboard/manager rep_progress[] (matched by user_id)
  signed?: number | null;
  signed_today?: number | null; // alias supported
  total_leads?: number | null;
  target?: number | null;
  percent?: number | null; // 0..100
}

export interface RepActionSheetProps {
  visible: boolean;
  onClose: () => void;
  rep: RepActionSheetRep | null;
  /** Determines which route group hosts the rep profile. */
  scope: "admin" | "manager";
  testID?: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatWorkTime(seconds?: number | null): string {
  if (seconds == null || seconds < 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m} min`;
}

function formatLastSeen(seconds?: number | null): string {
  if (seconds == null || seconds < 0) return "nieznany";
  if (seconds < 60) return `${seconds}s temu`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min temu`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h temu`;
  return `${Math.floor(seconds / 86_400)}d temu`;
}

function repInitials(name?: string | null): string {
  if (!name || typeof name !== "string") return "?";
  try {
    const parts = name.split(" ").filter(Boolean);
    if (parts.length === 0) return "?";
    return parts.map((p) => p?.[0] || "").join("").slice(0, 2).toUpperCase() || "?";
  } catch {
    return "?";
  }
}

// ─── component ────────────────────────────────────────────────────────────────

export function RepActionSheet({
  visible,
  onClose,
  rep,
  scope,
  testID = "rep-action-sheet",
}: RepActionSheetProps) {
  const router = useRouter();

  // Phone normalization — strip spaces, keep "+", non-digits removed.
  const phoneRaw = rep?.phone ? String(rep.phone).trim() : "";
  const phoneClean = phoneRaw.replace(/[^\d+]/g, "");
  const hasPhone = phoneClean.length >= 6; // sanity floor

  const isOnline = !!rep?.active;
  const dotColor = isOnline ? colors.secondary : "#94A3B8";

  // KPI normalization — accept either signed or signed_today field name
  const signedToday = rep?.signed ?? rep?.signed_today ?? null;
  const target = rep?.target ?? null;
  const percent = typeof rep?.percent === "number" ? Math.round(rep.percent) : null;
  const totalLeads = rep?.total_leads ?? null;

  const handleCall = useCallback(async () => {
    if (!hasPhone) return;
    const tel = `tel:${phoneClean}`;
    try {
      // canOpenURL is a softer check on web — Linking.openURL can throw.
      if (Platform.OS !== "web") {
        const ok = await Linking.canOpenURL(tel);
        if (!ok) {
          // eslint-disable-next-line no-console
          console.warn("Linking.canOpenURL returned false for", tel);
          return;
        }
      }
      await Linking.openURL(tel);
      onClose();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("call failed:", e);
    }
  }, [hasPhone, phoneClean, onClose]);

  const handleViewProfile = useCallback(() => {
    if (!rep?.user_id) return;
    router.push(`/(${scope})/rep/${rep.user_id}` as any);
    onClose();
  }, [rep?.user_id, scope, router, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={Platform.OS === "web" ? "fade" : "slide"}
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        testID={`${testID}-backdrop`}
      >
        <Pressable onPress={(e) => e.stopPropagation()} style={{ width: "100%" }}>
          <SafeAreaView style={styles.sheet} edges={["bottom"]} testID={testID}>
            <View style={styles.handleBar} />

            {/* Identity block */}
            <View style={styles.headerBlock}>
              <View style={[styles.avatar, { borderColor: dotColor }]}>
                <Text style={styles.avatarText}>{repInitials(rep?.name)}</Text>
                <View style={[styles.onlineDot, { backgroundColor: dotColor }]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.repName} numberOfLines={1}>
                  {rep?.name || "—"}
                </Text>
                <View style={styles.metaRow}>
                  <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
                  <Text style={styles.metaText}>
                    {isOnline
                      ? `Online · ${formatWorkTime(rep?.session_seconds)}`
                      : `Offline · ${formatLastSeen(rep?.last_seen_seconds)}`}
                  </Text>
                </View>
                {typeof rep?.battery === "number" && (
                  <View style={styles.metaRow}>
                    <Feather
                      name="battery"
                      size={11}
                      color={rep.battery < 0.2 ? colors.warning : colors.textSecondary}
                    />
                    <Text style={styles.metaText}>
                      Bateria: {Math.round(rep.battery * 100)}%
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Phone tile (or "no phone" fallback) */}
            {hasPhone ? (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleCall}
                style={styles.callBtn}
                testID={`${testID}-call`}
                accessibilityLabel={`Zadzwoń do ${rep?.name}`}
              >
                <View style={styles.callIcon}>
                  <Feather name="phone-call" size={18} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.callLabel}>Zadzwoń</Text>
                  <Text style={styles.callPhone}>{phoneRaw}</Text>
                </View>
                <Feather name="chevron-right" size={18} color="#fff" />
              </TouchableOpacity>
            ) : (
              <View style={styles.noPhoneTile} testID={`${testID}-call-disabled`}>
                <Feather name="phone-off" size={16} color={colors.textSecondary} />
                <Text style={styles.noPhoneText}>Brak numeru telefonu</Text>
              </View>
            )}

            {/* KPI block */}
            <Text style={styles.kpiLabel}>KPI dnia</Text>
            <View style={styles.kpiGrid}>
              <View style={styles.kpiTile} testID={`${testID}-kpi-signed`}>
                <Text style={styles.kpiValue}>
                  {signedToday ?? "—"}
                  {target ? <Text style={styles.kpiOf}> / {target}</Text> : null}
                </Text>
                <Text style={styles.kpiCaption}>Umowy</Text>
              </View>
              <View style={styles.kpiTile} testID={`${testID}-kpi-leads`}>
                <Text style={styles.kpiValue}>{totalLeads ?? "—"}</Text>
                <Text style={styles.kpiCaption}>Leady</Text>
              </View>
              <View style={styles.kpiTile} testID={`${testID}-kpi-progress`}>
                <Text style={styles.kpiValue}>
                  {percent != null ? `${percent}%` : "—"}
                </Text>
                <Text style={styles.kpiCaption}>Postęp</Text>
              </View>
            </View>

            {/* Primary action */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleViewProfile}
              style={styles.primaryBtn}
              testID={`${testID}-profile`}
              accessibilityLabel="Zobacz pełny profil handlowca"
            >
              <Feather name="user" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>Zobacz pełny profil</Text>
              <Feather name="chevron-right" size={16} color="#fff" />
            </TouchableOpacity>

            {/* Cancel */}
            <TouchableOpacity
              onPress={onClose}
              style={styles.cancelBtn}
              testID={`${testID}-close`}
              accessibilityLabel="Zamknij"
            >
              <Text style={styles.cancelText}>Zamknij</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default RepActionSheet;

// ─── styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(11,18,32,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingTop: 8,
    paddingBottom: spacing.md,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.zinc100,
    alignSelf: "center",
    marginBottom: spacing.sm,
  },
  // Identity
  headerBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.zinc100,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    position: "relative",
  },
  avatarText: {
    fontSize: 18,
    fontWeight: "900",
    color: colors.textPrimary,
    letterSpacing: 0.4,
  },
  onlineDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.paper,
  },
  repName: {
    fontSize: 17,
    fontWeight: "900",
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 3,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  metaText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "600",
  },
  // Phone tile
  callBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.secondary,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: spacing.md,
  },
  callIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  callLabel: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 14,
    letterSpacing: 0.3,
  },
  callPhone: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 1,
  },
  noPhoneTile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.zinc100,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: spacing.md,
  },
  noPhoneText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: "700",
  },
  // KPI
  kpiLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
  kpiGrid: {
    flexDirection: "row",
    gap: 8,
    marginBottom: spacing.md,
  },
  kpiTile: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  kpiValue: {
    fontSize: 20,
    fontWeight: "900",
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  kpiOf: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  kpiCaption: {
    fontSize: 10,
    fontWeight: "800",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 2,
  },
  // Primary action
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: spacing.sm,
  },
  primaryBtnText: {
    flex: 1,
    color: "#fff",
    fontWeight: "900",
    fontSize: 15,
    letterSpacing: 0.3,
  },
  // Cancel
  cancelBtn: {
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.zinc100,
    alignItems: "center",
  },
  cancelText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
});
