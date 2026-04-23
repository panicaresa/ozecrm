import React, { useEffect } from "react";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../src/lib/auth";
// Register background location task at module load (Faza 2.0)
import "../src/lib/backgroundTracking";
// Sprint 1.5 — offline queue auto-sync
import { startAutoSync } from "../src/lib/offlineQueue";

export default function RootLayout() {
  useEffect(() => {
    const stop = startAutoSync();
    return stop;
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="(admin)" />
          <Stack.Screen name="(manager)" />
          <Stack.Screen name="(rep)" />
          <Stack.Screen name="sync-status" />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
