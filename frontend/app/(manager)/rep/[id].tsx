// Sprint 3.5c micro — thin wrapper over shared RepProfileScreen.
// Scope "manager" keeps the existing behaviour (no breadcrumb, no manager row).
import React from "react";
import RepProfileScreen from "../../../src/components/RepProfileScreen";

export default function ManagerRepProfile() {
  return <RepProfileScreen scope="manager" />;
}
