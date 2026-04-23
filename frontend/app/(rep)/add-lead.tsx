import React, { useState } from "react";
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

const STATUSES = ["nowy", "umowione", "decyzja", "podpisana", "nie_zainteresowany"];
const BUILDING_TYPES: { value: "mieszkalny" | "gospodarczy"; label: string }[] = [
  { value: "mieszkalny", label: "Mieszkalny" },
  { value: "gospodarczy", label: "Gospodarczy" },
];

export default function AddLead() {
  const router = useRouter();
  const [clientName, setClientName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [zip, setZip] = useState("");
  const [note, setNote] = useState("");
  const [area, setArea] = useState("");
  const [buildingType, setBuildingType] = useState<"mieszkalny" | "gospodarczy">("mieszkalny");
  const [status, setStatus] = useState("nowy");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [meetingAt, setMeetingAt] = useState<Date | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const getLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Brak uprawnień", "Nie udało się pobrać lokalizacji. Udziel uprawnień w ustawieniach.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      setLatitude(loc.coords.latitude);
      setLongitude(loc.coords.longitude);
    } catch (e: any) {
      Alert.alert("Błąd lokalizacji", e?.message || "Nie udało się pobrać pozycji");
    } finally {
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

  const save = async () => {
    setErr(null);
    if (!clientName.trim()) {
      setErr("Podaj imię i nazwisko klienta");
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
    setBusy(true);
    try {
      await api.post("/leads", {
        client_name: clientName.trim(),
        phone: phone.trim() || null,
        address: address.trim() || null,
        postal_code: zip.trim() || null,
        note: note.trim() || null,
        building_area: area ? Number(area.replace(",", ".")) : null,
        building_type: buildingType,
        status,
        latitude,
        longitude,
        photo_base64: photo,
        meeting_at: meetingAt ? meetingAt.toISOString() : null,
      });
      router.back();
    } catch (e) {
      setErr(formatApiError(e, "Nie udało się zapisać leada"));
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
          <Field label="Telefon" placeholder="+48 ..." value={phone} onChangeText={setPhone} keyboardType="phone-pad" testID="lead-phone-input" />
          <Field label="Adres" placeholder="Ulica, miasto" value={address} onChangeText={setAddress} testID="lead-address-input" />
          <Field label="Kod pocztowy" placeholder="00-000" value={zip} onChangeText={setZip} testID="lead-zip-input" />

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

          {/* Geotag */}
          <TouchableOpacity style={styles.geoBox} onPress={getLocation} testID="geotag-button" activeOpacity={0.8}>
            <Feather name={latitude ? "check-circle" : "map-pin"} size={18} color={latitude ? colors.success : colors.secondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.geoTitle}>
                {latitude ? "Geotag zapisany" : locating ? "Pobieranie..." : "Pobierz lokalizację"}
              </Text>
              {latitude !== null && longitude !== null && (
                <Text style={styles.geoCoords}>{latitude.toFixed(5)}, {longitude.toFixed(5)}</Text>
              )}
            </View>
          </TouchableOpacity>

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
  footer: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.paper },
});
