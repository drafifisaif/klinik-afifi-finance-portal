"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Upload } from "lucide-react";
import { previewEncounterAnalysis, saveEncounterAnalysis } from "@/app/(portal)/patient-analysis/actions";
import type { EncounterAnalysisImport } from "@/lib/gloco-encounter-analysis";
import type { EncounterAnalysisGroup, ParsedEncounterAnalysis } from "@/lib/patient-import";

type PreviewRow = { month: string; filename: string; visits: number; uniquePatients: number; newPatients: number; existingPatients: number; netCharges: number; crossBranchPatients: number; branches: number };
type MetricGroup = Pick<EncounterAnalysisGroup, "visits" | "unique_patients" | "new_patients" | "existing_patients" | "gross_charges" | "net_charges" | "charges" | "payments" | "cities" | "genders" | "weekdays" | "hours">;

const money = new Intl.NumberFormat("ms-MY", { style: "currency", currency: "MYR", minimumFractionDigits: 2 });
const integer = new Intl.NumberFormat("ms-MY");
const monthsMs = ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"];
const chargeLabels: Record<string, string> = { Prescription: "Ubat-ubatan · Prescription", Doctor: "Caj doktor", Other: "Caj lain", Manual: "Prosedur · Manual", Discount: "Diskaun", Rounding: "Pembundaran" };
const paymentLabels: Record<string, string> = { Cash: "Tunai", Cheque: "Cek", "Credit Card": "Kad kredit", "Debit Card": "Kad debit", "Wire Transfer": "Pindahan bank", Others: "Lain-lain", "Write Off": "Write-off" };
const priceKeys = ["Selfpay", "Panel", "Lain-lain"];
const branchColors = ["#0f9588", "#3168ef", "#d6870a", "#d84c70"];

function formatMonth(value: string) {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  return `${monthsMs[month - 1]} ${year}`;
}

function shortMonth(value: string) {
  return monthsMs[Number(value.slice(5, 7)) - 1].slice(0, 3);
}

function compactMoney(value: number) {
  if (value >= 1000000) return `RM ${(value / 1000000).toFixed(1)}j`;
  if (value >= 1000) return `RM ${(value / 1000).toFixed(0)}k`;
  return money.format(value);
}

function percentChange(previous: number, current: number) {
  if (!previous) return current ? null : 0;
  return (current - previous) / Math.abs(previous) * 100;
}

type TrendSeries = { name: string; color: string; values: (number | null)[]; pointLabels?: string[] };

