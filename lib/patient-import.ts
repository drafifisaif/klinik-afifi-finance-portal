import "server-only";

import { createHmac } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";
import type { Branch } from "@/lib/types";

export type ParsedPatientEncounter = {
  patientKey: string;
  encounterKey: string;
  encounterDate: string;
  branchId: string;
};

export type PatientReportParseResult = {
  encounters: ParsedPatientEncounter[];
  invalidRows: number;
  branchCounts: Record<string, number>;
  dates: string[];
};

export type PatientBaselineRecord = { patientKey: string; lastEncounterDate: string };

export type PatientBaselineParseResult = {
  patients: PatientBaselineRecord[];
  duplicateRows: number;
  invalidRows: number;
  firstDate: string;
  lastDate: string;
};

export function getPatientImportPeriod(month: string, periodNo: number) {
  if (!/^\d{4}-\d{2}$/.test(month) || periodNo < 1 || periodNo > 4 || !Number.isInteger(periodNo)) {
    throw new Error("Choose a valid reporting month and period.");
  }
  const [year, monthNumber] = month.split("-").map(Number);
  if (monthNumber < 1 || monthNumber > 12) throw new Error("Choose a valid reporting month and period.");
  const monthStart = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const startDay = [1, 8, 15, 22][periodNo - 1];
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const endDay = periodNo === 4 ? lastDay : startDay + 6;
  return {
    monthStart,
    periodNo,
    startDate: `${month}-${String(startDay).padStart(2, "0")}`,
    endDate: `${month}-${String(endDay).padStart(2, "0")}`
  };
}

