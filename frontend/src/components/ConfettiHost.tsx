// Sprint 3a — global overlay showing confetti + banner when a contract is
// signed anywhere in the company. Two variants:
//   A) current user's contract  → huge confetti (200 particles, 5s) + haptic success
//   B) someone else's contract   → smaller confetti (60 particles, 2.5s), no haptic
// Tap anywhere on backdrop, or wait 4-5s, to dismiss.

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  useWindowDimensions,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import ConfettiCannon from "react-native-confetti-cannon";
import * as Haptics from "expo-haptics";
import { onAppEvent, AppEvent } from "../lib/useAppEventsWS";
import { useAuth } from "../lib/auth";
import { colors, radius, spacing } from "../theme";

function fmtPln(n?: number): string {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${Math.round(n)} zł`;
  }
}

interface ContractSignedEvent extends AppEvent {
  contract_id?: string;
  lead_id?: string;
  client_name?: string;
  rep_id?: string;
  rep_name?: string;
  gross_amount?: number;
  commission_amount?: number;
  signed_at?: string;
}

export const ConfettiHost: React.FC = () => {
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const [event, setEvent] = useState<ContractSignedEvent | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cannonRef = useRef<any>(null);

  const dismiss = () => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
    setVisible(false);
    setEvent(null);
  };

  useEffect(() => {
    const unsub = onAppEvent("contract_signed", (e) => {
      const evt = e as ContractSignedEvent;
      setEvent(evt);
      setVisible(true);
      const isMine = !!user && evt.rep_id === user.id;
      if (isMine && Platform.OS !== "web") {
        try {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        } catch {}
      }
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(
        () => {
          setVisible(false);
          setEvent(null);
        },
        isMine ? 5200 : 3600
      );
    });
    return () => {
      unsub();
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [user]);

  if (!visible || !event) return null;

  const isMine = !!user && event.rep_id === user.id;

  const cannonProps = isMine
    ? { count: 200, origin: { x: width / 2, y: -10 }, fadeOut: true, fallSpeed: 2600 }
    : { count: 60, origin: { x: width / 2, y: -10 }, fadeOut: true, fallSpeed: 2400 };

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={dismiss}
      statusBarTranslucent
    >
      <Pressable onPress={dismiss} style={styles.backdrop} testID="confetti-backdrop">
        {/* Confetti cannon always fires on mount (new key per event forces re-fire) */}
        <ConfettiCannon
          ref={cannonRef}
          key={event.contract_id || String(Date.now())}
          {...cannonProps}
          autoStart
          explosionSpeed={350}
        />

        {isMine ? (
          <View style={[styles.bannerBase, styles.bannerLarge]} testID="confetti-banner-mine">
            <Text style={styles.bigEmoji}>🎉</Text>
            <Text style={styles.bannerTitleLarge}>BRAWO! Podpisałeś umowę! 🎉</Text>
            <View style={styles.bannerSepLarge} />
            <Text style={styles.bannerClient}>
              {event.client_name || "—"}
              {typeof event.gross_amount === "number" ? ` · ${fmtPln(event.gross_amount)}` : ""}
            </Text>
            {typeof event.commission_amount === "number" && (
              <Text style={styles.bannerCommission}>
                Twoja prowizja: {fmtPln(event.commission_amount)}
              </Text>
            )}
            <Text style={styles.bannerHint}>[tap aby zamknąć]</Text>
          </View>
        ) : (
          <View style={[styles.bannerBase, styles.bannerSmall]} testID="confetti-banner-other">
            <View style={styles.bannerSmallRow}>
              <Text style={styles.smallEmoji}>🎊</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.bannerTitleSmall}>
                  {event.rep_name || "Handlowiec"} właśnie podpisał{" "}
                  {event.rep_name && /[aA]$/.test(event.rep_name) ? "a" : ""}
                  {" "}umowę!
                </Text>
                <Text style={styles.bannerClientSmall}>
                  {event.client_name || "—"}
                  {typeof event.gross_amount === "number"
                    ? ` · ${fmtPln(event.gross_amount)}`
                    : ""}
                </Text>
              </View>
              <Feather name="x" size={16} color={colors.textSecondary} />
            </View>
          </View>
        )}
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.15)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  bannerBase: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  bannerLarge: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    gap: 6,
  },
  bannerSmall: {
    position: "absolute",
    top: 60,
    width: "100%",
    maxWidth: 420,
    padding: 14,
  },
  bannerSmallRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bigEmoji: { fontSize: 54, marginBottom: 6 },
  smallEmoji: { fontSize: 28 },
  bannerTitleLarge: {
    fontSize: 18,
    fontWeight: "900",
    color: colors.primary,
    textAlign: "center",
  },
  bannerSepLarge: {
    width: 40,
    height: 3,
    backgroundColor: colors.primary,
    borderRadius: 2,
    marginVertical: 8,
  },
  bannerClient: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.textPrimary,
    textAlign: "center",
  },
  bannerCommission: {
    fontSize: 14,
    color: colors.success,
    fontWeight: "800",
    marginTop: 4,
  },
  bannerHint: {
    marginTop: 10,
    fontSize: 11,
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  bannerTitleSmall: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  bannerClientSmall: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
