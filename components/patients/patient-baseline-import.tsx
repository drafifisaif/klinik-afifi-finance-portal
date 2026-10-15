"use client";

import { useRef, useState } from "react";
import { importPatientBaseline } from "@/app/(portal)/patients/actions";
import type { PatientBaselineBatch } from "@/lib/patient-analytics";

export function PatientBaselineImport({ currentBaseline }: { currentBaseline: PatientBaselineBatch | null }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveList() {
    if (!formRef.current) return;
    if (!window.confirm("Portal akan menyemak dan menyimpan senarai ini. Baseline aktif hanya diganti jika semua rekod sah. Teruskan?")) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await importPatientBaseline(new FormData(formRef.current));
      setMessage(result.message);
      if (result.ok) formRef.current.reset();
    } catch {
      setMessage("Import tidak berjaya. Sila cuba semula; baseline sedia ada tidak diubah.");
    } finally {
      setBusy(false);
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
      <p className="patient-latest-context">Fail disemak dan disimpan dalam satu proses supaya tidak perlu dimuat naik dua kali. Baseline aktif hanya diganti selepas semua rekod lulus semakan.</p>
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
          <input name="baseline" type="file" accept=".csv,text/csv" required />
        </label>
        <div className="patient-import-actions">
          <button className="primary-button compact-button" type="button" disabled={busy} onClick={saveList}>{busy ? "Menyemak & menyimpan..." : "Semak & simpan baseline"}</button>
        </div>
      </form>
      {message ? <p className="patient-upload-message" role="status">{message}</p> : null}
    </section>
  );
}
