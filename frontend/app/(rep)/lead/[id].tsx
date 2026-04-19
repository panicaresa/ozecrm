import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, formatApiError } from "../../../src/lib/api";
import { colors, radius, spacing, statusColor, statusLabel } from "../../../src/theme";
import { Field } from "../../../src/components/Field";
import { Button } from "../../../src/components/Button";
import { Lead } from "../../../src/components/LeadCard";

const STATUSES = ["nowy", "umowione", "decyzja", "podpisana", "nie_zainteresowany"];

export default function LeadDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [lead, setLead] = useState<Lead | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<Lead[]>("/leads");
      const found = res.data.find((l) => l.id === id) as any;
      if (found) {
        setLead(found);
        setNote(found.note || "");
      } else {
        setErr("Lead nie został znaleziony");
      }
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const changeStatus = async (newStatus: string) => {
    if (!lead || newStatus === lead.status) return;
    setSavingStatus(newStatus);
    try {
      const res = await api.patch(`/leads/${lead.id}`, { status: newStatus });
      setLead(res.data);
    } catch (e) {
      Alert.alert("Błąd", formatApiError(e));
    } finally {
      setSavingStatus(null);
    }
  };

  const saveNote = async () => {
    if (!lead) return;
    setSavingNote(true);
    try {
      const res = await api.patch(`/leads/${lead.id}`, { note });
      setLead(res.data);
      Alert.alert("Zapisano", "Notatka została zaktualizowana");
    } catch (e) {
      Alert.alert("Błąd", formatApiError(e));
    } finally {
      setSavingNote(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!lead) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()}>
            <Feather name="arrow-left" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Lead</Text>
        </View>
        <View style={{ padding: spacing.md }}>
          <Text style={{ color: colors.error }}>{err || "Nie znaleziono"}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const sc = statusColor[lead.status] || colors.primary;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()} testID="lead-detail-back">
            <Feather name="arrow-left" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Szczegóły leada</Text>
            <Text style={styles.sub}>ID: {lead.id.slice(0, 8)}…</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: `${sc}22` }]}>
            <View style={[styles.dot, { backgroundColor: sc }]} />
            <Text style={[styles.statusText, { color: sc }]}>{statusLabel[lead.status] || lead.status}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.name}>{lead.client_name}</Text>
            {!!lead.phone && (
              <View style={styles.row}><Feather name="phone" size={14} color={colors.textSecondary} /><Text style={styles.rowText}>{lead.phone}</Text></View>
            )}
            {!!lead.address && (
              <View style={styles.row}><Feather name="map-pin" size={14} color={colors.textSecondary} /><Text style={styles.rowText}>{lead.address}</Text></View>
            )}
            {!!lead.building_area && (
              <View style={styles.row}>
                <Feather name="home" size={14} color={colors.textSecondary} />
                <Text style={styles.rowText}>
                  {lead.building_type === "gospodarczy" ? "Gospodarczy" : "Mieszkalny"} · {lead.building_area} m²
                </Text>
              </View>
            )}
            {(typeof lead.latitude === "number" && typeof lead.longitude === "number") && (
              <View style={styles.row}>
                <Feather name="navigation" size={14} color={colors.textSecondary} />
                <Text style={styles.rowText}>{lead.latitude.toFixed(5)}, {lead.longitude.toFixed(5)}</Text>
              </View>
            )}
          </View>

          <Text style={styles.section}>Zmień status</Text>
          <View style={styles.chipRow}>
            {STATUSES.map((s) => {
              const active = lead.status === s;
              const c = statusColor[s];
              return (
                <TouchableOpacity
                  key={s}
                  style={[
                    styles.chip,
                    active && { backgroundColor: c, borderColor: c },
                    !active && { borderColor: colors.border },
                  ]}
                  activeOpacity={0.8}
                  onPress={() => changeStatus(s)}
                  disabled={savingStatus !== null}
                  testID={`status-chip-${s}`}
                >
                  {savingStatus === s ? (
                    <ActivityIndicator color={active ? "#fff" : c} size="small" />
                  ) : (
                    <Text style={[styles.chipText, active ? { color: "#fff" } : { color: colors.textPrimary }]}>
                      {statusLabel[s]}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.section}>Notatka</Text>
          <Field
            placeholder="Wrażenia ze spotkania, ustalenia, kolejne kroki…"
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={5}
            style={{ height: 120, textAlignVertical: "top" }}
            testID="lead-note-textarea"
          />
          <Button
            title="Zapisz notatkę"
            onPress={saveNote}
            loading={savingNote}
            icon={<Feather name="save" size={18} color="#fff" />}
            testID="save-note-button"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", padding: spacing.md, gap: 12 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 20, fontWeight: "900", color: colors.textPrimary },
  sub: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  card: { backgroundColor: colors.paper, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, gap: 8, marginBottom: 16 },
  name: { fontSize: 22, fontWeight: "900", color: colors.textPrimary, letterSpacing: -0.5, marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowText: { color: colors.textSecondary, fontSize: 14, flex: 1 },
  section: { fontSize: 12, fontWeight: "800", color: colors.textPrimary, textTransform: "uppercase", letterSpacing: 1.5, marginTop: 8, marginBottom: 10 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1.5, backgroundColor: colors.paper, minHeight: 40, justifyContent: "center" },
  chipText: { fontSize: 12, fontWeight: "700" },
});
