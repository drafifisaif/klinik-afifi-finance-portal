import { ModuleHeader } from "@/components/module-header";
import { PatientReportImport } from "@/components/patients/patient-report-import";
import { PatientBaselineImport } from "@/components/patients/patient-baseline-import";
import { PatientMonthOverview } from "@/components/patients/patient-month-overview";
import { getPatientAnalytics } from "@/lib/patient-analytics";
import { formatDateTime } from "@/lib/format";
import { hasPermission, requirePermission } from "@/lib/permissions";

export const maxDuration = 60;

export default async function PatientsPage() {
  const profile = await requirePermission("view_patient_analytics");
  const { summaries, batches, baseline, error } = await getPatientAnalytics();
  const canImport = hasPermission(profile, "manage_patient_imports");

  return (
    <div className="page-stack">
      <ModuleHeader
        eyebrow="ANALISIS PESAKIT"
        title="Pesakit & lawatan"
        description="Lihat lawatan, pesakit unik dan trend mengikut cawangan daripada laporan GLOCO yang dimuat naik."
      />

      {error ? <div className="patient-setup-warning" role="alert">{error}</div> : null}

      <PatientMonthOverview summaries={summaries} branchScoped={profile.role === "branch_pic"} />

      {canImport ? <PatientReportImport /> : null}
      {canImport ? <PatientBaselineImport currentBaseline={baseline} /> : null}

      {canImport ? (
        <section className="patient-section" aria-labelledby="patient-import-history-title">
          <div className="patient-section-heading">
            <div><span className="owner-section-kicker">AUDIT IMPORT</span><h2 id="patient-import-history-title">Sejarah upload</h2></div>
            <p>Tempoh, jumlah rekod dan pengguna yang mengimport.</p>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Masa upload</th><th>Tempoh</th><th>Baris dibaca</th><th>Ditambah</th><th>Pendua</th><th>Diurus oleh</th></tr></thead>
              <tbody>
                {batches.length ? batches.map((batch) => (
                  <tr key={batch.id}>
                    <td>{formatDateTime(batch.created_at)}</td>
                    <td>{batch.period_start} – {batch.period_end}</td>
                    <td>{batch.rows_seen.toLocaleString()}</td>
                    <td>{batch.rows_imported.toLocaleString()}</td>
                    <td>{batch.duplicate_rows.toLocaleString()}</td>
                    <td>{batch.profiles?.full_name ?? "Finance"}</td>
                  </tr>
                )) : <tr><td colSpan={6}>Belum ada upload.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <p className="patient-privacy-note">Portal memadankan PID melalui nilai terlindung dan tidak memaparkan nama pesakit. “PID pertama kali direkod” berdasarkan sejarah import yang tersedia, bukan pengesahan sejarah penuh GLOCO.</p>
    </div>
  );
}
