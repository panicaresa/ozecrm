// Sprint 3.5c micro — admin version of the rep profile.
// Same screen as the manager one (shared RepProfileScreen) but with
// scope="admin" which adds:
//   - breadcrumb "Cała firma · Manager: <name>" in the header
//   - "Manager" info row (tap to drill into the manager profile)
//   - "ADMIN" badge in the top-right of the header
// RBAC: the underlying /api/users/{id}/profile endpoint is already
// admin-accessible (get_current_user-based check that allows admins).
import React from "react";
import RepProfileScreen from "../../../src/components/RepProfileScreen";

export default function AdminRepProfile() {
  return <RepProfileScreen scope="admin" />;
}
