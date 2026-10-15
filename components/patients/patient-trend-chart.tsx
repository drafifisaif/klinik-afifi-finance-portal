"use client";

import { useMemo, useState } from "react";
import type { PatientPeriodSummary } from "@/lib/patient-analytics";

type Metric = "visits" | "unique" | "new";

const metricLabels: Record<Metric, string> = {
  visits: "Jumlah lawatan",
  unique: "Pesakit unik",
  new: "PID pertama kali direkod"
};

const branchColors = ["#0f8f83", "#2563eb", "#d18a0c", "#d14968", "#6554c0", "#0f766e"];

function metricValue(row: PatientPeriodSummary, metric: Metric) {
  if (metric === "visits") return row.visit_count;
  if (metric === "unique") return row.unique_patient_count;
  return row.new_patient_count;
}

function formatMonth(month: string) {
  return new Intl.DateTimeFormat("ms-MY", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}T00:00:00Z`));
}

export function PatientTrendChart({ summaries, branchScoped = false, month, onMonthChange }: { summaries: PatientPeriodSummary[]; branchScoped?: boolean; month?: string; onMonthChange?: (month: string) => void }) {
  const months = [...new Set(summaries.map((row) => row.period_month))].sort();
  const [internalMonth, setInternalMonth] = useState(months.at(-1) ?? "");
  const selectedMonth = month ?? internalMonth;
  const setSelectedMonth = onMonthChange ?? setInternalMonth;
  const [metric, setMetric] = useState<Metric>("visits");
  const branches = [...new Set(summaries.map((row) => row.branches?.name ?? "Cawangan"))].sort((a, b) => a.localeCompare(b));
  const [visibleBranches, setVisibleBranches] = useState<string[]>(branches);

  const rows = useMemo(() => summaries.filter((row) => row.period_month === selectedMonth), [summaries, selectedMonth]);
  const max = Math.max(1, ...rows.filter((row) => row.is_complete).map((row) => metricValue(row, metric)));
  const plot = { left: 42, top: 18, width: 680, height: 220 };
  const x = (period: number) => plot.left + ((period - 1) / 3) * plot.width;
  const y = (value: number) => plot.top + plot.height - (value / max) * plot.height;
  const periods = [1, 2, 3, 4];

  if (!summaries.length) {
    return <p className="patient-empty">Carta trend akan tersedia selepas laporan pertama berjaya dimuat naik.</p>;
  }

  return (
    <section className="patient-chart-panel" aria-labelledby="patient-trend-title">
      <div className="patient-section-heading">
        <div>
          <span className="owner-section-kicker">TREND</span>
          <h2 id="patient-trend-title">Trend mingguan</h2>
        </div>
        <div className="patient-chart-controls">
          <label>
            Bulan
            <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
              {months.map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}
            </select>
          </label>
          <label>
            Ukuran
            <select value={metric} onChange={(event) => setMetric(event.target.value as Metric)}>
              {Object.entries(metricLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
      </div>

      {!branchScoped && branches.length > 1 ? (
        <div className="patient-branch-toggles" aria-label="Pilih cawangan untuk carta">
          {branches.map((branch, index) => {
            const active = visibleBranches.includes(branch);
            return (
              <button
                className={`patient-branch-toggle${active ? " is-active" : ""}`}
                key={branch}
                type="button"
                aria-pressed={active}
                onClick={() => setVisibleBranches((current) => active ? current.filter((item) => item !== branch) : [...current, branch])}
              >
                <span style={{ backgroundColor: branchColors[index % branchColors.length] }} />{branch}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="patient-chart-scroll">
        <svg className="patient-trend-svg" viewBox="0 0 780 290" role="img" aria-label={`${metricLabels[metric]} bagi ${selectedMonth}`}>
          {[0, 1, 2, 3].map((tick) => {
            const value = Math.round((max / 3) * (3 - tick));
            const tickY = plot.top + (plot.height / 3) * tick;
            return <g key={tick}><line x1={plot.left} x2={plot.left + plot.width} y1={tickY} y2={tickY} className="patient-chart-gridline" /><text x="2" y={tickY + 4} className="patient-chart-axis">{value}</text></g>;
          })}
          {periods.map((period) => <text className="patient-chart-axis" key={period} textAnchor="middle" x={x(period)} y="272">M{period}</text>)}
          {branches.filter((branch) => visibleBranches.includes(branch)).map((branch) => {
            const branchRows = rows.filter((row) => (row.branches?.name ?? "Cawangan") === branch && row.is_complete);
            const points = branchRows.map((row) => `${x(row.period_no)},${y(metricValue(row, metric))}`).join(" ");
            const colorIndex = branches.indexOf(branch);
            return (
              <g key={branch}>
                {branchRows.length > 1 ? <polyline fill="none" stroke={branchColors[colorIndex % branchColors.length]} strokeWidth="3" points={points} /> : null}
                {branchRows.map((row) => (
                  <circle key={`${row.period_no}-${branch}`} cx={x(row.period_no)} cy={y(metricValue(row, metric))} r="6" fill={branchColors[colorIndex % branchColors.length]}>
                    <title>{`${branch} · Tempoh ${row.period_no} (${row.period_start} hingga ${row.period_end}): ${metricValue(row, metric)}`}</title>
                  </circle>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="patient-period-legend"><span>M1 1–7</span><span>M2 8–14</span><span>M3 15–21</span><span>M4 22–akhir bulan</span></div>
      <p className="patient-chart-note">PID pertama kali direkod adalah berdasarkan sejarah import portal yang tersedia. Ia belum semestinya tarikh lawatan pertama sepanjang sejarah GLOCO.</p>
      <PatientMonthlyChart summaries={summaries} months={months} branches={branches} visibleBranches={visibleBranches} selectedMonth={selectedMonth} />
    </section>
  );
}

function PatientMonthlyChart({ summaries, months, branches, visibleBranches, selectedMonth }: {
  summaries: PatientPeriodSummary[];
  months: string[];
  branches: string[];
  visibleBranches: string[];
  selectedMonth: string;
}) {
  const [metric, setMetric] = useState<"visits" | "new">("visits");
  const chartMonths = months.slice(-6);
  const series = chartMonths.map((chartMonth) => {
    const byBranch = branches.filter((branch) => visibleBranches.includes(branch)).map((branch) => ({
      branch,
      value: summaries.filter((row) => row.is_complete && row.period_month === chartMonth && (row.branches?.name ?? "Cawangan") === branch)
        .reduce((sum, row) => sum + metricValue(row, metric), 0)
    }));
    return { month: chartMonth, byBranch, total: byBranch.reduce((sum, row) => sum + row.value, 0) };
  });
  const max = Math.max(1, ...series.map((row) => row.total));
  const plot = { left: 54, top: 22, width: 650, height: 216 };
  const barWidth = Math.min(68, plot.width / Math.max(chartMonths.length, 1) - 26);

  return (
    <div className="patient-monthly-chart" aria-labelledby="patient-monthly-trend-title">
      <div className="patient-section-heading">
        <div><span className="owner-section-kicker">PERBANDINGAN BULANAN</span><h2 id="patient-monthly-trend-title">Trend ikut bulan</h2></div>
        <div className="patient-chart-controls"><label>Ukuran bulanan<select value={metric} onChange={(event) => setMetric(event.target.value as "visits" | "new")}><option value="visits">Jumlah lawatan</option><option value="new">PID pertama kali direkod</option></select></label></div>
      </div>
      <div className="patient-chart-scroll">
        <svg className="patient-trend-svg" viewBox="0 0 780 300" role="img" aria-label={`${metricLabels[metric]} mengikut bulan dan cawangan`}>
          {[0, 1, 2, 3].map((tick) => {
            const value = Math.round((max / 3) * (3 - tick));
            const y = plot.top + (plot.height / 3) * tick;
            return <g key={tick}><line x1={plot.left} x2={plot.left + plot.width} y1={y} y2={y} className="patient-chart-gridline" /><text x="2" y={y + 4} className="patient-chart-axis">{value}</text></g>;
          })}
          {series.map((row, index) => {
            const center = plot.left + (plot.width / chartMonths.length) * (index + 0.5);
            let stackedHeight = 0;
            return <g key={row.month}>
              {row.byBranch.map(({ branch, value }) => {
                const height = (value / max) * plot.height;
                const y = plot.top + plot.height - stackedHeight - height;
                stackedHeight += height;
                return value > 0 ? <rect key={branch} x={center - barWidth / 2} y={y} width={barWidth} height={height} fill={branchColors[branches.indexOf(branch) % branchColors.length]}><title>{`${branch} · ${formatMonth(row.month)}: ${value.toLocaleString()}`}</title></rect> : null;
              })}
              <text x={center} y={plot.top + plot.height + 20} textAnchor="middle" className="patient-chart-axis">{new Intl.DateTimeFormat("ms-MY", { month: "short", timeZone: "UTC" }).format(new Date(`${row.month}T00:00:00Z`))}</text>
              <text x={center} y={plot.top + plot.height + 37} textAnchor="middle" className="patient-chart-axis">{row.month.slice(0, 4)}</text>
              {row.month === selectedMonth ? <line x1={center - barWidth / 2} x2={center + barWidth / 2} y1="285" y2="285" stroke="#08796f" strokeWidth="3" /> : null}
            </g>;
          })}
        </svg>
      </div>
      <p className="patient-chart-note">Jumlah setiap bulan menggunakan tempoh yang sudah lengkap. Bulan semasa mungkin belum penuh; warna menunjukkan cawangan yang dipilih di atas.</p>
    </div>
  );
}
