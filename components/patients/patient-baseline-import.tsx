"use client";

import { useRef, useState } from "react";
import { createPatientBaselineUpload, discardPatientBaselineUpload, importPatientBaseline } from "@/app/(portal)/patients/actions";
import { createClient } from "@/lib/supabase-client";
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
    let uploadPath: string | undefined;
    try {
      const input = formRef.current.elements.namedItem("baseline");
      const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
      if (!file) throw new Error("Pilih fail CSV senarai pesakit dahulu.");
      if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("Sila pilih fail CSV.");
      if (file.size === 0 || file.size > 10 * 1024 * 1024) throw new Error("Fail CSV kosong atau melebihi had 10 MB.");

      setMessage("Menyediakan ruang upload selamat...");
      const upload = await createPatientBaselineUpload();
      if (!upload.ok || !upload.path || !upload.token) throw new Error(upload.message);
      uploadPath = upload.path;

      setMessage("Menghantar fail terus ke storan private...");
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("patient-import-staging")
        .uploadToSignedUrl(upload.path, upload.token, file, { contentType: "text/csv" });
      if (uploadError) throw new Error("Upload fail gagal. Sila cuba semula.");

      setMessage("Menyemak dan menyimpan rekod pesakit...");
      const result = await importPatientBaseline(upload.path);
      setMessage(result.message);
      if (result.ok) formRef.current.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import tidak berjaya. Baseline sedia ada tidak diubah.");
      if (uploadPath) await discardPatientBaselineUpload(uploadPath);
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
