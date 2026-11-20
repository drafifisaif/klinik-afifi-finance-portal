import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";
import type { Branch } from "@/lib/types";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false, trimValues: true });

function list<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function xml(files: Record<string, Uint8Array>, name: string) {
  const value = files[name.replace(/^\//, "")];
  if (!value) throw new Error("Fail Excel tiada helaian yang boleh dibaca.");
  return new TextDecoder().decode(value);
}

function colIndex(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "";
  return [...letters].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function sharedStrings(files: Record<string, Uint8Array>) {
  const file = files["xl/sharedStrings.xml"];
  if (!file) return [];
  const parsed = parser.parse(new TextDecoder().decode(file)) as { sst?: { si?: unknown } };
  return list(parsed.sst?.si as Record<string, unknown>[] | Record<string, unknown> | undefined).map((item) => {
    if (typeof item.t === "string") return item.t;
    return list(item.r as Record<string, unknown>[] | Record<string, unknown> | undefined)
      .map((run) => String(run.t ?? "")).join("");
  });
}

function cellValue(cell: Record<string, unknown>, strings: string[]) {
  if (cell["@_t"] === "s") return strings[Number(cell.v)] ?? "";
  if (cell["@_t"] === "inlineStr") {
    const inline = cell.is as Record<string, unknown> | undefined;
    if (typeof inline?.t === "string") return inline.t;
    return list(inline?.r as Record<string, unknown>[] | Record<string, unknown> | undefined)
      .map((run) => String(run.t ?? "")).join("");
  }
  return String(cell.v ?? "");
}

function worksheetGrid(buffer: Buffer) {
  if (!buffer.byteLength || buffer.byteLength > 12 * 1024 * 1024) throw new Error("Fail Excel kosong atau melebihi had 12 MB.");
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(new Uint8Array(buffer)); }
  catch { throw new Error("Fail bukan Excel .xlsx yang sah."); }

  const workbook = parser.parse(xml(files, "xl/workbook.xml")) as { workbook?: { sheets?: { sheet?: unknown } } };
  const firstSheet = list(workbook.workbook?.sheets?.sheet as Record<string, unknown>[] | Record<string, unknown> | undefined)[0];
  const relationshipId = String(firstSheet?.["@_r:id"] ?? "");
  if (!relationshipId) throw new Error("Helaian Excel tidak dapat dikenal pasti.");
  const rels = parser.parse(xml(files, "xl/_rels/workbook.xml.rels")) as { Relationships?: { Relationship?: unknown } };
  const relation = list(rels.Relationships?.Relationship as Record<string, unknown>[] | Record<string, unknown> | undefined)
    .find((item) => item["@_Id"] === relationshipId);
  const target = String(relation?.["@_Target"] ?? "");
  if (!target) throw new Error("Helaian Excel tidak dapat dibuka.");
  const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  const sheet = parser.parse(xml(files, path)) as { worksheet?: { sheetData?: { row?: unknown } } };
  const rows = list(sheet.worksheet?.sheetData?.row as Record<string, unknown>[] | Record<string, unknown> | undefined);
  const strings = sharedStrings(files);
  return rows.map((row) => {
    const values: string[] = [];
    for (const cell of list(row.c as Record<string, unknown>[] | Record<string, unknown> | undefined)) {
      const reference = String(cell["@_r"] ?? "");
      if (reference) values[colIndex(reference)] = cellValue(cell, strings);
    }
    return values;
  });
}

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function amount(value: unknown) {
  const text = String(value ?? "").trim().replace(/,/g, "");
  if (!text || text === "-") return 0;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function count(value: unknown) {
  const parsed = amount(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function sameMetric(left: number, right: number) {
  return Math.round(left * 100) === Math.round(right * 100);
}

function monthKey(value: unknown) {
  const match = String(value ?? "").trim().match(/^([A-Za-z]{3,})\s+(\d{4})$/);
  if (!match) return null;
  const months: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  const month = months[match[1].slice(0, 3).toLowerCase()];
  return month ? `${match[2]}-${month}-01` : null;
}

const metricColumns = [
  ["patient_count", "Patient Count", "count"], ["visit_count", "Encounter Count", "count"],
  ["prescription", "Prescription", "amount"], ["doctor", "Doctor", "amount"], ["other", "Other", "amount"],
  ["manual", "Manual", "amount"], ["discount", "Discount", "amount"], ["rounding", "Rounding", "amount"],
  ["new", "New", "count"], ["existing", "Existing", "count"], ["male", "Male", "count"], ["female", "Female", "count"],
  ["selfpay", "Selfpay", "count"], ["insurance", "Insurance/Panel", "count"]
] as const;

export type GlocoMonthlyBranch = {
  branch_id: string;
  branch_name: string;
  monthly: Record<string, number>;
  total: Record<string, number>;
  payment_method: string;
};

export type GlocoMonthlyReport = {
  report_month: string;
  branches: GlocoMonthlyBranch[];
  summary: Record<string, number>;
  warnings: string[];
};

export function parseGlocoMonthlyReport(buffer: Buffer, branches: Branch[]): GlocoMonthlyReport {
  const grid = worksheetGrid(buffer);
  const byName = new Map(branches.map((branch) => [normalized(branch.name.replace(/^Klinik Afifi\s*/i, "")), branch]));
  const branchData: GlocoMonthlyBranch[] = [];
  let reportMonth = "";
  const summary: Record<string, number> = {};

  for (let rowIndex = 0; rowIndex < grid.length; rowIndex += 1) {
    const branchHeader = String(grid[rowIndex][0] ?? "").match(/^Branch:\s*Klinik Afifi\s*\((.+)\)$/i);
    if (!branchHeader) continue;
    const branch = byName.get(normalized(branchHeader[1]));
    if (!branch) throw new Error(`Cawangan dalam laporan tidak dikenali: ${branchHeader[1]}.`);

    const headerIndex = grid.findIndex((row, index) => index > rowIndex && normalized(row[0]) === "encounterdate");
    if (headerIndex < 0 || headerIndex > rowIndex + 3) throw new Error(`Tajuk lajur ${branch.name} tidak dapat dibaca.`);
    const header = grid[headerIndex];
    const subHeader = grid[headerIndex + 1] ?? [];
    const readRecord = (row: string[]) => {
      const record: Record<string, number> = {};
      for (const [key, title, kind] of metricColumns) {
        const idx = header.findIndex((item, i) => normalized(item) === normalized(title) || (i >= 3 && normalized(subHeader[i]) === normalized(title)));
        if (idx < 0) throw new Error(`Lajur ${title} tiada dalam laporan ${branch.name}.`);
        const parsed = kind === "count" ? count(row[idx]) : amount(row[idx]);
        if (parsed === null) throw new Error(`Angka ${title} tidak sah untuk ${branch.name}.`);
        record[key] = parsed;
      }
      return record;
    };

    const rows = grid.slice(headerIndex + 2, headerIndex + 8).filter((row) => row.some((cell) => String(cell ?? "").trim()));
    const monthlyRow = rows.find((row) => monthKey(row[0]));
    const totalRow = rows.find((row) => normalized(row[0]) === "total");
    if (!monthlyRow || !totalRow) throw new Error(`Baris bulan dan Total tidak lengkap untuk ${branch.name}.`);
    const currentMonth = monthKey(monthlyRow[0])!;
    if (reportMonth && currentMonth !== reportMonth) throw new Error("Laporan mengandungi bulan yang berbeza antara cawangan.");
    reportMonth = currentMonth;
    const methodColumn = header.findIndex((item) => normalized(item) === "paymentmethodtext");
    branchData.push({
      branch_id: branch.id,
      branch_name: branch.name,
      monthly: readRecord(monthlyRow),
      total: readRecord(totalRow),
      payment_method: methodColumn >= 0 ? String(monthlyRow[methodColumn] ?? "") : ""
    });
  }

  const summaryIndex = grid.findIndex((row) => normalized(row[0]) === "summary");
  if (!reportMonth || !branchData.length || summaryIndex < 0) throw new Error("Ini bukan laporan ringkasan bulanan GLOCO mengikut cawangan.");
  const summaryLabels: Record<string, string> = {
    totalselfpay: "selfpay", totalinsurance: "insurance", totalnew: "new", totalexisting: "existing",
    totalmale: "male", totalfemale: "female", totalprescriptioncharges: "prescription", totaldoctorcharges: "doctor",
    totalothercharges: "other", totalmanualcharges: "manual", totaldiscountcharges: "discount", totalroundingcharges: "rounding"
  };
  for (const row of grid.slice(summaryIndex + 1)) {
    for (let i = 0; i < row.length; i += 1) {
      const key = summaryLabels[normalized(row[i])];
      if (!key) continue;
      const valueIndex = i + 1 < row.length && row[i + 1] ? i + 1 : i + 2;
      const parsed = amount(row[valueIndex]);
      if (parsed === null) throw new Error(`Angka ringkasan ${String(row[i])} tidak sah.`);
      summary[key] = parsed;
    }
  }

  const warnings: string[] = [];
  const requiredSummary = ["selfpay", "insurance", "new", "existing", "male", "female", "prescription", "doctor", "other", "manual", "discount", "rounding"];
  const missingSummary = requiredSummary.filter((key) => summary[key] === undefined);
  if (missingSummary.length) warnings.push(`Ringkasan keseluruhan tidak lengkap: ${missingSummary.join(", ")}.`);
  for (const branch of branchData) {
    const differences = metricColumns.filter(([key]) => !sameMetric(branch.monthly[key], branch.total[key]));
    if (differences.length) warnings.push(`${branch.branch_name}: baris bulan dan Total berbeza (${differences.map(([, label]) => label).join(", ")}).`);
  }
  const monthlySum = Object.fromEntries(metricColumns.map(([key]) => [key, branchData.reduce((sum, branch) => sum + branch.monthly[key], 0)]));
  const combinedPatients = (monthlySum.new ?? 0) + (monthlySum.existing ?? 0);
  if (combinedPatients !== (summary.new ?? 0) + (summary.existing ?? 0)) {
    warnings.push(`Jumlah pesakit baharu + sedia ada ikut cawangan (${combinedPatients.toLocaleString()}) tidak sama dengan ringkasan keseluruhan (${((summary.new ?? 0) + (summary.existing ?? 0)).toLocaleString()}).`);
  }
  for (const key of ["new", "existing", "male", "female", "selfpay", "insurance", "prescription", "doctor", "other", "manual", "discount", "rounding"]) {
    if (summary[key] !== undefined && !sameMetric(monthlySum[key], summary[key])) {
      warnings.push(`Jumlah ${key} ikut cawangan (${monthlySum[key].toLocaleString()}) tidak sama dengan ringkasan keseluruhan (${summary[key].toLocaleString()}).`);
    }
  }

  return { report_month: reportMonth, branches: branchData, summary, warnings };
}
