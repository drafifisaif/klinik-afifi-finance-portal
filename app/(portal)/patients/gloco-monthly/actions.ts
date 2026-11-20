"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase-server";
import { getCurrentProfile, hasPermission } from "@/lib/permissions";
import { parseGlocoMonthlyReport } from "@/lib/gloco-monthly-report";

async function parseReport(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile || !hasPermission(profile, "manage_patient_imports")) {
    throw new Error("Hanya Owner atau Finance boleh memuat naik ringkasan GLOCO.");
  }
  const file = formData.get("report");
  if (!(file instanceof File) || !file.size) throw new Error("Pilih fail Excel GLOCO dahulu.");
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Fail mesti dalam format Excel .xlsx.");
  const supabase = await createClient();
  const { data: branches, error } = await supabase.from("branches").select("id, name, code, is_active").eq("is_active", true);
  if (error || !branches) throw new Error("Senarai cawangan tidak dapat dibaca.");
  const report = parseGlocoMonthlyReport(Buffer.from(await file.arrayBuffer()), branches);
  return { profile, file, report, supabase };
}

export async function previewGlocoMonthlyReport(formData: FormData) {
  try {
    const { file, report } = await parseReport(formData);
    return { ok: true as const, message: "Laporan berjaya disemak.", report, source_filename: file.name };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "Laporan tidak dapat disemak." };
  }
}

export async function saveGlocoMonthlyReport(formData: FormData) {
  try {
    const { profile, file, report, supabase } = await parseReport(formData);
    const { error } = await supabase.from("gloco_monthly_report_imports").insert({
      report_month: report.report_month,
      source_filename: file.name.slice(0, 180),
      report_data: report,
      imported_by: profile.id
    });
    if (error) {
      console.error("saveGlocoMonthlyReport failed", { code: error.code, message: error.message });
      if (error.code === "42P01" || error.code === "PGRST205") throw new Error("Simpanan ringkasan GLOCO belum disediakan. Migration Supabase belum dipasang.");
      throw new Error("Ringkasan tidak dapat disimpan. Cuba lagi atau hubungi admin portal.");
    }
    revalidatePath("/patients/gloco-monthly");
    return { ok: true as const, message: `${new Date(`${report.report_month}T00:00:00`).toLocaleDateString("ms-MY", { month: "long", year: "numeric" })} berjaya disimpan.` };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "Ringkasan tidak dapat disimpan." };
  }
}
