import { createAdminClient } from "@/lib/supabase-admin";
import { hasSupabaseEnv, createClient } from "@/lib/supabase-server";
import { branchPicHiddenExpenseCategories } from "@/lib/constants";
import { canViewAllBranches, filterBranchesForProfile, filterDashboardDataForProfile, getCurrentProfile, normalizeRole } from "@/lib/permissions";
import type {
  BankAccount,
  BankAccountPermission,
  BankTransaction,
  BankingData,
  Branch,
  BranchBankMapping,
  CashBankIn,
  DailySale,
  DashboardData,
  Expense,
  OpeningBalance,
  PanelClaim,
  PanelPayment,
  PanelCompany,
  PettyCashTransaction,
  PurchaseCategory,
  Supplier,
  SupplierPayment,
  SupplierPaymentEntry,
  SupplierPurchase,
  SupplierPurchaseEntry
} from "@/lib/types";

export type SupplierOutstandingRow = SupplierPurchaseEntry & {
  supplier_name?: string;
  branch_name?: string;
  paid_amount: number;
  outstanding_amount: number;
  status: string;
  aging_bucket?: string;
  days_overdue?: number;
};

const branches: Branch[] = [
  { id: "putatan", name: "Putatan", code: "PUT", is_active: true },
  { id: "papar", name: "Papar", code: "PAP", is_active: true },
  { id: "ranau", name: "Ranau", code: "RAN", is_active: true },
  { id: "kinabatangan", name: "Kinabatangan", code: "KIN", is_active: true }
];

const suppliers: Supplier[] = [
  { id: "s1", name: "Medisupply Sabah", payment_terms_days: 30, is_active: true, phone: "088-100 200", address: "Kota Kinabalu", notes: null },
  { id: "s2", name: "ClinicCare Consumables", payment_terms_days: 14, is_active: true, phone: "088-300 400", address: "Papar", notes: null }
];

const panelCompanies: PanelCompany[] = [
  { id: "p1", name: "SabahCare Panel", payment_terms_days: 30, is_active: true, address: "Kota Kinabalu", notes: null },
  { id: "p2", name: "Borneo Corporate Health", payment_terms_days: 45, is_active: true, address: "Sandakan", notes: null }
];

const sales: DailySale[] = [
  {
    id: "d1",
    branch_id: "putatan",
    sale_date: "2026-05-19",
    cash_amount: 2450,
    bank_transfer_amount: 1860,
    card_amount: 1320,
    panel_amount: 980,
    qr_amount: 760,
    total_amount: 7370,
    branches: { name: "Putatan", code: "PUT" }
  },
  {
    id: "d2",
    branch_id: "papar",
    sale_date: "2026-05-19",
    cash_amount: 1680,
    bank_transfer_amount: 1220,
    card_amount: 840,
    panel_amount: 1240,
    qr_amount: 520,
    total_amount: 5500,
    branches: { name: "Papar", code: "PAP" }
  },
  {
    id: "d3",
    branch_id: "ranau",
    sale_date: "2026-05-19",
    cash_amount: 1320,
    bank_transfer_amount: 980,
    card_amount: 620,
    panel_amount: 720,
    qr_amount: 390,
    total_amount: 4030,
    branches: { name: "Ranau", code: "RAN" }
  },
  {
    id: "d4",
    branch_id: "kinabatangan",
    sale_date: "2026-05-19",
    cash_amount: 1490,
    bank_transfer_amount: 1110,
    card_amount: 740,
    panel_amount: 860,
    qr_amount: 430,
    total_amount: 4630,
    branches: { name: "Kinabatangan", code: "KIN" }
  },
  {
    id: "d5",
    branch_id: "putatan",
    sale_date: "2026-05-01",
    cash_amount: 35500,
    bank_transfer_amount: 28900,
    card_amount: 22800,
    panel_amount: 18200,
    qr_amount: 12600,
    total_amount: 118000,
    branches: { name: "Putatan", code: "PUT" }
  }
];

const expenses: Expense[] = [
  {
    id: "e1",
    branch_id: "putatan",
    expense_date: "2026-05-18",
    category: "salary",
    description: "Monthly staff salary allocation",
    payment_type: "bank_transfer",
    amount: 28500,
    vendor_name: "Salary bank payout",
    branches: { name: "Putatan", code: "PUT" }
  },
  {
    id: "e2",
    branch_id: "papar",
    expense_date: "2026-05-16",
    category: "rental",
    description: "Clinic lot rental",
    payment_type: "bank_transfer",
    amount: 4200,
    vendor_name: "Landlord",
    branches: { name: "Papar", code: "PAP" }
  },
  {
    id: "e3",
    branch_id: "ranau",
    expense_date: "2026-05-15",
    category: "utilities",
    description: "Electric and water bill",
    payment_type: "qr",
    amount: 1380,
    vendor_name: "Utilities",
    branches: { name: "Ranau", code: "RAN" }
  }
];

const purchases: SupplierPurchase[] = [
  {
    id: "sp1",
    supplier_id: "s1",
    branch_id: "putatan",
    invoice_no: "MS-2605-018",
    purchase_date: "2026-05-12",
    due_date: "2026-06-11",
    category: "medicine",
    medicine_cost: 18400,
    consumables_cost: 0,
    other_cost: 0,
    total_amount: 18400,
    suppliers: { name: "Medisupply Sabah" },
    branches: { name: "Putatan", code: "PUT" }
  },
  {
    id: "sp2",
    supplier_id: "s2",
    branch_id: "papar",
    invoice_no: "CC-2605-041",
    purchase_date: "2026-05-14",
    due_date: "2026-05-28",
    category: "consumables",
    medicine_cost: 0,
    consumables_cost: 5200,
    other_cost: 0,
    total_amount: 5200,
    suppliers: { name: "ClinicCare Consumables" },
    branches: { name: "Papar", code: "PAP" }
  }
];

const supplierPayments: SupplierPayment[] = [
  {
    id: "pay1",
    supplier_id: "s2",
    purchase_id: "sp2",
    branch_id: "papar",
    bank_account_id: "bank-agrobank",
    payment_date: "2026-05-18",
    payment_type: "bank_transfer",
    amount: 2500,
    reference_no: "BT-8591",
    suppliers: { name: "ClinicCare Consumables" },
    branches: { name: "Papar", code: "PAP" },
    bank_accounts: { name: "Agrobank", bank_name: "Agrobank", account_no: null }
  }
];

