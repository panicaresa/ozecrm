import React, { useEffect } from "react";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
// Sprint 3.5c micro: wraps the whole app — required by Swipeable / PanGestureHandler
// used by FilterableList and DrillDownableSection modals. Must be the outermost
// parent of the stack or PanGestureHandler throws "must be a descendant of
// GestureHandlerRootView" on certain routes after router.push.
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AuthProvider } from "../src/lib/auth";
// Register background location task at module load (Faza 2.0)
import "../src/lib/backgroundTracking";
// Sprint 1.5 — offline queue auto-sync
import { startAutoSync } from "../src/lib/offlineQueue";
// Sprint 3a — global app events (contract_signed → confetti)
import { useAppEventsWS } from "../src/lib/useAppEventsWS";
import { ConfettiHost } from "../src/components/ConfettiHost";

// Thin host that owns the singleton WS connection for app events.
// Kept as a separate component so the hook lifecycle is stable even if
// RootLayout re-renders for other reasons.
function AppEventsManager() {
  useAppEventsWS();
  return null;
}

export default function RootLayout() {
  useEffect(() => {
    const stop = startAutoSync();
    return stop;
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <AppEventsManager />
          <ConfettiHost />
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
    </GestureHandlerRootView>
  );
}
