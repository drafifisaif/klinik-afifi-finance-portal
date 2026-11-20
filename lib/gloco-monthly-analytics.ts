import "server-only";

import { createClient, hasSupabaseEnv } from "@/lib/supabase-server";
import type { GlocoMonthlyReport } from "@/lib/gloco-monthly-report";

export type GlocoMonthlyImport = {
  id: string;
  report_month: string;
  source_filename: string;
  imported_at: string;
  report_data: GlocoMonthlyReport;
};

export async function getGlocoMonthlyImports() {
  if (!hasSupabaseEnv()) return { reports: [] as GlocoMonthlyImport[], error: null };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("gloco_monthly_report_imports")
    .select("id, report_month, source_filename, imported_at, report_data")
    .order("report_month", { ascending: false })
    .order("imported_at", { ascending: false })
    .limit(120);

  if (error) {
    console.error("getGlocoMonthlyImports failed", { code: error.code, message: error.message });
    const setupMissing = error.code === "42P01" || error.code === "PGRST205";
    return {
      reports: [] as GlocoMonthlyImport[],
      error: setupMissing ? "Simpanan ringkasan GLOCO belum disediakan. Migration Supabase perlu dipasang dahulu." : "Ringkasan GLOCO tidak dapat dibaca."
    };
  }

  const latestByMonth = new Map<string, GlocoMonthlyImport>();
  for (const row of (data ?? []) as GlocoMonthlyImport[]) {
    if (!latestByMonth.has(row.report_month)) latestByMonth.set(row.report_month, row);
  }
  return { reports: [...latestByMonth.values()], error: null };
}