const supplierPurchaseEntriesDemo: SupplierPurchaseEntry[] = purchases.map((purchase, index) => ({
  ...purchase,
  category: purchase.category ?? "other",
  created_at: `2026-05-${String(index + 8).padStart(2, "0")}T08:00:00.000Z`,
  created_by: null,
  credit_term_days: purchase.credit_term_days ?? 0,
  is_void: purchase.is_void ?? false,
  updated_at: `2026-05-${String(index + 8).padStart(2, "0")}T08:00:00.000Z`,
  updated_by: null,
  void_reason: purchase.void_reason ?? null,
  voided_at: purchase.voided_at ?? null,
  voided_by: purchase.voided_by ?? null
}));

const supplierPaymentEntriesDemo: SupplierPaymentEntry[] = supplierPayments.map((payment, index) => ({
  id: payment.id,
  amount: payment.amount,
  bank_account_id: payment.bank_account_id ?? null,
  branch_id: payment.branch_id ?? "putatan",
  created_at: `2026-05-${String(index + 18).padStart(2, "0")}T09:00:00.000Z`,
  created_by: null,
  is_void: false,
  notes: payment.notes ?? null,
  payment_date: payment.payment_date,
  payment_method: payment.payment_type,
  reference_no: payment.reference_no ?? null,
  supplier_id: payment.supplier_id,
  supplier_purchase_entry_id: payment.purchase_id ?? null,
  suppliers: payment.suppliers ?? null,
  branches: payment.branches ?? null,
  bank_accounts: payment.bank_accounts ?? null,
  updated_at: `2026-05-${String(index + 18).padStart(2, "0")}T09:00:00.000Z`,
  updated_by: null,
  void_reason: null,
  voided_at: null,
  voided_by: null
}));

const panels: PanelClaim[] = [
  {
    id: "pc1",
    panel_company_id: "p1",
    branch_id: "putatan",
    claim_no: "SC-APR-026",
    claim_month: "2026-04-01",
    submitted_date: "2026-05-02",
    due_date: "2026-06-01",
    amount: 8600,
    status: "unpaid",
    panel_companies: { name: "SabahCare Panel" },
    branches: { name: "Putatan", code: "PUT" }
  },
  {
    id: "pc2",
    panel_company_id: "p2",
    branch_id: "ranau",
    claim_no: "BCH-APR-019",
    claim_month: "2026-04-01",
    submitted_date: "2026-05-04",
    due_date: "2026-06-18",
    amount: 5400,
    status: "partial",
    panel_companies: { name: "Borneo Corporate Health" },
    branches: { name: "Ranau", code: "RAN" }
  }
];

const panelPayments: PanelPayment[] = [
  {
    id: "pp1",
    panel_claim_id: "pc2",
    panel_company_id: "p2",
    branch_id: "ranau",
    bank_account_id: "bank-cimb-ranau-panel",
    payment_date: "2026-05-20",
    amount: 1500,
    payment_type: "bank_transfer",
    reference_no: "PANEL-REF-2205",
    notes: "First partial panel collection",
    panel_claims: { claim_no: "BCH-APR-019", branch_id: "ranau" },
    panel_companies: { name: "Borneo Corporate Health" },
    branches: { name: "Ranau", code: "RAN" },
    bank_accounts: { name: "CIMB Ranau Panel", bank_name: "CIMB", account_no: null }
  }
];

const bankAccounts: BankAccount[] = [
  { id: "bank-cimb-ranau-operation", name: "CIMB Ranau Operation", bank_name: "CIMB", account_no: null, is_active: true },
  { id: "bank-cimb-ranau-panel", name: "CIMB Ranau Panel", bank_name: "CIMB", account_no: null, is_active: true },
  { id: "bank-cimb-putatan-operation", name: "CIMB Putatan Operation", bank_name: "CIMB", account_no: null, is_active: true },
  { id: "bank-cimb-putatan-panel", name: "CIMB Putatan Panel", bank_name: "CIMB", account_no: null, is_active: true },
  { id: "bank-agrobank", name: "Agrobank", bank_name: "Agrobank", account_no: null, is_active: true }
];

const branchBankMappings: BranchBankMapping[] = [
  {
    id: "mapping-ranau",
    branch_id: "ranau",
    bank_account_id: "bank-cimb-ranau-operation",
    is_active: true,
    branches: { name: "Ranau", code: "RAN" },
    bank_accounts: { name: "CIMB Ranau Operation", bank_name: "CIMB", account_no: null }
  },
  {
    id: "mapping-putatan",
    branch_id: "putatan",
    bank_account_id: "bank-cimb-putatan-operation",
    is_active: true,
    branches: { name: "Putatan", code: "PUT" },
    bank_accounts: { name: "CIMB Putatan Operation", bank_name: "CIMB", account_no: null }
  },
  {
    id: "mapping-papar",
    branch_id: "papar",
    bank_account_id: "bank-agrobank",
    is_active: true,
    branches: { name: "Papar", code: "PAP" },
    bank_accounts: { name: "Agrobank", bank_name: "Agrobank", account_no: null }
  },
  {
    id: "mapping-kinabatangan",
    branch_id: "kinabatangan",
    bank_account_id: "bank-agrobank",
    is_active: true,
    branches: { name: "Kinabatangan", code: "KIN" },
    bank_accounts: { name: "Agrobank", bank_name: "Agrobank", account_no: null }
  }
];

const cashBankIns: CashBankIn[] = [];
const bankAccountPermissions: BankAccountPermission[] = [];
const bankTransactions: BankTransaction[] = [];
const pettyCashTransactions: PettyCashTransaction[] = [];
const openingBalances: OpeningBalance[] = [];

export const demoData: DashboardData = {
  branches,
  openingBalances,
  sales,
  expenses,
  purchases: supplierPurchaseEntriesDemo,
  supplierPayments: supplierPaymentEntriesDemo,
  panels,
  panelPayments
};

export const demoBankingData: BankingData = {
  branches,
  openingBalances,
  sales,
  expenses,
  bankAccounts,
  bankAccountPermissions,
  bankTransactions,
  branchBankMappings,
  cashBankIns,
  pettyCashTransactions,
  supplierPayments: supplierPaymentEntriesDemo,
  panelPayments
};

async function fetchOrDemo<T>(query: PromiseLike<{ data: T | null; error: unknown }>, fallback: T, label?: string) {
  const { data, error } = await query;
  if (error || !data) {
    if (error) {
      console.error(`fetchOrDemo failed for ${label ?? "unknown query"}`, error);
    }
    return fallback;
  }
  return data;
}

