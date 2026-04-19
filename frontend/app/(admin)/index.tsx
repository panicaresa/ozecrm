import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, radius, spacing } from "../../src/theme";
import { useAuth } from "../../src/lib/auth";
import { BrandLogo } from "../../src/components/BrandLogo";
import { CommissionCalculator } from "../../src/components/CommissionCalculator";

export default function AdminHome() {
  const router = useRouter();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  const tiles = [
    { title: "Finanse firmy", icon: "dollar-sign" as const, href: "/(admin)/finance", desc: "Obrót, marża, prowizje" },
    { title: "Ustawienia globalne", icon: "sliders" as const, href: "/(admin)/settings", desc: "Ceny bazowe, RRSO, kody" },
    { title: "Użytkownicy", icon: "users" as const, href: "/(admin)/users", desc: "Handlowcy i managerowie" },
    { title: "Centrum Dowodzenia", icon: "activity" as const, href: "/(manager)", desc: "Widok managera" },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topbar}>
        <BrandLogo height={28} testID="admin-brand-logo" />
        <TouchableOpacity style={styles.iconBtn} onPress={handleLogout} testID="logout-button">
          <Feather name="log-out" size={18} color={colors.textInverse} />
        </TouchableOpacity>
      </View>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.hello}>Panel administratora</Text>
          <Text style={styles.sub}>{user?.email}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: 12 }}>
        <CommissionCalculator testID="admin-commission-calculator" />
        {tiles.map((t) => (
          <TouchableOpacity
            key={t.title}
            style={styles.tile}
            activeOpacity={0.8}
            onPress={() => router.push(t.href as any)}
            testID={`admin-tile-${t.title.replace(/\s+/g, "-").toLowerCase()}`}
          >
            <View style={styles.tileIcon}>
              <Feather name={t.icon} size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.tileTitle}>{t.title}</Text>
              <Text style={styles.tileDesc}>{t.desc}</Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  header: { flexDirection: "row", alignItems: "center", padding: spacing.md, paddingTop: 4 },
  hello: { fontSize: 22, fontWeight: "900", color: colors.textPrimary },
  sub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.inverted, alignItems: "center", justifyContent: "center" },
  tile: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.paper, padding: 16, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  tileIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: `${colors.primary}15`, alignItems: "center", justifyContent: "center" },
  tileTitle: { fontSize: 16, fontWeight: "800", color: colors.textPrimary },
  tileDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
});
