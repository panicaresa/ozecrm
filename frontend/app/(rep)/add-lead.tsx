import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Image,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { colors, radius, spacing, statusColor, statusLabel } from "../../src/theme";
import { Button } from "../../src/components/Button";
import { Field } from "../../src/components/Field";
import { api, formatApiError } from "../../src/lib/api";
import { DateTimeField } from "../../src/components/DateTimeField";
import { enqueueLead, isNetworkError } from "../../src/lib/offlineQueue";
import { compressPhoto } from "../../src/lib/imageCompression";
import {
  formatPhoneDisplay,
  normalizePhoneDigits,
  formatZipDisplay,
  normalizeZipDigits,
} from "../../src/lib/inputFormatters";

const STATUSES = ["nowy", "umowione", "decyzja", "podpisana", "nie_zainteresowany"];
const BUILDING_TYPES: { value: "mieszkalny" | "gospodarczy"; label: string }[] = [
  { value: "mieszkalny", label: "Mieszkalny" },
  { value: "gospodarczy", label: "Gospodarczy" },
];

// Sprint 1 — GPS precision thresholds
const GPS_TARGET_ACCURACY_M = 20; // good precision
const GPS_HINT_TIMEOUT_MS = 30_000; // show hint after 30s

export default function AddLead() {
  const router = useRouter();
  const [clientName, setClientName] = useState("");
  // Sprint 5-pre-pent — phone/zip stored as RAW digits internally; display
  // is computed via formatPhoneDisplay/formatZipDisplay. Body to API:
  // phone is sent as raw 9 digits, zip as the formatted "XX-XXX" string.
  const [phoneDigits, setPhoneDigits] = useState("");
  const [zipDigits, setZipDigits] = useState("");
  const [address, setAddress] = useState("");
  const [apartmentNumber, setApartmentNumber] = useState("");
  const [note, setNote] = useState("");
  const [area, setArea] = useState("");
  const [buildingType, setBuildingType] = useState<"mieszkalny" | "gospodarczy">("mieszkalny");
  const [status, setStatus] = useState("nowy");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [meetingAt, setMeetingAt] = useState<Date | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Sprint 5-pre (ISSUE-012): separate loading state for the photo
  // compression step so the user sees "Kompresja zdjęcia…" during the
  // 1-2 s pre-upload work instead of staring at a frozen Save button.
  const [compressing, setCompressing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  // Sprint 1 — GPS precision loop state
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const gpsWatchSubRef = useRef<Location.LocationSubscription | null>(null);
  const gpsHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [gpsHintShown, setGpsHintShown] = useState(false);

  // Sprint 1 — focus hint for apartment field (set after hard-collision alert)
  const [apartmentHighlight, setApartmentHighlight] = useState(false);

  // Cleanup GPS watch subscription when component unmounts
  useEffect(() => {
    return () => {
      try {
        gpsWatchSubRef.current?.remove();
      } catch {}
      if (gpsHintTimerRef.current) clearTimeout(gpsHintTimerRef.current);
    };
  }, []);

  const stopGpsWatch = () => {
    try {
      gpsWatchSubRef.current?.remove();
    } catch {}
    gpsWatchSubRef.current = null;
    if (gpsHintTimerRef.current) {
      clearTimeout(gpsHintTimerRef.current);
      gpsHintTimerRef.current = null;
    }
  };

  const getLocation = async () => {
    // Reset state + restart watch
    stopGpsWatch();
    setGpsHintShown(false);
    setGpsAccuracy(null);
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Brak uprawnień", "Nie udało się pobrać lokalizacji. Udziel uprawnień w ustawieniach.");
        setLocating(false);
        return;
      }
      // Start hint timer
      gpsHintTimerRef.current = setTimeout(() => {
        setGpsHintShown(true);
      }, GPS_HINT_TIMEOUT_MS);

      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Highest,
          timeInterval: 1000,
          distanceInterval: 0,
        },
        (loc) => {
          setLatitude(loc.coords.latitude);
          setLongitude(loc.coords.longitude);
          const acc = typeof loc.coords.accuracy === "number" ? loc.coords.accuracy : null;
          setGpsAccuracy(acc);
          // If we already hit the target, we keep the watch running but
          // user can stop it manually via "Odśwież" / save. It auto-cleans
          // on unmount. No forced stop — GPS can still refine further.
          if (acc != null && acc <= GPS_TARGET_ACCURACY_M) {
            setLocating(false);
          }
        }
      );
      gpsWatchSubRef.current = sub;
    } catch (e: any) {
      Alert.alert("Błąd lokalizacji", e?.message || "Nie udało się pobrać pozycji");
      setLocating(false);
    }
  };

  const takePhoto = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Brak uprawnień", "Kamera niedostępna. Spróbuj wybrać z galerii.");
        return;
      }
      const res = await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true });
      if (!res.canceled && res.assets?.[0]?.base64) {
        setPhoto(`data:image/jpeg;base64,${res.assets[0].base64}`);
      }
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się zrobić zdjęcia");
    }
  };

  const pickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.5, base64: true });
    if (!res.canceled && res.assets?.[0]?.base64) {
      setPhoto(`data:image/jpeg;base64,${res.assets[0].base64}`);
    }
  };

  // Sprint 1.5 — reused idempotency key (same per screen lifecycle)
  const idempotencyKey = useRef<string>(`lead-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  const performSave = async (extra: Record<string, any> = {}) => {
    // Sprint 5-pre (ISSUE-012): compress photo before online POST.
    // Raw camera frames are 4-6 MB base64 — they reliably timed out at 5s.
    // The same compressPhoto helper is used by the offline queue when
    // enqueueing, so we get consistent on-disk and on-wire sizes.
    let compressedPhoto = photo;
    if (photo) {
      try {
        setCompressing(true);
        compressedPhoto = await compressPhoto(photo);
      } catch (err) {
        console.warn("compressPhoto failed, using original photo", err);
        // Fallback: use the original — better to attempt the upload
        // than to fail with no photo (which would 4xx the request).
      } finally {
        setCompressing(false);
      }
    }

    const body: Record<string, any> = {
      client_name: clientName.trim(),
      // Sprint 5-pre-pent — phone stored as raw 9 digits; backend persists
      // the same canonical form so display formatters work consistently.
      phone: phoneDigits.length === 9 ? phoneDigits : null,
      address: address.trim() || null,
      // ZIP stored with hyphen ("80-309") — Polish standard.
      postal_code: zipDigits.length === 5 ? formatZipDisplay(zipDigits) : null,
      apartment_number: apartmentNumber.trim() || null,
      note: note.trim() || null,
      building_area: area ? Number(area.replace(",", ".")) : null,
      building_type: buildingType,
      status,
      latitude,
      longitude,
      photo_base64: compressedPhoto,
      meeting_at: meetingAt ? meetingAt.toISOString() : null,
      ...extra,
    };
    await api.post("/leads", body, {
      headers: { "Idempotency-Key": idempotencyKey.current },
      // Sprint 5-pre (ISSUE-012): 30 s budget for compressed (~200-300 KB)
      // JPEG over average 4G. Was 5 s — guaranteed timeout for any photo.
      timeout: 30000,
    });
    stopGpsWatch();
    router.back();
  };

  const handleCollisionError = (e: any): boolean => {
    // Returns true if we handled the error with a dialog, false if caller should setErr.
    const detail = e?.response?.data?.detail;
    const status = e?.response?.status;
    if (status !== 409 || !detail || typeof detail !== "object") return false;

    if (detail.code === "LEAD_NEARBY_SOFT") {
      Alert.alert(
        "⚠️ Lead w pobliżu",
        `${detail.message}\n\nCzy TO NA PEWNO inny klient?`,
        [
          { text: "Anuluj", style: "cancel" },
          {
            text: "Tak, to inny klient",
            onPress: async () => {
              setBusy(true);
              try {
                await performSave({ confirmed_nearby_duplicate: true });
              } catch (err) {
                setErr(formatApiError(err, "Nie udało się zapisać leada"));
              } finally {
                setBusy(false);
              }
            },
          },
        ]
      );
      return true;
    }

    if (detail.code === "LEAD_DUPLICATE_HARD") {
      Alert.alert(
        "🔴 Lead już istnieje",
        String(detail.message || "Pod tym adresem jest już lead."),
        [
          { text: "Anuluj", style: "cancel" },
          {
            text: "Otwórz istniejący",
            onPress: () => {
              if (detail.existing_lead_id) {
                router.replace(`/(rep)/lead/${detail.existing_lead_id}` as any);
              }
            },
          },
          {
            text: "To inny klient — dodaj nr mieszkania",
            onPress: () => {
              setApartmentHighlight(true);
              // Stay on the screen so user can fill apartment_number and retry save.
            },
          },
        ]
      );
      return true;
    }

    return false;
  };

  const save = async () => {
    setErr(null);
    setApartmentHighlight(false);
    if (!clientName.trim()) {
      setErr("Podaj imię i nazwisko klienta");
      return;
    }
    // Sprint 5-pre-pent — phone/zip masking validation. Both are optional;
    // empty is fine. If user typed a partial value, block save with a
    // clear message so they can fix it before the network roundtrip.
    if (phoneDigits.length > 0 && phoneDigits.length !== 9) {
      Alert.alert(
        "Niepoprawny telefon",
        "Telefon musi mieć dokładnie 9 cyfr (lub być pusty)."
      );
      return;
    }
    if (zipDigits.length > 0 && zipDigits.length !== 5) {
      Alert.alert(
        "Niepoprawny kod pocztowy",
        "Kod pocztowy musi mieć dokładnie 5 cyfr (lub być pusty)."
      );
      return;
    }
    // Faza 2.1 — wymagane zdjęcie
    if (!photo) {
      setErr("Zdjęcie obiektu jest wymagane. Dotknij okno powyżej, aby je dodać.");
      return;
    }
    // Faza 2.1 — meeting_at wymagane dla statusu "umowione"
    if (status === "umowione" && !meetingAt) {
      setErr('Dla statusu „Umówione" ustaw datę i godzinę spotkania.');
      return;
    }
    // Sprint 1 — warn on low GPS accuracy before submitting
    if (
      latitude !== null &&
      longitude !== null &&
      gpsAccuracy !== null &&
      gpsAccuracy > 50
    ) {
      const ok = await new Promise<boolean>((resolve) => {
        Alert.alert(
          "Słaba precyzja GPS",
          `Lokalizacja może być niedokładna (±${Math.round(gpsAccuracy)} m) — system może wykryć duplikat fałszywie. Kontynuować?`,
          [
            { text: "Anuluj", style: "cancel", onPress: () => resolve(false) },
            { text: "Tak, zapisuj", onPress: () => resolve(true) },
          ]
        );
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await performSave();
    } catch (e: any) {
      // Sprint 1.5 — network-level failures fall back to the offline queue.
      // Anti-collision 409s are still handled by handleCollisionError first.
      if (handleCollisionError(e)) {
        // noop — dialog handled
      } else if (isNetworkError(e)) {
        try {
          const body: Record<string, any> = {
            client_name: clientName.trim(),
            // Sprint 5-pre-pent — same canonical phone/zip schema as the
            // online path so the queue replay produces identical records.
            phone: phoneDigits.length === 9 ? phoneDigits : null,
            address: address.trim() || null,
            postal_code: zipDigits.length === 5 ? formatZipDisplay(zipDigits) : null,
            apartment_number: apartmentNumber.trim() || null,
            note: note.trim() || null,
            building_area: area ? Number(area.replace(",", ".")) : null,
            building_type: buildingType,
            status,
            latitude,
            longitude,
            meeting_at: meetingAt ? meetingAt.toISOString() : null,
          };
          await enqueueLead(body, photo);
          stopGpsWatch();
          Alert.alert(
            "📶 Brak zasięgu",
            "Zapisano lokalnie. Wyślę automatycznie gdy wróci połączenie.",
            [{ text: "OK", onPress: () => router.back() }]
          );
        } catch (enqueueErr: any) {
          setErr(formatApiError(enqueueErr, "Nie udało się zapisać leada lokalnie"));
        }
      } else {
        setErr(formatApiError(e, "Nie udało się zapisać leada"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()} testID="back-button">
            <Feather name="arrow-left" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Nowy lead</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
          {/* Photo — REQUIRED */}
          <TouchableOpacity style={[styles.photoBox, !photo && styles.photoBoxRequired]} onPress={takePhoto} testID="take-photo-button" activeOpacity={0.8}>
            {photo ? (
              <Image source={{ uri: photo }} style={styles.photoImg} />
            ) : (
              <View style={{ alignItems: "center", gap: 6 }}>
                <Feather name="camera" size={28} color={colors.error} />
                <Text style={[styles.photoText, { color: colors.error, fontWeight: "800" }]}>📸 Zdjęcie obiektu (wymagane)</Text>
                <Text style={styles.photoText}>Dotknij, aby zrobić zdjęcie</Text>
                <TouchableOpacity onPress={pickImage}><Text style={styles.linkText}>lub wybierz z galerii</Text></TouchableOpacity>
              </View>
            )}
          </TouchableOpacity>

          <Field label="Klient" placeholder="Imię i nazwisko" value={clientName} onChangeText={setClientName} testID="lead-name-input" />
          {/* Sprint 5-pre-pent — phone with input masking (XXX-XXX-XXX), state
              keeps raw 9 digits; maxLength=11 includes the 2 hyphens. */}
          <Field
            label="Telefon"
            placeholder="500-100-200"
            value={formatPhoneDisplay(phoneDigits)}
            onChangeText={(v) => setPhoneDigits(normalizePhoneDigits(v))}
            keyboardType="phone-pad"
            maxLength={11}
            testID="lead-phone-input"
          />
          <Field label="Adres" placeholder="Ulica, miasto" value={address} onChangeText={setAddress} testID="lead-address-input" />
          {/* Sprint 5-pre-pent — postal code with input masking (XX-XXX) and
              numeric keyboard; maxLength=6 includes the hyphen. */}
          <Field
            label="Kod pocztowy"
            placeholder="80-309"
            value={formatZipDisplay(zipDigits)}
            onChangeText={(v) => setZipDigits(normalizeZipDigits(v))}
            keyboardType="number-pad"
            maxLength={6}
            testID="lead-zip-input"
          />
          <View style={apartmentHighlight ? styles.apartmentHighlight : undefined}>
            <Field
              label="Numer mieszkania / klatki (opcjonalne)"
              placeholder="np. 12A, m. 5, klatka II"
              value={apartmentNumber}
              onChangeText={(v) => {
                setApartmentNumber(v);
                if (apartmentHighlight) setApartmentHighlight(false);
              }}
              testID="lead-apartment-input"
            />
            <Text style={styles.apartmentHint}>Dla kamienic, bloków i budynków wielorodzinnych</Text>
          </View>

          <Text style={styles.sectionLabel}>Obiekt</Text>
          <View style={styles.pills}>
            {BUILDING_TYPES.map((t) => (
              <TouchableOpacity
                key={t.value}
                style={[styles.pill, buildingType === t.value && styles.pillActive]}
                onPress={() => setBuildingType(t.value)}
                testID={`building-type-${t.value}`}
              >
                <Text style={[styles.pillText, buildingType === t.value && styles.pillTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Field label="Metraż (m²)" placeholder="180" keyboardType="decimal-pad" value={area} onChangeText={setArea} testID="lead-area-input" />

          <Text style={styles.sectionLabel}>Status</Text>
          <View style={styles.pills}>
            {STATUSES.map((s) => {
              const active = status === s;
              const sc = statusColor[s];
              return (
                <TouchableOpacity
                  key={s}
                  style={[styles.pill, active && { backgroundColor: sc, borderColor: sc }]}
                  onPress={() => setStatus(s)}
                  testID={`status-${s}`}
                >
                  <Text style={[styles.pillText, active && { color: "#fff" }]}>{statusLabel[s]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {status === "umowione" && (
            <View style={styles.meetingBlock}>
              <Text style={styles.sectionLabel}>Termin spotkania *</Text>
              <DateTimeField
                value={meetingAt}
                onChange={setMeetingAt}
                mode="datetime"
                placeholder="Wybierz datę i godzinę"
                testID="meeting-at-field"
              />
            </View>
          )}

          <Field
            label="Notatka"
            placeholder="Wrażenia ze spotkania / ustalenia"
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={3}
            testID="lead-note-input"
            style={{ height: 80, textAlignVertical: "top" }}
          />

          {/* GPS widget — Sprint 1 with precision loop */}
          {(() => {
            const hasCoords = latitude !== null && longitude !== null;
            const acc = gpsAccuracy;
            const isGood = acc != null && acc <= GPS_TARGET_ACCURACY_M;
            const isWeak = acc != null && acc > GPS_TARGET_ACCURACY_M;
            const showHint = gpsHintShown && isWeak;
            let label = "📍 Pobierz lokalizację";
            if (locating && !hasCoords) label = "📍 Pobieranie GPS...";
            else if (hasCoords) label = "📍 Lokalizacja GPS";

            return (
              <View style={[styles.gpsCard, isGood && styles.gpsCardGood, isWeak && styles.gpsCardWeak]} testID="gps-widget">
                <View style={styles.gpsRow}>
                  <Feather
                    name={isGood ? "check-circle" : "map-pin"}
                    size={18}
                    color={isGood ? colors.success : isWeak ? colors.error : colors.secondary}
                  />
                  <Text style={styles.gpsTitle}>{label}</Text>
                  {locating && !isGood && <ActivityIndicator size="small" color={colors.secondary} />}
                </View>
                {hasCoords && (
                  <Text style={styles.gpsCoords} testID="gps-coords">
                    {latitude!.toFixed(5)}, {longitude!.toFixed(5)}
                  </Text>
                )}
                {acc != null && (
                  <Text
                    style={[
                      styles.gpsAcc,
                      isGood && { color: colors.success },
                      isWeak && { color: colors.error, fontWeight: "800" },
                    ]}
                    testID="gps-accuracy"
                  >
                    {isGood
                      ? `±${Math.round(acc)} m (dobra precyzja) ✓`
                      : `±${Math.round(acc)} m ${locating ? "(czekamy na <20 m)" : "(słaba precyzja ⚠️)"}`}
                  </Text>
                )}
                {showHint && (
                  <Text style={styles.gpsHint}>
                    💡 Spróbuj wyjść z budynku lub podejść bliżej ulicy. GPS potrzebuje otwartego nieba.
                  </Text>
                )}
                <View style={styles.gpsActions}>
                  <TouchableOpacity onPress={getLocation} style={styles.gpsBtn} testID="gps-refresh-button">
                    <Feather name="refresh-cw" size={14} color={colors.secondary} />
                    <Text style={styles.gpsBtnText}>Odśwież</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })()}

          {!!err && <Text style={{ color: colors.error, marginTop: 8 }}>{err}</Text>}
        </ScrollView>

        <View style={styles.footer}>
          <Button title="Zapisz lead" onPress={save} loading={busy} testID="save-lead-button" icon={<Feather name="save" size={18} color="#fff" />} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: spacing.md },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 20, fontWeight: "900", color: colors.textPrimary },
  photoBox: { height: 180, borderRadius: radius.lg, borderWidth: 2, borderStyle: "dashed", borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.paper, marginBottom: spacing.md, overflow: "hidden" },
  photoBoxRequired: { borderColor: colors.error, backgroundColor: "#FEF2F2" },
  meetingBlock: { marginBottom: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, backgroundColor: `${colors.primary}08` },
  photoImg: { width: "100%", height: "100%" },
  photoText: { color: colors.textSecondary, fontSize: 13 },
  linkText: { color: colors.secondary, fontWeight: "700", fontSize: 12, textDecorationLine: "underline" },
  sectionLabel: { fontSize: 13, fontWeight: "700", color: colors.textPrimary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: spacing.md },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.paper },
  pillActive: { backgroundColor: colors.inverted, borderColor: colors.inverted },
  pillText: { fontSize: 12, fontWeight: "700", color: colors.textPrimary },
  pillTextActive: { color: "#fff" },
  geoBox: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: colors.paper, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginTop: 8 },
  geoTitle: { fontWeight: "700", color: colors.textPrimary, fontSize: 14 },
  geoCoords: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  // Sprint 1 — GPS widget
  gpsCard: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.paper, marginTop: 8 },
  gpsCardGood: { borderColor: colors.success, backgroundColor: "#ECFDF5" },
  gpsCardWeak: { borderColor: colors.error, backgroundColor: "#FEF2F2" },
  gpsRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  gpsTitle: { fontWeight: "800", color: colors.textPrimary, fontSize: 14, flex: 1 },
  gpsCoords: { color: colors.textPrimary, fontSize: 13, fontWeight: "700", marginBottom: 2 },
  gpsAcc: { color: colors.textSecondary, fontSize: 12, marginBottom: 4 },
  gpsHint: { color: colors.textPrimary, fontSize: 12, marginTop: 6, lineHeight: 17 },
  gpsActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  gpsBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  gpsBtnText: { color: colors.secondary, fontSize: 12, fontWeight: "700" },
  // Sprint 1 — apartment_number highlight (pokaże się po hard-collision alert)
  apartmentHighlight: { borderWidth: 2, borderColor: colors.primary, borderRadius: radius.md, padding: 6, marginBottom: 4 },
  apartmentHint: { color: colors.textSecondary, fontSize: 11, marginTop: -8, marginBottom: 12, marginLeft: 2 },
  footer: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.paper },
});
