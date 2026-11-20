"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileSpreadsheet, Upload } from "lucide-react";
import { previewGlocoMonthlyReport, saveGlocoMonthlyReport } from "@/app/(portal)/patients/gloco-monthly/actions";
import type { GlocoMonthlyReport } from "@/lib/gloco-monthly-report";
import type { GlocoMonthlyImport } from "@/lib/gloco-monthly-analytics";

const money = new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR", minimumFractionDigits: 2 });
const integer = new Intl.NumberFormat("ms-MY");
const categoryRows: Array<[string, keyof GlocoMonthlyReport["summary"]]> = [
  ["Preskripsi", "prescription"], ["Doktor", "doctor"], ["Lain-lain", "other"],
  ["Manual", "manual"], ["Diskaun", "discount"], ["Pembundaran", "rounding"]
];

function monthLabel(month: string) {
  return new Date(`${month.slice(0, 7)}-02T00:00:00`).toLocaleDateString("ms-MY", { month: "long", year: "numeric" });
}

function reportValues(report: GlocoMonthlyReport) {
  const branches = report.branches;
  const patients = branches.reduce((sum, branch) => sum + branch.monthly.patient_count, 0);
  const visits = branches.reduce((sum, branch) => sum + branch.monthly.visit_count, 0);
  const charges = categoryRows.reduce((sum, [, key]) => sum + (report.summary[key] ?? 0), 0);
  return { patients, visits, charges, average: patients ? visits / patients : 0 };
}

function ReportWarnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return <p className="gloco-clean-check">Angka cawangan dan ringkasan keseluruhan sepadan.</p>;
  return <div className="gloco-warning" role="status"><strong>Perlu semakan</strong><ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>;
}