function TrendChart({ months, series, valueFormat, label, axisLabels }: { months: string[]; series: TrendSeries[]; valueFormat: (value: number) => string; label: string; axisLabels?: string[] }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(920);

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = Math.round(entry.contentRect.width);
      if (nextWidth > 0) setWidth((current) => current === nextWidth ? current : nextWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (!months.length || !series.length) return <p className="encounter-chart-empty">Tiada data untuk dipaparkan.</p>;
  const height = Math.min(290, Math.max(220, width * 0.32));
  const left = Math.min(82, Math.max(58, width * 0.19));
  const right = 22;
  const top = 18;
  const bottom = 48;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const max = Math.max(1, ...series.flatMap((line) => line.values.filter((value): value is number => value !== null)));
  const x = (index: number) => left + (months.length === 1 ? plotWidth / 2 : index * plotWidth / (months.length - 1));
  const y = (value: number) => top + plotHeight - value / max * plotHeight;
  const ticks = Array.from({ length: 5 }, (_, index) => max * index / 4);
  return <div className="encounter-chart-wrap" ref={chartRef}>
    <svg className="encounter-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {ticks.map((tick, index) => <g key={index}><line className="encounter-chart-grid" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} /><text className="encounter-chart-axis" x={left - 10} y={y(tick) + 4} textAnchor="end">{valueFormat(tick)}</text></g>)}
      {months.map((item, index) => <text className="encounter-chart-axis" key={item} x={x(index)} y={height - 16} textAnchor="middle">{axisLabels?.[index] ?? shortMonth(item)}</text>)}
      {series.map((line) => <g key={line.name}>
        {line.values.reduce<number[][]>((runs, value, index) => {
          if (value === null) return runs;
          if (index === 0 || line.values[index - 1] === null) runs.push([]);
          runs.at(-1)?.push(index);
          return runs;
        }, []).filter((run) => run.length > 1).map((run, index) => <polyline key={`${line.name}-run-${index}`} fill="none" stroke={line.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" points={run.map((point) => `${x(point)},${y(line.values[point]!)}`).join(" ")} />)}
        {line.values.map((value, index) => value === null ? null : <circle key={`${line.name}-${months[index]}`} cx={x(index)} cy={y(value)} r="4.5" fill={line.color}><title>{line.pointLabels?.[index] ?? `${line.name} · ${formatMonth(months[index])}: ${valueFormat(value)}`}</title></circle>)}
      </g>)}
    </svg>
    <div className="encounter-chart-legend">{series.map((line) => <span key={line.name}><i style={{ background: line.color }} />{line.name}</span>)}</div>
  </div>;
}

function emptyGroup(): MetricGroup {
  return { visits: 0, unique_patients: 0, new_patients: 0, existing_patients: 0, gross_charges: 0, net_charges: 0, charges: {}, payments: {}, cities: {}, genders: {}, weekdays: {}, hours: {} };
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
  for (const key of ["cities", "genders", "weekdays", "hours"] as const) {
    for (const [label, value] of Object.entries(source[key] ?? {})) target[key]![label] = (target[key]![label] ?? 0) + value;
  }
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
    payments: report.payments,
    cities: report.cities ?? {},
    genders: report.genders,
    weekdays: report.weekdays,
    hours: report.hours
  };
}

export function EncounterAnalysis({ reports, error, canUpload }: { reports: EncounterAnalysisImport[]; error: string | null; canUpload: boolean }) {
  const router = useRouter();
  const [savedReports, setSavedReports] = useState<EncounterAnalysisImport[]>([]);
  const ordered = useMemo(() => {
    const latestByMonth = new Map<string, EncounterAnalysisImport>();
    for (const item of [...reports, ...savedReports].sort((a, b) => a.imported_at.localeCompare(b.imported_at))) latestByMonth.set(item.report_month, item);
    return [...latestByMonth.values()].sort((a, b) => a.report_month.localeCompare(b.report_month));
  }, [reports, savedReports]);
  const years = [...new Set(ordered.map((item) => item.report_month.slice(0, 4)))].sort();
  const availableYearKey = years.join(",");
  const [year, setYear] = useState(years.at(-1) ?? "");
  const [month, setMonth] = useState("all");
  const [branch, setBranch] = useState("all");
  const [priceLevel, setPriceLevel] = useState("all");
  const [quarterMetric, setQuarterMetric] = useState<"visits" | "net_charges">("visits");
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const availableYears = availableYearKey.split(",").filter(Boolean);
    if (availableYears.length && !availableYears.includes(year)) setYear(availableYears.at(-1) ?? "");
  }, [availableYearKey, year]);
  const monthOptions = ordered.filter((item) => item.report_month.startsWith(`${year}-`));
  const filtered = month === "all" ? monthOptions : monthOptions.filter((item) => item.report_month === month);
  const branchOptions = [...new Map(ordered.flatMap((item) => item.report_data.branches).map((item) => [item.branch_id, { id: item.branch_id, name: item.branch_name }])).values()];
  const selectedGroups = filtered.map((report) => ({ report, group: chooseGroup(report.report_data, branch, priceLevel) }));
  const totals = selectedGroups.reduce((sum, item) => addGroup(sum, item.group), emptyGroup());
  const categoryRows = Object.entries(totals.charges).sort(([left], [right]) => chargeLabels[left].localeCompare(chargeLabels[right]));
  const paymentRows = Object.entries(totals.payments).sort(([left], [right]) => left === "Write Off" ? 1 : right === "Write Off" ? -1 : 0);
  const branchRows = branchOptions.filter((option) => branch === "all" || option.id === branch).map((option) => ({
    ...option,
    metrics: filtered.reduce((sum, report) => addGroup(sum, chooseGroup(report.report_data, option.id, priceLevel)), emptyGroup()),
    selfpay: filtered.reduce((sum, report) => addGroup(sum, chooseGroup(report.report_data, option.id, "Selfpay")), emptyGroup()),
    panel: filtered.reduce((sum, report) => addGroup(sum, chooseGroup(report.report_data, option.id, "Panel")), emptyGroup())
  }));
  const periodLabel = month === "all" ? year : month ? formatMonth(month) : year;
  const trendLines = branch === "all" ? branchOptions : branchOptions.filter((item) => item.id === branch);
  const visitsTrend = trendLines.map((item, index) => ({
    name: item.name,
    color: branchColors[index % branchColors.length],
    values: monthOptions.map((report) => chooseGroup(report.report_data, item.id, priceLevel).visits)
  }));
  const salesTrend = trendLines.map((item, index) => ({
    name: item.name,
    color: branchColors[index % branchColors.length],
    values: monthOptions.map((report) => chooseGroup(report.report_data, item.id, priceLevel).net_charges)
  }));
  const patientTrend = [
    { name: "Pesakit baharu", color: "#0f9588", values: monthOptions.map((report) => chooseGroup(report.report_data, branch, priceLevel).new_patients) },
    { name: "Pesakit sedia ada", color: "#d84c70", values: monthOptions.map((report) => chooseGroup(report.report_data, branch, priceLevel).existing_patients) }
  ];
  const topCity = Object.entries(totals.cities ?? {}).sort((a, b) => b[1] - a[1])[0];
  const topWeekday = Object.entries(totals.weekdays ?? {}).sort((a, b) => b[1] - a[1])[0];
  const peakHour = Object.entries(totals.hours ?? {}).sort((a, b) => b[1] - a[1])[0];
  const discountShare = totals.gross_charges ? Math.abs(totals.charges.Discount ?? 0) / totals.gross_charges * 100 : 0;
  const selectedMonthIndex = month === "all" ? monthOptions.length - 1 : monthOptions.findIndex((report) => report.report_month === month);
  const lastTwoMonths = selectedMonthIndex > 0 ? monthOptions.slice(selectedMonthIndex - 1, selectedMonthIndex + 1) : [];
  const salesChange = lastTwoMonths.length === 2
    ? chooseGroup(lastTwoMonths[1].report_data, branch, priceLevel).net_charges - chooseGroup(lastTwoMonths[0].report_data, branch, priceLevel).net_charges
    : null;
  const visitChange = lastTwoMonths.length === 2
    ? chooseGroup(lastTwoMonths[1].report_data, branch, priceLevel).visits - chooseGroup(lastTwoMonths[0].report_data, branch, priceLevel).visits
    : null;
  const newPatientShare = (report?: EncounterAnalysisImport) => {
    if (!report) return null;
    const group = chooseGroup(report.report_data, branch, priceLevel);
    const total = group.new_patients + group.existing_patients;
    return total ? group.new_patients / total * 100 : null;
  };
  const newShareChange = lastTwoMonths.length === 2 && newPatientShare(lastTwoMonths[0]) !== null && newPatientShare(lastTwoMonths[1]) !== null
    ? newPatientShare(lastTwoMonths[1])! - newPatientShare(lastTwoMonths[0])!
    : null;
  const trafficLeader = [...branchRows].sort((a, b) => b.metrics.visits - a.metrics.visits)[0];
  const salesLeader = [...branchRows].sort((a, b) => b.metrics.net_charges - a.metrics.net_charges)[0];
  const topCharge = categoryRows.filter(([key]) => key !== "Discount" && key !== "Rounding").sort((a, b) => b[1] - a[1])[0];
  const comparisonYears = years.slice(-2);
  const previousYear = comparisonYears[0];
  const currentYear = comparisonYears[1];
  const yearReports = comparisonYears.map((item) => ordered.filter((report) => report.report_month.startsWith(`${item}-`)));
  const sharedMonths = previousYear && currentYear
    ? Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0")).filter((monthNumber) =>
      yearReports.every((items) => items.some((report) => report.report_month.endsWith(`-${monthNumber}`)))
    )
    : [];
  const sharedMonthGroups = yearReports.map((items) => sharedMonths.map((monthNumber) => {
    const report = items.find((item) => item.report_month.endsWith(`-${monthNumber}`))!;
    return { report, group: chooseGroup(report.report_data, branch, priceLevel) };
  }));
  const comparisonTotals = sharedMonthGroups.map((items) => items.reduce((sum, item) => addGroup(sum, item.group), emptyGroup()));
  const comparisonMonthlySeries = (metric: "visits" | "net_charges") => yearReports.map((items, index) => ({
    name: comparisonYears[index],
    color: index === 0 ? "#3168ef" : "#0f9588",
    values: sharedMonths.map((monthNumber) => {
      const report = items.find((item) => item.report_month.endsWith(`-${monthNumber}`));
      return report ? chooseGroup(report.report_data, branch, priceLevel)[metric] : null;
    }),
    pointLabels: sharedMonths.map((monthNumber) => {
      const report = items.find((item) => item.report_month.endsWith(`-${monthNumber}`));
      const value = report ? chooseGroup(report.report_data, branch, priceLevel)[metric] : 0;
      return `${comparisonYears[index]} · ${monthsMs[Number(monthNumber) - 1]} · ${metric === "visits" ? integer.format(Math.round(value)) + " lawatan" : money.format(value)}`;
    })
  }));
  const patientComparisonSeries = yearReports.flatMap((items, yearIndex) => [
    { name: `${comparisonYears[yearIndex]} · baharu`, color: yearIndex === 0 ? "#78a5f5" : "#5dc4b5", values: sharedMonths.map((monthNumber) => {
      const report = items.find((item) => item.report_month.endsWith(`-${monthNumber}`));
      return report ? chooseGroup(report.report_data, branch, priceLevel).new_patients : null;
    }), pointLabels: sharedMonths.map((monthNumber) => {
      const report = items.find((item) => item.report_month.endsWith(`-${monthNumber}`));
      const value = report ? chooseGroup(report.report_data, branch, priceLevel).new_patients : 0;
      return `${comparisonYears[yearIndex]} · ${monthsMs[Number(monthNumber) - 1]} · ${integer.format(value)} pesakit baharu`;
    }) },
    { name: `${comparisonYears[yearIndex]} · sedia ada`, color: yearIndex === 0 ? "#b5cafa" : "#a0e0d8", values: sharedMonths.map((monthNumber) => {
      const report = items.find((item) => item.report_month.endsWith(`-${monthNumber}`));
      return report ? chooseGroup(report.report_data, branch, priceLevel).existing_patients : null;
    }), pointLabels: sharedMonths.map((monthNumber) => {
      const report = items.find((item) => item.report_month.endsWith(`-${monthNumber}`));
      const value = report ? chooseGroup(report.report_data, branch, priceLevel).existing_patients : 0;
      return `${comparisonYears[yearIndex]} · ${monthsMs[Number(monthNumber) - 1]} · ${integer.format(value)} pesakit sedia ada`;
    }) }
  ]);
  const quarters = [1, 2, 3, 4];
  const quarterSeries = yearReports.map((items, yearIndex) => {
    const values = quarters.map((quarter) => {
      const reportsInQuarter = items.filter((report) => Math.ceil(Number(report.report_month.slice(5, 7)) / 3) === quarter);
      const totalsInQuarter = reportsInQuarter.reduce((sum, report) => addGroup(sum, chooseGroup(report.report_data, branch, priceLevel)), emptyGroup());
      const metricValue = quarterMetric === "visits" ? totalsInQuarter.visits : totalsInQuarter.net_charges;
      return reportsInQuarter.length ? metricValue : null;
    });
    const pointLabels = quarters.map((quarter) => {
      const reportsInQuarter = items.filter((report) => Math.ceil(Number(report.report_month.slice(5, 7)) / 3) === quarter);
      const totalMonths = items.filter((report) => Math.ceil(Number(report.report_month.slice(5, 7)) / 3) === quarter).length;
      const group = reportsInQuarter.reduce((sum, report) => addGroup(sum, chooseGroup(report.report_data, branch, priceLevel)), emptyGroup());
      const amount = quarterMetric === "visits" ? integer.format(group.visits) : money.format(group.net_charges);
      return `${comparisonYears[yearIndex]} · Suku ${quarter} · ${totalMonths}/3 bulan · ${amount}`;
    });
    return { name: comparisonYears[yearIndex], color: yearIndex === 0 ? "#3168ef" : "#0f9588", values, pointLabels };
  });
  const comparableVisitChange = comparisonTotals.length === 2 ? percentChange(comparisonTotals[0].visits, comparisonTotals[1].visits) : null;
  const comparableSalesChange = comparisonTotals.length === 2 ? percentChange(comparisonTotals[0].net_charges, comparisonTotals[1].net_charges) : null;
  const previousPerVisit = comparisonTotals[0]?.visits ? comparisonTotals[0].net_charges / comparisonTotals[0].visits : null;
  const currentPerVisit = comparisonTotals[1]?.visits ? comparisonTotals[1].net_charges / comparisonTotals[1].visits : null;
  const perVisitChange = previousPerVisit !== null && currentPerVisit !== null ? percentChange(previousPerVisit, currentPerVisit) : null;
  const comparisonPeriodLabel = sharedMonths.map((monthNumber) => monthsMs[Number(monthNumber) - 1].slice(0, 3)).join(", ");

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
    if (result.ok) {
      setSavedReports((current) => [...current, ...result.saved]);
      setPreview(null);
      formRef.current.reset();
      router.refresh();
    }
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

      <p className="encounter-filter-caption">Ringkasan: {periodLabel} · {branch === "all" ? "Semua cawangan" : branchOptions.find((item) => item.id === branch)?.name} · {priceLevel === "all" ? "Semua jenis bayaran" : priceLevel}. Graf menunjukkan trend bulanan sepanjang {year}; penapis bulan mengubah ringkasan dan pecahan di bawah.</p>

      <section className="patient-section encounter-owner-brief">
        <div><span className="owner-section-kicker">RINGKASAN UNTUK OWNER · {year}</span><h2>Gambaran tempoh pilihan</h2></div>
        <p>{visitChange === null ? "Muat naik laporan bulan sebelumnya untuk mula melihat perubahan." : visitChange === 0 ? `Lawatan kekal hampir sama antara ${formatMonth(lastTwoMonths[0].report_month)} dengan ${formatMonth(lastTwoMonths[1].report_month)}.` : `Lawatan ${visitChange > 0 ? "meningkat" : "menurun"} dari ${formatMonth(lastTwoMonths[0].report_month)} ke ${formatMonth(lastTwoMonths[1].report_month)}.`} {salesChange === null ? "" : salesChange === 0 ? "Caj bersih juga kekal hampir sama." : `Caj bersih bergerak ${salesChange > 0 ? "naik" : "turun"}; bandingkan dengan graf pesakit untuk melihat sama ada perubahan datang daripada jumlah lawatan atau campuran caj.`} {branch === "all" && trafficLeader ? `${trafficLeader.name} paling sibuk dalam tempoh pilihan${salesLeader && salesLeader.id !== trafficLeader.id ? `, tetapi ${salesLeader.name} mendahului dari segi caj bersih` : " dan turut mencatat caj bersih tertinggi"}.` : branch !== "all" ? `Paparan difokuskan pada ${branchOptions.find((item) => item.id === branch)?.name ?? "cawangan pilihan"}.` : "Pilih tempoh yang mempunyai data untuk melihat perbandingan cawangan."}</p>
      </section>

      {comparisonYears.length === 2 ? <section className="patient-section encounter-comparison-section">
        <div className="patient-section-heading"><div><span className="owner-section-kicker">PERBANDINGAN TAHUNAN</span><h2>{previousYear} berbanding {currentYear}</h2></div><p>Perbandingan guna bulan yang ada dalam kedua-dua tahun, bukan jumlah setahun yang tempohnya berbeza.</p></div>
        {sharedMonths.length ? <>
          <p className="encounter-comparison-caption">Tempoh sepadan: {comparisonPeriodLabel} · {branch === "all" ? "Semua cawangan" : branchOptions.find((item) => item.id === branch)?.name} · {priceLevel === "all" ? "Selfpay + Panel" : priceLevel}</p>
          <div className="encounter-comparison-summary">
            <p>Dalam tempoh sepadan, lawatan {comparableVisitChange === null ? "belum boleh dibandingkan" : comparableVisitChange === 0 ? "kekal hampir sama" : `${comparableVisitChange > 0 ? "meningkat" : "menurun"} ${Math.abs(comparableVisitChange).toFixed(1)}%`} dan caj bersih {comparableSalesChange === null ? "belum boleh dibandingkan" : comparableSalesChange === 0 ? "kekal hampir sama" : `${comparableSalesChange > 0 ? "meningkat" : "menurun"} ${Math.abs(comparableSalesChange).toFixed(1)}%`} pada {currentYear} berbanding {previousYear}. {perVisitChange === null ? "" : `Caj bersih bagi setiap lawatan ${perVisitChange === 0 ? "hampir sama" : `${perVisitChange > 0 ? "meningkat" : "menurun"} ${Math.abs(perVisitChange).toFixed(1)}%`}; ini membantu bezakan perubahan jumlah pesakit daripada perubahan purata caj.`}</p>
          </div>
          <div className="encounter-analysis-columns encounter-comparison-charts">
            <article className="encounter-comparison-chart"><h3>Trend lawatan</h3><TrendChart months={sharedMonths} axisLabels={sharedMonths.map((item) => monthsMs[Number(item) - 1].slice(0, 3))} series={comparisonMonthlySeries("visits")} valueFormat={(value) => integer.format(Math.round(value))} label={`Perbandingan lawatan bulanan ${previousYear} dan ${currentYear}`} /></article>
            <article className="encounter-comparison-chart"><h3>Trend caj bersih</h3><TrendChart months={sharedMonths} axisLabels={sharedMonths.map((item) => monthsMs[Number(item) - 1].slice(0, 3))} series={comparisonMonthlySeries("net_charges")} valueFormat={compactMoney} label={`Perbandingan caj bersih bulanan ${previousYear} dan ${currentYear}`} /></article>
            <article className="encounter-comparison-chart encounter-comparison-chart-wide"><h3>Pesakit baharu dan sedia ada</h3><TrendChart months={sharedMonths} axisLabels={sharedMonths.map((item) => monthsMs[Number(item) - 1].slice(0, 3))} series={patientComparisonSeries} valueFormat={(value) => integer.format(Math.round(value))} label={`Perbandingan pesakit baharu dan sedia ada bulanan ${previousYear} dan ${currentYear}`} /></article>
          </div>
          <p className="patient-chart-note">Pesakit baharu/sedia ada dipaparkan mengikut kiraan setiap bulan; jumlah bulan berlainan bukan bilangan pesakit unik setahun.</p>
        </> : <p className="encounter-chart-empty">Belum ada bulan yang sepadan untuk dibandingkan. Pastikan sekurang-kurangnya satu bulan bagi setiap tahun sudah dimuat naik.</p>}

        <div className="patient-section-heading encounter-quarter-heading"><div><span className="owner-section-kicker">PRESTASI SUKU TAHUN</span><h2>Quarter {previousYear}–{currentYear}</h2></div><label className="encounter-quarter-select">Paparan<select value={quarterMetric} onChange={(event) => setQuarterMetric(event.target.value as "visits" | "net_charges")}><option value="visits">Jumlah lawatan</option><option value="net_charges">Caj bersih</option></select></label></div>
        <TrendChart months={quarters.map(String)} axisLabels={quarters.map((item) => `Q${item}`)} series={quarterSeries} valueFormat={quarterMetric === "visits" ? (value) => integer.format(Math.round(value)) : compactMoney} label={`Perbandingan suku tahun ${previousYear} dan ${currentYear} mengikut ${quarterMetric === "visits" ? "lawatan" : "caj bersih"}`} />
        <div className="encounter-quarter-coverage">{comparisonYears.map((item, index) => <p key={item}><strong>{item}</strong>{quarters.map((quarter) => {
          const count = yearReports[index].filter((report) => Math.ceil(Number(report.report_month.slice(5, 7)) / 3) === quarter).length;
          return <span key={quarter}>Q{quarter} <i className={count === 3 ? "is-complete" : count ? "is-partial" : "is-empty"}>{count}/3 bln</i></span>;
        })}</p>)}</div>
        <p className="patient-chart-note">Suku yang belum lengkap dipaparkan sebagai data separa, bukan sifar. Bandingkan suku penuh dengan suku penuh untuk bacaan yang adil.</p>
      </section> : null}

      <section className="patient-section encounter-trend-section">
        <div className="patient-section-heading"><div><span className="owner-section-kicker">TREND PESAKIT</span><h2>Lawatan mengikut cawangan</h2></div><p>Lihat arah lawatan dari bulan ke bulan. Pilih satu cawangan di atas untuk fokus.</p></div>
        <TrendChart months={monthOptions.map((item) => item.report_month)} series={visitsTrend} valueFormat={(value) => integer.format(Math.round(value))} label="Trend lawatan bulanan mengikut cawangan" />
      </section>

      <div className="encounter-analysis-columns">
        <section className="patient-section encounter-trend-section">
          <div className="patient-section-heading"><div><span className="owner-section-kicker">PESAKIT BAHARU & SEDIA ADA</span><h2>Perubahan pesakit</h2></div><p>Bilangan PID unik bagi setiap bulan; lawatan berulang dalam bulan yang sama dikira sekali.</p></div>
          <TrendChart months={monthOptions.map((item) => item.report_month)} series={patientTrend} valueFormat={(value) => integer.format(Math.round(value))} label="Trend bulanan pesakit baharu dan sedia ada" />
        </section>
        <section className="patient-section encounter-trend-section">
          <div className="patient-section-heading"><div><span className="owner-section-kicker">PRESTASI JUALAN</span><h2>Caj bersih ikut cawangan</h2></div><p>Bandingkan jualan bulanan selepas diskaun dan pembundaran; ini bukan kutipan bank.</p></div>
          <TrendChart months={monthOptions.map((item) => item.report_month)} series={salesTrend} valueFormat={compactMoney} label="Trend caj bersih bulanan mengikut cawangan" />
        </section>
      </div>

      <section className="patient-section encounter-decision-panel">
        <div className="patient-section-heading"><div><span className="owner-section-kicker">BAHAN UNTUK DIFIKIRKAN</span><h2>Petunjuk di sebalik trend</h2></div><p>Gunakan sebagai soalan semakan, bukan keputusan automatik.</p></div>
        <div className="encounter-insight-list">
          <article><span>Arah jualan</span><strong>{salesChange === null ? "Belum cukup data" : salesChange === 0 ? "Hampir sama" : salesChange > 0 ? "Meningkat" : "Menurun"}</strong><p>{salesChange === null ? "Perlu sekurang-kurangnya dua bulan." : `Bandingkan ${formatMonth(lastTwoMonths[1].report_month)} dengan ${formatMonth(lastTwoMonths[0].report_month)}. Adakah perubahan seiring dengan lawatan atau campuran caj?`}</p></article>
          <article><span>Pesakit baharu</span><strong>{newShareChange === null ? "Corak belum jelas" : newShareChange === 0 ? "Bahagian hampir sama" : newShareChange > 0 ? "Bahagian bertambah" : "Bahagian berkurang"}</strong><p>{newShareChange === null ? "Laporan bulanan diperlukan untuk melihat arah pesakit baharu." : "Perhatikan sama ada perubahan pesakit baharu diikuti lawatan ulangan pada bulan seterusnya."}</p></article>
          <article><span>Campuran jualan</span><strong>{topCharge ? chargeLabels[topCharge[0]] ?? topCharge[0] : "Belum tersedia"}</strong><p>{topCharge ? "Kategori terbesar boleh membantu fikirkan stok, kapasiti perkhidmatan dan latihan. Semak perubahan kategori dari bulan ke bulan." : "Tiada pecahan caj bagi tempoh ini."}</p></article>
          <article><span>Corak operasi</span><strong>{topWeekday?.[0] ?? "Belum tersedia"}{peakHour ? ` · ${peakHour[0]}` : ""}</strong><p>{topWeekday ? "Semak sama ada jadual staf dan kapasiti sesuai dengan hari/waktu paling sibuk." : "Maklumat hari dan waktu belum tersedia dalam laporan pilihan."}</p></article>
          <article><span>Kawasan pesakit</span><strong>{topCity?.[0] ?? "Perlu kemas kini laporan"}</strong><p>{topCity ? "Bandar asal memberi konteks kawasan liputan dan aktiviti setempat." : "Laporan yang sudah disimpan belum ada pecahan bandar. Import semula untuk mengisi analisis ini."}</p></article>
          <article><span>Diskaun</span><strong>{discountShare > 0 ? "Perlu dipantau" : "Tiada diskaun direkod"}</strong><p>Jika diskaun meningkat dari bulan ke bulan, semak sebab, kelulusan dan kesannya terhadap caj bersih.</p></article>
        </div>
      </section>

      <div className="encounter-analysis-columns">
        <section className="patient-section encounter-breakdown">
          <div className="patient-section-heading"><div><span className="owner-section-kicker">PECAHAN CAJ</span><h2>Jualan mengikut kategori</h2></div><p>Prescription ialah ubat; Manual dipaparkan sebagai prosedur.</p></div>
          <div className="encounter-breakdown-list">{categoryRows.map(([key, amount]) => <div className="encounter-breakdown-row" key={key}><span>{chargeLabels[key] ?? key}</span><strong>{money.format(amount)}</strong></div>)}</div>
          <p className="patient-chart-note">Caj menunjukkan nilai jualan dalam GLOCO; ia bukan semestinya wang yang telah diterima.</p>
        </section>

        <section className="patient-section encounter-breakdown">
          <div className="patient-section-heading"><div><span className="owner-section-kicker">KUTIPAN DIREKOD</span><h2>Kaedah bayaran</h2></div><p>Perbandingan kaedah bayaran di laporan GLOCO.</p></div>
          <div className="encounter-breakdown-list">{paymentRows.map(([key, amount]) => <div className="encounter-breakdown-row" key={key}><span>{paymentLabels[key] ?? key}</span><strong>{money.format(amount)}</strong></div>)}</div>
          <p className="patient-chart-note">Ini bukan penyata bank atau rekonsiliasi tunai.</p>
        </section>
      </div>

      {priceLevel === "all" ? <section className="patient-section encounter-branch-section">
        <div className="patient-section-heading"><div><span className="owner-section-kicker">SELF PAY & PANEL</span><h2>Campuran jualan setiap cawangan</h2></div><p>Bar menunjukkan perbandingan Selfpay dan Panel dalam tempoh pilihan.</p></div>
        <div className="encounter-branch-list">{branchRows.map((item) => {
          const payerSum = item.selfpay.net_charges + item.panel.net_charges;
          const selfpayWidth = payerSum ? item.selfpay.net_charges / payerSum * 100 : 50;
          return <div className="encounter-branch-row encounter-payer-row" key={item.id}><strong>{item.name}</strong><div className="encounter-payer-bar" aria-label={`${item.name}: Selfpay ${Math.round(selfpayWidth)}%, Panel ${Math.round(100 - selfpayWidth)}%`}><i style={{ width: `${selfpayWidth}%` }} /><i style={{ width: `${100 - selfpayWidth}%` }} /></div><small>Selfpay <strong>{money.format(item.selfpay.net_charges)}</strong> · Panel <strong>{money.format(item.panel.net_charges)}</strong></small></div>;
        })}</div>
      </section> : null}
    </> : <section className="patient-section encounter-empty"><FileSpreadsheet size={26} /><h2>Belum ada analisis lawatan</h2><p>Muat naik laporan terperinci untuk mula melihat jualan, Selfpay/Panel dan corak lawatan.</p></section>}

    {canUpload ? <section className="patient-import-panel encounter-upload-panel">
      <div className="patient-section-heading"><div><span className="owner-section-kicker">OWNER / FINANCE</span><h2>Tambah laporan terperinci</h2></div><p>Pilih beberapa fail bulanan sekaligus. PID digunakan untuk kiraan unik dalam memori sahaja dan tidak disimpan dalam jadual analisis.</p></div>
      <form ref={formRef} className="encounter-upload-form">
        <label>Fail Excel GLOCO (.xlsx)<input accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" type="file" name="reports" multiple required onChange={() => { setPreview(null); setMessage(""); }} /></label>
        <div className="encounter-upload-buttons"><button className="primary-button compact-button" type="button" disabled={busy} onClick={runPreview}>{busy ? "Memproses..." : "Semak fail"}</button><button className="secondary-button compact-button" type="button" disabled={busy || !preview?.length} onClick={saveReports}><Upload size={16} />Simpan analisis</button></div>
      </form>
      {message ? <p className={`patient-upload-message${preview === null && message.includes("berjaya disimpan") ? " is-success" : ""}`} role="status">{message}</p> : null}
      {preview ? <div className="table-scroll encounter-preview-table"><table className="data-table"><thead><tr><th>Bulan</th><th>Fail</th><th>Lawatan</th><th>Pesakit unik</th><th>Caj bersih</th><th>Rentas cawangan</th></tr></thead><tbody>{preview.map((item) => <tr key={item.month}><td>{formatMonth(item.month)}</td><td>{item.filename}</td><td>{integer.format(item.visits)}</td><td>{integer.format(item.uniquePatients)}</td><td>{money.format(item.netCharges)}</td><td>{integer.format(item.crossBranchPatients)}</td></tr>)}</tbody></table></div> : null}
    </section> : null}
    {ordered.length ? <p className="patient-chart-note encounter-provenance">Sumber: {filtered.map((item) => item.source_filename).join(" · ")} · Dikemaskini {filtered.map((item) => new Date(item.imported_at).toLocaleDateString("ms-MY")).join(" · ")}</p> : null}
  </div>;
}

