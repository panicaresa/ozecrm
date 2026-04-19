import React from "react";
import { View } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import { colors, radius, statusColor, statusLabel } from "../theme";

export interface MapPin {
  id: string;
  lat?: number | null;
  lng?: number | null;
  status?: string;
  client_name?: string;
}

interface Props {
  pins: MapPin[];
  height?: number;
  testID?: string;
  selectedId?: string | null;
  onSelectPin?: (id: string | null) => void;
}

export const LeadMap: React.FC<Props> = ({ pins, height = 280, testID, selectedId, onSelectPin }) => {
  const valid = pins.filter((p) => typeof p.lat === "number" && typeof p.lng === "number");
  const center =
    valid.length > 0
      ? { latitude: valid[0].lat!, longitude: valid[0].lng! }
      : { latitude: 54.372, longitude: 18.638 };
  return (
    <View style={{ height, borderRadius: radius.lg, overflow: "hidden" }} testID={testID}>
      <MapView
        style={{ flex: 1 }}
        provider={PROVIDER_DEFAULT}
        initialRegion={{ ...center, latitudeDelta: 0.3, longitudeDelta: 0.3 }}
      >
        {valid.map((p) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.lat!, longitude: p.lng! }}
            title={p.client_name || ""}
            description={statusLabel[p.status || ""] || p.status}
            pinColor={statusColor[p.status || ""] || colors.primary}
            onPress={() => onSelectPin?.(selectedId === p.id ? null : p.id)}
          />
        ))}
      </MapView>
    </View>
  );
};
