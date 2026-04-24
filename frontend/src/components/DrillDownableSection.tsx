import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  ScrollView,
  TouchableOpacity,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";

// ──────────────────────────────────────────────────────────────────────────────
// Generic drill-down section — Sprint 3.5b
// Pattern used across the app (DailyReport pipeline, MyLeady, Manager Dashboard).
// ──────────────────────────────────────────────────────────────────────────────

// Feather icon names limited to a safe subset used in our app.
export type FeatherGlyph =
  | "calendar"
  | "zap"
  | "user-plus"
  | "user-x"
  | "alert-circle"
  | "alert-octagon"
  | "users"
  | "activity"
  | "file-text"
  | "map-pin"
  | "chevron-right"
  | "bar-chart-2"
  | "dollar-sign"
  | "target"
  | "briefcase";

export interface DrillDownItem {
  id: string;
  // additional fields are consumer-defined
  [key: string]: unknown;
}

export interface DrillDownableSectionProps<T extends DrillDownItem> {
  /** Section title shown above the preview list. */
  title: string;
  /** Optional leading Feather icon. */
  icon?: FeatherGlyph;
  /** Optional accent colour for the icon (default: colors.primary). */
  iconColor?: string;
  /** All items (preview shows the first `maxInline`, modal shows all). */
  items: T[];
  /**
   * Render an inline/row preview for the section list.
   * Should NOT include its own press handler — the section wraps it with Pressable.
   */
  renderItemPreview: (item: T) => React.ReactElement;
  /**
   * Optional separate renderer for modal rows; defaults to renderItemPreview.
   * Use this when you want a denser or richer row inside the full-list modal.
   */
  renderItemFull?: (item: T) => React.ReactElement;
  /** Called when a user taps any row (inline or modal). */
  onItemPress: (item: T) => void;
  /** Max items rendered inline before "Pokaż wszystkie" button appears. Default 3. */
  maxInline?: number;
  /** Copy shown when items.length === 0. Default "Brak pozycji". */
  emptyCopy?: string;
  /** Alternate title used for the modal header. Defaults to `title`. */
  modalTitle?: string;
  /**
   * Render mode for inline preview:
   *   "list" — vertical stack, Pressable rows (default)
   *   "chips" — horizontal wrap of Pressable chips (used by rep counters)
   */
  layout?: "list" | "chips";
  /** Test ID root (appended with -row-<id> / -show-more / -modal / -close). */
  testID?: string;
}

