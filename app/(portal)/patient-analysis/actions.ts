"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase-server";
import { getCurrentProfile, hasPermission } from "@/lib/permissions";
import type { EncounterAnalysisImport } from "@/lib/gloco-encounter-analysis";
import { parseEncounterAnalysisWorkbook, type ParsedEncounterAnalysis } from "@/lib/patient-import";

type PreparedReport = { file: File; report: ParsedEncounterAnalysis };

async function prepareReports(formData: FormData): Promise<PreparedReport[]> {
  const profile = await getCurrentProfile();
  if (!profile || !hasPermission(profile, "manage_patient_imports")) {
    throw new Error("Hanya Owner atau Finance boleh memuat naik analisis lawatan.");
  }
  const files = formData.getAll("reports").filter((value): value is File => value instanceof File && value.size > 0);
  if (!files.length || files.length > 12) throw new Error("Pilih antara 1 hingga 12 fail laporan bulanan.");
  if (files.some((file) => !file.name.toLowerCase().endsWith(".xlsx"))) throw new Error("Semua fail mesti dalam format Excel .xlsx.");
  if (files.reduce((sum, file) => sum + file.size, 0) > 9 * 1024 * 1024) throw new Error("Jumlah saiz fail melebihi had 9 MB. Pilih fail dalam kumpulan lebih kecil.");

  const supabase = await createClient();
  const { data: branches, error } = await supabase.from("branches").select("id, name, code, is_active").eq("is_active", true);
  if (error || !branches) throw new Error("Senarai cawangan tidak dapat dibaca.");
  const reports = await Promise.all(files.map(async (file) => ({
    file,
    report: parseEncounterAnalysisWorkbook(Buffer.from(await file.arrayBuffer()), branches)
  })));
  const months = reports.map(({ report }) => report.report_month);
  if (new Set(months).size !== months.length) throw new Error("Ada lebih daripada satu fail untuk bulan yang sama. Pilih satu versi bagi setiap bulan.");
  return reports.sort((left, right) => left.report.report_month.localeCompare(right.report.report_month));
}

export async function previewEncounterAnalysis(formData: FormData) {
  try {
    const reports = await prepareReports(formData);
    return {
      ok: true as const,
      message: `${reports.length} laporan berjaya disemak. PID tidak akan disimpan dalam analisis ini.`,
      reports: reports.map(({ file, report }) => ({
        month: report.report_month,
        filename: file.name,
        visits: report.total_visits,
        uniquePatients: report.unique_patients,
        newPatients: report.new_patients,
        existingPatients: report.existing_patients,
        netCharges: report.net_charges,
        crossBranchPatients: report.cross_branch_patients,
        branches: report.branches.length
      }))
    };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "Fail tidak dapat disemak." };
  }
}

export async function saveEncounterAnalysis(formData: FormData) {
  try {
    const profile = await getCurrentProfile();
    if (!profile || !hasPermission(profile, "manage_patient_imports")) throw new Error("Hanya Owner atau Finance boleh menyimpan analisis lawatan.");
    const reports = await prepareReports(formData);
    const supabase = await createClient();
    const { data, error } = await supabase.from("gloco_encounter_analysis_imports").insert(reports.map(({ file, report }) => ({
      report_month: report.report_month,
      source_filename: file.name.slice(0, 180),
      report_data: report,
      imported_by: profile.id
    }))).select("id, report_month, source_filename, imported_at, report_data");
    if (error) {
      console.error("saveEncounterAnalysis failed", { code: error.code, message: error.message });
      if (error.code === "42P01" || error.code === "PGRST205") throw new Error("Jadual analisis belum dipasang dalam Supabase Finance.");
      throw new Error("Analisis tidak dapat disimpan. Tiada PID mentah dimasukkan.");
    }
    if (!data || data.length !== reports.length) {
      throw new Error("Simpanan berjaya dihantar tetapi rekod tidak dapat dibaca semula. Semak polisi akses Supabase Finance.");
    }
    revalidatePath("/patient-analysis");
    return {
      ok: true as const,
      message: `${reports.length} laporan berjaya disimpan dan dibaca semula. Data trend sudah dikemaskini.`,
      saved: data as unknown as EncounterAnalysisImport[]
    };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "Analisis tidak dapat disimpan." };
  }
}
