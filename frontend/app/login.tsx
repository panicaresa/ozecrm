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
import { useAuth } from "../src/lib/auth";
import { colors, spacing, radius } from "../src/theme";
import { Button } from "../src/components/Button";
import { Field } from "../src/components/Field";
import { formatApiError } from "../src/lib/api";

const QUICK_ACCOUNTS: { label: string; email: string; color: string }[] = [
  { label: "Admin", email: "admin@test.com", color: colors.inverted },
  { label: "Manager", email: "manager@test.com", color: colors.secondary },
  { label: "Handlowiec", email: "handlowiec@test.com", color: colors.primary },
];

export default function Login() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError("Wprowadź e-mail i hasło");
      return;
    }
    setLoading(true);
    try {
      const u = await login(email.trim().toLowerCase(), password);
      if (u.role === "admin") router.replace("/(admin)");
      else if (u.role === "manager") router.replace("/(manager)");
      else router.replace("/(rep)");
    } catch (e: any) {
      setError(formatApiError(e, "Nie udało się zalogować"));
    } finally {
      setLoading(false);
    }
  };

  const quickFill = (em: string) => {
    setEmail(em);
    setPassword("test1234");
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brandWrap}>
            <View style={styles.logoCircle}>
              <Feather name="sun" size={34} color={colors.primary} />
            </View>
            <Text style={styles.brand}>GRUPA OZE</Text>
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
  logoCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.inverted, alignItems: "center", justifyContent: "center", marginBottom: 12 },
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
});
