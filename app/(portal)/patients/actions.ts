"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase-server";
import { getCurrentProfile, hasPermission } from "@/lib/permissions";
import { getPatientImportPeriod, parsePatientEncounterWorkbook } from "@/lib/patient-import";

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
    const known = new Set<string>();

    for (let offset = 0; offset < patientKeys.length; offset += 500) {
      const { data, error } = await supabase
        .from("patient_registry")
        .select("patient_key")
        .in("patient_key", patientKeys.slice(offset, offset + 500));
      if (error) throw new Error("Could not check this report against the patient history.");
      for (const row of data ?? []) known.add(row.patient_key);
    }

    const seenInFile = new Set<string>();
    const candidateNewIds = patientKeys.filter((key) => {
      if (known.has(key) || seenInFile.has(key)) return false;
      seenInFile.add(key);
      return true;
    }).length;

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
