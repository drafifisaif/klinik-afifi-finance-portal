"use client";

import { useRef, useState } from "react";
import { importPatientReport, previewPatientReport } from "@/app/(portal)/patients/actions";

type Preview = {
  rows: number;
  invalidRows: number;
  candidateNewIds: number;
  branches: Record<string, number>;
  startDate: string;
  endDate: string;
};

const periods = [
  { value: "1", label: "Minggu 1 · 1–7" },
  { value: "2", label: "Minggu 2 · 8–14" },
  { value: "3", label: "Minggu 3 · 15–21" },
  { value: "4", label: "Minggu 4 · 22–akhir bulan" }
];

export function PatientReportImport() {
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  async function handlePreview() {
    if (!formRef.current) return;
    setIsBusy(true);
    setMessage("");
    const result = await previewPatientReport(new FormData(formRef.current));
    setIsBusy(false);
    setMessage(result.message);
    setPreview(result.ok ? result.preview ?? null : null);
  }

  async function handleImport() {
    if (!formRef.current) return;
    setIsBusy(true);
    setMessage("");
    const result = await importPatientReport(new FormData(formRef.current));
    setIsBusy(false);
    setMessage(result.message);
    if (result.ok) {
      setPreview(null);
      formRef.current.reset();
    }
  }

  return (
    <section className="patient-import-panel" aria-labelledby="patient-import-title">
      <div className="patient-section-heading">
        <div>
          <span className="owner-section-kicker">FINANCE MANAGER</span>
          <h2 id="patient-import-title">Upload laporan GLOCO</h2>
        </div>
        <p>Satu fail gabungan untuk semua cawangan. Maklumat nama, alamat dan telefon tidak dibaca untuk analisis.</p>
      </div>
      <form ref={formRef} className="patient-import-form">
        <label>
          Bulan laporan
          <input name="period_month" type="month" defaultValue={defaultMonth} required onChange={() => setPreview(null)} />
        </label>
        <label>
          Tempoh laporan
          <select name="period_no" defaultValue="1" onChange={() => setPreview(null)}>
            {periods.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
          </select>
        </label>
        <label className="patient-file-input">
          Fail Excel GLOCO (.xlsx)
          <input
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            name="report"
            type="file"
            required
            onChange={() => setPreview(null)}
          />
        </label>
        <div className="patient-import-actions">
          <button className="primary-button compact-button" type="button" disabled={isBusy} onClick={handlePreview}>
            {isBusy ? "Memproses..." : "Semak laporan"}
          </button>
          <button className="secondary-button compact-button" type="button" disabled={isBusy || !preview || preview.invalidRows > 0} onClick={handleImport}>
            Sahkan & simpan
          </button>
        </div>
      </form>
      {message ? <p className={`patient-upload-message${preview ? " is-success" : ""}`} role="status">{message}</p> : null}
      {preview ? (
        <div className="patient-preview" aria-label="Pratonton laporan">
          <strong>{preview.startDate} hingga {preview.endDate}</strong>
          <span>{preview.rows.toLocaleString()} lawatan</span>
          <span>{preview.candidateNewIds.toLocaleString()} PID belum ada dalam data portal</span>
          {preview.invalidRows > 0 ? <span className="patient-warning-text">{preview.invalidRows.toLocaleString()} baris tidak sepadan. Betulkan laporan sebelum simpan.</span> : <span>Semua baris dapat dibaca</span>}
          <span>{Object.entries(preview.branches).map(([branch, count]) => `${branch}: ${count}`).join(" · ")}</span>
          <small>Angka PID baharu merujuk kepada rekod yang belum ditemui dalam import portal setakat ini, bukan pengesahan sejarah seumur hidup.</small>
        </div>
      ) : null}
    </section>
  );
}
