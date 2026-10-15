"use client";

import { useRef, useState } from "react";
import { importPatientBaseline, previewPatientBaseline } from "@/app/(portal)/patients/actions";
import type { PatientBaselineBatch } from "@/lib/patient-analytics";

type Preview = { patients: number; duplicateRows: number; invalidRows: number; firstDate: string; lastDate: string };

export function PatientBaselineImport({ currentBaseline }: { currentBaseline: PatientBaselineBatch | null }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function checkList() {
    if (!formRef.current) return;
    setBusy(true);
    setMessage("");
    const result = await previewPatientBaseline(new FormData(formRef.current));
    setBusy(false);
    setMessage(result.message);
    setPreview(result.ok ? result.preview ?? null : null);
  }

  async function saveList() {
    if (!formRef.current) return;
    setBusy(true);
    setMessage("");
    const result = await importPatientBaseline(new FormData(formRef.current));
    setBusy(false);
    setMessage(result.message);
    if (result.ok) {
      setPreview(null);
      formRef.current.reset();
    }
  }

  return (
    <section className="patient-import-panel" aria-labelledby="patient-baseline-title">
      <div className="patient-section-heading">
        <div><span className="owner-section-kicker">SETUP AWAL · OWNER / FINANCE</span><h2 id="patient-baseline-title">Senarai pesakit sedia ada</h2></div>
        <p>Import sekali sebagai baseline untuk membezakan PID sedia ada daripada PID yang pertama kali muncul dalam laporan portal.</p>
      </div>
      <div className="patient-baseline-notice">
        Cawangan tidak diisi kerana tiada dalam fail. Sistem hanya membaca PID dan Last Encounter; nama, alamat, bandar, telefon dan medan lain tidak disimpan. Tarikh terakhir bukan tarikh pesakit mula-mula datang.
      </div>
      {currentBaseline ? (
        <p className="patient-latest-context">
          Baseline aktif: <strong>{currentBaseline.patient_count.toLocaleString()} PID tanpa maklumat cawangan</strong>
          <span>Last Encounter dalam fail: {currentBaseline.last_encounter_from} hingga {currentBaseline.last_encounter_to}</span>
          <span>{currentBaseline.imported_by_name ?? "Finance"} · {new Date(currentBaseline.created_at).toLocaleString("ms-MY", { timeZone: "Asia/Kuching" })}</span>
        </p>
      ) : null}
      <form ref={formRef} className="patient-import-form">
        <label className="patient-file-input">
          Fail asal (.csv)
          <input name="baseline" type="file" accept=".csv,text/csv" required onChange={() => setPreview(null)} />
        </label>
        <div className="patient-import-actions">
          <button className="primary-button compact-button" type="button" disabled={busy} onClick={checkList}>{busy ? "Memproses..." : "Semak senarai"}</button>
          <button className="secondary-button compact-button" type="button" disabled={busy || !preview || preview.invalidRows > 0} onClick={saveList}>Simpan baseline</button>
        </div>
      </form>
      {message ? <p className="patient-upload-message" role="status">{message}</p> : null}
      {preview ? (
        <div className="patient-preview" aria-label="Pratonton baseline pesakit">
          <span>{preview.patients.toLocaleString()} PID unik</span>
          <span>Last Encounter: {preview.firstDate} hingga {preview.lastDate}</span>
          {preview.duplicateRows ? <span>{preview.duplicateRows.toLocaleString()} baris PID berulang, tarikh terakhir dikekalkan</span> : <span>Tiada PID berulang</span>}
          {preview.invalidRows ? <span className="patient-warning-text">{preview.invalidRows.toLocaleString()} baris tidak sah; simpan disekat</span> : <span>Semua baris sah</span>}
          <small>Baseline aktif terdahulu hanya diganti selepas keseluruhan senarai berjaya disimpan.</small>
        </div>
      ) : null}
    </section>
  );
}
