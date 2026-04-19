import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api, formatApiError } from "../../src/lib/api";
import { colors, radius, spacing } from "../../src/theme";
import { Field } from "../../src/components/Field";
import { Button } from "../../src/components/Button";

interface UserRec {
  id: string;
  email: string;
  name: string;
  role: string;
  manager_id?: string | null;
  avatar_url?: string | null;
}

const ROLES: UserRec["role"][] = ["admin", "manager", "handlowiec"];

export default function AdminUsers() {
  const router = useRouter();
  const [users, setUsers] = useState<UserRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [cEmail, setCEmail] = useState("");
  const [cName, setCName] = useState("");
  const [cPassword, setCPassword] = useState("");
  const [cRole, setCRole] = useState<UserRec["role"]>("handlowiec");
  const [cManager, setCManager] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<UserRec[]>("/users");
      setUsers(res.data);
    } catch (e) {
      Alert.alert("Błąd", formatApiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const managers = users.filter((u) => u.role === "manager");

  const create = async () => {
    if (!cEmail.trim() || !cPassword || !cName.trim()) {
      Alert.alert("Brak danych", "Uzupełnij e-mail, imię i hasło.");
      return;
    }
    setCreating(true);
    try {
      await api.post("/auth/register", {
        email: cEmail.trim().toLowerCase(),
        password: cPassword,
        name: cName.trim(),
        role: cRole,
        manager_id: cRole === "handlowiec" ? cManager : null,
      });
      setShowCreate(false);
      setCEmail(""); setCName(""); setCPassword(""); setCManager(null); setCRole("handlowiec");
      await load();
    } catch (e) {
      Alert.alert("Błąd", formatApiError(e));
    } finally {
      setCreating(false);
    }
  };

  const del = (u: UserRec) => {
    Alert.alert("Usunąć?", `${u.email}`, [
      { text: "Anuluj" },
      {
        text: "Usuń",
        style: "destructive",
        onPress: async () => {
          try {
            await api.delete(`/users/${u.id}`);
            await load();
          } catch (e) {
            Alert.alert("Błąd", formatApiError(e));
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} testID="users-back-button">
          <Feather name="arrow-left" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Użytkownicy</Text>
          <Text style={styles.sub}>{users.length} kont</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowCreate(true)} testID="create-user-button">
          <Feather name="plus" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(u) => u.id}
          contentContainerStyle={{ padding: spacing.md, gap: 8 }}
          renderItem={({ item }) => (
            <View style={styles.row} testID={`user-row-${item.email}`}>
              <View style={[styles.roleDot, { backgroundColor: item.role === "admin" ? colors.inverted : item.role === "manager" ? colors.secondary : colors.primary }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name || item.email}</Text>
                <Text style={styles.email}>{item.email} · {item.role}</Text>
              </View>
              <TouchableOpacity onPress={() => del(item)} testID={`delete-user-${item.email}`}>
                <Feather name="trash-2" size={16} color={colors.error} />
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      <Modal visible={showCreate} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalContent}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Dodaj użytkownika</Text>
              <TouchableOpacity onPress={() => setShowCreate(false)}>
                <Feather name="x" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView>
              <Field label="Imię i nazwisko" value={cName} onChangeText={setCName} testID="new-user-name" />
              <Field label="E-mail" value={cEmail} onChangeText={setCEmail} keyboardType="email-address" autoCapitalize="none" testID="new-user-email" />
              <Field label="Hasło" value={cPassword} onChangeText={setCPassword} secureTextEntry testID="new-user-password" />
              <Text style={styles.section}>Rola</Text>
              <View style={styles.pills}>
                {ROLES.map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.pill, cRole === r && styles.pillActive]}
                    onPress={() => setCRole(r)}
                    testID={`new-user-role-${r}`}
                  >
                    <Text style={[styles.pillText, cRole === r && { color: "#fff" }]}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {cRole === "handlowiec" && (
                <>
                  <Text style={styles.section}>Przypisz managera</Text>
                  <View style={styles.pills}>
                    {managers.length === 0 && <Text style={{ color: colors.textSecondary }}>Brak managerów</Text>}
                    {managers.map((m) => (
                      <TouchableOpacity
                        key={m.id}
                        style={[styles.pill, cManager === m.id && styles.pillActive]}
                        onPress={() => setCManager(m.id)}
                      >
                        <Text style={[styles.pillText, cManager === m.id && { color: "#fff" }]}>{m.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              <Button title="Utwórz konto" onPress={create} loading={creating} testID="submit-create-user" />
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", padding: spacing.md, gap: 12 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 20, fontWeight: "900", color: colors.textPrimary },
  sub: { fontSize: 12, color: colors.textSecondary },
  addBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12, backgroundColor: colors.paper, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  roleDot: { width: 10, height: 10, borderRadius: 5 },
  name: { fontWeight: "700", color: colors.textPrimary, fontSize: 15 },
  email: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalContent: { backgroundColor: colors.paper, padding: spacing.md, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: "90%" },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  modalTitle: { fontSize: 18, fontWeight: "900", color: colors.textPrimary },
  section: { fontSize: 12, fontWeight: "800", color: colors.textPrimary, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  pillActive: { backgroundColor: colors.inverted, borderColor: colors.inverted },
  pillText: { fontSize: 12, fontWeight: "700", color: colors.textPrimary, textTransform: "capitalize" },
});
