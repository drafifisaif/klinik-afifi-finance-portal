import { createAdminClient } from "@/lib/supabase-admin";
import { createClient, getSupabaseHost, hasSupabaseEnv } from "@/lib/supabase-server";
import { branchPicHiddenExpenseCategories } from "@/lib/constants";
import { canViewAllBranches, filterBranchesForProfile, filterDashboardDataForProfile, getCurrentProfile, normalizeRole } from "@/lib/permissions";
import { monthlyOpeningBalanceStartMonth } from "@/lib/opening-balances";
import type { DateRange } from "@/lib/bank-reporting";
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
  MonthlyOpeningBalance,
  OpeningBalance,
  PanelClaim,
  PanelPayment,
  PanelCompany,
  PettyCashTransaction,
  Profile,
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
const monthlyOpeningBalances: MonthlyOpeningBalance[] = [];

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
  monthlyOpeningBalances,
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
  let result: { data: T | null; error: unknown };
  try {
    result = await query;
  } catch (error) {
    console.error(`fetchOrDemo rejected for ${label ?? "unknown query"}`, error);
    return fallback;
  }
  const { data, error } = result;
  if (error || !data) {
    if (error) {
      console.error(`fetchOrDemo failed for ${label ?? "unknown query"}`, {
        error,
        supabaseHost: label?.includes("monthly_opening_balances") ? getSupabaseHost() : undefined
      });
    }
    return fallback;
  }
  return data;
}

async function fetchProjectedOrDemo<T>(query: PromiseLike<{ data: unknown | null; error: unknown }>, fallback: T, label?: string) {
  return fetchOrDemo(query as PromiseLike<{ data: T | null; error: unknown }>, fallback, label);
}