export async function getDashboardData(): Promise<DashboardData> {
  const profile = await getCurrentProfile();
  if (!hasSupabaseEnv()) return filterDashboardDataForProfile(demoData, profile);

  const supabase = await createClient();
  const adminSupabase = createAdminClient();

  const [branchRows, openingBalanceRows, salesRows, expenseRows, purchaseRows, paymentRows, panelRows, panelPaymentRows] = await Promise.all([
    fetchOrDemo(supabase.from("branches").select("*").order("name"), demoData.branches),
    fetchOrDemo(
      supabase
        .from("opening_balances")
        .select("*, branches(name, code), bank_accounts(name, bank_name, account_no), suppliers(name), panel_companies(name)")
        .order("balance_date", { ascending: false }),
      demoData.openingBalances
    ),
    fetchOrDemo(
      supabase
        .from("daily_sales")
        .select("*, branches(name, code)")
        .order("sale_date", { ascending: false }),
      demoData.sales
    ),
    fetchOrDemo(
      supabase
        .from("expenses")
        .select("*, branches(name, code)")
        .order("expense_date", { ascending: false }),
      demoData.expenses
    ),
    fetchOrDemo(
      supabase
        .from("supplier_purchase_entries")
        .select("*, suppliers(name), branches(name, code)")
        .order("purchase_date", { ascending: false }),
      demoData.purchases,
      "supplier_purchase_entries_dashboard"
    ),
    fetchOrDemo(
      adminSupabase
        .from("supplier_payment_entries")
        .select("*, suppliers(name), branches(name, code), bank_accounts(name, bank_name, account_no), supplier_purchase_entries(id, invoice_no, branch_id, supplier_id, due_date, total_amount)")
        .order("payment_date", { ascending: false }),
      demoData.supplierPayments,
      "supplier_payment_entries_dashboard"
    ),
    fetchOrDemo(
      supabase
        .from("panel_claims")
        .select("*, panel_companies(name), branches(name, code)")
        .order("claim_month", { ascending: false }),
      demoData.panels
    ),
    fetchOrDemo(
      supabase
        .from("panel_payments")
        .select("*, bank_accounts(name, bank_name, account_no), panel_claims(branch_id, claim_no, panel_company_id, branches(name, code), panel_companies(name))")
        .order("payment_date", { ascending: false }),
      demoData.panelPayments
    )
  ]);

  const normalizedPanelPayments = (panelPaymentRows as PanelPayment[]).map((payment) => ({
    ...payment,
    branch_id: payment.branch_id ?? payment.panel_claims?.branch_id ?? null,
    panel_company_id: payment.panel_company_id ?? payment.panel_claims?.panel_company_id ?? null,
    panel_companies: payment.panel_companies ?? payment.panel_claims?.panel_companies ?? null,
    branches: payment.branches ?? payment.panel_claims?.branches ?? null,
    panel_claims: payment.panel_claims ?? null
  }));

  return filterDashboardDataForProfile({
    branches: branchRows as Branch[],
    openingBalances: openingBalanceRows as OpeningBalance[],
    sales: salesRows as DailySale[],
    expenses: expenseRows as Expense[],
    purchases: purchaseRows as SupplierPurchaseEntry[],
    supplierPayments: paymentRows as SupplierPaymentEntry[],
    panels: panelRows as PanelClaim[],
    panelPayments: normalizedPanelPayments
  }, profile);
}

export async function getExpensesReportingData(): Promise<Pick<DashboardData, "branches" | "expenses" | "supplierPayments">> {
  const profile = await getCurrentProfile();
  if (!hasSupabaseEnv()) {
    const filtered = filterDashboardDataForProfile(demoData, profile);
    return {
      branches: filtered.branches,
      expenses: filtered.expenses,
      supplierPayments: filtered.supplierPayments
    };
  }

  const supabase = await createClient();
  const adminSupabase = createAdminClient();
  const [branchRows, expenseRows, supplierPaymentRows] = await Promise.all([
    fetchOrDemo(supabase.from("branches").select("*").order("name"), demoData.branches),
    fetchOrDemo(
      supabase
        .from("expenses")
        .select("*, branches(name, code)")
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false }),
      demoData.expenses,
      "expenses_reporting"
    ),
    fetchOrDemo(
      adminSupabase
        .from("supplier_payment_entries")
        .select("*, suppliers(name), branches(name, code), bank_accounts(name, bank_name, account_no), supplier_purchase_entries(id, invoice_no, branch_id, supplier_id, due_date, total_amount)")
        .order("payment_date", { ascending: false })
        .order("created_at", { ascending: false }),
      demoData.supplierPayments,
      "supplier_payment_entries_reporting"
    )
  ]);

  const filtered = filterDashboardDataForProfile({
    branches: branchRows as Branch[],
    openingBalances: [],
    sales: [],
    expenses: expenseRows as Expense[],
    purchases: [],
    supplierPayments: supplierPaymentRows as SupplierPaymentEntry[],
    panels: [],
    panelPayments: []
  }, profile);

  const role = normalizeRole(profile?.role);
  const expenses = role === "branch_pic"
    ? filtered.expenses.filter((expense) => !branchPicHiddenExpenseCategories.has(String(expense.category ?? "").trim().toLowerCase()))
    : filtered.expenses;

  return {
    branches: filtered.branches,
    expenses,
    supplierPayments: filtered.supplierPayments
  };
}

type BankingDataOptions = {
  bankAccessOnly?: boolean;
};

export type DashboardOperationalCashData = Pick<
  BankingData,
  "branches" | "cashBankIns" | "expenses" | "openingBalances" | "pettyCashTransactions" | "sales"
>;

function permissionHasVisibleAccount(permission: BankAccountPermission) {
  return permission.can_view || permission.can_create_transaction || permission.can_edit_transaction || permission.can_manage_account;
}

