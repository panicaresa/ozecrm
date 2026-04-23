// Sprint 1.5 — /sync-status: view all pending / conflicting offline operations.

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQueue } from "../src/lib/useQueue";
import { removeOp, retryOp, syncNow, QueueOp } from "../src/lib/offlineQueue";
import { colors, radius, spacing } from "../src/theme";

function fmtTime(iso?: string) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function opTitle(op: QueueOp): string {
  if (op.type === "POST_LEAD") {
    const n = op.body?.client_name || "Nowy lead";
    return `👤 ${n}`;
  }
  if (op.type === "POST_CONTRACT") {
    const amt = Number(op.body?.gross_amount || 0);
    const name = op.body?.client_name || "Umowa";
    return `📄 ${name}${amt ? ` (${Math.round(amt / 1000)}k)` : ""}`;
  }
  return op.type;
}

export default function SyncStatus() {
  const router = useRouter();
  const { ops, counts } = useQueue();
  const [syncing, setSyncing] = useState(false);
  const [aptModal, setAptModal] = useState<{ opId: string } | null>(null);
  const [aptValue, setAptValue] = useState("");

  const pendingOps = ops.filter((o) => o.status !== "conflict");
  const conflictOps = ops.filter((o) => o.status === "conflict");

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      await syncNow();
    } finally {
      setSyncing(false);
    }
  };

  const confirmAbandon = (op: QueueOp) => {
    Alert.alert(
      "Porzucić operację?",
      `${opTitle(op)}\n\nNa pewno? ${op.type === "POST_LEAD" ? "Lead" : "Umowa"} zostanie utracona na zawsze.`,
      [
        { text: "Anuluj", style: "cancel" },
        {
          text: "Tak, porzuć",
          style: "destructive",
          onPress: () => {
            removeOp(op.id).catch(() => {});
          },
        },
      ]
    );
  };

  const handleOpenExisting = (op: QueueOp) => {
    if (!op.conflict?.existing_lead_id) return;
    Alert.alert(
      "Otworzyć istniejący lead?",
      `Po otwarciu pending operacja zostanie porzucona (unikamy duplikatu).`,
      [
        { text: "Anuluj", style: "cancel" },
        {
          text: "Otwórz + porzuć lokalny",
          onPress: async () => {
            const existing = op.conflict!.existing_lead_id;
            await removeOp(op.id);
            router.replace(`/(rep)/lead/${existing}` as any);
          },
        },
      ]
    );
  };

  const handleAddApartment = (op: QueueOp) => {
    setAptModal({ opId: op.id });
    setAptValue("");
  };

  const submitApartment = async () => {
    if (!aptModal) return;
    const apt = aptValue.trim();
    if (!apt) {
      Alert.alert("Brak numeru", "Podaj numer mieszkania / klatki.");
      return;
    }
    await retryOp(aptModal.opId, { apartment_number: apt });
    setAptModal(null);
    setAptValue("");
  };

  const handleConfirmSoft = (op: QueueOp) => {
    Alert.alert(
      "Potwierdzić że to inny klient?",
      op.conflict?.message || "",
      [
        { text: "Anuluj", style: "cancel" },
        {
          text: "Tak, inny klient",
          onPress: () => retryOp(op.id, { confirmed_nearby_duplicate: true }),
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="sync-status-back">
          <Feather name="arrow-left" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Synchronizacja</Text>
        <TouchableOpacity
          onPress={handleSyncAll}
          disabled={syncing || ops.length === 0}
          testID="sync-status-sync-all"
        >
          {syncing ? (
            <ActivityIndicator size="small" color={colors.secondary} />
          ) : (
            <Feather
              name="refresh-cw"
              size={20}
              color={ops.length === 0 ? colors.textSecondary : colors.secondary}
            />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {ops.length === 0 && (
          <View style={styles.emptyCard} testID="sync-status-empty">
            <Feather name="check-circle" size={40} color={colors.success} />
            <Text style={styles.emptyTitle}>Wszystko zsynchronizowane</Text>
            <Text style={styles.emptySub}>
              Brak operacji oczekujących na wysyłkę. Gdy zabraknie zasięgu, leady i umowy trafią tutaj automatycznie.
            </Text>
          </View>
        )}

        {pendingOps.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Nie wysłane jeszcze ({pendingOps.length})</Text>
            {pendingOps.map((op) => (
              <View key={op.id} style={styles.card} testID={`sync-op-${op.id}`}>
                <Text style={styles.cardTitle}>{opTitle(op)}</Text>
                <Text style={styles.cardMeta}>
                  Dodany {fmtTime(op.created_at)} · {op.attempts} {op.attempts === 1 ? "próba" : "prób"}
                  {op.status === "syncing" ? " · wysyłam…" : ""}
                </Text>
                {!!op.last_error && <Text style={styles.errText}>Błąd: {op.last_error}</Text>}
                <View style={styles.cardActions}>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnPrimary]}
                    onPress={() => retryOp(op.id)}
                    testID={`sync-op-retry-${op.id}`}
                  >
                    <Feather name="refresh-cw" size={14} color="#fff" />
                    <Text style={styles.btnPrimaryText}>Synchronizuj teraz</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnDanger]}
                    onPress={() => confirmAbandon(op)}
                    testID={`sync-op-abandon-${op.id}`}
                  >
                    <Feather name="trash-2" size={14} color="#B91C1C" />
                    <Text style={styles.btnDangerText}>Porzuć</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {conflictOps.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: "#B45309" }]}>
              Wymaga Twojej decyzji ⚠️ ({conflictOps.length})
            </Text>
            {conflictOps.map((op) => (
              <View
                key={op.id}
                style={[styles.card, styles.conflictCard]}
                testID={`sync-op-${op.id}`}
              >
                <Text style={styles.cardTitle}>{opTitle(op)}</Text>
                <Text style={styles.cardMeta}>
                  Dodany {fmtTime(op.created_at)} · konflikt:
                </Text>
                <Text style={styles.conflictMsg}>{op.conflict?.message}</Text>
                <View style={styles.cardActions}>
                  {op.conflict?.code === "LEAD_DUPLICATE_HARD" && (
                    <>
                      <TouchableOpacity
                        style={[styles.btn, styles.btnSecondary]}
                        onPress={() => handleOpenExisting(op)}
                        testID={`sync-op-open-existing-${op.id}`}
                      >
                        <Feather name="external-link" size={14} color={colors.secondary} />
                        <Text style={styles.btnSecondaryText}>Otwórz istniejący</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.btn, styles.btnPrimary]}
                        onPress={() => handleAddApartment(op)}
                        testID={`sync-op-add-apt-${op.id}`}
                      >
                        <Feather name="home" size={14} color="#fff" />
                        <Text style={styles.btnPrimaryText}>Dodaj z nr mieszkania</Text>
                      </TouchableOpacity>
                    </>
                  )}
                  {op.conflict?.code === "LEAD_NEARBY_SOFT" && (
                    <TouchableOpacity
                      style={[styles.btn, styles.btnPrimary]}
                      onPress={() => handleConfirmSoft(op)}
                      testID={`sync-op-confirm-soft-${op.id}`}
                    >
                      <Feather name="check" size={14} color="#fff" />
                      <Text style={styles.btnPrimaryText}>Potwierdź: inny klient</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.btn, styles.btnDanger]}
                    onPress={() => confirmAbandon(op)}
                    testID={`sync-op-abandon-${op.id}`}
                  >
                    <Feather name="trash-2" size={14} color="#B91C1C" />
                    <Text style={styles.btnDangerText}>Porzuć</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {ops.length > 0 && (
          <Text style={styles.footerHint}>
            Łącznie: {counts.total} · pending: {counts.pending} · konflikt: {counts.conflict}
            {counts.syncing > 0 ? ` · wysyłam: ${counts.syncing}` : ""}
          </Text>
        )}
      </ScrollView>

      {/* Apartment number modal */}
      <Modal visible={!!aptModal} transparent animationType="fade" onRequestClose={() => setAptModal(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Numer mieszkania / klatki</Text>
            <Text style={styles.modalSub}>
              Podaj numer który odróżnia ten lokal od istniejącego leada.
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="np. 12A, m. 5, klatka II"
              placeholderTextColor={colors.textSecondary}
              value={aptValue}
              onChangeText={setAptValue}
              autoFocus={Platform.OS !== "web"}
              testID="sync-apt-input"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnSecondary]}
                onPress={() => setAptModal(null)}
                testID="sync-apt-cancel"
              >
                <Text style={styles.btnSecondaryText}>Anuluj</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary]}
                onPress={submitApartment}
                testID="sync-apt-submit"
              >
                <Feather name="check" size={14} color="#fff" />
                <Text style={styles.btnPrimaryText}>Spróbuj ponownie</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.paper,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: 17, fontWeight: "900", color: colors.textPrimary },
  scroll: { padding: spacing.md, paddingBottom: 40 },
  emptyCard: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    gap: 10,
  },
  emptyTitle: { fontSize: 16, fontWeight: "900", color: colors.textPrimary },
  emptySub: { fontSize: 13, color: colors.textSecondary, textAlign: "center", lineHeight: 19 },
  section: { marginBottom: spacing.lg },
  sectionTitle: { fontSize: 13, fontWeight: "800", color: colors.textSecondary, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  card: { backgroundColor: colors.paper, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: 10 },
  conflictCard: { backgroundColor: "#FFF7ED", borderColor: "#FDBA74" },
  cardTitle: { fontSize: 15, fontWeight: "800", color: colors.textPrimary },
  cardMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  errText: { fontSize: 12, color: "#B91C1C", marginTop: 6, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  conflictMsg: { fontSize: 13, color: "#9A3412", marginTop: 6, lineHeight: 19 },
  cardActions: { flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" },
  btn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1 },
  btnPrimary: { backgroundColor: colors.secondary, borderColor: colors.secondary },
  btnPrimaryText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  btnSecondary: { backgroundColor: colors.paper, borderColor: colors.border },
  btnSecondaryText: { color: colors.secondary, fontSize: 12, fontWeight: "800" },
  btnDanger: { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" },
  btnDangerText: { color: "#B91C1C", fontSize: 12, fontWeight: "800" },
  footerHint: { textAlign: "center", fontSize: 11, color: colors.textSecondary, marginTop: 8 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 400, backgroundColor: colors.paper, borderRadius: radius.lg, padding: spacing.lg, gap: 12 },
  modalTitle: { fontSize: 17, fontWeight: "900", color: colors.textPrimary },
  modalSub: { fontSize: 13, color: colors.textSecondary },
  modalInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, color: colors.textPrimary, fontSize: 14 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 8 },
});
