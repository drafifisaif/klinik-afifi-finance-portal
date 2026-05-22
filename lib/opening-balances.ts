import { getCurrentProfile, normalizeRole } from "@/lib/permissions";
import { createClient, hasSupabaseEnv } from "@/lib/supabase-server";
import type { BankAccount, Branch, OpeningBalance, OpeningBalanceType, PanelCompany, Supplier } from "@/lib/types";

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
  panelCompanies: PanelCompany[];
  suppliers: Supplier[];
};

export async function getOpeningBalanceSetupReferences(): Promise<OpeningBalanceSetupReferences> {
  const profile = await getCurrentProfile();
  if (!profile?.is_active || normalizeRole(profile.role) !== "owner") {
    return { balances: [], bankAccounts: [], branches: [], panelCompanies: [], suppliers: [] };
  }
  if (!hasSupabaseEnv()) {
    return { balances: [], bankAccounts: [], branches: [], panelCompanies: [], suppliers: [] };
  }

  const supabase = await createClient();
  const [balanceRows, branchRows, bankRows, supplierRows, panelRows] = await Promise.all([
    supabase
      .from("opening_balances")
      .select("*, branches(name, code), bank_accounts(name, bank_name, account_no), suppliers(name), panel_companies(name)")
      .order("balance_date", { ascending: false }),
    supabase.from("branches").select("*").eq("is_active", true).order("name"),
    supabase.from("bank_accounts").select("*").eq("is_active", true).order("name"),
    supabase.from("suppliers").select("*").eq("is_active", true).order("name"),
    supabase.from("panel_companies").select("*").eq("is_active", true).order("name")
  ]);

  if (balanceRows.error) throw balanceRows.error;
  if (branchRows.error) throw branchRows.error;
  if (bankRows.error) throw bankRows.error;
  if (supplierRows.error) throw supplierRows.error;
  if (panelRows.error) throw panelRows.error;

  return {
    balances: (balanceRows.data ?? []) as OpeningBalance[],
    bankAccounts: bankRows.data ?? [],
    branches: branchRows.data ?? [],
    panelCompanies: panelRows.data ?? [],
    suppliers: supplierRows.data ?? []
  };
}
