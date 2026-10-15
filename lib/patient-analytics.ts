import "server-only";

import { createClient, hasSupabaseEnv } from "@/lib/supabase-server";
import { getCurrentProfile, hasPermission } from "@/lib/permissions";
import { getVisibleProfilesById } from "@/lib/users";

export type PatientPeriodSummary = {
  period_month: string;
  period_no: number;
  period_start: string;
  period_end: string;
  branch_id: string;
  visit_count: number;
  unique_patient_count: number;
  new_patient_count: number;
  is_complete: boolean;
  last_imported_at: string | null;
  last_imported_by: string | null;
  last_imported_by_name?: string | null;
  branches?: { name: string } | null;
};

export type PatientImportBatch = {
  id: string;
  period_month: string;
  period_no: number;
  period_start: string;
  period_end: string;
  source_filename: string;
  rows_seen: number;
  rows_imported: number;
  duplicate_rows: number;
  new_patient_count: number;
  created_at: string;
  profiles?: { full_name: string } | null;
};

export type PatientBaselineBatch = {
  id: string;
  patient_count: number;
  last_encounter_from: string;
  last_encounter_to: string;
  created_at: string;
  imported_by_name: string | null;
};

export async function getPatientAnalytics() {
  const profile = await getCurrentProfile();
  if (!hasSupabaseEnv()) return { summaries: [] as PatientPeriodSummary[], batches: [] as PatientImportBatch[], baseline: null as PatientBaselineBatch | null, error: null };

  const supabase = await createClient();
  let summaryQuery = supabase
    .from("patient_period_summaries")
    .select("period_month, period_no, period_start, period_end, branch_id, visit_count, unique_patient_count, new_patient_count, is_complete, last_imported_at, last_imported_by, branches(name)")
    .order("period_month", { ascending: false })
    .order("period_no", { ascending: false })
    .limit(200);

  if (profile?.role === "branch_pic" && profile.branch_id) {
    summaryQuery = summaryQuery.eq("branch_id", profile.branch_id);
  }

  const { data: summaryData, error: summaryError } = await summaryQuery;
  if (summaryError) {
    console.error("getPatientAnalytics summaries failed", { code: summaryError.code, message: summaryError.message });
    return { summaries: [] as PatientPeriodSummary[], batches: [] as PatientImportBatch[], baseline: null, error: "Patient analytics setup is not ready. Apply the patient analytics Supabase migration." };
  }

  const summaries = (summaryData ?? []) as unknown as PatientPeriodSummary[];
  const uploaderProfiles = await getVisibleProfilesById(summaries.map((row) => row.last_imported_by));
  const uploaderNames = new Map(uploaderProfiles.map((user) => [user.id, user.full_name]));
  const summariesWithUploader = summaries.map((row) => ({
    ...row,
    last_imported_by_name: row.last_imported_by ? uploaderNames.get(row.last_imported_by) ?? null : null
  }));

  let batches: PatientImportBatch[] = [];
  let baseline: PatientBaselineBatch | null = null;
  if (profile && hasPermission(profile, "manage_patient_imports")) {
    const [{ data: batchData, error: batchError }, { data: baselineData, error: baselineError }] = await Promise.all([
      supabase
      .from("patient_import_batches")
      .select("id, period_month, period_no, period_start, period_end, source_filename, rows_seen, rows_imported, duplicate_rows, new_patient_count, created_at, profiles:profiles!patient_import_batches_imported_by_fkey(full_name)")
      .order("created_at", { ascending: false })
      .limit(30),
      supabase.from("patient_baseline_batches").select("id, patient_count, last_encounter_from, last_encounter_to, created_at, imported_by").eq("is_active", true).maybeSingle()
    ]);
    if (batchError) {
      console.error("getPatientAnalytics import history failed", { code: batchError.code, message: batchError.message });
    } else {
      batches = (batchData ?? []) as unknown as PatientImportBatch[];
    }
    if (baselineError) {
      console.error("getPatientAnalytics baseline status failed", { code: baselineError.code, message: baselineError.message });
    } else if (baselineData) {
      const [uploader] = await getVisibleProfilesById([baselineData.imported_by]);
      baseline = {
        id: baselineData.id,
        patient_count: baselineData.patient_count,
        last_encounter_from: baselineData.last_encounter_from,
        last_encounter_to: baselineData.last_encounter_to,
        created_at: baselineData.created_at,
        imported_by_name: uploader?.full_name ?? null
      };
    }
  }

  return { summaries: summariesWithUploader, batches, baseline, error: null };
}
