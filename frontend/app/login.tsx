import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth, User } from "../src/lib/auth";
import { colors, spacing, radius } from "../src/theme";
import { Button } from "../src/components/Button";
import { Field } from "../src/components/Field";
import { BrandLogo } from "../src/components/BrandLogo";
import { api, formatApiError } from "../src/lib/api";

const QUICK_ACCOUNTS: { label: string; email: string; color: string }[] = [
  { label: "Admin", email: "admin@test.com", color: colors.inverted },
  { label: "Manager", email: "manager@test.com", color: colors.secondary },
  { label: "Handlowiec", email: "handlowiec@test.com", color: colors.primary },
];

export default function Login() {
  const router = useRouter();
  const { login, refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Batch B-fix #3D: inline force-change-password flow
  const [pendingUser, setPendingUser] = useState<User | null>(null);
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [changing, setChanging] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);

  const navigateByRole = (role: string) => {
    if (role === "admin") router.replace("/(admin)");
    else if (role === "manager") router.replace("/(manager)");
    else router.replace("/(rep)");
  };

  const handleLogin = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError("Wprowadź e-mail i hasło");
      return;
    }
    setLoading(true);
    try {
      const u = await login(email.trim().toLowerCase(), password);
      if (u.must_change_password) {
        // Do NOT navigate — show inline password-change form instead.
        setPendingUser(u);
      } else {
        navigateByRole(u.role);
      }
    } catch (e: any) {
      setError(formatApiError(e, "Nie udało się zalogować"));
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
    setChangeError(null);
    if (newPw.length < 12) {
      setChangeError("Nowe hasło musi mieć co najmniej 12 znaków.");
      return;
    }
    if (!/[a-zA-Z]/.test(newPw) || !/[0-9]/.test(newPw)) {
      setChangeError("Hasło musi zawierać co najmniej 1 literę i 1 cyfrę.");
      return;
    }
    if (newPw !== newPw2) {
      setChangeError("Hasła nie są identyczne.");
      return;
    }
    setChanging(true);
    try {
      await api.post("/auth/change-password", {
        current_password: password,
        new_password: newPw,
      });
      // Reload user from /auth/me so AuthContext gets the fresh flag = False
      await refresh();
      const role = pendingUser?.role || "handlowiec";
      setPendingUser(null);
      setNewPw("");
      setNewPw2("");
      setPassword("");
      navigateByRole(role);
    } catch (e: any) {
      setChangeError(formatApiError(e, "Nie udało się zmienić hasła"));
    } finally {
      setChanging(false);
    }
  };

  const quickFill = (em: string) => {
    setEmail(em);
    setPassword("test1234");
  };

  // ─── Inline force-change form ─────────────────────────────────────────────
  if (pendingUser) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.brandWrap}>
              <View style={styles.logoCard}>
                <BrandLogo height={46} testID="login-brand-logo" />
              </View>
              <Text style={styles.tagline}>CRM · Centrum Dowodzenia D2D</Text>
            </View>

            <View style={styles.card}>
              <View style={styles.okRow} testID="force-change-ok-row">
                <Feather name="check-circle" size={16} color={colors.success} />
                <Text style={styles.okText}>Zalogowano jako {pendingUser.email}</Text>
              </View>
              <View style={styles.warnBox}>
                <Feather name="alert-triangle" size={16} color={colors.error} />
                <Text style={styles.warnText}>Musisz zmienić hasło przed kontynuacją.</Text>
              </View>

              <Field
                label="Nowe hasło"
                placeholder="min. 12 znaków, litera + cyfra"
                secureTextEntry
                value={newPw}
                onChangeText={setNewPw}
                testID="force-change-new-password"
              />
              <Field
                label="Powtórz nowe hasło"
                placeholder="••••••••••••"
                secureTextEntry
                value={newPw2}
                onChangeText={setNewPw2}
                testID="force-change-confirm-password"
              />

              {!!changeError && (
                <View style={styles.errBox} testID="force-change-error">
                  <Feather name="alert-triangle" size={14} color={colors.error} />
                  <Text style={styles.errText}>{changeError}</Text>
                </View>
              )}

              <Button
                title="Zmień hasło"
                onPress={handleChangePassword}
                loading={changing}
                testID="force-change-submit-button"
                icon={<Feather name="key" size={18} color="#fff" />}
              />

              <TouchableOpacity
                onPress={() => {
                  setPendingUser(null);
                  setNewPw("");
                  setNewPw2("");
                  setChangeError(null);
                }}
                style={{ marginTop: spacing.md, alignSelf: "center" }}
                testID="force-change-cancel"
              >
                <Text style={styles.cancelLink}>Anuluj i wyloguj się</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.footer}>© 2026 Grupa OZE · wersja MVP</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brandWrap}>
            <View style={styles.logoCard}>
              <BrandLogo height={46} testID="login-brand-logo" />
            </View>
            <Text style={styles.tagline}>CRM · Centrum Dowodzenia D2D</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>Zaloguj się</Text>
            <Text style={styles.subtitle}>Wybierz szybkie konto testowe lub wprowadź dane ręcznie</Text>

            <View style={styles.quickRow}>
              {QUICK_ACCOUNTS.map((a) => (
                <TouchableOpacity
                  key={a.email}
                  style={[styles.quickBtn, { borderColor: a.color }]}
                  onPress={() => quickFill(a.email)}
                  testID={`quick-login-${a.label.toLowerCase()}`}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.quickText, { color: a.color }]}>{a.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Field
              label="E-mail"
              placeholder="nazwa@firma.pl"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              testID="login-email-input"
            />
            <Field
              label="Hasło"
              placeholder="••••••••"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              testID="login-password-input"
            />

            {!!error && (
              <View style={styles.errBox} testID="login-error">
                <Feather name="alert-triangle" size={14} color={colors.error} />
                <Text style={styles.errText}>{error}</Text>
              </View>
            )}

            <Button
              title="Zaloguj"
              onPress={handleLogin}
              loading={loading}
              testID="login-submit-button"
              icon={<Feather name="arrow-right" size={18} color="#fff" />}
            />
          </View>

          <Text style={styles.footer}>© 2026 Grupa OZE · wersja MVP</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, padding: spacing.lg, justifyContent: "center" },
  brandWrap: { alignItems: "center", marginBottom: spacing.xl },
  logoCard: { backgroundColor: colors.paper, paddingHorizontal: 20, paddingVertical: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  brand: { fontSize: 28, fontWeight: "900", letterSpacing: -1, color: colors.textPrimary },
  tagline: { fontSize: 13, color: colors.textSecondary, marginTop: 4, letterSpacing: 0.5 },
  card: { backgroundColor: colors.paper, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 22, fontWeight: "900", color: colors.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.md },
  quickRow: { flexDirection: "row", gap: 8, marginBottom: spacing.md },
  quickBtn: { flex: 1, borderWidth: 1, paddingVertical: 10, borderRadius: radius.md, alignItems: "center" },
  quickText: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fef2f2", padding: 10, borderRadius: radius.md, marginBottom: spacing.md },
  errText: { color: colors.error, fontSize: 13, flex: 1 },
  footer: { textAlign: "center", fontSize: 11, color: colors.textSecondary, marginTop: spacing.lg },
  okRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  okText: { color: colors.success, fontSize: 13, fontWeight: "700" },
  warnBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fef3c7", padding: 12, borderRadius: radius.md, marginBottom: spacing.md },
  warnText: { color: colors.error, fontSize: 13, fontWeight: "700", flex: 1 },
  cancelLink: { color: colors.textSecondary, fontSize: 12, textDecorationLine: "underline" },
});
