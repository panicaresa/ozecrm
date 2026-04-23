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
  Image,
  Modal,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { api, formatApiError } from "../lib/api";
import { colors, radius, spacing, statusColor, statusLabel } from "../theme";
import { Field } from "./Field";
import { Button } from "./Button";
import { Lead } from "./LeadCard";
import { DateTimeField } from "./DateTimeField";

const STATUSES = ["nowy", "umowione", "decyzja", "podpisana", "nie_zainteresowany"];

interface DocMeta {
  id: string;
  type: "umowa" | "photo" | "other";
  filename?: string;
  mime?: string;
  uploaded_at?: string;
}

export const LeadDetailScreen: React.FC<{ leadId: string; backLabel?: string }> = ({ leadId }) => {
  const router = useRouter();
  const [lead, setLead] = useState<Lead | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<{ id: string; mime: string; data: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [meetingAt, setMeetingAt] = useState<string>("");
  const [savingMeeting, setSavingMeeting] = useState(false);

  const loadLead = useCallback(async () => {
    try {
      const res = await api.get<Lead[]>("/leads");
      const found = res.data.find((l) => l.id === leadId) as any;
      if (found) {
        setLead(found);
        setNote(found.note || "");
        if (found.meeting_at) setMeetingAt(String(found.meeting_at).slice(0, 16));
      } else {
        setErr("Lead nie został znaleziony");
      }
    } catch (e) {
      setErr(formatApiError(e));
    }
  }, [leadId]);

  const loadDocs = useCallback(async () => {
    try {
      const res = await api.get<DocMeta[]>(`/leads/${leadId}/documents`);
      setDocs(res.data || []);
    } catch {
      /* non-fatal */
    }
  }, [leadId]);

  useEffect(() => {
    (async () => {
      await Promise.all([loadLead(), loadDocs()]);
      setLoading(false);
    })();
  }, [loadLead, loadDocs]);

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

  const saveMeeting = async () => {
    if (!lead) return;
    setSavingMeeting(true);
    try {
      let iso: string | null = null;
      const mText = (meetingAt || "").trim();
      if (mText.length >= 10) {
        const s = mText.includes("T") ? mText : `${mText}T09:00`;
        const d = new Date(s);
        if (isNaN(d.getTime())) {
          Alert.alert("Zły format", "Użyj formatu YYYY-MM-DDTHH:mm, np. 2026-04-25T14:30");
          setSavingMeeting(false);
          return;
        }
        iso = d.toISOString();
      }
      const res = await api.patch(`/leads/${lead.id}`, { meeting_at: iso });
      setLead(res.data);
      Alert.alert("Zapisano", iso ? "Data spotkania ustawiona — pojawi się w Kalendarzu." : "Data spotkania usunięta.");
    } catch (e) {
      Alert.alert("Błąd", formatApiError(e));
    } finally {
      setSavingMeeting(false);
    }
  };

  // Bezpieczne formatowanie daty spotkania do wyświetlenia
  const meetingDisplay = React.useMemo(() => {
    const raw = lead?.meeting_at;
    if (!raw) return null;
    try {
      const d = new Date(raw);
      if (isNaN(d.getTime())) return null;
      return d.toLocaleString("pl-PL", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    } catch {
      return null;
    }
  }, [lead?.meeting_at]);

  const uploadDocument = async (type: "umowa" | "photo", data_base64: string, filename: string, mime: string) => {
    setUploading(type);
    try {
      await api.post(`/leads/${leadId}/documents`, { type, data_base64, filename, mime });
      await loadDocs();
      // Po wgraniu skanu UMOWY → natychmiastowe przekierowanie na formularz danych finansowych.
      if (type === "umowa" && lead) {
        router.push({
          pathname: "/(rep)/add-contract",
          params: {
            leadId: lead.id,
            clientName: lead.client_name,
            area: lead.building_area ? String(lead.building_area) : "",
            buildingType: lead.building_type || "mieszkalny",
          },
        } as any);
      }
    } catch (e) {
      Alert.alert("Błąd przesyłania", formatApiError(e));
    } finally {
      setUploading(null);
    }
  };

  const takePhotoAndUpload = async (type: "photo" | "umowa") => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Brak uprawnień", "Nie można uruchomić kamery.");
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true });
    if (!res.canceled && res.assets?.[0]?.base64) {
      const a = res.assets[0];
      await uploadDocument(
        type,
        a.base64!,
        a.fileName || `${type}-${Date.now()}.jpg`,
        a.mimeType || "image/jpeg"
      );
    }
  };

  const pickImageAndUpload = async (type: "photo" | "umowa") => {
    const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.5, base64: true });
    if (!res.canceled && res.assets?.[0]?.base64) {
      const a = res.assets[0];
      await uploadDocument(
        type,
        a.base64!,
        a.fileName || `${type}-${Date.now()}.jpg`,
        a.mimeType || "image/jpeg"
      );
    }
  };

  const pickDocumentAndUpload = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/*"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      // Read file as base64
      let base64: string | null = null;
      if (Platform.OS === "web") {
        const resp = await fetch(a.uri);
        const blob = await resp.blob();
        base64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve((r.result as string).split(",")[1] || "");
          r.onerror = () => reject(r.error);
          r.readAsDataURL(blob);
        });
      } else {
        const FS = require("expo-file-system");
        base64 = await FS.readAsStringAsync(a.uri, { encoding: FS.EncodingType.Base64 });
      }
      if (!base64) return;
      await uploadDocument("umowa", base64, a.name || "umowa.pdf", a.mimeType || "application/pdf");
    } catch (e: any) {
      Alert.alert("Błąd", e?.message || "Nie udało się wybrać pliku");
    }
  };

  const openPreview = async (doc: DocMeta) => {
    setPreviewLoading(true);
    try {
      const res = await api.get(`/leads/${leadId}/documents/${doc.id}`);
      const body = res.data as any;
      setPreviewDoc({ id: doc.id, mime: body.mime || "image/jpeg", data: body.data_base64 });
    } catch (e) {
      Alert.alert("Błąd", formatApiError(e));
    } finally {
      setPreviewLoading(false);
    }
  };

  const deleteDoc = (doc: DocMeta) => {
    Alert.alert("Usunąć dokument?", doc.filename || doc.id.slice(0, 8), [
      { text: "Anuluj" },
      {
        text: "Usuń",
        style: "destructive",
        onPress: async () => {
          try {
            await api.delete(`/leads/${leadId}/documents/${doc.id}`);
            await loadDocs();
          } catch (e) {
            Alert.alert("Błąd", formatApiError(e));
          }
        },
      },
    ]);
  };

  const offerUmowaPicker = () =>
    Alert.alert("Skan umowy", "Wybierz źródło dokumentu", [
      { text: "Anuluj", style: "cancel" },
      { text: "Zrób zdjęcie", onPress: () => takePhotoAndUpload("umowa") },
      { text: "Wybierz plik (PDF)", onPress: pickDocumentAndUpload },
      { text: "Wybierz z galerii", onPress: () => pickImageAndUpload("umowa") },
    ]);

  const offerPhotoPicker = () =>
    Alert.alert("Zdjęcie obiektu", "Wybierz źródło", [
      { text: "Anuluj", style: "cancel" },
      { text: "Zrób zdjęcie", onPress: () => takePhotoAndUpload("photo") },
      { text: "Wybierz z galerii", onPress: () => pickImageAndUpload("photo") },
    ]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}><ActivityIndicator color={colors.primary} /></View>
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
  const umowy = docs.filter((d) => d.type === "umowa");
  const gallery = docs.filter((d) => d.type === "photo");

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
            {!!lead.phone && (<View style={styles.row}><Feather name="phone" size={14} color={colors.textSecondary} /><Text style={styles.rowText}>{lead.phone}</Text></View>)}
            {!!lead.address && (<View style={styles.row}><Feather name="map-pin" size={14} color={colors.textSecondary} /><Text style={styles.rowText}>{lead.address}</Text></View>)}
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
                  style={[styles.chip, active && { backgroundColor: c, borderColor: c }, !active && { borderColor: colors.border }]}
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

          {/* Meeting date — visible when status is umowione */}
          {lead.status === "umowione" && (
            <View style={styles.meetingBox} testID="meeting-box">
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <Feather name="calendar" size={14} color={colors.primary} />
                <Text style={{ fontSize: 13, fontWeight: "900", color: colors.textPrimary }}>
                  Data i godzina spotkania
                </Text>
              </View>
              {meetingDisplay ? (
                <View style={styles.meetingCurrent}>
                  <Feather name="check-circle" size={14} color={colors.secondary} />
                  <Text style={styles.meetingCurrentText} numberOfLines={1}>
                    Aktualnie: {meetingDisplay}
                  </Text>
                </View>
              ) : (
                <Text style={styles.meetingMissing}>⏰ Brak daty — ustaw termin spotkania poniżej</Text>
              )}
              <Text style={styles.hintSmall}>Wybierz datę i godzinę w kalendarzu poniżej.</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <View style={{ flex: 1 }}>
                  <DateTimeField
                    value={(() => {
                      if (!meetingAt || meetingAt.length < 10) return null;
                      const s = meetingAt.includes("T") ? meetingAt : `${meetingAt}T09:00`;
                      const d = new Date(s);
                      return isNaN(d.getTime()) ? null : d;
                    })()}
                    onChange={(d) => setMeetingAt(d ? d.toISOString().slice(0, 16) : "")}
                    mode="datetime"
                    placeholder="Wybierz datę i godzinę"
                    testID="meeting-input"
                  />
                </View>
                <TouchableOpacity
                  style={styles.meetingSave}
                  onPress={saveMeeting}
                  disabled={savingMeeting}
                  testID="save-meeting-button"
                  activeOpacity={0.85}
                >
                  {savingMeeting ? <ActivityIndicator color="#fff" /> : <Feather name="check" size={16} color="#fff" />}
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                {[
                  { label: "Dziś 14:00", offset: 0, hh: "14:00" },
                  { label: "Jutro 10:00", offset: 1, hh: "10:00" },
                  { label: "Za 3 dni 16:00", offset: 3, hh: "16:00" },
                ].map((o) => (
                  <TouchableOpacity
                    key={o.label}
                    style={styles.quickMeetingChip}
                    onPress={() => {
                      const d = new Date();
                      d.setDate(d.getDate() + o.offset);
                      setMeetingAt(`${d.toISOString().slice(0, 10)}T${o.hh}`);
                    }}
                  >
                    <Text style={styles.quickMeetingText}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* CTA: Dodaj umowę — visible when status is podpisana or decyzja */}
          {(lead.status === "podpisana" || lead.status === "decyzja" || lead.status === "umowione") && (
            <TouchableOpacity
              style={styles.contractCta}
              activeOpacity={0.85}
              onPress={() => router.push({
                pathname: "/(rep)/add-contract",
                params: {
                  leadId: lead.id,
                  clientName: lead.client_name,
                  area: lead.building_area ? String(lead.building_area) : "",
                  buildingType: lead.building_type || "mieszkalny",
                },
              } as any)}
              testID="add-contract-button"
            >
              <Feather name="file-plus" size={18} color="#fff" />
              <View style={{ flex: 1 }}>
                <Text style={styles.contractCtaTitle}>Dodaj umowę z danymi finansowymi</Text>
                <Text style={styles.contractCtaSub}>Cena brutto, marża, finansowanie → zasili moduł Finanse</Text>
              </View>
              <Feather name="chevron-right" size={18} color="#fff" />
            </TouchableOpacity>
          )}

          {/* Dokumentacja */}
          <Text style={styles.section}>Dokumentacja</Text>

          <View style={styles.docBlock}>
            <View style={styles.docBlockHead}>
              <Feather name="file-text" size={16} color={colors.primary} />
              <Text style={styles.docBlockTitle}>Skan umowy</Text>
              <Text style={styles.docCount}>{umowy.length}</Text>
            </View>
            {umowy.length === 0 ? (
              <Text style={styles.empty}>Brak wgranego skanu</Text>
            ) : (
              umowy.map((d) => (
                <View style={styles.docRow} key={d.id} testID={`doc-umowa-${d.id}`}>
                  <Feather name={d.mime?.includes("pdf") ? "file" : "image"} size={18} color={colors.secondary} />
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => openPreview(d)}>
                    <Text style={styles.docName} numberOfLines={1}>{d.filename || "Umowa"}</Text>
                    <Text style={styles.docMeta}>{d.mime}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => deleteDoc(d)} testID={`delete-doc-${d.id}`}>
                    <Feather name="trash-2" size={16} color={colors.error} />
                  </TouchableOpacity>
                </View>
              ))
            )}
            <TouchableOpacity
              style={styles.uploadBtn}
              activeOpacity={0.8}
              onPress={offerUmowaPicker}
              disabled={uploading !== null}
              testID="upload-umowa-button"
            >
              {uploading === "umowa" ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <>
                  <Feather name="upload" size={16} color={colors.primary} />
                  <Text style={styles.uploadText}>Wgraj skan umowy (PDF / zdjęcie)</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.docBlock}>
            <View style={styles.docBlockHead}>
              <Feather name="image" size={16} color={colors.primary} />
              <Text style={styles.docBlockTitle}>Galeria obiektu</Text>
              <Text style={styles.docCount}>{gallery.length}</Text>
            </View>
            {gallery.length === 0 ? (
              <Text style={styles.empty}>Brak zdjęć</Text>
            ) : (
              <View style={styles.galleryGrid}>
                {gallery.map((d) => (
                  <TouchableOpacity key={d.id} style={styles.galleryTile} onPress={() => openPreview(d)} testID={`gallery-tile-${d.id}`}>
                    <View style={styles.galleryThumb}>
                      <Feather name="image" size={24} color={colors.textInverseSecondary} />
                      <Text style={styles.galleryName} numberOfLines={1}>{d.filename?.slice(0, 16) || "Foto"}</Text>
                    </View>
                    <TouchableOpacity style={styles.galleryDelete} onPress={() => deleteDoc(d)}>
                      <Feather name="x" size={12} color="#fff" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <TouchableOpacity
              style={styles.uploadBtn}
              activeOpacity={0.8}
              onPress={offerPhotoPicker}
              disabled={uploading !== null}
              testID="upload-photo-button"
            >
              {uploading === "photo" ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <>
                  <Feather name="camera" size={16} color={colors.primary} />
                  <Text style={styles.uploadText}>Dodaj zdjęcie obiektu</Text>
                </>
              )}
            </TouchableOpacity>
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
          <Button title="Zapisz notatkę" onPress={saveNote} loading={savingNote} icon={<Feather name="save" size={18} color="#fff" />} testID="save-note-button" />
        </ScrollView>

        {/* Preview modal */}
        <Modal visible={!!previewDoc || previewLoading} transparent animationType="fade" onRequestClose={() => setPreviewDoc(null)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHead}>
                <Text style={styles.modalTitle}>Podgląd dokumentu</Text>
                <TouchableOpacity onPress={() => setPreviewDoc(null)} testID="close-preview">
                  <Feather name="x" size={22} color={colors.textInverse} />
                </TouchableOpacity>
              </View>
              {previewLoading && <ActivityIndicator color={colors.primary} style={{ marginVertical: 40 }} />}
              {previewDoc && previewDoc.mime?.startsWith("image") && (
                <Image
                  source={{ uri: `data:${previewDoc.mime};base64,${previewDoc.data}` }}
                  style={{ width: "100%", height: 500 }}
                  resizeMode="contain"
                />
              )}
              {previewDoc && !previewDoc.mime?.startsWith("image") && (
                <View style={styles.pdfPreview}>
                  <Feather name="file" size={48} color={colors.textInverseSecondary} />
                  <Text style={{ color: "#fff", marginTop: 8, textAlign: "center" }}>
                    Plik ({previewDoc.mime})
                  </Text>
                  <Text style={{ color: colors.textInverseSecondary, fontSize: 11, marginTop: 4, textAlign: "center" }}>
                    Pełny podgląd PDF dostępny w aplikacji mobilnej (Expo Go)
                  </Text>
                </View>
              )}
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
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
  docBlock: { backgroundColor: colors.paper, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, marginBottom: 16 },
  docBlockHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  docBlockTitle: { flex: 1, fontSize: 15, fontWeight: "800", color: colors.textPrimary },
  docCount: { fontSize: 11, color: colors.textSecondary, fontWeight: "700", backgroundColor: colors.zinc100, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  empty: { color: colors.textSecondary, fontSize: 12, fontStyle: "italic", marginBottom: 8 },
  meetingBox: { backgroundColor: colors.paper, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.primary, marginBottom: 16 },
  meetingCurrent: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.md, backgroundColor: `${colors.secondary}15`, marginBottom: 8 },
  meetingCurrentText: { color: colors.secondary, fontWeight: "800", fontSize: 12, flex: 1 },
  meetingMissing: { color: colors.textSecondary, fontSize: 12, marginBottom: 8, fontStyle: "italic" },
  hintSmall: { fontSize: 11, color: colors.textSecondary, lineHeight: 15 },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: colors.bg },
  meetingSave: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  quickMeetingChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  quickMeetingText: { fontSize: 11, color: colors.textPrimary, fontWeight: "700" },
  contractCta: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.secondary, paddingHorizontal: 14, paddingVertical: 14, borderRadius: radius.md, marginBottom: 16 },
  contractCtaTitle: { color: "#fff", fontSize: 14, fontWeight: "900" },
  contractCtaSub: { color: "#DCFCE7", fontSize: 11, marginTop: 2, fontWeight: "600" },

  docRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: colors.bg, borderRadius: radius.md, marginBottom: 6 },
  docName: { color: colors.textPrimary, fontSize: 13, fontWeight: "700" },
  docMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  uploadBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.primary, marginTop: 6 },
  uploadText: { color: colors.primary, fontWeight: "700", fontSize: 13 },
  galleryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  galleryTile: { width: "30%", aspectRatio: 1, position: "relative" },
  galleryThumb: { flex: 1, backgroundColor: colors.inverted, borderRadius: radius.md, alignItems: "center", justifyContent: "center", padding: 6, gap: 4 },
  galleryName: { color: colors.textInverseSecondary, fontSize: 9 },
  galleryDelete: { position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.error, alignItems: "center", justifyContent: "center" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center", padding: 16 },
  modalCard: { width: "100%", maxWidth: 600, backgroundColor: colors.inverted, borderRadius: radius.lg, overflow: "hidden" },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, borderBottomWidth: 1, borderBottomColor: colors.borderDark },
  modalTitle: { color: "#fff", fontWeight: "800", fontSize: 14 },
  pdfPreview: { padding: 40, alignItems: "center" },
});
