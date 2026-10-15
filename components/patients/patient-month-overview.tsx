"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/format";
import type { PatientPeriodSummary } from "@/lib/patient-analytics";
import { PatientSummaryCards } from "@/components/patients/patient-summary-cards";
import { PatientTrendChart } from "@/components/patients/patient-trend-chart";

function formatMonth(month: string) {
  return new Intl.DateTimeFormat("ms-MY", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}T00:00:00Z`));
}

export function PatientMonthOverview({ summaries, branchScoped }: { summaries: PatientPeriodSummary[]; branchScoped: boolean }) {
  const months = [...new Set(summaries.map((row) => row.period_month))].sort();
  const [month, setMonth] = useState(months.at(-1) ?? "");
  const monthRows = summaries.filter((row) => row.period_month === month);
  const completedRows = monthRows.filter((row) => row.is_complete);
  const latestPeriod = completedRows.reduce<number | null>((latest, row) => latest === null || row.period_no > latest ? row.period_no : latest, null);
  const latestRows = completedRows.filter((row) => row.period_no === latestPeriod);
  const branchRows = [...new Set(monthRows.map((row) => row.branch_id))].map((branchId) => {
    const rows = monthRows.filter((row) => row.branch_id === branchId);
    const complete = rows.filter((row) => row.is_complete);
    const latest = [...complete].sort((a, b) => b.period_no - a.period_no)[0];
    return {
      branchId,
      branchName: rows[0]?.branches?.name ?? "Cawangan",
      visits: complete.reduce((sum, row) => sum + row.visit_count, 0),
      newPatients: complete.reduce((sum, row) => sum + row.new_patient_count, 0),
      uniqueLatest: latest?.unique_patient_count ?? 0,
      completed: complete.length,
      latest
    };
  });
  const expectedPeriods = branchRows.length * 4;

  return (
    <>
      <div className="patient-month-filter">
        <label>Bulan laporan
          <select value={month} onChange={(event) => setMonth(event.target.value)} disabled={!months.length}>
            {months.map((value) => <option key={value} value={value}>{formatMonth(value)}</option>)}
          </select>
        </label>
        <p>{month ? `${completedRows.length} daripada ${expectedPeriods} tempoh/cawangan lengkap` : "Belum ada laporan pesakit diimport"}</p>
      </div>

      <PatientSummaryCards
        completedPeriods={completedRows.length}
        newPatients={completedRows.reduce((sum, row) => sum + row.new_patient_count, 0)}
        periodLabel={month ? formatMonth(month) : "Belum ada import"}
        uniqueLabel={latestPeriod ? `Tempoh ${latestPeriod} sahaja; tidak dijumlahkan merentas minggu` : "Belum ada tempoh lengkap"}
        uniqueTitle="Pesakit unik tempoh terakhir"
        uniquePatients={latestRows.reduce((sum, row) => sum + row.unique_patient_count, 0)}
        visits={completedRows.reduce((sum, row) => sum + row.visit_count, 0)}
      />

      <PatientTrendChart summaries={summaries} branchScoped={branchScoped} month={month} onMonthChange={setMonth} />

      <section className="patient-section" aria-labelledby="patient-branch-summary-title">
        <div className="patient-section-heading">
          <div><span className="owner-section-kicker">PECAHAN CAWANGAN</span><h2 id="patient-branch-summary-title">Ringkasan {month ? formatMonth(month) : "bulanan"}</h2></div>
          <p>Lawatan dan PID pertama kali direkod dijumlahkan daripada tempoh lengkap sahaja.</p>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Cawangan</th><th>Lawatan</th><th>Pesakit unik tempoh terakhir</th><th>PID pertama kali direkod</th><th>Tempoh lengkap</th><th>Kemaskini terakhir</th></tr></thead>
            <tbody>
              {branchRows.length ? branchRows.map((row) => (
                <tr key={row.branchId}>
                  <td>{row.branchName}</td>
                  <td>{row.visits.toLocaleString()}</td>
                  <td>{row.latest ? `${row.uniqueLatest.toLocaleString()} (T${row.latest.period_no})` : "-"}</td>
                  <td>{row.newPatients.toLocaleString()}</td>
                  <td><span className={`status-pill ${row.completed === 4 ? "status-paid" : "status-partial"}`}>{row.completed}/4</span></td>
                  <td>{row.latest ? `${row.latest.last_imported_by_name ?? "Finance"} · ${row.latest.last_imported_at ? formatDateTime(row.latest.last_imported_at) : "Masa tidak direkod"}` : "Belum upload"}</td>
                </tr>
              )) : <tr><td colSpan={6}>Belum ada laporan untuk dipaparkan.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
