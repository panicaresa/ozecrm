// Brand palette — derived from Grupa OZE logo (blue→green gradient, black wordmark)
export const colors = {
  bg: "#F4F6F9",
  paper: "#FFFFFF",
  inverted: "#0B2545", // deep navy — primary dark surface
  invertedAlt: "#0F1F3D",
  primary: "#30A0E3", // brand blue
  primaryHover: "#1F87C6",
  secondary: "#84D13C", // brand green
  secondaryHover: "#6EB52A",
  accent: "#F59E0B", // amber accent reserved for warnings
  success: "#84D13C",
  warning: "#F59E0B",
  error: "#EF4444",
  info: "#30A0E3",
  textPrimary: "#0B1220",
  textSecondary: "#64748B",
  textInverse: "#FFFFFF",
  textInverseSecondary: "#B6C5DB",
  border: "#E2E8F0",
  borderDark: "#1E3A5F",
  zinc100: "#F1F5F9",
  zinc200: "#E2E8F0",
  zinc300: "#CBD5E1",

  // Sprint 4 — rep activity status (active / idle / offline)
  activeStatus: "#22C55E", // green-500 — distinct from brand secondary/podpisana
  idleStatus: "#EAB308",   // yellow-500
  offlineStatus: "#94A3B8", // slate-400
};

// Lead status palette — fits the OZE brand (blue/green/amber/slate)
export const statusColor: Record<string, string> = {
  podpisana: "#84D13C",
  decyzja: "#30A0E3",
  umowione: "#F59E0B",
  nie_zainteresowany: "#94A3B8",
  nowy: "#0B2545",
};

export const statusLabel: Record<string, string> = {
  podpisana: "Podpisana",
  decyzja: "Decyzja",
  umowione: "Umówione",
  nie_zainteresowany: "Nie zainteresowany",
  nowy: "Nowy",
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };
export const radius = { sm: 6, md: 8, lg: 12, xl: 16, pill: 999 };