function filterBankingDataForProfile(data: BankingData, profile: Awaited<ReturnType<typeof getCurrentProfile>>, options: BankingDataOptions = {}): BankingData {
  const filteredBranches = filterBranchesForProfile(data.branches, profile);
  const branchIds = new Set(filteredBranches.map((branch) => branch.id));
  const role = normalizeRole(profile?.role);

  const shouldFilterByBankPermissions = profile?.is_active && (role === "admin" || role === "finance");
  const shouldUseAssignedBranchPicBanks = role === "branch_pic" && options.bankAccessOnly;

  const branchPicBankAccountIds =
    role === "branch_pic" && !options.bankAccessOnly
      ? new Set(
          data.branchBankMappings
            .filter((mapping) => mapping.is_active && branchIds.has(mapping.branch_id))
            .map((mapping) => mapping.bank_account_id)
        )
      : null;

  const assignedBankAccountIds =
    shouldFilterByBankPermissions || shouldUseAssignedBranchPicBanks
      ? new Set(
          data.bankAccountPermissions
            .filter((permission) => permission.user_id === profile?.id && permissionHasVisibleAccount(permission))
            .map((permission) => permission.bank_account_id)
        )
      : null;

  const permittedBankAccountIds = assignedBankAccountIds ? assignedBankAccountIds : branchPicBankAccountIds;

  const permittedMappings = data.branchBankMappings.filter((mapping) => {
    if (!mapping.is_active || !branchIds.has(mapping.branch_id)) return false;
    return !permittedBankAccountIds || permittedBankAccountIds.has(mapping.bank_account_id);
  });

  const mappedBranchIds = new Set(permittedMappings.map((mapping) => mapping.branch_id));

  const filteredCashBankIns = data.cashBankIns.filter((bankIn) => {
    if (!branchIds.has(bankIn.branch_id)) return false;
    return !permittedBankAccountIds || permittedBankAccountIds.has(bankIn.bank_account_id);
  });

  const filteredBankTransactions = data.bankTransactions.filter((transaction) => {
    return !permittedBankAccountIds || permittedBankAccountIds.has(transaction.bank_account_id);
  });

  const filteredSupplierPayments = data.supplierPayments.filter((payment) => {
    if (payment.branch_id && !branchIds.has(payment.branch_id)) return false;
    if (payment.bank_account_id && permittedBankAccountIds) return permittedBankAccountIds.has(payment.bank_account_id);
    return true;
  });

  const filteredPanelPayments = data.panelPayments.filter((payment) => {
    if (payment.branch_id && !branchIds.has(payment.branch_id)) return false;
    if (payment.bank_account_id && permittedBankAccountIds) return permittedBankAccountIds.has(payment.bank_account_id);
    return true;
  });

  const filteredPettyCashTransactions = data.pettyCashTransactions.filter((transaction) => {
    if (!branchIds.has(transaction.branch_id)) return false;

    return (
      !options.bankAccessOnly ||
      !transaction.bank_account_id ||
      !permittedBankAccountIds ||
      permittedBankAccountIds.has(transaction.bank_account_id)
    );
  });

  const visibleBranchIds = permittedBankAccountIds
    ? new Set([
        ...mappedBranchIds,
        ...filteredCashBankIns.map((bankIn) => bankIn.branch_id),
        ...filteredBankTransactions
          .map((transaction) => transaction.branch_id)
          .filter((branchId): branchId is string => Boolean(branchId)),
        ...filteredSupplierPayments
          .map((payment) => payment.branch_id)
          .filter((branchId): branchId is string => Boolean(branchId)),
        ...filteredPanelPayments
          .map((payment) => payment.branch_id)
          .filter((branchId): branchId is string => Boolean(branchId)),
        ...filteredPettyCashTransactions.map((transaction) => transaction.branch_id)
      ])
    : branchIds;

  return {
    // Keep branch filter options complete for the user's accessible branches.
    // Bank account visibility remains permission-scoped below.
    branches: filteredBranches,

    sales: data.sales.filter(
      (sale) => visibleBranchIds.has(sale.branch_id) && (!permittedBankAccountIds || mappedBranchIds.has(sale.branch_id))
    ),

    expenses: data.expenses.filter((expense) => visibleBranchIds.has(expense.branch_id)),

    bankAccounts: data.bankAccounts.filter((account) => {
      return account.is_active && (!permittedBankAccountIds || permittedBankAccountIds.has(account.id));
    }),

    openingBalances: data.openingBalances.filter((balance) => {
      if (balance.branch_id && !visibleBranchIds.has(balance.branch_id)) return false;
      if (balance.bank_account_id && permittedBankAccountIds && !permittedBankAccountIds.has(balance.bank_account_id)) return false;
      return true;
    }),

    bankAccountPermissions: data.bankAccountPermissions.filter((permission) => !profile || permission.user_id === profile.id),
    bankTransactions: filteredBankTransactions,
    branchBankMappings: permittedMappings,
    cashBankIns: filteredCashBankIns,
    pettyCashTransactions: filteredPettyCashTransactions,
    supplierPayments: filteredSupplierPayments,
    panelPayments: filteredPanelPayments
  };
}

export async function getBankingData(): Promise<BankingData> {
  return getBankingDataForScope();
}

export async function getDashboardOperationalCashData(): Promise<DashboardOperationalCashData> {
  const profile = await getCurrentProfile();
  const fallbackBranches = filterBranchesForProfile(demoBankingData.branches, profile);
  const fallbackBranchIds = new Set(fallbackBranches.map((branch) => branch.id));
  const fallbackOperational = {
    branches: fallbackBranches,
    cashBankIns: demoBankingData.cashBankIns.filter((bankIn) => fallbackBranchIds.has(bankIn.branch_id)),
    expenses: demoBankingData.expenses.filter((expense) => fallbackBranchIds.has(expense.branch_id) && String(expense.category ?? "").trim().toLowerCase() === "locum_doctor"),
    openingBalances: demoBankingData.openingBalances.filter((balance) => {
      return (balance.balance_type === "cash_in_hand" || balance.balance_type === "petty_cash")
        && (!balance.branch_id || fallbackBranchIds.has(balance.branch_id));
    }),
    pettyCashTransactions: demoBankingData.pettyCashTransactions.filter((transaction) => fallbackBranchIds.has(transaction.branch_id)),
    sales: demoBankingData.sales.filter((sale) => fallbackBranchIds.has(sale.branch_id))
  };

  if (!hasSupabaseEnv()) return fallbackOperational;

  const supabase = await createClient();
  const [branchRows, openingBalanceRows, salesRows, expenseRows, cashBankInRows, pettyCashRows] = await Promise.all([
    fetchOrDemo(supabase.from("branches").select("*").eq("is_active", true).order("name"), [], "dashboard_operational_branches"),
    fetchOrDemo(
      supabase
        .from("opening_balances")
        .select("*, branches(name, code)")
        .in("balance_type", ["cash_in_hand", "petty_cash"])
        .order("balance_date", { ascending: false }),
      [],
      "dashboard_operational_opening_balances"
    ),
    fetchOrDemo(
      supabase
        .from("daily_sales")
        .select("*, branches(name, code)")
        .order("sale_date", { ascending: false }),
      [],
      "dashboard_operational_daily_sales"
    ),
    fetchOrDemo(
      supabase
        .from("expenses")
        .select("*, branches(name, code)")
        .eq("category", "locum_doctor")
        .order("expense_date", { ascending: false }),
      [],
      "dashboard_operational_cash_locum_expenses"
    ),
    fetchOrDemo(
      supabase
        .from("cash_bank_ins")
        .select("*, branches(name, code)")
        .order("bank_in_date", { ascending: false }),
      [],
      "dashboard_operational_cash_bank_ins"
    ),
    fetchOrDemo(
      supabase
        .from("petty_cash_transactions")
        .select("*, branches(name, code)")
        .order("transaction_date", { ascending: false }),
      [],
      "dashboard_operational_petty_cash_transactions"
    )
  ]);

  const scopedBranches = filterBranchesForProfile(branchRows as Branch[], profile);
  const scopedBranchIds = new Set(scopedBranches.map((branch) => branch.id));

  return {
    branches: scopedBranches,
    cashBankIns: (cashBankInRows as CashBankIn[]).filter((bankIn) => scopedBranchIds.has(bankIn.branch_id)),
    expenses: (expenseRows as Expense[]).filter((expense) => scopedBranchIds.has(expense.branch_id) && String(expense.category ?? "").trim().toLowerCase() === "locum_doctor"),
    openingBalances: (openingBalanceRows as OpeningBalance[]).filter((balance) => {
      return (balance.balance_type === "cash_in_hand" || balance.balance_type === "petty_cash")
        && (!balance.branch_id || scopedBranchIds.has(balance.branch_id));
    }),
    pettyCashTransactions: (pettyCashRows as PettyCashTransaction[]).filter((transaction) => scopedBranchIds.has(transaction.branch_id)),
    sales: (salesRows as DailySale[]).filter((sale) => scopedBranchIds.has(sale.branch_id))
  };
}