export function GlocoMonthlyAnalysis({ reports, error, canUpload }: { reports: GlocoMonthlyImport[]; error: string | null; canUpload: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<GlocoMonthlyReport | null>(null);
  const [fileLabel, setFileLabel] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const ordered = [...reports].sort((a, b) => a.report_month.localeCompare(b.report_month));
  const latest = ordered.at(-1);

  async function inspect() {
    if (!formRef.current) return;
    setBusy(true); setMessage("");
    const result = await previewGlocoMonthlyReport(new FormData(formRef.current));
    setBusy(false); setMessage(result.message);
    setPreview(result.ok ? result.report : null);
  }

  async function save() {
    if (!formRef.current || !preview) return;
    setBusy(true); setMessage("");
    const result = await saveGlocoMonthlyReport(new FormData(formRef.current));
    setBusy(false); setMessage(result.message);
    if (result.ok) { setPreview(null); setFileLabel(""); formRef.current.reset(); window.location.reload(); }
  }

  return (
    <div className="page-stack gloco-monthly-page">
      <nav className="patient-analysis-nav" aria-label="Analisis pesakit">
        <Link href="/patients"><ArrowLeft size={17} /> Analisis PID</Link>
        <span aria-current="page">Ringkasan GLOCO</span>
      </nav>
      {error ? <div className="patient-setup-warning" role="alert">{error}</div> : null}

      {latest ? <>
        <section className="gloco-monthly-summary" aria-label={`Ringkasan ${monthLabel(latest.report_month)}`}>
          <div className="gloco-monthly-title"><div><span className="owner-section-kicker">ANALISIS GLOCO · AGREGAT BULANAN</span><h2>{monthLabel(latest.report_month)}</h2></div><small>Fail: {latest.source_filename}</small></div>
          <div className="patient-summary-grid">
            <article className="patient-summary-card"><div><p>Jumlah lawatan</p><strong>{integer.format(reportValues(latest.report_data).visits)}</strong><small>Jumlah daripada cawangan dalam laporan ini</small></div></article>
            <article className="patient-summary-card"><div><p>Pesakit ikut cawangan</p><strong>{integer.format(reportValues(latest.report_data).patients)}</strong><small>Bukan bilangan PID unik antara cawangan</small></div></article>
            <article className="patient-summary-card"><div><p>Jumlah caj dilaporkan</p><strong>{money.format(reportValues(latest.report_data).charges)}</strong><small>Angka laporan GLOCO; bukan kutipan tunai atau jualan</small></div></article>
            <article className="patient-summary-card"><div><p>Purata lawatan / pesakit</p><strong>{reportValues(latest.report_data).average.toFixed(2)}</strong><small>Kiraan lawatan dibahagi pesakit setiap cawangan</small></div></article>
          </div>
        </section>

        <section className="patient-section" aria-labelledby="gloco-branch-title">
          <div className="patient-section-heading"><div><span className="owner-section-kicker">PECAHAN CAWANGAN</span><h2 id="gloco-branch-title">Lawatan, pesakit dan caj</h2></div><p>Angka diambil terus daripada baris bulan GLOCO.</p></div>
          <div className="table-scroll"><table className="data-table gloco-data-table"><thead><tr><th>Cawangan</th><th>Lawatan</th><th>Pesakit</th><th>Baharu</th><th>Sedia ada</th><th>Purata lawatan</th><th>Jumlah caj</th></tr></thead><tbody>
            {latest.report_data.branches.map((branch) => {
              const m = branch.monthly;
              const charges = categoryRows.reduce((sum, [, key]) => sum + (m[key] ?? 0), 0);
              return <tr key={branch.branch_id}><td>{branch.branch_name}</td><td>{integer.format(m.visit_count)}</td><td>{integer.format(m.patient_count)}</td><td>{integer.format(m.new)}</td><td>{integer.format(m.existing)}</td><td>{m.patient_count ? (m.visit_count / m.patient_count).toFixed(2) : "0.00"}</td><td>{money.format(charges)}</td></tr>;
            })}
          </tbody></table></div>
          <ReportWarnings warnings={latest.report_data.warnings} />
        </section>

        <section className="patient-section" aria-labelledby="gloco-charge-title">
          <div className="patient-section-heading"><div><span className="owner-section-kicker">KATEGORI CAJ</span><h2 id="gloco-charge-title">Jumlah keseluruhan laporan</h2></div><p>Pecahan caj mengikut kategori seperti dalam ringkasan GLOCO.</p></div>
          <div className="gloco-charge-grid">{categoryRows.map(([label, key]) => <div key={key}><span>{label}</span><strong>{money.format(latest.report_data.summary[key] ?? 0)}</strong></div>)}</div>
        </section>
      </> : <section className="patient-section gloco-empty"><FileSpreadsheet size={26} /><h2>Belum ada ringkasan GLOCO</h2><p>Muat naik laporan bulanan untuk mula melihat analisis berasingan ini.</p></section>}

      <section className="patient-section" aria-labelledby="gloco-trend-title">
        <div className="patient-section-heading"><div><span className="owner-section-kicker">PERBANDINGAN BULAN KE BULAN</span><h2 id="gloco-trend-title">Trend laporan GLOCO</h2></div><p>Trend ini hanya menggunakan fail ringkasan bulanan yang diimport di halaman ini.</p></div>
        {ordered.length ? <div className="table-scroll"><table className="data-table gloco-data-table"><thead><tr><th>Bulan</th><th>Lawatan</th><th>Pesakit ikut cawangan</th><th>Jumlah caj</th><th>Berbanding bulan sebelumnya</th></tr></thead><tbody>{ordered.map((item, index) => {
          const values = reportValues(item.report_data);
          const previous = index ? reportValues(ordered[index - 1].report_data) : null;
          const delta = previous && previous.charges ? ((values.charges - previous.charges) / previous.charges) * 100 : null;
          return <tr key={item.id}><td>{monthLabel(item.report_month)}</td><td>{integer.format(values.visits)}</td><td>{integer.format(values.patients)}</td><td>{money.format(values.charges)}</td><td>{delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}% caj`}</td></tr>;
        })}</tbody></table></div> : <p className="gloco-empty-hint">Trend akan bermula selepas laporan pertama disimpan.</p>}
      </section>

      {canUpload ? <section className="patient-import-panel" aria-labelledby="gloco-upload-title">
        <div className="patient-section-heading"><div><span className="owner-section-kicker">OWNER / FINANCE</span><h2 id="gloco-upload-title">Tambah laporan bulanan</h2></div><p>Gunakan fail ringkasan semua cawangan. Data ini tidak masuk ke analisis PID.</p></div>
        <form ref={formRef} className="gloco-upload-form">
          <label className="gloco-file-picker"><Upload size={18} /><span>{fileLabel || "Pilih fail Excel GLOCO (.xlsx)"}</span><input name="report" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required onChange={(event) => { setPreview(null); setFileLabel(event.target.files?.[0]?.name ?? ""); }} /></label>
          <div className="patient-import-actions"><button className="primary-button compact-button" type="button" disabled={busy} onClick={inspect}>{busy ? "Menyemak..." : "Semak laporan"}</button><button className="secondary-button compact-button" type="button" disabled={busy || !preview} onClick={save}>{preview?.warnings.length ? "Simpan dengan amaran" : "Sahkan & simpan"}</button></div>
        </form>
        {message ? <p className={`patient-upload-message${preview ? " is-success" : ""}`} role="status">{message}</p> : null}
        {preview ? <div className="gloco-preview"><div><strong>{monthLabel(preview.report_month)}</strong><span>{integer.format(reportValues(preview).visits)} lawatan · {integer.format(reportValues(preview).patients)} pesakit ikut cawangan · {money.format(reportValues(preview).charges)} jumlah caj</span></div><ReportWarnings warnings={preview.warnings} /><small>{preview.warnings.length ? "Angka tidak diubah. Simpan laporan bersama amaran ini selepas semakan anda." : "Semakan lulus. Menyimpan laporan ini tidak mengubah atau menggantikan data PID."}</small></div> : null}
      </section> : null}
      <p className="patient-privacy-note">Analisis ini berasingan sepenuhnya daripada PID. Kiraan pesakit dijumlahkan daripada laporan bulanan mengikut cawangan dan bukan pesakit unik seluruh klinik.</p>
    </div>
  );
}
