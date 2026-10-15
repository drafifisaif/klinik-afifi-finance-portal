"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
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
};

const PATIENT_BASELINE_BUCKET = "patient-import-staging";

async function requirePatientImportProfile() {
  const profile = await getCurrentProfile();
  if (!profile || !hasPermission(profile, "manage_patient_imports")) {
    throw new Error("Only Owner or Finance can import the historical patient list.");
  }
  return profile;
}

export async function createPatientBaselineUpload(): Promise<{ ok: boolean; message: string; path?: string; token?: string }> {
  try {
    const supabase = await createClient();
    const profile = await requirePatientImportProfile();
    const path = `${profile.id}/${randomUUID()}.csv`;
    const { data, error } = await supabase.storage.from(PATIENT_BASELINE_BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      console.error("createPatientBaselineUpload failed", { userId: profile.id, code: error?.name, message: error?.message });
      throw new Error("Ruang upload private belum siap. Sila hubungi admin portal.");
    }
    return { ok: true, message: "Upload selamat disediakan.", path, token: data.token };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not prepare a secure patient upload." };
  }
}

export async function discardPatientBaselineUpload(path: string): Promise<void> {
  try {
    const profile = await requirePatientImportProfile();
    if (!path.startsWith(`${profile.id}/`) || !/^[0-9a-f-]{36}\.csv$/i.test(path.slice(profile.id.length + 1))) return;
    const admin = createAdminClient();
    await admin.storage.from(PATIENT_BASELINE_BUCKET).remove([path]);
  } catch (error) {
    console.error("discardPatientBaselineUpload failed", error instanceof Error ? error.message : "unknown error");
  }
}

export async function importPatientBaseline(path: string): Promise<BaselineUploadResult> {
  let profileId = "";
  let admin: ReturnType<typeof createAdminClient> | null = null;
  let userClient: Awaited<ReturnType<typeof createClient>> | null = null;
  let stagedBatchId: string | null = null;
  try {
    const profile = await requirePatientImportProfile();
    profileId = profile.id;
    if (!path.startsWith(`${profile.id}/`) || !/^[0-9a-f-]{36}\.csv$/i.test(path.slice(profile.id.length + 1))) {
      throw new Error("Fail import tidak sah atau bukan milik akaun ini.");
    }
    admin = createAdminClient();
    const { data: file, error: downloadError } = await admin.storage.from(PATIENT_BASELINE_BUCKET).download(path);
    if (downloadError || !file) {
      console.error("importPatientBaseline download failed", { userId: profile.id, code: downloadError?.name, message: downloadError?.message });
      throw new Error("Fail sementara tidak dapat dibaca. Sila upload semula.");
    }
    if (file.size === 0 || file.size > 10 * 1024 * 1024) throw new Error("Fail CSV kosong atau melebihi had 10 MB.");
    const parsed = parsePatientBaselineCsv(Buffer.from(await file.arrayBuffer()));
    if (parsed.invalidRows > 0) throw new Error(`${parsed.invalidRows.toLocaleString()} baris tiada PID atau tarikh Last Encounter tidak sah. Tiada data disimpan.`);
    if (parsed.patients.length > 100000) throw new Error("Senarai pesakit melebihi had 100,000 PID.");
    const supabase = await createClient();
    userClient = supabase;
    const { data: batchData, error: batchError } = await supabase.rpc("start_patient_baseline_import", {
      p_patient_count: parsed.patients.length,
      p_first_date: parsed.firstDate,
      p_last_date: parsed.lastDate
    });
    if (batchError || !batchData) {
      console.error("importPatientBaseline start failed", { userId: profile.id, role: profile.role, rowCount: parsed.patients.length, code: batchError?.code, message: batchError?.message });
      if (batchError?.code === "42501") throw new Error("Only Owner or Finance can import the historical patient list.");
      throw new Error("Baseline import could not be started. No existing baseline was changed.");
    }
    stagedBatchId = String(batchData);

    const chunkSize = 2500;
    for (let offset = 0; offset < parsed.patients.length; offset += chunkSize) {
      const { error: chunkError } = await supabase.rpc("append_patient_baseline_import", {
        p_batch_id: stagedBatchId,
        p_patients: parsed.patients.slice(offset, offset + chunkSize).map((patient) => ({
          patient_key: patient.patientKey,
          last_encounter_date: patient.lastEncounterDate
        }))
      });
      if (chunkError) {
        console.error("importPatientBaseline chunk failed", { userId: profile.id, role: profile.role, rowOffset: offset, chunkSize: Math.min(chunkSize, parsed.patients.length - offset), code: chunkError.code, message: chunkError.message });
        if (chunkError.code === "42501") throw new Error("Only Owner or Finance can import the historical patient list.");
        throw new Error("A patient baseline batch could not be saved. The existing baseline remains active.");
      }
    }

    const { data: finalData, error: finalError } = await supabase.rpc("finalize_patient_baseline_import", { p_batch_id: stagedBatchId });
    if (finalError || !finalData) {
      console.error("importPatientBaseline finalize failed", { userId: profile.id, role: profile.role, rowCount: parsed.patients.length, code: finalError?.code, message: finalError?.message });
      if (finalError?.code === "42501") throw new Error("Only Owner or Finance can import the historical patient list.");
      throw new Error("The baseline could not be finalized. The existing baseline remains active.");
    }
    const result = Array.isArray(finalData) ? finalData[0] : finalData;
    stagedBatchId = null;
    revalidatePath("/patients");
    revalidatePath("/dashboard");
    return {
      ok: true,
      message: `Historical baseline saved: ${Number(result?.patient_count ?? parsed.patients.length).toLocaleString()} existing patient IDs. Branch is not assigned; names, addresses, and phone numbers were not stored.`
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not save the historical patient list." };
  } finally {
    if (stagedBatchId) {
      try {
        if (userClient) {
          const { error } = await userClient.rpc("discard_patient_baseline_import", { p_batch_id: stagedBatchId });
          if (error) console.error("importPatientBaseline staged cleanup failed", { userId: profileId, code: error.code, message: error.message });
        }
      } catch (error) {
        console.error("importPatientBaseline staged cleanup failed", { userId: profileId, message: error instanceof Error ? error.message : "unknown error" });
      }
    }
    if (admin && path.startsWith(`${profileId}/`)) {
      const { error } = await admin.storage.from(PATIENT_BASELINE_BUCKET).remove([path]);
      if (error) console.error("importPatientBaseline cleanup failed", { userId: profileId, code: error.name, message: error.message });
    }
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