export type BranchPicCashBankInTarget = {
  bankAccount: BankAccount | null;
  bankAccounts: BankAccount[];
  branch: Branch | null;
  mapping: BranchBankMapping | null;
  mappings: BranchBankMapping[];
};

function isPanelBankAccount(account: Pick<BankAccount, "name" | "bank_name"> | null | undefined) {
  const haystack = `${account?.name ?? ""} ${account?.bank_name ?? ""}`.trim().toLowerCase();
  return haystack.includes("panel");
}

export async function getBranchPicCashBankInTarget(branchId: string | null | undefined): Promise<BranchPicCashBankInTarget> {
  if (!branchId) return { bankAccount: null, bankAccounts: [], branch: null, mapping: null, mappings: [] };

  if (!hasSupabaseEnv()) {
    const branch = branches.find((item) => item.id === branchId) ?? null;
    const mappings = branchBankMappings.filter((item) => item.branch_id === branchId && item.is_active);
    const branchBankAccounts = mappings
      .map((mapping) => bankAccounts.find((account) => account.id === mapping.bank_account_id && account.is_active) ?? null)
      .filter((account): account is BankAccount => Boolean(account))
      .filter((account) => !isPanelBankAccount(account));
    const bankAccount = branchBankAccounts[0] ?? null;
    const mapping = bankAccount
      ? mappings.find((item) => item.bank_account_id === bankAccount.id) ?? null
      : null;

    return { bankAccount, bankAccounts: branchBankAccounts, branch, mapping, mappings };
  }

  const supabase = await createClient();
  const [branchRow, mappingRowsResult] = await Promise.all([
    supabase.from("branches").select("*").eq("id", branchId).maybeSingle(),
    supabase
      .from("branch_bank_mappings")
      .select("id, branch_id, bank_account_id, is_active")
      .eq("branch_id", branchId)
      .eq("is_active", true)
  ]);

  const branch = branchRow.error || !branchRow.data ? null : branchRow.data as Branch;
  const mappings = mappingRowsResult.error || !mappingRowsResult.data ? [] : mappingRowsResult.data as BranchBankMapping[];
  if (!mappings.length) {
    console.warn("cash-bank-in bank loader found no active branch mappings", {
      action: "getBranchPicCashBankInTarget",
      selectedBranchId: branchId,
      mappedBankRowsReturned: 0,
      reason: "no_active_branch_mappings"
    });
    return { bankAccount: null, bankAccounts: [], branch, mapping: null, mappings: [] };
  }

  const mappedBankIds = Array.from(new Set(mappings.map((mapping) => mapping.bank_account_id).filter(Boolean)));
  const { data: bankAccountRows, error: bankAccountError } = await supabase
    .from("bank_accounts")
    .select("*")
    .in("id", mappedBankIds)
    .eq("is_active", true)
    .order("name");

  const activeMappedBankAccounts = bankAccountError || !bankAccountRows ? [] : bankAccountRows as BankAccount[];
  const nonPanelBankAccounts = activeMappedBankAccounts.filter((account) => !isPanelBankAccount(account));
  const selectedBankAccount = nonPanelBankAccounts[0] ?? null;
  const selectedMapping = selectedBankAccount
    ? mappings.find((mapping) => mapping.bank_account_id === selectedBankAccount.id) ?? null
    : null;

  if (!selectedBankAccount) {
    console.warn("cash-bank-in bank loader found no non-panel mapped banks", {
      action: "getBranchPicCashBankInTarget",
      selectedBranchId: branchId,
      mappedBankRowsReturned: activeMappedBankAccounts.length,
      mappedBanks: activeMappedBankAccounts.map((account) => ({
        id: account.id,
        name: account.name,
        bank_name: account.bank_name ?? null,
        is_active: account.is_active
      })),
      nonPanelCandidateBanks: nonPanelBankAccounts.map((account) => account.name),
      finalSelectedDestinationBankId: null,
      finalSelectedDestinationBankName: null,
      reason: "no_non_panel_mapped_banks"
    });
  } else {
    console.info("cash-bank-in bank loader selected branch_pic destination bank", {
      action: "getBranchPicCashBankInTarget",
      selectedBranchId: branchId,
      mappedBankRowsReturned: activeMappedBankAccounts.length,
      mappedBanks: activeMappedBankAccounts.map((account) => ({
        id: account.id,
        name: account.name,
        bank_name: account.bank_name ?? null,
        is_active: account.is_active
      })),
      nonPanelCandidateBanks: nonPanelBankAccounts.map((account) => account.name),
      finalSelectedDestinationBankId: selectedBankAccount.id,
      finalSelectedDestinationBankName: selectedBankAccount.name
    });
  }

  return {
    bankAccount: selectedBankAccount,
    bankAccounts: nonPanelBankAccounts,
    branch,
    mapping: selectedMapping,
    mappings
  };
}

