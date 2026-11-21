"use client";

import { useMemo, useRef, useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { previewEncounterAnalysis, saveEncounterAnalysis } from "@/app/(portal)/patient-analysis/actions";
import type { EncounterAnalysisImport } from "@/lib/gloco-encounter-analysis";
import type { EncounterAnalysisGroup, ParsedEncounterAnalysis } from "@/lib/patient-import";

type PreviewRow = { month: string; filename: string; visits: number; uniquePatients: number; newPatients: number; existingPatients: number; netCharges: number; crossBranchPatients: number; branches: number };
type MetricGroup = Pick<EncounterAnalysisGroup, "visits" | "unique_patients" | "new_patients" | "existing_patients" | "gross_charges" | "net_charges" | "charges" | "payments">;

const money = new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR", minimumFractionDigits: 2 });
const integer = new Intl.NumberFormat("ms-MY");
const monthsMs = ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"];
const chargeLabels: Record<string, string> = { Prescription: "Ubat-ubatan · Prescription", Doctor: "Caj doktor", Other: "Caj lain", Manual: "Prosedur · Manual", Discount: "Diskaun", Rounding: "Pembundaran" };
const paymentLabels: Record<string, string> = { Cash: "Tunai", Cheque: "Cek", "Credit Card": "Kad kredit", "Debit Card": "Kad debit", "Wire Transfer": "Pindahan bank", Others: "Lain-lain", "Write Off": "Write-off" };
const priceKeys = ["Selfpay", "Panel", "Lain-lain"];

function formatMonth(value: string) {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  return `${monthsMs[month - 1]} ${year}`;
}

function emptyGroup(): MetricGroup {
  return { visits: 0, unique_patients: 0, new_patients: 0, existing_patients: 0, gross_charges: 0, net_charges: 0, charges: {}, payments: {} };
}

function addGroup(target: MetricGroup, source?: MetricGroup) {
  if (!source) return target;
  target.visits += source.visits;
  target.unique_patients += source.unique_patients;
  target.new_patients += source.new_patients;
  target.existing_patients += source.existing_patients;
  target.gross_charges += source.gross_charges;
  target.net_charges += source.net_charges;
  for (const [key, value] of Object.entries(source.charges)) target.charges[key] = (target.charges[key] ?? 0) + value;
  for (const [key, value] of Object.entries(source.payments)) target.payments[key] = (target.payments[key] ?? 0) + value;
  return target;
}

function chooseGroup(report: ParsedEncounterAnalysis, branchId: string, priceLevel: string): MetricGroup {
  const branch = branchId === "all" ? null : report.branches.find((item) => item.branch_id === branchId) ?? null;
  if (branch) return priceLevel === "all" ? branch : branch.price_levels[priceLevel] ?? emptyGroup();
  if (priceLevel !== "all") return report.price_levels[priceLevel] ?? emptyGroup();
  return {
    visits: report.total_visits,
    unique_patients: report.unique_patients,
    new_patients: report.new_patients,
    existing_patients: report.existing_patients,
    gross_charges: report.gross_charges,
    net_charges: report.net_charges,
    charges: report.charges,
    payments: report.payments
  };
}

export function EncounterAnalysis({ reports, error, canUpload }: { reports: EncounterAnalysisImport[]; error: string | null; canUpload: boolean }) {
  const ordered = useMemo(() => [...reports].sort((a, b) => a.report_month.localeCompare(b.report_month)), [reports]);
  const years = [...new Set(ordered.map((item) => item.report_month.slice(0, 4)))].sort();
  const [year, setYear] = useState(years.at(-1) ?? "");
  const [month, setMonth] = useState("all");
  const [branch, setBranch] = useState("all");
  const [priceLevel, setPriceLevel] = useState("all");
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const monthOptions = ordered.filter((item) => item.report_month.startsWith(`${year}-`));
  const filtered = month === "all" ? monthOptions : monthOptions.filter((item) => item.report_month === month);
  const branchOptions = [...new Map(ordered.flatMap((item) => item.report_data.branches).map((item) => [item.branch_id, { id: item.branch_id, name: item.branch_name }])).values()];
  const selectedGroups = filtered.map((report) => ({ report, group: chooseGroup(report.report_data, branch, priceLevel) }));
  const totals = selectedGroups.reduce((sum, item) => addGroup(sum, item.group), emptyGroup());
  const averagePatients = filtered.length ? Math.round(totals.unique_patients / filtered.length) : 0;
  const averageCrossBranch = filtered.length ? Math.round(selectedGroups.reduce((sum, item) => sum + (branch === "all" && priceLevel === "all" ? item.report.report_data.cross_branch_patients : 0), 0) / filtered.length) : 0;
  const categoryRows = Object.entries(totals.charges).sort(([left], [right]) => chargeLabels[left].localeCompare(chargeLabels[right]));
  const paymentRows = Object.entries(totals.payments).sort(([left], [right]) => left === "Write Off" ? 1 : right === "Write Off" ? -1 : 0);
  const collected = Object.entries(totals.payments).filter(([key]) => key !== "Write Off").reduce((sum, [, value]) => sum + value, 0);
  const branchRows = branch === "all" ? branchOptions.map((option) => ({
    ...option,
    metrics: filtered.reduce((sum, report) => addGroup(sum, chooseGroup(report.report_data, option.id, priceLevel)), emptyGroup()),
    selfpay: filtered.reduce((sum, report) => addGroup(sum, chooseGroup(report.report_data, option.id, "Selfpay")), emptyGroup()),
    panel: filtered.reduce((sum, report) => addGroup(sum, chooseGroup(report.report_data, option.id, "Panel")), emptyGroup())
  })) : [];
  const maxBranchSales = Math.max(1, ...branchRows.map((item) => item.metrics.net_charges));
  const periodLabel = month === "all" ? year : month ? formatMonth(month) : year;

  async function runPreview() {
    if (!formRef.current) return;
    setBusy(true); setMessage("");
    const result = await previewEncounterAnalysis(new FormData(formRef.current));
    setBusy(false); setMessage(result.message); setPreview(result.ok ? result.reports ?? null : null);
  }

  async function saveReports() {
    if (!formRef.current) return;
    setBusy(true); setMessage("");
    const result = await saveEncounterAnalysis(new FormData(formRef.current));
    setBusy(false); setMessage(result.message);
    if (result.ok) { setPreview(null); formRef.current.reset(); }
  }

  return <div className="encounter-analysis-page">
    {error ? <div className="patient-setup-warning" role="alert">{error}</div> : null}
    {ordered.length ? <>
      <section className="encounter-filter-panel" aria-label="Penapis analisis">
        <label>Tahun<select value={year} onChange={(event) => { setYear(event.target.value); setMonth("all"); }}>
          {years.map((item) => <option key={item} value={item}>{item}</option>)}
        </select></label>
        <label>Bulan<select value={month} onChange={(event) => setMonth(event.target.value)}>
          <option value="all">Semua bulan</option>
          {monthOptions.map((item) => <option key={item.report_month} value={item.report_month}>{formatMonth(item.report_month)}</option>)}
        </select></label>
        <label>Cawangan<select value={branch} onChange={(event) => setBranch(event.target.value)}>
          <option value="all">Semua cawangan</option>
          {branchOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>Price Level<select value={priceLevel} onChange={(event) => setPriceLevel(event.target.value)}>
          <option value="all">Selfpay + Panel</option>
          {priceKeys.map((item) => <option key={item} value={item}>{item === "Lain-lain" ? item : item}</option>)}
        </select></label>
      </section>

      <p className="encounter-filter-caption">Analisis: {periodLabel} · {branch === "all" ? "Semua cawangan" : branchOptions.find((item) => item.id === branch)?.name} · {priceLevel === "all" ? "Semua jenis bayaran" : priceLevel}</p>

      <section className="encounter-kpi-grid" aria-label="Ringkasan analisis">
        <article><span>Jumlah lawatan</span><strong>{integer.format(totals.visits)}</strong><small>{filtered.length} bulan laporan</small></article>
        <article><span>Pesakit unik</span><strong>{integer.format(month === "all" ? averagePatients : totals.unique_patients)}</strong><small>{month === "all" ? "Purata sebulan · tidak dijumlah merentas bulan" : "PID dikira sekali dalam bulan ini"}</small></article>
        <article><span>Pesakit baharu</span><strong>{integer.format(month === "all" && filtered.length ? Math.round(totals.new_patients / filtered.length) : totals.new_patients)}</strong><small>{month === "all" ? "Purata sebulan" : "PID baharu dalam bulan ini"}</small></article>
        <article><span>Pesakit sedia ada</span><strong>{integer.format(month === "all" && filtered.length ? Math.round(totals.existing_patients / filtered.length) : totals.existing_patients)}</strong><small>{month === "all" ? "Purata sebulan" : "PID sedia ada dalam bulan ini"}</small></article>
        <article><span>Caj kasar</span><strong>{money.format(totals.gross_charges)}</strong><small>Sebelum diskaun dan pembundaran</small></article>
        <article><span>Caj bersih GLOCO</span><strong>{money.format(totals.net_charges)}</strong><small>Caj kasar + diskaun + pembundaran</small></article>
        <article><span>Kutipan direkod</span><strong>{money.format(collected)}</strong><small>Cash, cek, kad, pindahan dan lain-lain</small></article>
      </section>

      {branch === "all" && priceLevel === "all" ? <section className="encounter-overlap-note"><strong>{integer.format(month === "all" ? averageCrossBranch : selectedGroups.reduce((sum, item) => sum + item.report.report_data.cross_branch_patients, 0))}</strong><span>{month === "all" ? "purata PID rentas cawangan sebulan" : "PID muncul di lebih daripada satu cawangan bulan ini"}. Cawangan punya pesakit unik boleh bertindih dan tidak boleh dijumlah sebagai pesakit keseluruhan.</span></section> : null}

      <div className="encounter-analysis-columns">
        <section className="patient-section encounter-breakdown">
          <div className="patient-section-heading"><div><span className="owner-section-kicker">PECAHAN CAJ</span><h2>Jualan & caj</h2></div><p>Jumlah mengikut kategori dalam laporan GLOCO.</p></div>
          <div className="encounter-breakdown-list">{categoryRows.map(([key, amount]) => <div className="encounter-breakdown-row" key={key}><span>{chargeLabels[key] ?? key}</span><strong>{money.format(amount)}</strong></div>)}</div>
          <p className="patient-chart-note">“Manual” dipaparkan sebagai prosedur mengikut pengertian klinik. Nilai caj bukan semestinya wang yang sudah diterima.</p>
        </section>

        <section className="patient-section encounter-breakdown">
          <div className="patient-section-heading"><div><span className="owner-section-kicker">KUTIPAN</span><h2>Kaedah bayaran</h2></div><p>Nilai yang direkod pada lawatan; Write-off diasingkan.</p></div>
          <div className="encounter-breakdown-list">{paymentRows.map(([key, amount]) => <div className="encounter-breakdown-row" key={key}><span>{paymentLabels[key] ?? key}</span><strong>{money.format(amount)}</strong></div>)}</div>
          <p className="patient-chart-note">Kutipan ini daripada laporan GLOCO, bukan penyata bank atau rekonsiliasi tunai.</p>
        </section>
      </div>

      <section className="patient-section encounter-branch-section">
        <div className="patient-section-heading"><div><span className="owner-section-kicker">SELF PAY & PANEL</span><h2>Prestasi cawangan</h2></div><p>Jumlah caj dan lawatan mengikut penapis di atas.</p></div>
        {branch === "all" ? <div className="encounter-branch-list">{branchRows.map((item) => <div className="encounter-branch-row" key={item.id}><div><strong>{item.name}</strong><small>{integer.format(item.metrics.visits)} lawatan · {integer.format(month === "all" ? Math.round(item.metrics.unique_patients / Math.max(filtered.length, 1)) : item.metrics.unique_patients)} pesakit unik{month === "all" ? " purata/bulan" : ""}</small></div><div className="encounter-branch-price-split"><span>Selfpay <strong>{money.format(item.selfpay.net_charges)}</strong></span><span>Panel <strong>{money.format(item.panel.net_charges)}</strong></span></div><div className="encounter-branch-value"><strong>{money.format(item.metrics.net_charges)}</strong><span><i style={{ width: `${Math.max(2, item.metrics.net_charges / maxBranchSales * 100)}%` }} /></span></div></div>)}</div>
          : <div className="encounter-branch-list"><div className="encounter-branch-row"><div><strong>{branchOptions.find((item) => item.id === branch)?.name}</strong><small>{integer.format(totals.visits)} lawatan · {integer.format(month === "all" ? averagePatients : totals.unique_patients)} pesakit unik{month === "all" ? " purata/bulan" : ""}</small></div><div className="encounter-branch-value"><strong>{money.format(totals.net_charges)}</strong></div></div></div>}
      </section>

      <section className="patient-section encounter-trend-section">
        <div className="patient-section-heading"><div><span className="owner-section-kicker">TREND</span><h2>Lawatan & caj ikut bulan</h2></div><p>Setiap titik/bar mewakili satu fail bulanan yang sudah disimpan.</p></div>
        <div className="encounter-trend-list">{monthOptions.map((item) => {
          const data = item.report_data;
          const group = chooseGroup(data, branch, priceLevel);
          const top = Math.max(1, ...monthOptions.map((entry) => chooseGroup(entry.report_data, branch, priceLevel).net_charges));
          return <div className="encounter-trend-row" key={item.report_month}><span>{formatMonth(item.report_month)}</span><span className="encounter-trend-bar"><i style={{ width: `${group.net_charges / top * 100}%` }} /></span><strong>{money.format(group.net_charges)}</strong><small>{integer.format(group.visits)} lawatan</small></div>;
        })}</div>
      </section>
    </> : <section className="patient-section encounter-empty"><FileSpreadsheet size={26} /><h2>Belum ada analisis lawatan</h2><p>Muat naik laporan terperinci untuk mula melihat jualan, Selfpay/Panel dan corak lawatan.</p></section>}

    {canUpload ? <section className="patient-import-panel encounter-upload-panel">
      <div className="patient-section-heading"><div><span className="owner-section-kicker">OWNER / FINANCE</span><h2>Tambah laporan terperinci</h2></div><p>Pilih beberapa fail bulanan sekaligus. PID digunakan untuk kiraan unik dalam memori sahaja dan tidak disimpan dalam jadual analisis.</p></div>
      <form ref={formRef} className="encounter-upload-form">
        <label>Fail Excel GLOCO (.xlsx)<input accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" type="file" name="reports" multiple required onChange={() => { setPreview(null); setMessage(""); }} /></label>
        <div className="encounter-upload-buttons"><button className="primary-button compact-button" type="button" disabled={busy} onClick={runPreview}>{busy ? "Memproses..." : "Semak fail"}</button><button className="secondary-button compact-button" type="button" disabled={busy || !preview?.length} onClick={saveReports}><Upload size={16} />Simpan analisis</button></div>
      </form>
      {message ? <p className="patient-upload-message" role="status">{message}</p> : null}
      {preview ? <div className="table-scroll encounter-preview-table"><table className="data-table"><thead><tr><th>Bulan</th><th>Fail</th><th>Lawatan</th><th>Pesakit unik</th><th>Caj bersih</th><th>Rentas cawangan</th></tr></thead><tbody>{preview.map((item) => <tr key={item.month}><td>{formatMonth(item.month)}</td><td>{item.filename}</td><td>{integer.format(item.visits)}</td><td>{integer.format(item.uniquePatients)}</td><td>{money.format(item.netCharges)}</td><td>{integer.format(item.crossBranchPatients)}</td></tr>)}</tbody></table></div> : null}
    </section> : null}
    {ordered.length ? <p className="patient-chart-note encounter-provenance">Sumber: {filtered.map((item) => item.source_filename).join(" · ")} · Dikemaskini {filtered.map((item) => new Date(item.imported_at).toLocaleDateString("ms-MY")).join(" · ")}</p> : null}
  </div>;
}
