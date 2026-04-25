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
import { colors, radius, spacing } from "../theme";
import { buildTelUrl } from "../lib/inputFormatters";

// ──────────────────────────────────────────────────────────────────────────────
// LeadActionSheet (Sprint 3.5d micro)
// Bottom sheet shown ONLY from <DrillDownableSection> modal rows. It gives the
// user 4 options instead of an immediate navigation — because drill-down is
// "research mode", not "work mode" (My Leady / Manager Leady / Calendar).
// ──────────────────────────────────────────────────────────────────────────────

export interface LeadActionSheetLead {
  id: string;
  client_name?: string;
  phone?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  rep_id?: string;
  rep_name?: string;
  meeting_at?: string;
  status?: string;
}

export interface LeadActionSheetProps {
  visible: boolean;
  onClose: () => void;
  lead: LeadActionSheetLead | null;
  onViewDetails: () => void;
  /** Optional callback — when missing the "Handlowiec" action is disabled. */
  onViewRep?: () => void;
  /** Role scope — used for subtle copy differences if needed. */
  scope?: "admin" | "manager" | "rep";
  testID?: string;
}

function fmtMeeting(iso?: string): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleString("pl-PL", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

export function LeadActionSheet({
  visible,
  onClose,
  lead,
  onViewDetails,
  onViewRep,
  testID = "lead-action-sheet",
}: LeadActionSheetProps) {
  const hasPhone = !!(lead?.phone && String(lead.phone).trim().length > 0);
  // Sprint 5-pre-pent — use the centralized buildTelUrl so legacy phone
  // formats ("+48 500 123 456", "500-123-456") and the new canonical raw
  // 9-digit form all produce a working tel: link.
  const telUrl = buildTelUrl(lead?.phone);
  const hasCoords =
    typeof lead?.latitude === "number" && typeof lead?.longitude === "number";
  const hasRep = !!(lead?.rep_id && onViewRep);

  const handleCall = useCallback(() => {
    if (!telUrl) return;
    Linking.openURL(telUrl).catch(() => {});
    onClose();
  }, [telUrl, onClose]);

  const handleMap = useCallback(() => {
    if (!hasCoords || !lead) return;
    const url = Platform.select({
      ios: `maps:?daddr=${lead.latitude},${lead.longitude}`,
      android: `google.navigation:q=${lead.latitude},${lead.longitude}`,
      default: `https://maps.google.com/?q=${lead.latitude},${lead.longitude}`,
    });
    if (url) Linking.openURL(url).catch(() => {});
    onClose();
  }, [hasCoords, lead, onClose]);

  const handleRep = useCallback(() => {
    if (!hasRep || !onViewRep) return;
    onViewRep();
    onClose();
  }, [hasRep, onViewRep, onClose]);

  const handleDetails = useCallback(() => {
    onViewDetails();
    onClose();
  }, [onViewDetails, onClose]);

  const meetingLabel = fmtMeeting(lead?.meeting_at);

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
        {/* Catch taps inside the sheet so they don't bubble up to close it. */}
        <Pressable onPress={(e) => e.stopPropagation()} style={{ width: "100%" }}>
          <SafeAreaView style={styles.sheet} edges={["bottom"]} testID={testID}>
            <View style={styles.handleBar} />

            {/* Lead header */}
            <View style={styles.headerBlock}>
              <Text style={styles.clientName} numberOfLines={1}>
                {lead?.client_name || "—"}
              </Text>
              {!!lead?.address && (
                <Text style={styles.metaLine} numberOfLines={1}>
                  <Feather name="map-pin" size={11} color={colors.textSecondary} />{" "}
                  {lead.address}
                </Text>
              )}
              {!!meetingLabel && (
                <Text style={styles.metaLine} numberOfLines={1}>
                  <Feather name="calendar" size={11} color={colors.info} />{" "}
                  Spotkanie: {meetingLabel}
                </Text>
              )}
              {!!lead?.rep_name && (
                <Text style={styles.metaLine} numberOfLines={1}>
                  <Feather name="user" size={11} color={colors.textSecondary} />{" "}
                  Handlowiec: {lead.rep_name}
                </Text>
              )}
            </View>

            {/* Primary action */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleDetails}
              style={styles.primaryBtn}
              testID={`${testID}-details`}
            >
              <Feather name="file-text" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>Zobacz szczegóły</Text>
              <Feather name="chevron-right" size={16} color="#fff" />
            </TouchableOpacity>

            <Text style={styles.quickLabel}>Szybkie akcje</Text>

            <View style={styles.quickRow}>
              {/* Call */}
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleCall}
                disabled={!hasPhone}
                style={[styles.quickTile, !hasPhone && styles.quickTileDisabled]}
                testID={`${testID}-call`}
              >
                <View
                  style={[
                    styles.quickIcon,
                    {
                      backgroundColor: hasPhone
                        ? `${colors.secondary}15`
                        : colors.zinc100,
                    },
                  ]}
                >
                  <Feather
                    name="phone"
                    size={18}
                    color={hasPhone ? colors.secondary : colors.textSecondary}
                  />
                </View>
                <Text
                  style={[
                    styles.quickText,
                    !hasPhone && { color: colors.textSecondary },
                  ]}
                >
                  Zadzwoń
                </Text>
                {!hasPhone && <Text style={styles.quickHint}>brak nr.</Text>}
              </TouchableOpacity>

              {/* Map / Navigate */}
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleMap}
                disabled={!hasCoords}
                style={[styles.quickTile, !hasCoords && styles.quickTileDisabled]}
                testID={`${testID}-map`}
              >
                <View
                  style={[
                    styles.quickIcon,
                    {
                      backgroundColor: hasCoords
                        ? `${colors.info}15`
                        : colors.zinc100,
                    },
                  ]}
                >
                  <Feather
                    name="navigation"
                    size={18}
                    color={hasCoords ? colors.info : colors.textSecondary}
                  />
                </View>
                <Text
                  style={[
                    styles.quickText,
                    !hasCoords && { color: colors.textSecondary },
                  ]}
                >
                  Mapy
                </Text>
                {!hasCoords && <Text style={styles.quickHint}>brak GPS</Text>}
              </TouchableOpacity>

              {/* Rep profile */}
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleRep}
                disabled={!hasRep}
                style={[styles.quickTile, !hasRep && styles.quickTileDisabled]}
                testID={`${testID}-rep`}
              >
                <View
                  style={[
                    styles.quickIcon,
                    {
                      backgroundColor: hasRep
                        ? `${colors.primary}15`
                        : colors.zinc100,
                    },
                  ]}
                >
                  <Feather
                    name="user"
                    size={18}
                    color={hasRep ? colors.primary : colors.textSecondary}
                  />
                </View>
                <Text
                  style={[
                    styles.quickText,
                    !hasRep && { color: colors.textSecondary },
                  ]}
                >
                  Handlowiec
                </Text>
                {!hasRep && <Text style={styles.quickHint}>n/a</Text>}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.85}
              style={styles.cancelBtn}
              testID={`${testID}-cancel`}
            >
              <Text style={styles.cancelText}>Anuluj</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default LeadActionSheet;

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
  headerBlock: {
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.zinc100,
    gap: 3,
  },
  clientName: {
    fontSize: 17,
    fontWeight: "900",
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  metaLine: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "600",
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: spacing.md,
  },
  primaryBtnText: {
    flex: 1,
    color: "#fff",
    fontWeight: "900",
    fontSize: 15,
    letterSpacing: 0.3,
  },
  quickLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
  quickRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: spacing.md,
  },
  quickTile: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    gap: 6,
  },
  quickTileDisabled: { opacity: 0.55 },
  quickIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  quickText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textPrimary,
    textAlign: "center",
  },
  quickHint: {
    fontSize: 9,
    color: colors.textSecondary,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
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
