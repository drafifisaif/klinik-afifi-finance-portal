import { canViewAllBranches, filterBranchesForProfile, getCurrentProfile, normalizeRole } from "@/lib/permissions";
import { createClient, hasSupabaseEnv } from "@/lib/supabase-server";
import type {
  BankAccount,
  Branch,
  MonthlyOpeningBalance,
  OpeningBalance,
  OpeningBalanceType,
  OpeningBalanceVerificationStatus,
  PanelCompany,
  Supplier
} from "@/lib/types";

export const openingBalanceTypes: { label: string; value: OpeningBalanceType }[] = [
  { label: "Bank account", value: "bank_account" },
  { label: "Cash in hand", value: "cash_in_hand" },
  { label: "Petty cash", value: "petty_cash" },
  { label: "Supplier outstanding", value: "supplier_outstanding" },
  { label: "Panel outstanding", value: "panel_outstanding" }
];

export function openingBalanceTypeLabel(type: OpeningBalanceType) {
  return openingBalanceTypes.find((option) => option.value === type)?.label ?? type;
}

export const openingBalanceVerificationStatuses: { label: string; value: OpeningBalanceVerificationStatus }[] = [
  { label: "Pending Review", value: "pending_review" },
  { label: "Confirmed", value: "confirmed" },
  { label: "Estimated", value: "estimated" }
];

export const openingBalanceSourceReferences = [
  "bank_statement",
  "staff_estimate",
  "invoice_record",
  "panel_statement",
  "owner_record",
  "other"
] as const;

export function openingBalanceVerificationLabel(status: OpeningBalanceVerificationStatus | null | undefined) {
  return openingBalanceVerificationStatuses.find((option) => option.value === status)?.label ?? "Pending Review";
}

export function needsOpeningBalanceCaution(balance: OpeningBalance) {
  return (balance.verification_status ?? "pending_review") !== "confirmed";
}

export function openingBalanceApplies(balance: OpeningBalance, endDate?: string) {
  return !endDate || balance.balance_date <= endDate;
}

export function bankOpeningBalanceTotal(
  balances: OpeningBalance[],
  bankAccountId: string,
  endDate?: string
) {
  return balances
    .filter((balance) => balance.balance_type === "bank_account" && balance.bank_account_id === bankAccountId && openingBalanceApplies(balance, endDate))
    .reduce((sum, balance) => sum + Number(balance.amount ?? 0), 0);
}

export function branchOpeningBalanceTotal(
  balances: OpeningBalance[],
  balanceType: "cash_in_hand" | "petty_cash",
  branchId: string,
  endDate?: string
) {
  return balances
    .filter((balance) => balance.balance_type === balanceType && balance.branch_id === branchId && openingBalanceApplies(balance, endDate))
    .reduce((sum, balance) => sum + Number(balance.amount ?? 0), 0);
}

export const monthlyOpeningBalanceStartMonth = "2026-01-01";

export function monthStart(dateString: string) {
  const date = new Date(`${dateString}T00:00:00Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export function addMonths(dateString: string, months: number) {
  const date = new Date(`${dateString}T00:00:00Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)).toISOString().slice(0, 10);
}

export function monthlyRowForBranch(
  balances: MonthlyOpeningBalance[] | undefined,
  branchId: string,
  balanceMonth: string
) {
  return balances?.find((balance) => balance.branch_id === branchId && balance.balance_month === balanceMonth) ?? null;
}

export function outstandingOpeningBalanceTotal(
  balances: OpeningBalance[],
  balanceType: "supplier_outstanding" | "panel_outstanding",
  branchIds?: Set<string>,
  endDate?: string,
  includeUnassigned = true
) {
  return balances
    .filter((balance) => {
      if (balance.balance_type !== balanceType || !openingBalanceApplies(balance, endDate)) return false;
      if (!branchIds) return true;
      if (!balance.branch_id) return includeUnassigned;
      return branchIds.has(balance.branch_id);
    })
    .reduce((sum, balance) => sum + Number(balance.amount ?? 0), 0);
}