export async function getBankingDataForScope(options: BankingDataOptions = {}): Promise<BankingData> {
  const profile = await getCurrentProfile();
  if (!hasSupabaseEnv()) return filterBankingDataForProfile(demoBankingData, profile, options);

  const supabase = await createClient();
  const role = normalizeRole(profile?.role);
  const [branchRows, openingBalanceRows, salesRows, expenseRows, permissionRows, transactionRows, mappingRows, cashBankInRows, pettyCashRows, supplierPaymentRows, panelPaymentRows] = await Promise.all([
    fetchOrDemo(supabase.from("branches").select("*").eq("is_active", true).order("name"), demoBankingData.branches, "branches"),
    fetchOrDemo(
      supabase
        .from("opening_balances")
        .select("*, branches(name, code), bank_accounts(name, bank_name, account_no), suppliers(name), panel_companies(name)")
        .order("balance_date", { ascending: false }),
      demoBankingData.openingBalances,
      "opening_balances"
    ),
    fetchOrDemo(
      supabase
        .from("daily_sales")
        .select("*, branches(name, code)")
        .order("sale_date", { ascending: false }),
      demoBankingData.sales,
      "daily_sales"
    ),
    fetchOrDemo(
      supabase
        .from("expenses")
        .select("*, branches(name, code)")
        .order("expense_date", { ascending: false }),
      demoBankingData.expenses,
      "expenses_banking"
    ),
    fetchOrDemo<BankAccountPermission[]>(
      supabase
        .from("bank_account_permissions")
        .select("id, user_id, bank_account_id, can_view, can_create_transaction, can_edit_transaction, can_manage_account"),
      demoBankingData.bankAccountPermissions,
      "bank_account_permissions"
    ),
    fetchOrDemo(
      supabase
        .from("bank_transactions")
        .select("*, branches(name, code), bank_accounts:bank_accounts!bank_transactions_bank_account_id_fkey(id, name, bank_name, account_no)")
        .order("transaction_date", { ascending: false }),
      demoBankingData.bankTransactions,
      "bank_transactions"
    ),
    fetchOrDemo(
      supabase
        .from("branch_bank_mappings")
        .select("*, branches(name, code), bank_accounts(name, bank_name, account_no)")
        .eq("is_active", true),
      demoBankingData.branchBankMappings,
      "branch_bank_mappings"
    ),
    fetchOrDemo(
      supabase
        .from("cash_bank_ins")
        .select("*, branches(name, code), bank_accounts(name, bank_name, account_no)")
        .order("bank_in_date", { ascending: false }),
      demoBankingData.cashBankIns,
      "cash_bank_ins"
    ),
    fetchOrDemo(
      supabase
        .from("petty_cash_transactions")
        .select("*, branches(name, code), bank_accounts(name, bank_name, account_no)")
        .order("transaction_date", { ascending: false }),
      demoBankingData.pettyCashTransactions,
      "petty_cash_transactions"
    ),
    fetchOrDemo(
      supabase
        .from("supplier_payment_entries")
        .select("*, suppliers(name), branches(name, code), bank_accounts(name, bank_name, account_no), supplier_purchase_entries(id, invoice_no, branch_id, supplier_id, due_date, total_amount)")
        .order("payment_date", { ascending: false }),
      demoBankingData.supplierPayments,
      "supplier_payment_entries"
    ),
    fetchOrDemo(
      supabase
        .from("panel_payments")
        .select("*, bank_accounts(name, bank_name, account_no), panel_claims(branch_id, claim_no, panel_company_id, branches(name, code), panel_companies(name))")
        .order("payment_date", { ascending: false }),
      demoBankingData.panelPayments,
      "panel_payments"
    )
  ]);

  const permissionRowsTyped = permissionRows as BankAccountPermission[];
  const allowedPermissionRows = role === "owner"
    ? permissionRowsTyped
    : permissionRowsTyped.filter((permission) => permission.user_id === profile?.id && permissionHasVisibleAccount(permission));
  const allowedBankAccountIds = Array.from(new Set(allowedPermissionRows.map((permission) => permission.bank_account_id)));

  let bankRows: BankAccount[] = [];
  if (role === "owner") {
    bankRows = await fetchOrDemo(
      supabase.from("bank_accounts").select("*").eq("is_active", true).order("name"),
      demoBankingData.bankAccounts
    ) as BankAccount[];
  } else if (role === "admin" || role === "finance") {
    bankRows = allowedBankAccountIds.length
      ? await fetchOrDemo(
          supabase
            .from("bank_accounts")
            .select("id, name, bank_name, is_active")
            .in("id", allowedBankAccountIds)
            .eq("is_active", true)
            .order("name"),
          []
        ) as BankAccount[]
      : [];
  } else {
    bankRows = await fetchOrDemo(supabase.from("bank_accounts").select("*").eq("is_active", true).order("name"), demoBankingData.bankAccounts) as BankAccount[];
  }

  const normalizedPanelPayments = (panelPaymentRows as PanelPayment[]).map((payment) => ({
    ...payment,
    branch_id: payment.branch_id ?? payment.panel_claims?.branch_id ?? null,
    panel_company_id: payment.panel_company_id ?? payment.panel_claims?.panel_company_id ?? null,
    panel_companies: payment.panel_companies ?? payment.panel_claims?.panel_companies ?? null,
    branches: payment.branches ?? payment.panel_claims?.branches ?? null,
    panel_claims: payment.panel_claims ?? null
  }));

  return filterBankingDataForProfile(
    {
      branches: branchRows as Branch[],
      openingBalances: openingBalanceRows as OpeningBalance[],
      sales: salesRows as DailySale[],
      expenses: expenseRows as Expense[],
      bankAccounts: bankRows as BankAccount[],
      bankAccountPermissions: permissionRowsTyped,
      bankTransactions: transactionRows as BankTransaction[],
      branchBankMappings: mappingRows as BranchBankMapping[],
      cashBankIns: cashBankInRows as CashBankIn[],
      pettyCashTransactions: pettyCashRows as PettyCashTransaction[],
      supplierPayments: supplierPaymentRows as SupplierPaymentEntry[],
      panelPayments: normalizedPanelPayments
    },
    profile,
    options
  );
}

export async function getSuppliers(options: { includeInactive?: boolean } = {}) {
  if (!hasSupabaseEnv()) return suppliers;
  const supabase = await createClient();
  const query = supabase.from("suppliers").select("*").order("name");
  return fetchOrDemo(options.includeInactive ? query : query.eq("is_active", true), suppliers);
}

