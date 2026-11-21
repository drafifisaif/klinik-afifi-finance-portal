import { redirect } from "next/navigation";
import { ModuleHeader } from "@/components/module-header";
import { EncounterAnalysis } from "@/components/patients/encounter-analysis";
import { getEncounterAnalysisImports } from "@/lib/gloco-encounter-analysis";
import { hasPermission, isManagementRole, requirePermission } from "@/lib/permissions";

export const maxDuration = 60;

export default async function PatientAnalysisPage() {
  const profile = await requirePermission("view_patient_analytics");
  if (!isManagementRole(profile.role)) redirect("/unauthorized");
  const { reports, error } = await getEncounterAnalysisImports();

  return <div className="page-stack">
    <ModuleHeader
      eyebrow="ANALISIS LAWATAN · SELF PAY & PANEL"
      title="Analisis klinik"
      description="Satu paparan untuk lawatan, pesakit unik, caj GLOCO, kategori jualan dan kutipan mengikut cawangan."
    />
    <EncounterAnalysis reports={reports} error={error} canUpload={hasPermission(profile, "manage_patient_imports")} />
  </div>;
}
