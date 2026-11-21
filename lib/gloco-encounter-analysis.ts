import "server-only";

import { createClient, hasSupabaseEnv } from "@/lib/supabase-server";
import type { ParsedEncounterAnalysis } from "@/lib/patient-import";

export type EncounterAnalysisImport = {
  id: string;
  report_month: string;
  source_filename: string;
  imported_at: string;
  report_data: ParsedEncounterAnalysis;
};

export async function getEncounterAnalysisImports() {
  if (!hasSupabaseEnv()) return { reports: [] as EncounterAnalysisImport[], error: null };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("gloco_encounter_analysis_imports")
    .select("id, report_month, source_filename, imported_at, report_data")
    .order("report_month", { ascending: false })
    .order("imported_at", { ascending: false })
    .limit(240);

  if (error) {
    console.error("getEncounterAnalysisImports failed", { code: error.code, message: error.message });
    const missing = error.code === "42P01" || error.code === "PGRST205";
    return {
      reports: [] as EncounterAnalysisImport[],
      error: missing ? "Simpanan analisis belum disediakan dalam Supabase Finance." : "Analisis lawatan tidak dapat dibaca."
    };
  }

  const latestByMonth = new Map<string, EncounterAnalysisImport>();
  for (const row of (data ?? []) as unknown as EncounterAnalysisImport[]) {
    if (!latestByMonth.has(row.report_month)) latestByMonth.set(row.report_month, row);
  }
  return { reports: [...latestByMonth.values()], error: null };
}
