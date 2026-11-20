import { redirect } from "next/navigation";
import { ModuleHeader } from "@/components/module-header";
import { GlocoMonthlyAnalysis } from "@/components/patients/gloco-monthly-analysis";
import { getGlocoMonthlyImports } from "@/lib/gloco-monthly-analytics";
import { hasPermission, isManagementRole, requirePermission } from "@/lib/permissions";

export const maxDuration = 60;

export default async function GlocoMonthlyPage() {
  const profile = await requirePermission("view_patient_analytics");
  if (!isManagementRole(profile.role)) redirect("/unauthorized");
  const { reports, error } = await getGlocoMonthlyImports();

  return <div className="page-stack">
    <ModuleHeader
      eyebrow="ANALISIS GLOCO · BERASINGAN DARIPADA PID"
      title="Ringkasan GLOCO bulanan"
      description="Analisis laporan agregat bulanan: lawatan, caj mengikut kategori, perbandingan cawangan dan semakan ketepatan angka."
    />
    <GlocoMonthlyAnalysis reports={reports} error={error} canUpload={hasPermission(profile, "manage_patient_imports")} />
  </div>;
}
