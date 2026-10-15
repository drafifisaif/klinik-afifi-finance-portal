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
