import { ModuleHeader } from "@/components/module-header";
import { PanelManagementSection } from "@/components/panel-management-section";
import { getPanelCompanies } from "@/lib/data";
import { hasPermission, normalizeRole, requirePermission } from "@/lib/permissions";

export default async function PanelManagementPage() {
  const profile = await requirePermission("view_panel_records");
  const panelCompanies = await getPanelCompanies();
  const role = normalizeRole(profile.role);
  const canManageMasterData = hasPermission(profile, "edit_finance") && role !== "branch_pic";

  return (
    <>
      <ModuleHeader
        eyebrow="Master data"
        title="Panel Management"
        description="Manage panel company master records, contact details, and active status without leaving receivables follow-up work."
      />

      <PanelManagementSection canManageMasterData={canManageMasterData} panelCompanies={panelCompanies} profile={profile} />
    </>
  );
}