export function getPatientImportMonth(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Choose a valid reporting month.");
  const [year, monthNumber] = month.split("-").map(Number);
  if (monthNumber < 1 || monthNumber > 12) throw new Error("Choose a valid reporting month.");
  const monthStart = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { monthStart, startDate: monthStart, endDate: `${month}-${String(lastDay).padStart(2, "0")}` };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function xmlFile(files: Record<string, Uint8Array>, name: string) {
  const normalizedName = name.replace(/^\//, "");
  const file = files[normalizedName];
  if (!file) throw new Error("The spreadsheet is missing a required worksheet.");
  return new TextDecoder().decode(file);
}

function columnNumber(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "";
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function cellText(cell: Record<string, unknown>, sharedStrings: string[]) {
  const type = String(cell["@_t"] ?? "");
  if (type === "s") return sharedStrings[Number(cell.v)] ?? "";
  if (type === "inlineStr") {
    const inline = cell.is as Record<string, unknown> | undefined;
    const text = inline?.t;
    if (typeof text === "string") return text;
    const runs = asArray(inline?.r as Record<string, unknown> | Record<string, unknown>[] | undefined);
    return runs.map((run) => String((run.t as string | undefined) ?? "")).join("");
  }
  return String(cell.v ?? "");
}

function sharedStringList(files: Record<string, Uint8Array>) {
  const bytes = files["xl/sharedStrings.xml"];
  if (!bytes) return [];
  const parsed = parser.parse(new TextDecoder().decode(bytes)) as { sst?: { si?: unknown } };
  return asArray(parsed.sst?.si as Record<string, unknown> | Record<string, unknown>[] | undefined).map((item) => {
    if (typeof item.t === "string") return item.t;
    return asArray(item.r as Record<string, unknown> | Record<string, unknown>[] | undefined)
      .map((run) => String((run.t as string | undefined) ?? ""))
      .join("");
  });
}

function firstWorksheetPath(files: Record<string, Uint8Array>) {
  const workbook = parser.parse(xmlFile(files, "xl/workbook.xml")) as {
    workbook?: { sheets?: { sheet?: unknown } };
  };
  const firstSheet = asArray(workbook.workbook?.sheets?.sheet as Record<string, unknown> | Record<string, unknown>[] | undefined)[0];
  const relationshipId = String(firstSheet?.["@_r:id"] ?? "");
  if (!relationshipId) throw new Error("The spreadsheet has no readable worksheet.");

  const relationships = parser.parse(xmlFile(files, "xl/_rels/workbook.xml.rels")) as {
    Relationships?: { Relationship?: unknown };
  };
  const relation = asArray(relationships.Relationships?.Relationship as Record<string, unknown> | Record<string, unknown>[] | undefined)
    .find((item) => item["@_Id"] === relationshipId);
  const target = String(relation?.["@_Target"] ?? "");
  if (!target) throw new Error("The spreadsheet worksheet could not be located.");
  return target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
}

function excelDate(value: string) {
  const normalized = value.trim().replace(/\s+\d{1,2}:\d{2}(?::\d{2})?$/, "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;

  const dmy = normalized.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,}|\d{1,2})[-/ ,](\d{2,4})$/);
  if (dmy) {
    const months: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
    };
    const month = /^\d+$/.test(dmy[2]) ? Number(dmy[2]) : months[dmy[2].slice(0, 3).toLowerCase()];
    let year = Number(dmy[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (month >= 1 && month <= 12 && Number(dmy[1]) >= 1 && Number(dmy[1]) <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(Number(dmy[1])).padStart(2, "0")}`;
    }
  }

  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

export function parsePatientBaselineCsv(buffer: Buffer): PatientBaselineParseResult {
  if (buffer.byteLength > 10 * 1024 * 1024) throw new Error("The patient list is too large. Maximum file size is 10 MB.");
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const headers: string[] = [];
  let rowNumber = 0;
  let columnNumber = 0;
  let field = "";
  let quoted = false;
  let pidColumn = -1;
  let lastEncounterColumn = -1;
  let pid = "";
  let encounter = "";
  let invalidRows = 0;
  let duplicateRows = 0;
  let firstDate = "";
  let lastDate = "";
  const byPatient = new Map<string, string>();

  const consumeField = () => {
    const value = field.trim();
    if (rowNumber === 0) {
      headers.push(value);
    } else if (columnNumber === pidColumn) {
      pid = value;
    } else if (columnNumber === lastEncounterColumn) {
      encounter = value;
    }
    field = "";
    columnNumber += 1;
  };

  const consumeRow = () => {
    if (rowNumber === 0) {
      pidColumn = headers.findIndex((header) => normalizeHeader(header) === "pid");
      lastEncounterColumn = headers.findIndex((header) => normalizeHeader(header) === "lastencounter");
      if (pidColumn < 0 || lastEncounterColumn < 0) {
        throw new Error("The patient list must include PID and Last Encounter columns.");
      }
    } else if (pid || encounter) {
      const lastEncounterDate = excelDate(encounter);
      if (!pid || !lastEncounterDate) {
        invalidRows += 1;
      } else {
        const patientKey = keyedPatientId(pid);
        const previousDate = byPatient.get(patientKey);
        if (previousDate !== undefined) {
          duplicateRows += 1;
          if (lastEncounterDate > previousDate) byPatient.set(patientKey, lastEncounterDate);
        } else {
          byPatient.set(patientKey, lastEncounterDate);
        }
        if (!firstDate || lastEncounterDate < firstDate) firstDate = lastEncounterDate;
        if (!lastDate || lastEncounterDate > lastDate) lastDate = lastEncounterDate;
      }
    }
    rowNumber += 1;
    columnNumber = 0;
    pid = "";
    encounter = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"') {
      if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if ([",", "\r", "\n", undefined].includes(text[index + 1])) {
        quoted = false;
      } else {
        field += char;
      }
    } else if (quoted) {
      field += char;
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ",") {
      consumeField();
    } else if (char === "\r" || char === "\n") {
      consumeField();
      consumeRow();
      if (char === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      field += char;
    }
  }
  if (field.length || columnNumber || rowNumber === 0) {
    consumeField();
    consumeRow();
  }

  if (!byPatient.size) throw new Error("No valid PID and Last Encounter rows were found.");
  return {
    patients: [...byPatient].map(([patientKey, lastEncounterDate]) => ({ patientKey, lastEncounterDate })),
    duplicateRows,
    invalidRows,
    firstDate,
    lastDate
  };
}

function normalizeBranchName(value: string) {
  return value.trim().toLowerCase()
    .replace(/^klinik\s+afifi\s*/, "")
    .replace(/[()]/g, "")
    .trim();
}

function getColumn(headers: string[], candidates: string[]) {
  const normalizedCandidates = candidates.map(normalizeHeader);
  return headers.findIndex((header) => normalizedCandidates.includes(normalizeHeader(header)));
}

function hashIdentifier(value: string, purpose: "patient" | "encounter") {
  const secret = process.env.PATIENT_ID_HMAC_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("Patient import is not configured. Add a private PATIENT_ID_HMAC_SECRET in Vercel and restart the deployment.");
  }
  return createHmac("sha256", secret).update(`${purpose}:${value}`).digest("hex");
}

export function keyedPatientId(value: string) {
  return hashIdentifier(value.trim().toUpperCase(), "patient");
}

export function keyedEncounterId(value: string) {
  return hashIdentifier(value.trim().toUpperCase(), "encounter");
}

export function parsePatientEncounterWorkbook(buffer: Buffer, branches: Branch[]): PatientReportParseResult {
  if (buffer.byteLength > 12 * 1024 * 1024) throw new Error("The report is too large. Maximum file size is 12 MB.");

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error("Could not read this Excel file. Please download it again from GLOCO.");
  }

  const worksheetPath = firstWorksheetPath(files);
  const worksheet = parser.parse(xmlFile(files, worksheetPath)) as {
    worksheet?: { sheetData?: { row?: unknown } };
  };
  const rows = asArray(worksheet.worksheet?.sheetData?.row as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const strings = sharedStringList(files);
  const grid = rows.map((row) => {
    const cells = asArray(row.c as Record<string, unknown> | Record<string, unknown>[] | undefined);
    const values: string[] = [];
    for (const cell of cells) {
      const reference = String(cell["@_r"] ?? "");
      if (reference) values[columnNumber(reference)] = cellText(cell, strings);
    }
    return values;
  });

  const headerIndex = grid.findIndex((row) =>
    row.some((cell) => normalizeHeader(cell) === "encounterdate") &&
    row.some((cell) => normalizeHeader(cell) === "pidencounter") &&
    row.some((cell) => normalizeHeader(cell) === "branchname")
  );
  if (headerIndex < 0) {
    throw new Error("Required GLOCO columns were not found. Expected Encounter Date, PID/Encounter, and Branch Name.");
  }

  const headers = grid[headerIndex];
  const dateColumn = getColumn(headers, ["Encounter Date"]);
  const patientEncounterColumn = getColumn(headers, ["PID/Encounter"]);
  const branchColumn = getColumn(headers, ["Branch Name"]);
  const branchByName = new Map(branches.map((branch) => [normalizeBranchName(branch.name), branch]));
  const encounters: ParsedPatientEncounter[] = [];
  const branchCounts: Record<string, number> = {};
  const dates = new Set<string>();
  let invalidRows = 0;

  for (const row of grid.slice(headerIndex + 1)) {
    if (!row.some((value) => String(value ?? "").trim())) continue;
    const rawCombined = String(row[patientEncounterColumn] ?? "").trim();
    const separatorIndex = rawCombined.lastIndexOf("/");
    const pid = separatorIndex > 0 ? rawCombined.slice(0, separatorIndex).trim() : "";
    const encounterNumber = separatorIndex > 0 ? rawCombined.slice(separatorIndex + 1).trim() : "";
    const encounterDate = excelDate(String(row[dateColumn] ?? ""));
    const branchName = normalizeBranchName(String(row[branchColumn] ?? ""));
    const branch = branchByName.get(branchName);

    if (!pid || !encounterNumber || !encounterDate || !branch) {
      invalidRows += 1;
      continue;
    }

    encounters.push({
      patientKey: keyedPatientId(pid),
      encounterKey: keyedEncounterId(`${pid}:${encounterNumber}`),
      encounterDate,
      branchId: branch.id
    });
    dates.add(encounterDate);
    branchCounts[branch.name] = (branchCounts[branch.name] ?? 0) + 1;
  }

  if (!encounters.length) throw new Error("No valid patient encounters were found in this report.");
  if (encounters.length > 50000) throw new Error("This report has more than 50,000 valid rows. Please split it into smaller periods.");

  return { encounters, invalidRows, branchCounts, dates: [...dates].sort() };
}

export type EncounterAnalysisGroup = {
  visits: number;
  unique_patients: number;
  new_patients: number;
  existing_patients: number;
  gross_charges: number;
  net_charges: number;
  charges: Record<string, number>;
  payments: Record<string, number>;
};

export type ParsedEncounterAnalysis = {
  report_month: string;
  total_visits: number;
  unique_patients: number;
  cross_branch_patients: number;
  branch_patient_excess: number;
  new_patients: number;
  existing_patients: number;
  gross_charges: number;
  net_charges: number;
  charges: Record<string, number>;
  payments: Record<string, number>;
  price_levels: Record<string, EncounterAnalysisGroup>;
  patient_types: Record<string, number>;
  genders: Record<string, number>;
  weekdays: Record<string, number>;
  hours: Record<string, number>;
  branches: Array<EncounterAnalysisGroup & { branch_id: string; branch_name: string; price_levels: Record<string, EncounterAnalysisGroup> }>;
};

const analysisChargeLabels = ["Prescription", "Doctor", "Other", "Manual", "Discount", "Rounding"] as const;
const analysisPaymentLabels = ["Cash", "Cheque", "Credit Card", "Debit Card", "Wire Transfer", "Others", "Write Off"] as const;

function analysisAmount(value: unknown) {
  const text = String(value ?? "").trim().replace(/,/g, "");
  if (!text || text === "-") return 0;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function cents(value: number) {
  return Math.round(value * 100) / 100;
}

export function parseEncounterAnalysisWorkbook(buffer: Buffer, branches: Branch[]): ParsedEncounterAnalysis {
  if (buffer.byteLength > 12 * 1024 * 1024) throw new Error("Fail laporan melebihi had 12 MB.");
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(new Uint8Array(buffer)); }
  catch { throw new Error("Fail Excel tidak dapat dibaca. Muat turun semula laporan daripada GLOCO."); }

  const worksheet = parser.parse(xmlFile(files, firstWorksheetPath(files))) as { worksheet?: { sheetData?: { row?: unknown } } };
  const rows = asArray(worksheet.worksheet?.sheetData?.row as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const strings = sharedStringList(files);
  const grid = rows.map((row) => {
    const cells = asArray(row.c as Record<string, unknown> | Record<string, unknown>[] | undefined);
    const values: string[] = [];
    for (const cell of cells) {
      const reference = String(cell["@_r"] ?? "");
      if (reference) values[columnNumber(reference)] = cellText(cell, strings);
    }
    return values;
  });
  const headerIndex = grid.findIndex((row) =>
    row.some((cell) => normalizeHeader(cell) === "encounterdate") &&
    row.some((cell) => normalizeHeader(cell) === "pidencounter") &&
    row.some((cell) => normalizeHeader(cell) === "branchname")
  );
  if (headerIndex < 0) throw new Error("Laporan perlu ada lajur Encounter Date, PID/Encounter dan Branch Name.");

  const header = grid[headerIndex];
  const subHeader = grid[headerIndex + 1] ?? [];
  const findColumn = (label: string, useSubHeader = false) => {
    const source = useSubHeader ? subHeader : header;
    return source.findIndex((cell) => normalizeHeader(cell) === normalizeHeader(label));
  };
  const required = {
    date: findColumn("Encounter Date"), pid: findColumn("PID/Encounter"), price: findColumn("Price Level"),
    gender: findColumn("Patient Gender"), type: findColumn("Patient Type"), branch: findColumn("Branch Name")
  };
  if (Object.values(required).some((index) => index < 0)) throw new Error("Ada lajur wajib yang tiada dalam laporan.");
  const chargeColumns = Object.fromEntries(analysisChargeLabels.map((label) => [label, findColumn(label, true)]));
  const paymentColumns = Object.fromEntries(analysisPaymentLabels.map((label) => [label, findColumn(label, true)]));
  if (Object.values(chargeColumns).some((index) => index < 0) || Object.values(paymentColumns).some((index) => index < 0)) {
    throw new Error("Lajur kategori caj atau cara bayaran tidak lengkap.");
  }

  const branchByName = new Map(branches.map((branch) => [normalizeBranchName(branch.name), branch]));
  type InternalGroup = { metrics: EncounterAnalysisGroup; people: Map<string, Set<string>> };
  const makeGroup = (): InternalGroup => ({
    metrics: {
      visits: 0, unique_patients: 0, new_patients: 0, existing_patients: 0, gross_charges: 0, net_charges: 0,
      charges: Object.fromEntries(analysisChargeLabels.map((label) => [label, 0])),
      payments: Object.fromEntries(analysisPaymentLabels.map((label) => [label, 0]))
    },
    people: new Map()
  });
  const overall = makeGroup();
  const branchGroups = new Map<string, InternalGroup>();
  const priceGroups = new Map<string, InternalGroup>();
  const branchPriceGroups = new Map<string, Map<string, InternalGroup>>();
  const allPeople = new Map<string, { types: Set<string>; branches: Set<string> }>();
  const patientTypes: Record<string, number> = {};
  const genders: Record<string, number> = {};
  const weekdays: Record<string, number> = {};
  const hours: Record<string, number> = {};
  const dateSet = new Set<string>();
  const weekdayLabels = ["Ahad", "Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu"];
  let validRows = 0;
  let invalidRows = 0;

  const addNumber = (target: Record<string, number>, label: string, value: number) => { target[label] = cents((target[label] ?? 0) + value); };
  const addEncounter = (group: InternalGroup, pid: string, patientType: string, charges: Record<string, number>, payments: Record<string, number>) => {
    const m = group.metrics;
    m.visits += 1;
    if (!group.people.has(pid)) group.people.set(pid, new Set());
    const types = group.people.get(pid)!;
    if (patientType) types.add(patientType);
    for (const label of analysisChargeLabels) addNumber(m.charges, label, charges[label]);
    for (const label of analysisPaymentLabels) addNumber(m.payments, label, payments[label]);
    const gross = charges.Prescription + charges.Doctor + charges.Other + charges.Manual;
    m.gross_charges = cents(m.gross_charges + gross);
    m.net_charges = cents(m.net_charges + gross + charges.Discount + charges.Rounding);
  };

  for (const row of grid.slice(headerIndex + 2)) {
    const rawDate = String(row[required.date] ?? "").trim();
    const rawCombined = String(row[required.pid] ?? "").trim();
    if (!rawDate && !rawCombined) continue;
    if (!/^\d{1,2}[/-]\d{1,2}[/-]\d{4}/.test(rawDate) || !rawCombined.includes("/")) continue;

    const separatorIndex = rawCombined.lastIndexOf("/");
    const pid = rawCombined.slice(0, separatorIndex).trim().toUpperCase();
    const encounterDate = excelDate(rawDate);
    const branch = branchByName.get(normalizeBranchName(String(row[required.branch] ?? "")));
    if (!pid || !encounterDate || !branch) { invalidRows += 1; continue; }
    const date = new Date(`${encounterDate}T00:00:00Z`);
    const month = encounterDate.slice(0, 7);
    dateSet.add(month);
    const type = String(row[required.type] ?? "").trim().toLowerCase();
    const priceText = normalizeHeader(row[required.price]);
    const priceKey = priceText === "selfpay" ? "Selfpay" : priceText.includes("panel") || priceText.includes("insurance") ? "Panel" : "Lain-lain";
    const gender = String(row[required.gender] ?? "").trim() || "Tidak dinyatakan";
    const charges = Object.fromEntries(analysisChargeLabels.map((label) => {
      const amount = analysisAmount(row[chargeColumns[label]]);
      return [label, amount];
    })) as Record<string, number>;
    const payments = Object.fromEntries(analysisPaymentLabels.map((label) => {
      const amount = analysisAmount(row[paymentColumns[label]]);
      return [label, amount];
    })) as Record<string, number>;
    if ([...Object.values(charges), ...Object.values(payments)].some((amount) => amount === null)) { invalidRows += 1; continue; }

    const branchGroup = branchGroups.get(branch.id) ?? makeGroup();
    branchGroups.set(branch.id, branchGroup);
    addEncounter(overall, pid, type, charges, payments);
    addEncounter(branchGroup, pid, type, charges, payments);
    const priceGroup = priceGroups.get(priceKey) ?? makeGroup();
    priceGroups.set(priceKey, priceGroup);
    addEncounter(priceGroup, pid, type, charges, payments);
    const branchPrices = branchPriceGroups.get(branch.id) ?? new Map<string, InternalGroup>();
    branchPriceGroups.set(branch.id, branchPrices);
    const branchPriceGroup = branchPrices.get(priceKey) ?? makeGroup();
    branchPrices.set(priceKey, branchPriceGroup);
    addEncounter(branchPriceGroup, pid, type, charges, payments);

    if (!allPeople.has(pid)) allPeople.set(pid, { types: new Set(), branches: new Set() });
    const person = allPeople.get(pid)!;
    if (type) person.types.add(type);
    person.branches.add(branch.id);
    addNumber(patientTypes, type === "new" ? "New" : type === "existing" ? "Existing" : "Lain-lain", 1);
    addNumber(genders, gender, 1);
    addNumber(weekdays, weekdayLabels[date.getUTCDay()], 1);
    const hour = rawDate.match(/\s(\d{1,2}):/);
    if (hour) addNumber(hours, `${String(Number(hour[1])).padStart(2, "0")}:00`, 1);
    validRows += 1;
  }

  if (!validRows || dateSet.size !== 1) throw new Error("Fail mesti mengandungi rekod lawatan untuk satu bulan sahaja.");
  if (invalidRows) throw new Error(`${invalidRows.toLocaleString()} baris lawatan tidak lengkap atau cawangan tidak dikenali. Tiada analisis disimpan.`);
  const allGroups = [overall, ...branchGroups.values(), ...priceGroups.values(), ...[...branchPriceGroups.values()].flatMap((groups) => [...groups.values()])];
  for (const group of allGroups) {
    group.metrics.unique_patients = group.people.size;
    for (const types of group.people.values()) {
      if (types.has("new")) group.metrics.new_patients += 1;
      else if (types.has("existing")) group.metrics.existing_patients += 1;
    }
  }
  const branchList = branches.filter((branch) => branchGroups.has(branch.id)).map((branch) => ({
    branch_id: branch.id,
    branch_name: branch.name,
    ...branchGroups.get(branch.id)!.metrics,
    price_levels: Object.fromEntries([...(branchPriceGroups.get(branch.id) ?? new Map())].map(([key, group]) => [key, group.metrics]))
  }));
  const uniquePatients = allPeople.size;
  return {
    report_month: `${[...dateSet][0]}-01`,
    total_visits: overall.metrics.visits,
    unique_patients: uniquePatients,
    cross_branch_patients: [...allPeople.values()].filter((person) => person.branches.size > 1).length,
    branch_patient_excess: branchList.reduce((sum, branch) => sum + branch.unique_patients, 0) - uniquePatients,
    new_patients: [...allPeople.values()].filter((person) => person.types.has("new")).length,
    existing_patients: [...allPeople.values()].filter((person) => !person.types.has("new") && person.types.has("existing")).length,
    gross_charges: overall.metrics.gross_charges,
    net_charges: overall.metrics.net_charges,
    charges: overall.metrics.charges,
    payments: overall.metrics.payments,
    price_levels: Object.fromEntries([...priceGroups.entries()].map(([key, group]) => [key, group.metrics])),
    patient_types: patientTypes,
    genders,
    weekdays,
    hours,
    branches: branchList
  };
}