function DrillDownableSectionInner<T extends DrillDownItem>({
  title,
  icon,
  iconColor = colors.primary,
  items,
  renderItemPreview,
  renderItemFull,
  onItemPress,
  maxInline = 3,
  emptyCopy = "Brak pozycji",
  modalTitle,
  layout = "list",
  testID,
}: DrillDownableSectionProps<T>) {
  const [modalOpen, setModalOpen] = useState(false);

  const rendered = useMemo(() => items.slice(0, maxInline), [items, maxInline]);
  const overflow = items.length - rendered.length;
  const effectiveFullRenderer = renderItemFull || renderItemPreview;

  const handleRowPress = useCallback(
    (item: T) => {
      if (modalOpen) setModalOpen(false);
      // Defer so modal close animation doesn't fight navigation on native
      setTimeout(() => onItemPress(item), modalOpen ? 120 : 0);
    },
    [modalOpen, onItemPress]
  );

  const renderHeader = () => (
    <View style={styles.head}>
      {icon && (
        <View style={[styles.iconCircle, { backgroundColor: `${iconColor}15` }]}>
          <Feather name={icon} size={12} color={iconColor} />
        </View>
      )}
      <Text style={styles.title}>{title}</Text>
      {items.length > 0 && (
        <View style={styles.countBadge}>
          <Text style={styles.countBadgeText}>{items.length}</Text>
        </View>
      )}
    </View>
  );

  // Empty state
  if (items.length === 0) {
    return (
      <View style={styles.wrap} testID={testID}>
        {renderHeader()}
        <Text style={styles.empty}>{emptyCopy}</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap} testID={testID}>
      {renderHeader()}

      {layout === "chips" ? (
        <View style={styles.chipsRow}>
          {rendered.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => handleRowPress(item)}
              style={({ pressed }) => [styles.chipWrap, pressed && styles.pressed]}
              accessibilityRole="button"
              testID={testID ? `${testID}-row-${item.id}` : undefined}
            >
              {renderItemPreview(item)}
            </Pressable>
          ))}
          {overflow > 0 && (
            <Pressable
              onPress={() => setModalOpen(true)}
              style={({ pressed }) => [styles.moreChip, pressed && styles.pressed]}
              accessibilityRole="button"
              testID={testID ? `${testID}-show-more` : undefined}
            >
              <Text style={styles.moreChipText}>+{overflow}</Text>
              <Feather name="chevron-right" size={12} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>
      ) : (
        <View>
          {rendered.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => handleRowPress(item)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityRole="button"
              testID={testID ? `${testID}-row-${item.id}` : undefined}
            >
              <View style={{ flex: 1 }}>{renderItemPreview(item)}</View>
              <Feather name="chevron-right" size={14} color={colors.textSecondary} />
            </Pressable>
          ))}
          {overflow > 0 && (
            <Pressable
              onPress={() => setModalOpen(true)}
              style={({ pressed }) => [styles.moreRow, pressed && styles.pressed]}
              accessibilityRole="button"
              testID={testID ? `${testID}-show-more` : undefined}
            >
              <Feather name="chevron-right" size={14} color={colors.primary} />
              <Text style={styles.moreText}>Pokaż wszystkie ({items.length})</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Full-list modal */}
      <Modal
        visible={modalOpen}
        transparent
        animationType={Platform.OS === "web" ? "fade" : "slide"}
        onRequestClose={() => setModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <SafeAreaView style={styles.modalSheet} edges={["bottom"]} testID={testID ? `${testID}-modal` : undefined}>
            <View style={styles.modalHeader}>
              {icon && (
                <View style={[styles.iconCircle, { backgroundColor: `${iconColor}15` }]}>
                  <Feather name={icon} size={14} color={iconColor} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle} numberOfLines={1}>
                  {modalTitle || title}
                </Text>
                <Text style={styles.modalSub}>{items.length} {items.length === 1 ? "pozycja" : "pozycji"}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setModalOpen(false)}
                style={styles.closeBtn}
                hitSlop={10}
                testID={testID ? `${testID}-close` : undefined}
                accessibilityLabel="Zamknij"
              >
                <Feather name="x" size={18} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.lg }}
              showsVerticalScrollIndicator
            >
              {items.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => handleRowPress(item)}
                  style={({ pressed }) => [styles.modalRow, pressed && styles.pressed]}
                  accessibilityRole="button"
                  testID={testID ? `${testID}-modal-row-${item.id}` : undefined}
                >
                  <View style={{ flex: 1 }}>{effectiveFullRenderer(item)}</View>
                  <Feather name="chevron-right" size={16} color={colors.textSecondary} />
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.modalFooter}>
              <TouchableOpacity
                onPress={() => setModalOpen(false)}
                style={styles.modalCloseBtn}
                activeOpacity={0.85}
              >
                <Text style={styles.modalCloseText}>Zamknij</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

// React.memo with generic cast to preserve <T> type inference at the call-site.
export const DrillDownableSection = React.memo(
  DrillDownableSectionInner
) as typeof DrillDownableSectionInner;

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.zinc100,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  iconCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.textPrimary,
    letterSpacing: 1,
    textTransform: "uppercase",
    flexShrink: 1,
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.zinc100,
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textSecondary,
  },
  empty: {
    color: colors.textSecondary,
    fontSize: 12,
    paddingVertical: 6,
    fontStyle: "italic",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.zinc100,
  },
  pressed: { opacity: 0.6 },
  moreRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    marginTop: 4,
    borderRadius: radius.sm,
    backgroundColor: `${colors.primary}10`,
  },
  moreText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.primary,
    letterSpacing: 0.3,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chipWrap: {},
  moreChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: `${colors.primary}10`,
  },
  moreChipText: {
    fontSize: 11,
    fontWeight: "900",
    color: colors.primary,
  },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(11,18,32,0.55)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: "85%",
    minHeight: "50%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.zinc100,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  modalSub: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 1,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.zinc100,
  },
  modalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.zinc100,
  },
  modalFooter: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.zinc100,
    backgroundColor: colors.paper,
  },
  modalCloseBtn: {
    backgroundColor: colors.inverted,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
  },
  modalCloseText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
});

export default DrillDownableSection;