export type OpeningBalanceSetupReferences = {
  balances: OpeningBalance[];
  bankAccounts: BankAccount[];
  branches: Branch[];
  monthlyBalancesConfigError?: string | null;
  monthlyBalances: MonthlyOpeningBalance[];
  panelCompanies: PanelCompany[];
  suppliers: Supplier[];
};

function isMissingMonthlyOpeningBalancesTable(error: { code?: string | null; message?: string | null } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "PGRST205"
    || error?.code === "42P01"
    || message.includes("monthly_opening_balances")
    || message.includes("could not find the table")
    || message.includes("relation \"public.monthly_opening_balances\" does not exist");
}

export async function getOpeningBalanceSetupReferences(): Promise<OpeningBalanceSetupReferences> {
  const profile = await getCurrentProfile();
  if (!profile?.is_active) {
    return { balances: [], bankAccounts: [], branches: [], monthlyBalances: [], monthlyBalancesConfigError: null, panelCompanies: [], suppliers: [] };
  }
  if (!hasSupabaseEnv()) {
    return { balances: [], bankAccounts: [], branches: [], monthlyBalances: [], monthlyBalancesConfigError: null, panelCompanies: [], suppliers: [] };
  }

  const supabase = await createClient();
  const [balanceRows, branchRows, monthlyBalanceRows, bankRows, supplierRows, panelRows] = await Promise.all([
    supabase
      .from("opening_balances")
      .select("*, branches(name, code), bank_accounts(name, bank_name, account_no), suppliers(name), panel_companies(name)")
      .order("balance_date", { ascending: false }),
    supabase.from("branches").select("*").eq("is_active", true).order("name"),
    supabase
      .from("monthly_opening_balances")
      .select("*, branches(name, code)")
      .order("balance_month", { ascending: false }),
    supabase.from("bank_accounts").select("*").eq("is_active", true).order("name"),
    supabase.from("suppliers").select("*").eq("is_active", true).order("name"),
    supabase.from("panel_companies").select("*").eq("is_active", true).order("name")
  ]);

  if (balanceRows.error) throw balanceRows.error;
  if (branchRows.error) throw branchRows.error;
  const monthlyBalancesConfigError = monthlyBalanceRows.error && isMissingMonthlyOpeningBalancesTable(monthlyBalanceRows.error)
    ? "Monthly opening balances table is missing. Run supabase/2026-01-01-monthly-opening-reconciliation.sql in Supabase SQL Editor."
    : null;
  if (monthlyBalanceRows.error) {
    console.warn("[opening-balances] monthly_opening_balances could not be loaded. Run supabase/2026-01-01-monthly-opening-reconciliation.sql in Supabase SQL Editor.", monthlyBalanceRows.error);
    if (!monthlyBalancesConfigError) throw monthlyBalanceRows.error;
  }
  if (bankRows.error) throw bankRows.error;
  if (supplierRows.error) throw supplierRows.error;
  if (panelRows.error) throw panelRows.error;
  const visibleBranches = filterBranchesForProfile(branchRows.data ?? [], profile);
  const visibleBranchIds = new Set(visibleBranches.map((branch) => branch.id));
  const role = normalizeRole(profile.role);
  const canSeeAll = canViewAllBranches(profile);

  return {
    balances: ((balanceRows.data ?? []) as OpeningBalance[]).filter((balance) => {
      if (canSeeAll) return true;
      return !balance.branch_id || visibleBranchIds.has(balance.branch_id);
    }),
    bankAccounts: bankRows.data ?? [],
    branches: visibleBranches,
    monthlyBalancesConfigError,
    monthlyBalances: ((monthlyBalanceRows.data ?? []) as MonthlyOpeningBalance[]).filter((balance) => role === "owner" || role === "finance" || visibleBranchIds.has(balance.branch_id)),
    panelCompanies: panelRows.data ?? [],
    suppliers: supplierRows.data ?? []
  };
}
