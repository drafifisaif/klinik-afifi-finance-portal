"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase-server";
import { getCurrentProfile, hasPermission } from "@/lib/permissions";
import { getPatientImportPeriod, parsePatientBaselineCsv, parsePatientEncounterWorkbook } from "@/lib/patient-import";

type PatientUploadResult = {
  ok: boolean;
  message: string;
  preview?: {
    rows: number;
    invalidRows: number;
    candidateNewIds: number;
    branches: Record<string, number>;
    startDate: string;
    endDate: string;
  };
};

type BaselineUploadResult = {
  ok: boolean;
  message: string;
  preview?: { patients: number; duplicateRows: number; invalidRows: number; firstDate: string; lastDate: string };
};

async function parseBaselineUpload(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile || !hasPermission(profile, "manage_patient_imports")) {
    throw new Error("Only Owner or Finance can import the historical patient list.");
  }
  const file = formData.get("baseline");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose the original patient CSV first.");
  if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("Please upload the patient list as CSV.");
  const parsed = parsePatientBaselineCsv(Buffer.from(await file.arrayBuffer()));
  if (parsed.patients.length > 100000) throw new Error("The patient list exceeds the 100,000 PID limit.");
  return { parsed, profile };
}

export async function previewPatientBaseline(formData: FormData): Promise<BaselineUploadResult> {
  try {
    const { parsed } = await parseBaselineUpload(formData);
    return {
      ok: true,
      message: "Baseline preview ready. Names, addresses, and phone numbers are ignored.",
      preview: {
        patients: parsed.patients.length,
        duplicateRows: parsed.duplicateRows,
        invalidRows: parsed.invalidRows,
        firstDate: parsed.firstDate,
        lastDate: parsed.lastDate
      }
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not read the patient list." };
  }
}

export async function importPatientBaseline(formData: FormData): Promise<BaselineUploadResult> {
  try {
    const { parsed, profile } = await parseBaselineUpload(formData);
    if (parsed.invalidRows > 0) throw new Error(`${parsed.invalidRows} rows have a missing PID or invalid Last Encounter date. No data was saved.`);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("import_patient_historical_baseline", {
      p_patients: parsed.patients.map((patient) => ({
        patient_key: patient.patientKey,
        last_encounter_date: patient.lastEncounterDate
      }))
    });
    if (error) {
      console.error("importPatientBaseline failed", {
        userId: profile.id,
        role: profile.role,
        rowCount: parsed.patients.length,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      if (error.code === "42501") throw new Error("Only Owner or Finance can import the historical patient list.");
      throw new Error("The historical patient list could not be saved. No patient identifiers were included in the error log.");
    }
    const result = Array.isArray(data) ? data[0] : data;
    revalidatePath("/patients");
    revalidatePath("/dashboard");
    return {
      ok: true,
      message: `Historical baseline saved: ${Number(result?.patient_count ?? parsed.patients.length).toLocaleString()} existing patient IDs. Branch is not assigned; names, addresses, and phone numbers were not stored.`
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not save the historical patient list." };
  }
}

async function parseUpload(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile || !hasPermission(profile, "manage_patient_imports")) {
    throw new Error("Only Owner or Finance can import patient reports.");
  }

  const file = formData.get("report");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a GLOCO Excel report first.");
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Please upload the Excel .xlsx report from GLOCO.");

  const month = String(formData.get("period_month") ?? "");
  const periodNo = Number(formData.get("period_no"));
  const period = getPatientImportPeriod(month, periodNo);
  const supabase = await createClient();
  const { data: branchRows, error: branchError } = await supabase
    .from("branches")
    .select("id, name, code, is_active")
    .eq("is_active", true);
  if (branchError || !branchRows) throw new Error("Could not load active branch names for this report.");

  const parsed = parsePatientEncounterWorkbook(Buffer.from(await file.arrayBuffer()), branchRows);
  if (parsed.encounters.length > 20000) throw new Error("This report has more than 20,000 valid rows. Please split it into smaller reports.");
  if (parsed.invalidRows > 0) {
    throw new Error(`${parsed.invalidRows} report rows could not be matched. Check encounter dates, PID/Encounter values, and branch names; no data was saved.`);
  }
  if (parsed.dates.some((date) => date < period.startDate || date > period.endDate)) {
    throw new Error("The report contains encounters outside the selected reporting period.");
  }

  return { period, parsed, profile, supabase };
}

export async function previewPatientReport(formData: FormData): Promise<PatientUploadResult> {
  try {
    const { parsed, period, supabase } = await parseUpload(formData);
    const patientKeys = [...new Set(parsed.encounters.map((encounter) => encounter.patientKey))];
    let knownCount = 0;

    for (let offset = 0; offset < patientKeys.length; offset += 5000) {
      const { data, error } = await supabase.rpc("count_known_patient_ids", {
        p_patient_keys: patientKeys.slice(offset, offset + 5000)
      });
      if (error) throw new Error("Could not check this report against the patient history.");
      knownCount += Number(data ?? 0);
    }
    const candidateNewIds = Math.max(patientKeys.length - knownCount, 0);

    return {
      ok: true,
      message: "Preview ready. No patient names or raw IDs are shown here.",
      preview: {
        rows: parsed.encounters.length,
        invalidRows: parsed.invalidRows,
        candidateNewIds,
        branches: parsed.branchCounts,
        startDate: period.startDate,
        endDate: period.endDate
      }
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not read this GLOCO report." };
  }
}

export async function importPatientReport(formData: FormData): Promise<PatientUploadResult> {
  try {
    const { period, parsed, profile, supabase } = await parseUpload(formData);
    const { data, error } = await supabase.rpc("import_patient_encounters", {
      p_period_month: period.monthStart,
      p_period_no: period.periodNo,
      p_period_start: period.startDate,
      p_period_end: period.endDate,
      p_source_filename: "GLOCO report",
      p_encounters: parsed.encounters.map((encounter) => ({
        patient_key: encounter.patientKey,
        encounter_key: encounter.encounterKey,
        encounter_date: encounter.encounterDate,
        branch_id: encounter.branchId
      }))
    });

    if (error) {
      console.error("importPatientReport failed", {
        userId: profile.id,
        role: profile.role,
        periodStart: period.startDate,
        periodEnd: period.endDate,
        rowCount: parsed.encounters.length,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      if (error.code === "42501") throw new Error("Only Owner or Finance can import patient reports.");
      throw new Error("The patient report could not be imported. Check the selected period and report rows.");
    }

    const result = Array.isArray(data) ? data[0] : data;
    const imported = Number(result?.inserted_count ?? 0);
    const duplicates = Number(result?.duplicate_count ?? 0);
    const newIds = Number(result?.new_patient_count ?? 0);
    revalidatePath("/patients");
    revalidatePath("/dashboard");

    return {
      ok: true,
      message: `Import complete: ${imported} visits added, ${duplicates} duplicate rows skipped, ${newIds} IDs first seen in portal data. ${parsed.invalidRows} invalid rows were ignored.`
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The patient report could not be imported." };
  }
}
