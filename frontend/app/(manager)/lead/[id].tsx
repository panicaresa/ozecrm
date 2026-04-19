import React from "react";
import { useLocalSearchParams } from "expo-router";
import { LeadDetailScreen } from "../../../src/components/LeadDetailScreen";

export default function ManagerLeadDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <LeadDetailScreen leadId={id as string} />;
}