export async function getPanelPaymentBankAccounts() {
  const profile = await getCurrentProfile();
  if (!profile?.is_active) {
    return { bankAccounts: [] as BankAccount[], branchBankMappings: [] as BranchBankMapping[] };
  }
  if (!hasSupabaseEnv()) {
    return {
      bankAccounts,
      branchBankMappings
    };
  }

  const role = normalizeRole(profile.role);
  const bankLookupSupabase = role === "owner" || role === "admin" || role === "finance"
    ? createAdminClient()
    : await createClient();

  const [mappingRows] = await Promise.all([
    fetchOrDemo(
      bankLookupSupabase
        .from("branch_bank_mappings")
        .select("*, branches(name, code), bank_accounts(name, bank_name, account_no)")
        .eq("is_active", true),
      branchBankMappings,
      "panel_payment_branch_bank_mappings"
    )
  ]);

  let bankAccountRows: BankAccount[] = [];
  const activeQuery = await bankLookupSupabase.from("bank_accounts").select("*").eq("is_active", true).order("name");
  if (activeQuery.error && (activeQuery.error.code === "42703" || activeQuery.error.message?.toLowerCase().includes("is_active"))) {
    const fallbackQuery = await bankLookupSupabase.from("bank_accounts").select("id, name, bank_name, account_no").order("name");
    if (fallbackQuery.error || !fallbackQuery.data) {
      if (fallbackQuery.error) {
        console.error("getPanelPaymentBankAccounts fallback failed", {
          action: "getPanelPaymentBankAccounts",
          role: profile.role,
          code: fallbackQuery.error.code,
          error: fallbackQuery.error.message,
          details: fallbackQuery.error.details,
          hint: fallbackQuery.error.hint
        });
      }
      bankAccountRows = bankAccounts;
    } else {
      bankAccountRows = fallbackQuery.data.map((account) => ({
        ...account,
        is_active: true
      }));
    }
  } else if (!activeQuery.error && activeQuery.data && activeQuery.data.length === 0) {
    const fallbackQuery = await bankLookupSupabase.from("bank_accounts").select("id, name, bank_name, account_no").order("name");
    if (fallbackQuery.error || !fallbackQuery.data) {
      if (fallbackQuery.error) {
        console.error("getPanelPaymentBankAccounts fallback after zero active rows failed", {
          action: "getPanelPaymentBankAccounts",
          role: profile.role,
          code: fallbackQuery.error.code,
          error: fallbackQuery.error.message,
          details: fallbackQuery.error.details,
          hint: fallbackQuery.error.hint
        });
      }
      bankAccountRows = bankAccounts;
    } else {
      console.warn("getPanelPaymentBankAccounts active filter returned zero rows; falling back to all readable accounts", {
        action: "getPanelPaymentBankAccounts",
        role: profile.role,
        bankAccountCount: fallbackQuery.data.length,
        bankAccountNames: fallbackQuery.data.map((account) => account.name),
        isActiveFilterApplied: true,
        branchIdFilterApplied: false
      });
      bankAccountRows = fallbackQuery.data.map((account) => ({
        ...account,
        is_active: true
      }));
    }
  } else if (activeQuery.error || !activeQuery.data) {
    if (activeQuery.error) {
      console.error("getPanelPaymentBankAccounts failed", {
        action: "getPanelPaymentBankAccounts",
        role: profile.role,
        code: activeQuery.error.code,
        error: activeQuery.error.message,
        details: activeQuery.error.details,
        hint: activeQuery.error.hint
      });
    }
    bankAccountRows = bankAccounts;
  } else {
    bankAccountRows = activeQuery.data as BankAccount[];
  }

  const typedMappings = mappingRows as BranchBankMapping[];
  const scopedMappings = role === "branch_pic" && profile.branch_id
    ? typedMappings.filter((mapping) => mapping.branch_id === profile.branch_id)
    : typedMappings;
  const scopedBankIds = new Set(scopedMappings.map((mapping) => mapping.bank_account_id));
  const scopedBankAccounts = role === "branch_pic" && profile.branch_id
    ? bankAccountRows.filter((account) => scopedBankIds.has(account.id))
    : bankAccountRows;

  return {
    bankAccounts: scopedBankAccounts,
    branchBankMappings: scopedMappings
  };
}

export async function getSupplierPurchaseEntries() {
  const profile = await getCurrentProfile();
  if (!profile?.is_active) return [] as SupplierPurchaseEntry[];

  if (!hasSupabaseEnv()) {
    return canViewAllBranches(profile)
      ? supplierPurchaseEntriesDemo
      : supplierPurchaseEntriesDemo.filter((entry) => entry.branch_id === profile.branch_id);
  }

  const supabase = createAdminClient();
  const rows = await fetchOrDemo(
    supabase
      .from("supplier_purchase_entries")
      .select("*, suppliers(name), branches(name, code)")
      .order("purchase_date", { ascending: false })
      .order("created_at", { ascending: false }),
    [] as SupplierPurchaseEntry[],
    "supplier_purchase_entries"
  );

  const entries = rows as SupplierPurchaseEntry[];
  return canViewAllBranches(profile)
    ? entries
    : entries.filter((entry) => entry.branch_id === profile.branch_id);
}

export async function getSupplierPaymentEntries() {
  const profile = await getCurrentProfile();
  if (!profile?.is_active) return [] as SupplierPaymentEntry[];

  if (!hasSupabaseEnv()) {
    return canViewAllBranches(profile)
      ? supplierPaymentEntriesDemo
      : supplierPaymentEntriesDemo.filter((entry) => entry.branch_id === profile.branch_id);
  }

  const supabase = createAdminClient();
  const rows = await fetchOrDemo(
    supabase
      .from("supplier_payment_entries")
      .select("*, suppliers(name), branches(name, code), bank_accounts(name, bank_name, account_no), supplier_purchase_entries(id, invoice_no, branch_id, supplier_id, due_date, total_amount)")
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false }),
    [] as SupplierPaymentEntry[],
    "supplier_payment_entries"
  );

  const entries = rows as SupplierPaymentEntry[];
  return canViewAllBranches(profile)
    ? entries
    : entries.filter((entry) => entry.branch_id === profile.branch_id);
}

export async function getBranches() {
  const profile = await getCurrentProfile();
  if (!hasSupabaseEnv()) return filterBranchesForProfile(branches, profile);
  const supabase = await createClient();

  if (profile?.is_active && !canViewAllBranches(profile) && profile.branch_id) {
    const assignedBranch = await fetchOrDemo(
      supabase.from("branches").select("*").eq("id", profile.branch_id).maybeSingle(),
      null
    );
    return assignedBranch ? [assignedBranch as Branch] : [];
  }

  const rows = await fetchOrDemo(supabase.from("branches").select("*").eq("is_active", true).order("name"), branches);
  return filterBranchesForProfile(rows as Branch[], profile);
}