export function EncounterDashboardPreview({ reports, selectedBranchIds, error }: { reports: EncounterAnalysisImport[]; selectedBranchIds: string[]; error: string | null }) {
  const orderedReports = [...reports].sort((a, b) => a.report_month.localeCompare(b.report_month));
  const year = orderedReports.at(-1)?.report_month.slice(0, 4) ?? "2026";
  const yearReports = orderedReports.filter((report) => report.report_month.startsWith(`${year}-`));
  const branches = [...new Map(yearReports.flatMap((report) => report.report_data.branches).map((branch) => [branch.branch_id, { id: branch.branch_id, name: branch.branch_name }])).values()]
    .filter((branch) => selectedBranchIds.includes(branch.id));
  const visitsTrend = branches.map((branch, index) => ({
    name: branch.name,
    color: branchColors[index % branchColors.length],
    values: yearReports.map((report) => report.report_data.branches.find((item) => item.branch_id === branch.id)?.visits ?? 0)
  }));
  const salesTrend = branches.map((branch, index) => ({
    name: branch.name,
    color: branchColors[index % branchColors.length],
    values: yearReports.map((report) => report.report_data.branches.find((item) => item.branch_id === branch.id)?.net_charges ?? 0)
  }));

  return <section className="dashboard-encounter-preview" aria-labelledby="dashboard-encounter-title">
    <div className="dashboard-patient-heading">
      <div><p className="owner-section-kicker">ANALISIS LAWATAN · {year}</p><h2 id="dashboard-encounter-title">Trend klinik</h2><p>Prestasi bulanan untuk cawangan yang dipilih.</p></div>
      <a className="secondary-button compact-button" href="/patient-analysis">Buka analisis penuh</a>
    </div>
    {yearReports.length && branches.length ? <div className="dashboard-encounter-charts">
      <article className="patient-section encounter-trend-section"><div className="patient-section-heading"><div><span className="owner-section-kicker">LAWATAN</span><h2>Pesakit mengikut cawangan</h2></div></div><TrendChart months={yearReports.map((item) => item.report_month)} series={visitsTrend} valueFormat={(value) => integer.format(Math.round(value))} label={`Trend lawatan bulanan mengikut cawangan bagi ${year}`} /></article>
      <article className="patient-section encounter-trend-section"><div className="patient-section-heading"><div><span className="owner-section-kicker">CAJ GLOCO</span><h2>Jualan mengikut cawangan</h2></div></div><TrendChart months={yearReports.map((item) => item.report_month)} series={salesTrend} valueFormat={compactMoney} label={`Trend caj bersih bulanan mengikut cawangan bagi ${year}`} /></article>
    </div> : <p className="dashboard-encounter-empty">{error ?? `Belum ada laporan lawatan terperinci untuk ${year}. Analisis penuh boleh dibuka untuk menyemak atau memuat naik laporan.`}</p>}
  </section>;
}
