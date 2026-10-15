import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { authenticateFinanceApiRequest } from "@/lib/finance-api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

type PatientPeriodRow = {
  period_month: string;
  period_no: number;
  period_start: string;
  period_end: string;
  branch_id: string;
  visit_count: number;
  unique_patient_count: number;
  new_patient_count: number;
  is_complete: boolean;
  branches?: { name: string } | { name: string }[] | null;
};

type BranchRow = { id: string; name: string };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

function isIsoDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function branchName(value: PatientPeriodRow["branches"]) {
  return Array.isArray(value) ? value[0]?.name ?? "Cawangan" : value?.name ?? "Cawangan";
}

function aggregate(rows: PatientPeriodRow[]) {
  const visits = rows.reduce((sum, row) => sum + Number(row.visit_count || 0), 0);
  const uniquePatients = rows.reduce((sum, row) => sum + Number(row.unique_patient_count || 0), 0);
  const newPatients = rows.reduce((sum, row) => sum + Number(row.new_patient_count || 0), 0);
  return {
    visits,
    unique_patients_by_branch: uniquePatients,
    new_patients: newPatients,
    known_existing_patients_by_branch: Math.max(0, uniquePatients - newPatients),
  };
}

export async function GET(request: Request) {
  const auth = authenticateFinanceApiRequest(request);
  if (auth.error === "not_configured" || auth.error === "invalid_config") {
    return json({ error: "Finance API is not configured." }, 503);
  }
  if (!auth.key) return json({ error: "A valid Finance API bearer token is required." }, 401);

  const url = new URL(request.url);
  const startDate = url.searchParams.get("start_date");
  const endDate = url.searchParams.get("end_date");
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || endDate! < startDate!) {
    return json({ error: "Provide valid start_date and end_date values in YYYY-MM-DD format." }, 400);
  }
  const requestedDays = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000 + 1;
  if (requestedDays > 366) return json({ error: "The requested date range cannot exceed 366 days." }, 400);

  try {
    const allBranchAccess = auth.key.branch_ids.includes("*");
    const supabase = createAdminClient();
    let branchQuery = supabase.from("branches").select("id, name").eq("is_active", true).order("name");
    if (!allBranchAccess) branchQuery = branchQuery.in("id", auth.key.branch_ids);
    const { data: branchData, error: branchError } = await branchQuery;
    if (branchError) throw branchError;

    const branches = (branchData ?? []) as BranchRow[];
    const branchIds = branches.map((branch) => branch.id);
    if (branchIds.length === 0) {
      return json({ api_version: "v1", period: { start_date: startDate, end_date: endDate }, branches: [], weekly: [], monthly: [] });
    }

    const { data, error } = await supabase
      .from("patient_period_summaries")
      .select("period_month, period_no, period_start, period_end, branch_id, visit_count, unique_patient_count, new_patient_count, is_complete, branches(name)")
      .in("branch_id", branchIds)
      .gte("period_start", startDate!)
      .lte("period_end", endDate!)
      .eq("is_complete", true)
      .order("period_start", { ascending: true });
    if (error) throw error;

    const rows = (data ?? []) as unknown as PatientPeriodRow[];
    const groupedPeriods = new Map<string, PatientPeriodRow[]>();
    for (const row of rows) {
      const key = `${row.period_month}:${row.period_no}`;
      groupedPeriods.set(key, [...(groupedPeriods.get(key) ?? []), row]);
    }

    const weekly = [...groupedPeriods.values()].map((periodRows) => {
      const first = periodRows[0];
      const totals = aggregate(periodRows);
      const byBranch = periodRows.map((row) => ({
        name: branchName(row.branches),
        visits: Number(row.visit_count || 0),
        unique_patients: Number(row.unique_patient_count || 0),
        new_patients: Number(row.new_patient_count || 0),
        known_existing_patients: Math.max(0, Number(row.unique_patient_count || 0) - Number(row.new_patient_count || 0)),
      }));
      return {
        period_month: first.period_month,
        period_no: first.period_no,
        start_date: first.period_start,
        end_date: first.period_end,
        ...totals,
        branches: byBranch,
      };
    }).sort((a, b) => a.start_date.localeCompare(b.start_date));

    const rowsByMonth = new Map<string, PatientPeriodRow[]>();
    for (const row of rows) rowsByMonth.set(row.period_month, [...(rowsByMonth.get(row.period_month) ?? []), row]);
    const monthly = [...rowsByMonth.entries()].map(([periodMonth, monthRows]) => {
      const monthWeeks = weekly.filter((period) => period.period_month === periodMonth);
      const latestWeek = monthWeeks.at(-1) ?? null;
      return {
        period_month: periodMonth,
        visits: monthRows.reduce((sum, row) => sum + Number(row.visit_count || 0), 0),
        new_patients: monthRows.reduce((sum, row) => sum + Number(row.new_patient_count || 0), 0),
        latest_period_unique_patients_by_branch: latestWeek?.unique_patients_by_branch ?? 0,
        latest_period_known_existing_patients_by_branch: latestWeek?.known_existing_patients_by_branch ?? 0,
        latest_period_no: latestWeek?.period_no ?? null,
        completed_period_count: monthWeeks.length,
      };
    }).sort((a, b) => a.period_month.localeCompare(b.period_month));

    return json({
      api_version: "v1",
      period: { start_date: startDate, end_date: endDate },
      definitions: {
        new_patients: "PID yang pertama kali direkod dalam sejarah import portal yang tersedia; bukan semestinya lawatan pertama sepanjang sejarah klinik.",
        known_existing_patients: "Pesakit unik dalam tempoh tolak PID baharu bagi tempoh yang sama.",
        unique_patient_scope: "Kiraan unik dijumlahkan mengikut cawangan; pesakit yang sama di dua cawangan mungkin dikira dua kali.",
        monthly_unique: "Pesakit unik bulanan tidak dijumlahkan merentas minggu; angka yang dipaparkan ialah tempoh lengkap terkini.",
      },
      weekly,
      monthly,
    });
  } catch (error) {
    console.error("[finance-api] Patient analytics summary failed", error);
    return json({ error: "Patient analytics could not be loaded." }, 500);
  }
}