export async function getPanelCompanies() {
  if (!hasSupabaseEnv()) return panelCompanies;
  const supabase = await createClient();
  return fetchOrDemo(supabase.from("panel_companies").select("*").order("name"), panelCompanies);
}

export async function getImportReferenceData() {
  const profile = await getCurrentProfile();
  if (!hasSupabaseEnv()) {
    return {
      branches: filterBranchesForProfile(branches, profile),
      bankAccounts,
      suppliers,
      panelCompanies,
      purchases
    };
  }

  const supabase = await createClient();
  const [branchRows, bankRows, supplierRows, panelRows, purchaseRows] = await Promise.all([
    fetchOrDemo(supabase.from("branches").select("*").eq("is_active", true).order("name"), branches),
    fetchOrDemo(supabase.from("bank_accounts").select("*").eq("is_active", true).order("name"), bankAccounts),
    fetchOrDemo(supabase.from("suppliers").select("*").eq("is_active", true).order("name"), suppliers),
    fetchOrDemo(supabase.from("panel_companies").select("*").eq("is_active", true).order("name"), panelCompanies),
    fetchOrDemo(
      supabase
        .from("supplier_purchases")
        .select("*")
        .order("purchase_date", { ascending: false }),
      purchases
    )
  ]);

  return {
    branches: filterBranchesForProfile(branchRows as Branch[], profile),
    bankAccounts: bankRows as BankAccount[],
    suppliers: supplierRows as Supplier[],
    panelCompanies: panelRows as PanelCompany[],
    purchases: purchaseRows as SupplierPurchase[]
  };
}

export function totalBy<T>(items: T[], getAmount: (item: T) => number) {
  return items.reduce((sum, item) => sum + getAmount(item), 0);
}

export function branchName(data: DashboardData, branchId: string) {
  return data.branches.find((branch) => branch.id === branchId)?.name ?? branchId;
}

export async function getSupplierOutstanding() {
  if (!hasSupabaseEnv()) {
    const profile = await getCurrentProfile();
    const rows = supplierPurchaseEntriesDemo.map((row) => {
      const paidAmount = supplierPaymentEntriesDemo
        .filter((payment) => !payment.is_void && payment.supplier_purchase_entry_id === row.id)
        .reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);
      const outstandingAmount = Math.max(0, Number(row.total_amount ?? 0) - paidAmount);
      return {
        ...row,
        paid_amount: paidAmount,
        outstanding_amount: outstandingAmount,
        status: outstandingAmount <= 0 ? "paid" : paidAmount > 0 ? "partial" : "unpaid",
        aging_bucket: "not_due",
        days_overdue: 0,
        supplier_name: row.suppliers?.name,
        branch_name: row.branches?.name
      } as SupplierOutstandingRow;
    });
    if (!profile || canViewAllBranches(profile)) return rows;
    if (!profile.branch_id) return [];
    return rows.filter((row) => row.branch_id === profile.branch_id);
  }

  const profile = await getCurrentProfile();
  const supabase = createAdminClient();
  const [purchaseRows, paymentRows] = await Promise.all([
    fetchOrDemo(
      supabase
        .from("supplier_purchase_entries")
        .select("id, supplier_id, branch_id, invoice_no, invoice_date, purchase_date, credit_term_days, due_date, category, medicine_cost, consumables_cost, other_cost, total_amount, notes, is_void, void_reason, voided_at, voided_by, created_at, updated_at, suppliers(name), branches(name, code)")
        .is("is_void", false)
        .order("due_date", { ascending: true }),
      [] as unknown[],
      "supplier_purchase_entries_outstanding"
    ),
    fetchOrDemo(
      supabase
        .from("supplier_payment_entries")
        .select("id, supplier_purchase_entry_id, branch_id, amount, is_void")
        .is("is_void", false),
      [] as unknown[],
      "supplier_payment_entries_outstanding"
    )
  ]);

  const paidByPurchaseId = new Map<string, number>();
  (paymentRows as Pick<SupplierPaymentEntry, "supplier_purchase_entry_id" | "amount">[]).forEach((payment) => {
    if (!payment.supplier_purchase_entry_id) return;
    paidByPurchaseId.set(
      payment.supplier_purchase_entry_id,
      (paidByPurchaseId.get(payment.supplier_purchase_entry_id) ?? 0) + Number(payment.amount ?? 0)
    );
  });

  const today = new Date().toISOString().slice(0, 10);
  const outstandingRows = (purchaseRows as unknown as SupplierPurchaseEntry[]).map((row) => {
    const dueDate = row.due_date;
    const paidAmount = paidByPurchaseId.get(row.id) ?? 0;
    const outstandingAmount = Math.max(0, Number(row.total_amount ?? 0) - paidAmount);
    let agingBucket = "not_due";
    let daysOverdue = 0;

    if (outstandingAmount <= 0) {
      agingBucket = "paid";
    } else if (dueDate && dueDate < today) {
      const dueMs = new Date(`${dueDate}T00:00:00Z`).getTime();
      const todayMs = new Date(`${today}T00:00:00Z`).getTime();
      daysOverdue = Math.max(0, Math.floor((todayMs - dueMs) / 86400000));
      if (daysOverdue > 90) agingBucket = "over_90";
      else if (daysOverdue > 60) agingBucket = "overdue_61_90";
      else if (daysOverdue > 30) agingBucket = "overdue_31_60";
      else agingBucket = "overdue";
    } else if (dueDate) {
      const dueMs = new Date(`${dueDate}T00:00:00Z`).getTime();
      const todayMs = new Date(`${today}T00:00:00Z`).getTime();
      const daysUntilDue = Math.max(0, Math.floor((dueMs - todayMs) / 86400000));
      agingBucket = daysUntilDue <= 30 ? "due_within_30" : "not_due";
    }

    return {
      ...row,
      category: (row.category as PurchaseCategory | null | undefined) ?? "other",
      paid_amount: paidAmount,
      outstanding_amount: outstandingAmount,
      status: outstandingAmount <= 0 ? "paid" : paidAmount > 0 ? "partial" : dueDate && dueDate < today ? "overdue" : "unpaid",
      aging_bucket: agingBucket,
      days_overdue: daysOverdue,
      supplier_name: row.suppliers?.name,
      branch_name: row.branches?.name
    } as SupplierOutstandingRow;
  });

  if (!profile || canViewAllBranches(profile)) return outstandingRows;
  if (!profile.branch_id) return [];
  return outstandingRows.filter((row) => row.branch_id === profile.branch_id);
}
