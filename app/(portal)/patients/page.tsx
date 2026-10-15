import { ModuleHeader } from "@/components/module-header";
import { PatientReportImport } from "@/components/patients/patient-report-import";
import { PatientTrendChart } from "@/components/patients/patient-trend-chart";
import { getPatientAnalytics } from "@/lib/patient-analytics";
import { formatDateTime } from "@/lib/format";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { Activity, CalendarDays, UserRoundPlus, UsersRound } from "lucide-react";

export default async function PatientsPage() {
  const profile = await requirePermission("view_patient_analytics");
  const { summaries, batches, error } = await getPatientAnalytics();
  const canImport = hasPermission(profile, "manage_patient_imports");
  const latest = summaries.filter((row) => row.is_complete).sort((a, b) =>
    b.period_month.localeCompare(a.period_month) || b.period_no - a.period_no
  )[0];
  const latestRows = latest ? summaries.filter((row) => row.period_month === latest.period_month && row.period_no === latest.period_no) : [];
  const totals = latestRows.reduce((result, row) => ({
    visits: result.visits + row.visit_count,
    unique: result.unique + row.unique_patient_count,
    newPatients: result.newPatients + row.new_patient_count
  }), { visits: 0, unique: 0, newPatients: 0 });

  return (
    <div className="page-stack">
      <ModuleHeader
        eyebrow="ANALISIS PESAKIT"
        title="Pesakit & lawatan"
        description="Lihat lawatan, pesakit unik dan trend mengikut cawangan daripada laporan GLOCO yang dimuat naik."
      />

      {error ? <div className="patient-setup-warning" role="alert">{error}</div> : null}

      {latest ? (
        <div className="patient-latest-context">
          Tempoh terkini: <strong>{latest.period_start} hingga {latest.period_end}</strong>
          <span>{latestRows.every((row) => row.is_complete) ? "Laporan lengkap" : "Data belum lengkap"}</span>
        </div>
      ) : null}

      <div className="patient-summary-grid">
        <article className="patient-summary-card">
          <span className="patient-summary-icon tone-blue"><Activity size={20} /></span>
          <div><p>Jumlah lawatan</p><strong>{totals.visits.toLocaleString()}</strong><small>{latest ? `Tempoh ${latest.period_no}` : "Belum ada import"}</small></div>
        </article>
        <article className="patient-summary-card">
          <span className="patient-summary-icon tone-teal"><UsersRound size={20} /></span>
          <div><p>Pesakit unik</p><strong>{totals.unique.toLocaleString()}</strong><small>PID unik dalam tempoh</small></div>
        </article>
        <article className="patient-summary-card">
          <span className="patient-summary-icon tone-amber"><UserRoundPlus size={20} /></span>
          <div><p>PID pertama kali direkod</p><strong>{totals.newPatients.toLocaleString()}</strong><small>Dalam sejarah import portal</small></div>
        </article>
        <article className="patient-summary-card">
          <span className="patient-summary-icon tone-rose"><CalendarDays size={20} /></span>
          <div><p>Tempoh lengkap</p><strong>{summaries.filter((row) => row.is_complete).length}</strong><small>Tempoh/cawangan telah diimport</small></div>
        </article>
      </div>

      <PatientTrendChart summaries={summaries} branchScoped={profile.role === "branch_pic"} />

      <section className="patient-section" aria-labelledby="patient-branch-summary-title">
        <div className="patient-section-heading">
          <div><span className="owner-section-kicker">PECAHAN CAWANGAN</span><h2 id="patient-branch-summary-title">Ringkasan tempoh terkini</h2></div>
          <p>{latest ? `${latest.period_start} hingga ${latest.period_end}` : "Akan muncul selepas laporan diimport"}</p>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Cawangan</th><th>Lawatan</th><th>Pesakit unik</th><th>PID pertama kali direkod</th><th>Status data</th><th>Kemaskini terakhir</th></tr></thead>
            <tbody>
              {latestRows.length ? latestRows.map((row) => (
                <tr key={row.branch_id}>
                  <td>{row.branches?.name ?? "Cawangan"}</td>
                  <td>{row.visit_count.toLocaleString()}</td>
                  <td>{row.unique_patient_count.toLocaleString()}</td>
                  <td>{row.new_patient_count.toLocaleString()}</td>
                  <td><span className={`status-pill ${row.is_complete ? "status-paid" : "status-partial"}`}>{row.is_complete ? "Lengkap" : "Belum lengkap"}</span></td>
                  <td>{row.is_complete ? `${row.last_imported_by_name ?? "Finance"} · ${row.last_imported_at ? formatDateTime(row.last_imported_at) : "Masa tidak direkod"}` : "Belum upload"}</td>
                </tr>
              )) : <tr><td colSpan={6}>Belum ada laporan untuk dipaparkan.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {canImport ? <PatientReportImport /> : null}

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