async function fetchAllPagesOrDemo<T>(
  queryForPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  fallback: unknown[],
  label: string
): Promise<unknown[]> {
  const rows: T[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    let result: { data: T[] | null; error: unknown };
    try {
      result = await queryForPage(from, from + pageSize - 1);
    } catch (error) {
      console.error(`fetchAllPagesOrDemo rejected for ${label}`, error);
      return fallback;
    }

    if (result.error || !result.data) {
      console.error(`fetchAllPagesOrDemo failed for ${label}`, result.error);
      return fallback;
    }

    rows.push(...result.data);
    if (result.data.length < pageSize) return rows;
  }
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

export async function getBranchManagementBranches(profile: Profile): Promise<Branch[]> {
  if (!hasSupabaseEnv()) return filterBranchesForProfile(demoData.branches, profile);
  const supabase = await createClient();
  const rows = await fetchOrDemo(supabase.from("branches").select("*").order("name"), demoData.branches, "branch_management_branches");
  return filterBranchesForProfile(rows as Branch[], profile);
}

export async function getDailySalesPageData(
  profile: Profile,
  dateRange?: { startDate: string; endDate: string }
): Promise<Pick<DashboardData, "branches" | "sales">> {
  if (!hasSupabaseEnv()) {
    const data = filterDashboardDataForProfile(demoData, profile);
    return { branches: data.branches, sales: data.sales };
  }

  const supabase = await createClient();
  let salesQuery = supabase.from("daily_sales").select("*, branches(name, code)").order("sale_date", { ascending: false });
  if (dateRange) salesQuery = salesQuery.gte("sale_date", dateRange.startDate).lte("sale_date", dateRange.endDate);
  const [branchRows, salesRows] = await Promise.all([
    fetchOrDemo(supabase.from("branches").select("*").order("name"), demoData.branches, "daily_sales_branches"),
    fetchOrDemo(salesQuery, demoData.sales, "daily_sales_page")
  ]);
  const visibleBranches = filterBranchesForProfile(branchRows as Branch[], profile);
  const visibleBranchIds = new Set(visibleBranches.map((branch) => branch.id));

  return {
    branches: visibleBranches,
    sales: (salesRows as DailySale[]).filter((sale) => visibleBranchIds.has(sale.branch_id))
  };
}

export async function getPanelOutstandingPageData(profile: Profile): Promise<Pick<DashboardData, "branches" | "openingBalances" | "panels" | "panelPayments">> {
  if (!hasSupabaseEnv()) {
    const data = filterDashboardDataForProfile(demoData, profile);
    return {
      branches: data.branches,
      openingBalances: data.openingBalances,
      panels: data.panels,
      panelPayments: data.panelPayments
    };
  }

  const supabase = await createClient();
  const [branchRows, openingBalanceRows, panelRows, panelPaymentRows] = await Promise.all([
    fetchOrDemo(supabase.from("branches").select("*").order("name"), demoData.branches, "panel_outstanding_branches"),
    fetchOrDemo(
      supabase.from("opening_balances")
        .select("*, branches(name, code), bank_accounts(name, bank_name, account_no), suppliers(name), panel_companies(name)")
        .order("balance_date", { ascending: false }),
      demoData.openingBalances,
      "panel_outstanding_opening_balances"
    ),
    fetchOrDemo(
      supabase.from("panel_claims").select("*, panel_companies(name), branches(name, code)").order("claim_month", { ascending: false }),
      demoData.panels,
      "panel_outstanding_claims"
    ),
    fetchOrDemo(
      supabase.from("panel_payments")
        .select("*, bank_accounts(name, bank_name, account_no), panel_claims(branch_id, claim_no, panel_company_id, branches(name, code), panel_companies(name))")
        .order("payment_date", { ascending: false }),
      demoData.panelPayments,
      "panel_outstanding_payments"
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
  const visible = filterDashboardDataForProfile({
    branches: branchRows as Branch[],
    openingBalances: openingBalanceRows as OpeningBalance[],
    sales: [],
    expenses: [],
    purchases: [],
    supplierPayments: [],
    panels: panelRows as PanelClaim[],
    panelPayments: normalizedPanelPayments
  }, profile);

  return {
    branches: visible.branches,
    openingBalances: visible.openingBalances,
    panels: visible.panels,
    panelPayments: visible.panelPayments
  };
}

export async function getExpensesReportingData(dateRange?: { startDate: string; endDate: string }): Promise<Pick<DashboardData, "branches" | "expenses" | "supplierPayments">> {
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
  let expensesQuery = supabase
    .from("expenses")
    .select("id, branch_id, expense_date, category, vendor_name, description, payment_type, amount, receipt_path, entered_by, created_at, is_void, voided_at, voided_by, void_reason, branches(name, code)")
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });
  let supplierPaymentsQuery = adminSupabase
    .from("supplier_payment_entries")
    .select("id, supplier_purchase_entry_id, supplier_id, branch_id, payment_date, payment_method, bank_account_id, amount, reference_no, notes, is_void, created_at, suppliers(name), branches(name, code), bank_accounts(name, bank_name, account_no), supplier_purchase_entries(invoice_no)")
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (dateRange) {
    expensesQuery = expensesQuery.gte("expense_date", dateRange.startDate).lte("expense_date", dateRange.endDate);
    supplierPaymentsQuery = supplierPaymentsQuery.gte("payment_date", dateRange.startDate).lte("payment_date", dateRange.endDate);
  }
  const [branchRows, expenseRows, supplierPaymentRows] = await Promise.all([
    fetchProjectedOrDemo<Branch[]>(
      supabase.from("branches").select("id, name, code, is_active").order("name"),
      demoData.branches,
      "expenses_reporting_branches"
    ),
    fetchProjectedOrDemo<Expense[]>(expensesQuery, demoData.expenses, "expenses_reporting"),
    fetchProjectedOrDemo<SupplierPaymentEntry[]>(supplierPaymentsQuery, demoData.supplierPayments, "supplier_payment_entries_reporting")
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
  cashControlOnly?: boolean;
  cashControlRange?: Pick<DateRange, "endDate" | "startDate">;
};

export type DashboardOperationalCashData = Pick<
  BankingData,
  "branches" | "cashBankIns" | "expenses" | "monthlyOpeningBalances" | "openingBalances" | "pettyCashTransactions" | "sales"
>;

function permissionHasVisibleAccount(permission: BankAccountPermission) {
  return permission.can_view || permission.can_create_transaction || permission.can_edit_transaction || permission.can_manage_account;
}

function filterBankingDataForProfile(data: BankingData, profile: Awaited<ReturnType<typeof getCurrentProfile>>, options: BankingDataOptions = {}): BankingData {
  const filteredBranches = filterBranchesForProfile(data.branches, profile);
  const branchIds = new Set(filteredBranches.map((branch) => branch.id));
  const role = normalizeRole(profile?.role);

  const shouldFilterByBankPermissions = profile?.is_active && !options.cashControlOnly && (role === "admin" || role === "finance");
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

    monthlyOpeningBalances: data.monthlyOpeningBalances.filter((balance) => visibleBranchIds.has(balance.branch_id)),

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

export async function getPettyCashPageData(profile: Profile): Promise<Pick<BankingData, "bankAccounts" | "branches" | "monthlyOpeningBalances" | "openingBalances" | "pettyCashTransactions">> {
  if (!hasSupabaseEnv()) {
    const data = filterBankingDataForProfile(demoBankingData, profile);
    return {
      bankAccounts: data.bankAccounts,
      branches: data.branches,
      monthlyOpeningBalances: data.monthlyOpeningBalances,
      openingBalances: data.openingBalances,
      pettyCashTransactions: data.pettyCashTransactions
    };
  }

  const supabase = await createClient();
  const [branchRows, openingBalanceRows, monthlyOpeningBalanceRows, permissionRows, mappingRows, pettyCashRows] = await Promise.all([
    fetchOrDemo(supabase.from("branches").select("*").eq("is_active", true).order("name"), demoBankingData.branches, "petty_cash_branches"),
    fetchOrDemo(
      supabase.from("opening_balances")
        .select("*, branches(name, code), bank_accounts(name, bank_name, account_no), suppliers(name), panel_companies(name)")
        .order("balance_date", { ascending: false }),
      demoBankingData.openingBalances,
      "petty_cash_opening_balances"
    ),
    fetchOrDemo(
      supabase.from("monthly_opening_balances").select("*, branches(name, code)").order("balance_month", { ascending: false }),
      demoBankingData.monthlyOpeningBalances,
      "petty_cash_monthly_opening_balances"
    ),
    fetchOrDemo<BankAccountPermission[]>(
      supabase.from("bank_account_permissions")
        .select("id, user_id, bank_account_id, can_view, can_create_transaction, can_edit_transaction, can_manage_account"),
      demoBankingData.bankAccountPermissions,
      "petty_cash_bank_permissions"
    ),
    fetchOrDemo(
      supabase.from("branch_bank_mappings").select("*, branches(name, code), bank_accounts(name, bank_name, account_no)").eq("is_active", true),
      demoBankingData.branchBankMappings,
      "petty_cash_branch_bank_mappings"
    ),
    fetchOrDemo(
      supabase.from("petty_cash_transactions").select("*, branches(name, code), bank_accounts(name, bank_name, account_no)").order("transaction_date", { ascending: false }),
      demoBankingData.pettyCashTransactions,
      "petty_cash_transactions"
    )
  ]);
  const role = normalizeRole(profile.role);
  const permissions = permissionRows as BankAccountPermission[];
  const allowedBankAccountIds = Array.from(new Set(
    permissions
      .filter((permission) => role === "owner" || (permission.user_id === profile.id && permissionHasVisibleAccount(permission)))
      .map((permission) => permission.bank_account_id)
  ));
  const bankRows: BankAccount[] = role === "admin" || role === "finance"
    ? allowedBankAccountIds.length
      ? await fetchOrDemo(
          supabase.from("bank_accounts").select("id, name, bank_name, is_active").in("id", allowedBankAccountIds).eq("is_active", true).order("name"),
          [],
          "petty_cash_permitted_bank_accounts"
        )
      : []
    : await fetchOrDemo(
        supabase.from("bank_accounts").select("*").eq("is_active", true).order("name"),
        demoBankingData.bankAccounts,
        "petty_cash_bank_accounts"
      );
  const filtered = filterBankingDataForProfile({
    branches: branchRows as Branch[],
    openingBalances: openingBalanceRows as OpeningBalance[],
    monthlyOpeningBalances: monthlyOpeningBalanceRows as MonthlyOpeningBalance[],
    sales: [],
    expenses: [],
    bankAccounts: bankRows,
    bankAccountPermissions: permissions,
    bankTransactions: [],
    branchBankMappings: mappingRows as BranchBankMapping[],
    cashBankIns: [],
    pettyCashTransactions: pettyCashRows as PettyCashTransaction[],
    supplierPayments: [],
    panelPayments: []
  }, profile);

  return {
    bankAccounts: filtered.bankAccounts,
    branches: filtered.branches,
    monthlyOpeningBalances: filtered.monthlyOpeningBalances,
    openingBalances: filtered.openingBalances,
    pettyCashTransactions: filtered.pettyCashTransactions
  };
}

export async function getDashboardOperationalCashData(range?: Pick<DateRange, "endDate" | "startDate">): Promise<DashboardOperationalCashData> {
  const profile = await getCurrentProfile();
  const fallbackBranches = filterBranchesForProfile(demoBankingData.branches, profile);
  const fallbackBranchIds = new Set(fallbackBranches.map((branch) => branch.id));
  const fallbackOperational = {
    branches: fallbackBranches,
    cashBankIns: demoBankingData.cashBankIns.filter((bankIn) => fallbackBranchIds.has(bankIn.branch_id)),
    expenses: demoBankingData.expenses.filter((expense) => fallbackBranchIds.has(expense.branch_id) && String(expense.category ?? "").trim().toLowerCase() === "locum_doctor"),
    monthlyOpeningBalances: demoBankingData.monthlyOpeningBalances.filter((balance) => fallbackBranchIds.has(balance.branch_id)),
    openingBalances: demoBankingData.openingBalances.filter((balance) => {
      return (balance.balance_type === "cash_in_hand" || balance.balance_type === "petty_cash")
        && (!balance.branch_id || fallbackBranchIds.has(balance.branch_id));
    }),
    pettyCashTransactions: demoBankingData.pettyCashTransactions.filter((transaction) => fallbackBranchIds.has(transaction.branch_id)),
    sales: demoBankingData.sales.filter((sale) => fallbackBranchIds.has(sale.branch_id))
  };

  if (!hasSupabaseEnv()) return fallbackOperational;

  const cashControlStartDate = range
    ? range.startDate < monthlyOpeningBalanceStartMonth ? range.startDate : monthlyOpeningBalanceStartMonth
    : null;
  const supabase = await createClient();
  const openingBalancesQuery = supabase
    .from("opening_balances")
    .select("id, balance_date, balance_type, branch_id, bank_account_id, amount, verification_status")
    .in("balance_type", ["cash_in_hand", "petty_cash"]);
  const monthlyOpeningBalancesQuery = supabase.from("monthly_opening_balances")
    .select("id, branch_id, balance_month, opening_cash, opening_petty_cash");
  const salesQuery = supabase.from("daily_sales")
    .select("id, branch_id, sale_date, cash_amount, bank_transfer_amount, card_amount, panel_amount, qr_amount, total_amount, is_void");
  const locumExpensesQuery = supabase.from("expenses")
    .select("id, branch_id, expense_date, category, payment_type, amount, is_void")
    .eq("category", "locum_doctor");
  const cashBankInsQuery = supabase.from("cash_bank_ins")
    .select("id, branch_id, bank_account_id, cash_month, amount, is_void");
  const pettyCashQuery = supabase.from("petty_cash_transactions")
    .select("id, branch_id, bank_account_id, transaction_date, transaction_type, direction, amount, is_void");
  const datedOpeningBalancesQuery = range ? openingBalancesQuery.lte("balance_date", range.endDate) : openingBalancesQuery;
  const datedMonthlyOpeningBalancesQuery = range ? monthlyOpeningBalancesQuery.lte("balance_month", range.endDate) : monthlyOpeningBalancesQuery;
  const rangedSalesQuery = range
    ? salesQuery.gte("sale_date", cashControlStartDate!).lte("sale_date", range.endDate)
    : salesQuery;
  const rangedLocumExpensesQuery = range
    ? locumExpensesQuery.gte("expense_date", cashControlStartDate!).lte("expense_date", range.endDate)
    : locumExpensesQuery;
  const rangedCashBankInsQuery = range
    ? cashBankInsQuery.gte("cash_month", cashControlStartDate!).lte("cash_month", range.endDate)
    : cashBankInsQuery;
  const datedPettyCashQuery = range ? pettyCashQuery.lte("transaction_date", range.endDate) : pettyCashQuery;
  const [branchRows, openingBalanceRows, monthlyOpeningBalanceRows, salesRows, expenseRows, cashBankInRows, pettyCashRows] = await Promise.all([
    fetchOrDemo(supabase.from("branches").select("*").eq("is_active", true).order("name"), [], "dashboard_operational_branches"),
    fetchAllPagesOrDemo(
      (from, to) => datedOpeningBalancesQuery.order("balance_date", { ascending: false }).range(from, to),
      [],
      "dashboard_operational_opening_balances"
    ),
    fetchAllPagesOrDemo(
      (from, to) => datedMonthlyOpeningBalancesQuery.order("balance_month", { ascending: false }).range(from, to),
      [],
      "dashboard_operational_monthly_opening_balances"
    ),
    fetchAllPagesOrDemo(
      (from, to) => rangedSalesQuery.order("sale_date", { ascending: false }).range(from, to),
      [],
      "dashboard_operational_daily_sales"
    ),
    fetchAllPagesOrDemo(
      (from, to) => rangedLocumExpensesQuery.order("expense_date", { ascending: false }).range(from, to),
      [],
      "dashboard_operational_cash_locum_expenses"
    ),
    fetchAllPagesOrDemo(
      (from, to) => rangedCashBankInsQuery.order("cash_month", { ascending: false }).range(from, to),
      [],
      "dashboard_operational_cash_bank_ins"
    ),
    fetchAllPagesOrDemo(
      (from, to) => datedPettyCashQuery.order("transaction_date", { ascending: false }).range(from, to),
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
    monthlyOpeningBalances: (monthlyOpeningBalanceRows as MonthlyOpeningBalance[]).filter((balance) => scopedBranchIds.has(balance.branch_id)),
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

export async function getBranchPicCashBankInTarget(
  branchId: string | null | undefined,
  bankingData?: Pick<BankingData, "bankAccounts" | "branches" | "branchBankMappings">
): Promise<BranchPicCashBankInTarget> {
  if (!branchId) return { bankAccount: null, bankAccounts: [], branch: null, mapping: null, mappings: [] };

  if (bankingData) {
    const branch = bankingData.branches.find((item) => item.id === branchId) ?? null;
    const mappings = bankingData.branchBankMappings.filter((item) => item.branch_id === branchId && item.is_active);
    const nonPanelBankAccounts = mappings
      .map((mapping) => bankingData.bankAccounts.find((account) => account.id === mapping.bank_account_id && account.is_active) ?? null)
      .filter((account): account is BankAccount => Boolean(account))
      .filter((account) => !isPanelBankAccount(account));
    const bankAccount = nonPanelBankAccounts[0] ?? null;
    const mapping = bankAccount ? mappings.find((item) => item.bank_account_id === bankAccount.id) ?? null : null;

    if (!bankAccount) {
      console.warn("cash-bank-in bank loader found no non-panel mapped banks", {
        action: "getBranchPicCashBankInTarget",
        selectedBranchId: branchId,
        mappedBankRowsReturned: mappings.length,
        nonPanelCandidateBanks: nonPanelBankAccounts.map((account) => account.name),
        reason: "no_non_panel_mapped_banks"
      });
    }

    return { bankAccount, bankAccounts: nonPanelBankAccounts, branch, mapping, mappings };
  }

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

  if (options.cashControlOnly) {
    const supabase = await createClient();
    const role = normalizeRole(profile?.role);
    const reportStartDate = options.cashControlRange?.startDate ?? monthlyOpeningBalanceStartMonth;
    const reportEndDate = options.cashControlRange?.endDate;
    const cashControlStartDate = reportStartDate < monthlyOpeningBalanceStartMonth
      ? reportStartDate
      : monthlyOpeningBalanceStartMonth;
    const dateBounded = <T extends { lte: (column: string, value: string) => T }>(query: T, column: string) =>
      reportEndDate ? query.lte(column, reportEndDate) : query;

    const cashBankInSelect = "id, branch_id, bank_account_id, bank_in_date, cash_month, cash_sales_from, cash_sales_to, amount, reference_no, notes, entered_by, created_at, is_void, voided_at, voided_by, void_reason";
    const cashBankInsQuery = dateBounded(
      supabase.from("cash_bank_ins").select(cashBankInSelect).gte("cash_month", cashControlStartDate),
      "cash_month"
    );
    const unassignedCashBankInsQuery = supabase.from("cash_bank_ins").select(cashBankInSelect).is("cash_month", null);

    const branchesQuery = supabase.from("branches").select("id, name, code, is_active").eq("is_active", true).order("name");
    if (role === "branch_pic" && profile?.branch_id) branchesQuery.eq("id", profile.branch_id);
    const mappingsQuery = supabase.from("branch_bank_mappings")
      .select("id, branch_id, bank_account_id, is_active")
      .eq("is_active", true);
    if (role === "branch_pic" && profile?.branch_id) mappingsQuery.eq("branch_id", profile.branch_id);

    const [branchRows, openingBalanceRows, monthlyOpeningBalanceRows, salesRows, expenseRows, permissionRows, mappingRows, cashBankInRows, unassignedCashBankInRows] = await Promise.all([
      fetchProjectedOrDemo(
        branchesQuery,
        demoBankingData.branches,
        "cash_bank_in_branches"
      ),
      fetchAllPagesOrDemo(
        (from, to) => dateBounded(
          supabase.from("opening_balances")
            .select("id, branch_id, balance_date, balance_type, amount, verification_status")
            .in("balance_type", ["cash_in_hand", "petty_cash"]),
          "balance_date"
        ).order("balance_date", { ascending: false }).range(from, to),
        demoBankingData.openingBalances,
        "cash_bank_in_opening_balances"
      ),
      fetchAllPagesOrDemo(
        (from, to) => dateBounded(
          supabase.from("monthly_opening_balances")
            .select("id, branch_id, balance_month, opening_cash, opening_petty_cash"),
          "balance_month"
        ).order("balance_month", { ascending: false }).range(from, to),
        demoBankingData.monthlyOpeningBalances,
        "cash_bank_in_monthly_opening_balances"
      ),
      fetchAllPagesOrDemo(
        (from, to) => dateBounded(
          supabase.from("daily_sales")
            .select("id, branch_id, sale_date, cash_amount, is_void")
            .gte("sale_date", cashControlStartDate),
          "sale_date"
        ).order("sale_date", { ascending: false }).range(from, to),
        demoBankingData.sales,
        "cash_bank_in_sales"
      ),
      fetchAllPagesOrDemo(
        (from, to) => dateBounded(
          supabase.from("expenses")
            .select("id, branch_id, expense_date, category, payment_type, amount, is_void")
            .eq("category", "locum_doctor")
            .gte("expense_date", cashControlStartDate),
          "expense_date"
        ).order("expense_date", { ascending: false }).range(from, to),
        demoBankingData.expenses,
        "cash_bank_in_locum_expenses"
      ),
      fetchOrDemo<BankAccountPermission[]>(
        supabase.from("bank_account_permissions")
          .select("id, user_id, bank_account_id, can_view, can_create_transaction, can_edit_transaction, can_manage_account"),
        demoBankingData.bankAccountPermissions,
        "cash_bank_in_bank_permissions"
      ),
      fetchProjectedOrDemo(
        mappingsQuery,
        demoBankingData.branchBankMappings,
        "cash_bank_in_branch_bank_mappings"
      ),
      fetchAllPagesOrDemo(
        (from, to) => cashBankInsQuery.order("bank_in_date", { ascending: false }).range(from, to),
        demoBankingData.cashBankIns.filter((bankIn) => Boolean(bankIn.cash_month) && bankIn.cash_month! >= cashControlStartDate && (!reportEndDate || bankIn.cash_month! <= reportEndDate)),
        "cash_bank_in_assigned_records"
      ),
      fetchAllPagesOrDemo(
        (from, to) => unassignedCashBankInsQuery.order("bank_in_date", { ascending: false }).range(from, to),
        demoBankingData.cashBankIns.filter((bankIn) => !bankIn.cash_month),
        "cash_bank_in_unassigned_records"
      )
    ]);

    const permissions = permissionRows as BankAccountPermission[];
    const mappings = mappingRows as BranchBankMapping[];
    const allowedBankAccountIds = Array.from(new Set(
      permissions
        .filter((permission) => role === "owner" || (permission.user_id === profile?.id && permissionHasVisibleAccount(permission)))
        .map((permission) => permission.bank_account_id)
    ));
    const branchMappedBankAccountIds = Array.from(new Set(
      mappings
        .filter((mapping) => role !== "branch_pic" || mapping.branch_id === profile?.branch_id)
        .map((mapping) => mapping.bank_account_id)
    ));
    const permittedBankAccountIds = role === "branch_pic" ? branchMappedBankAccountIds : allowedBankAccountIds;
    const bankRows: BankAccount[] = role === "admin" || role === "finance" || role === "branch_pic"
      ? permittedBankAccountIds.length
        ? await fetchOrDemo(
            supabase.from("bank_accounts")
              .select("id, name, bank_name, account_no, is_active")
              .in("id", permittedBankAccountIds)
              .eq("is_active", true)
              .order("name"),
            [],
            "cash_bank_in_permitted_bank_accounts"
          ) as BankAccount[]
        : []
      : await fetchProjectedOrDemo(
          supabase.from("bank_accounts")
            .select("id, name, bank_name, account_no, is_active")
            .eq("is_active", true)
            .order("name"),
          demoBankingData.bankAccounts,
          "cash_bank_in_bank_accounts"
        ) as BankAccount[];

    return filterBankingDataForProfile({
      branches: branchRows as Branch[],
      openingBalances: openingBalanceRows as OpeningBalance[],
      monthlyOpeningBalances: monthlyOpeningBalanceRows as MonthlyOpeningBalance[],
      sales: salesRows as DailySale[],
      expenses: expenseRows as Expense[],
      bankAccounts: bankRows,
      bankAccountPermissions: permissions,
      bankTransactions: [],
      branchBankMappings: mappings,
      cashBankIns: [...cashBankInRows, ...unassignedCashBankInRows] as CashBankIn[],
      pettyCashTransactions: [],
      supplierPayments: [],
      panelPayments: []
    }, profile, options);
  }

  const supabase = await createClient();
  const role = normalizeRole(profile?.role);
  const [branchRows, openingBalanceRows, monthlyOpeningBalanceRows, salesRows, expenseRows, permissionRows, transactionRows, mappingRows, cashBankInRows, pettyCashRows, supplierPaymentRows, panelPaymentRows] = await Promise.all([
    fetchOrDemo(supabase.from("branches").select("*").eq("is_active", true).order("name"), demoBankingData.branches, "branches"),
    fetchAllPagesOrDemo(
      (from, to) => supabase
        .from("opening_balances")
        .select("*, branches(name, code), bank_accounts(name, bank_name, account_no), suppliers(name), panel_companies(name)")
        .order("balance_date", { ascending: false })
        .range(from, to),
      demoBankingData.openingBalances,
      "opening_balances"
    ),
    fetchAllPagesOrDemo(
      (from, to) => supabase
        .from("monthly_opening_balances")
        .select("*, branches(name, code)")
        .order("balance_month", { ascending: false })
        .range(from, to),
      demoBankingData.monthlyOpeningBalances,
      "monthly_opening_balances"
    ),
    fetchAllPagesOrDemo(
      (from, to) => supabase
        .from("daily_sales")
        .select("*, branches(name, code)")
        .order("sale_date", { ascending: false })
        .range(from, to),
      demoBankingData.sales,
      "daily_sales"
    ),
    fetchAllPagesOrDemo(
      (from, to) => supabase
        .from("expenses")
        .select("*, branches(name, code)")
        .order("expense_date", { ascending: false })
        .range(from, to),
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
        .select("id, branch_id, bank_account_id, is_active")
        .eq("is_active", true),
      demoBankingData.branchBankMappings,
      "branch_bank_mappings"
    ),
    fetchAllPagesOrDemo(
      (from, to) => supabase
        .from("cash_bank_ins")
        .select("*, branches(name, code), bank_accounts(name, bank_name, account_no)")
        .order("bank_in_date", { ascending: false })
        .range(from, to),
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

  const branchById = new Map((branchRows as Branch[]).map((branch) => [branch.id, branch]));
  const bankAccountById = new Map(bankRows.map((account) => [account.id, account]));
  const mappedBankRows = (mappingRows as BranchBankMapping[]).map((mapping) => {
    const branch = branchById.get(mapping.branch_id);
    const account = bankAccountById.get(mapping.bank_account_id);
    return {
      ...mapping,
      branches: branch ? { name: branch.name, code: branch.code } : null,
      bank_accounts: account
        ? { name: account.name, bank_name: account.bank_name, account_no: account.account_no }
        : null
    };
  });

  return filterBankingDataForProfile(
    {
      branches: branchRows as Branch[],
      openingBalances: openingBalanceRows as OpeningBalance[],
      monthlyOpeningBalances: monthlyOpeningBalanceRows as MonthlyOpeningBalance[],
      sales: salesRows as DailySale[],
      expenses: expenseRows as Expense[],
      bankAccounts: bankRows as BankAccount[],
      bankAccountPermissions: permissionRowsTyped,
      bankTransactions: transactionRows as BankTransaction[],
      branchBankMappings: mappedBankRows,
      cashBankIns: cashBankInRows as CashBankIn[],
      pettyCashTransactions: pettyCashRows as PettyCashTransaction[],
      supplierPayments: supplierPaymentRows as SupplierPaymentEntry[],
      panelPayments: normalizedPanelPayments
    },
    profile,
    options
  );
}

export async function getFinanceDashboardData(
  profile: Profile,
  range: Pick<DateRange, "endDate" | "startDate">
): Promise<{ dashboardData: DashboardData; bankingData: BankingData }> {
  if (!hasSupabaseEnv()) {
    return {
      dashboardData: filterDashboardDataForProfile(demoData, profile),
      bankingData: filterBankingDataForProfile(demoBankingData, profile)
    };
  }

  const supabase = await createClient();
  const adminSupabase = createAdminClient();
  const cashControlStartDate = range.startDate < monthlyOpeningBalanceStartMonth
    ? range.startDate
    : monthlyOpeningBalanceStartMonth;
  const openingBalancesQuery = supabase.from("opening_balances")
    .select("id, balance_date, balance_type, branch_id, bank_account_id, amount, verification_status")
    .lte("balance_date", range.endDate);
  const salesQuery = supabase.from("daily_sales")
    .select("id, branch_id, sale_date, cash_amount, bank_transfer_amount, card_amount, panel_amount, qr_amount, total_amount, is_void, entered_by, created_at, updated_at")
    .gte("sale_date", cashControlStartDate).lte("sale_date", range.endDate);
  const expensesQuery = supabase.from("expenses")
    .select("id, branch_id, expense_date, category, payment_type, amount, is_void")
    .gte("expense_date", cashControlStartDate).lte("expense_date", range.endDate);
  const purchasesQuery = supabase.from("supplier_purchase_entries")
    .select("id, branch_id, purchase_date, total_amount, is_void")
    .gte("purchase_date", range.startDate).lte("purchase_date", range.endDate);
  const supplierPaymentsQuery = (client: typeof supabase) => client.from("supplier_payment_entries")
    .select("id, branch_id, bank_account_id, payment_date, amount, is_void")
    .gte("payment_date", range.startDate).lte("payment_date", range.endDate);
  const panelClaimsQuery = supabase.from("panel_claims").select("id, branch_id, claim_month, amount, is_void")
    .lte("claim_month", range.endDate);
  const panelPaymentsQuery = supabase.from("panel_payments")
    .select("id, panel_claim_id, bank_account_id, payment_date, amount, is_void, panel_claims(branch_id, panel_company_id)")
    .lte("payment_date", range.endDate);
  const monthlyOpeningBalancesQuery = supabase.from("monthly_opening_balances")
    .select("id, branch_id, balance_month, opening_cash, opening_petty_cash")
    .lte("balance_month", range.endDate);
  const bankTransactionsQuery = supabase.from("bank_transactions")
    .select("id, bank_account_id, related_bank_account_id, transfer_group_id, transaction_date, transaction_type, direction, category, amount, branch_id, is_void")
    .gte("transaction_date", range.startDate).lte("transaction_date", range.endDate);
  const cashBankInsQuery = supabase.from("cash_bank_ins")
    .select("id, branch_id, bank_account_id, cash_month, amount, is_void")
    .gte("cash_month", cashControlStartDate).lte("cash_month", range.endDate);
  const pettyCashQuery = supabase.from("petty_cash_transactions")
    .select("id, branch_id, bank_account_id, transaction_date, transaction_type, direction, amount, is_void")
    .lte("transaction_date", range.endDate);
  const [branchRows, openingBalanceRows, salesRows, expenseRows, purchaseRows, paymentRows, bankSupplierPaymentRows, panelRows, panelPaymentRows,
    monthlyOpeningBalanceRows, permissionRows, transactionRows, mappingRows, cashBankInRows, pettyCashRows] = await Promise.all([
    fetchProjectedOrDemo(supabase.from("branches").select("id, name, code, is_active").order("name"), demoData.branches, "dashboard_branches"),
    fetchAllPagesOrDemo(
      (from, to) => openingBalancesQuery.order("balance_date", { ascending: false }).range(from, to),
      demoData.openingBalances,
      "dashboard_opening_balances"
    ),
    fetchAllPagesOrDemo(
      (from, to) => salesQuery.order("sale_date", { ascending: false }).range(from, to),
      demoData.sales,
      "dashboard_daily_sales"
    ),
    fetchAllPagesOrDemo(
      (from, to) => expensesQuery.order("expense_date", { ascending: false }).range(from, to),
      demoData.expenses,
      "dashboard_expenses"
    ),
    fetchAllPagesOrDemo(
      (from, to) => purchasesQuery.order("purchase_date", { ascending: false }).range(from, to),
      demoData.purchases,
      "dashboard_supplier_purchases"
    ),
    fetchAllPagesOrDemo(
      (from, to) => supplierPaymentsQuery(adminSupabase).order("payment_date", { ascending: false }).range(from, to),
      demoData.supplierPayments,
      "dashboard_supplier_payments"
    ),
    fetchAllPagesOrDemo(
      (from, to) => supplierPaymentsQuery(supabase).order("payment_date", { ascending: false }).range(from, to),
      demoBankingData.supplierPayments,
      "dashboard_banking_supplier_payments"
    ),
    fetchAllPagesOrDemo(
      (from, to) => panelClaimsQuery.order("claim_month", { ascending: false }).range(from, to),
      demoData.panels,
      "dashboard_panel_claims"
    ),
    fetchAllPagesOrDemo(
      (from, to) => panelPaymentsQuery.order("payment_date", { ascending: false }).range(from, to),
      demoData.panelPayments,
      "dashboard_panel_payments"
    ),
    fetchAllPagesOrDemo(
      (from, to) => monthlyOpeningBalancesQuery.order("balance_month", { ascending: false }).range(from, to),
      demoBankingData.monthlyOpeningBalances,
      "dashboard_monthly_opening_balances"
    ),
    fetchOrDemo<BankAccountPermission[]>(
      supabase.from("bank_account_permissions")
        .select("id, user_id, bank_account_id, can_view, can_create_transaction, can_edit_transaction, can_manage_account"),
      demoBankingData.bankAccountPermissions,
      "dashboard_bank_account_permissions"
    ),
    fetchAllPagesOrDemo(
      (from, to) => bankTransactionsQuery.order("transaction_date", { ascending: false }).range(from, to),
      demoBankingData.bankTransactions,
      "dashboard_bank_transactions"
    ),
    fetchProjectedOrDemo(
      supabase.from("branch_bank_mappings").select("id, branch_id, bank_account_id, is_active").eq("is_active", true),
      demoBankingData.branchBankMappings,
      "dashboard_branch_bank_mappings"
    ),
    fetchAllPagesOrDemo(
      (from, to) => cashBankInsQuery.order("cash_month", { ascending: false }).range(from, to),
      demoBankingData.cashBankIns,
      "dashboard_cash_bank_ins"
    ),
    fetchAllPagesOrDemo(
      (from, to) => pettyCashQuery.order("transaction_date", { ascending: false }).range(from, to),
      demoBankingData.pettyCashTransactions,
      "dashboard_petty_cash_transactions"
    )
  ]);

  const role = normalizeRole(profile.role);
  const permissionRowsTyped = permissionRows as BankAccountPermission[];
  const allowedBankAccountIds = Array.from(new Set(
    permissionRowsTyped
      .filter((permission) => role === "owner" || (permission.user_id === profile.id && permissionHasVisibleAccount(permission)))
      .map((permission) => permission.bank_account_id)
  ));
  const bankRows: BankAccount[] = role === "admin" || role === "finance"
    ? allowedBankAccountIds.length
      ? await fetchOrDemo(
          supabase.from("bank_accounts").select("id, name, bank_name, account_no, is_active").in("id", allowedBankAccountIds).eq("is_active", true).order("name"),
          [],
          "dashboard_permitted_bank_accounts"
        )
      : []
    : await fetchProjectedOrDemo(
        supabase.from("bank_accounts").select("id, name, bank_name, account_no, is_active").eq("is_active", true).order("name"),
        demoBankingData.bankAccounts,
        "dashboard_bank_accounts"
      );

  const normalizedPanelPayments = (panelPaymentRows as PanelPayment[]).map((payment) => ({
    ...payment,
    branch_id: payment.branch_id ?? payment.panel_claims?.branch_id ?? null,
    panel_company_id: payment.panel_company_id ?? payment.panel_claims?.panel_company_id ?? null,
    panel_companies: payment.panel_companies ?? payment.panel_claims?.panel_companies ?? null,
    branches: payment.branches ?? payment.panel_claims?.branches ?? null,
    panel_claims: payment.panel_claims ?? null
  }));

  const dashboardData = filterDashboardDataForProfile({
    branches: branchRows as Branch[],
    openingBalances: openingBalanceRows as OpeningBalance[],
    sales: salesRows as DailySale[],
    expenses: expenseRows as Expense[],
    purchases: purchaseRows as SupplierPurchaseEntry[],
    supplierPayments: paymentRows as SupplierPaymentEntry[],
    panels: panelRows as PanelClaim[],
    panelPayments: normalizedPanelPayments
  }, profile);
  const bankingData = filterBankingDataForProfile({
    branches: (branchRows as Branch[]).filter((branch) => branch.is_active),
    openingBalances: openingBalanceRows as OpeningBalance[],
    monthlyOpeningBalances: monthlyOpeningBalanceRows as MonthlyOpeningBalance[],
    sales: salesRows as DailySale[],
    expenses: expenseRows as Expense[],
    bankAccounts: bankRows as BankAccount[],
    bankAccountPermissions: permissionRowsTyped,
    bankTransactions: transactionRows as BankTransaction[],
    branchBankMappings: mappingRows as BranchBankMapping[],
    cashBankIns: cashBankInRows as CashBankIn[],
    pettyCashTransactions: pettyCashRows as PettyCashTransaction[],
    supplierPayments: bankSupplierPaymentRows as SupplierPaymentEntry[],
    panelPayments: normalizedPanelPayments
  }, profile);

  return { dashboardData, bankingData };
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

export async function getSupplierOutstanding(profileOverride?: Profile | null) {
  const profile = profileOverride === undefined ? await getCurrentProfile() : profileOverride;
  if (!hasSupabaseEnv()) {
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

  const supabase = createAdminClient();
  const [purchaseRows, paymentRows] = await Promise.all([
    fetchAllPagesOrDemo(
      (from, to) => supabase
        .from("supplier_purchase_entries")
        .select("id, supplier_id, branch_id, invoice_no, invoice_date, purchase_date, credit_term_days, due_date, category, medicine_cost, consumables_cost, other_cost, total_amount, notes, is_void, void_reason, voided_at, voided_by, created_at, updated_at, suppliers(name), branches(name, code)")
        .is("is_void", false)
        .order("due_date", { ascending: true })
        .range(from, to),
      [] as unknown[],
      "supplier_purchase_entries_outstanding"
    ),
    fetchAllPagesOrDemo(
      (from, to) => supabase
        .from("supplier_payment_entries")
        .select("id, supplier_purchase_entry_id, branch_id, amount, is_void")
        .is("is_void", false)
        .range(from, to),
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
