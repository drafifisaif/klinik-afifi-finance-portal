import { hasSupabaseEnv, createClient } from "@/lib/supabase-server";
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
  Supplier,
  SupplierPayment,
  SupplierPurchase
} from "@/lib/types";

export type SupplierOutstandingRow = SupplierPurchase & {
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
  purchases,
  supplierPayments,
  panels,
  panelPayments
};

export const demoBankingData: BankingData = {
  branches,
  openingBalances,
  sales,
  bankAccounts,
  bankAccountPermissions,
  bankTransactions,
  branchBankMappings,
  cashBankIns,
  pettyCashTransactions,
  supplierPayments,
  panelPayments
};

async function fetchOrDemo<T>(query: PromiseLike<{ data: T | null; error: unknown }>, fallback: T) {
  const { data, error } = await query;
  if (error || !data) return fallback;
  return data;
}

export async function getDashboardData(): Promise<DashboardData> {
  const profile = await getCurrentProfile();
  if (!hasSupabaseEnv()) return filterDashboardDataForProfile(demoData, profile);

  const supabase = await createClient();

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
        .order("sale_date", { ascending: false })
        .limit(50),
      demoData.sales
    ),
    fetchOrDemo(
      supabase
        .from("expenses")
        .select("*, branches(name, code)")
        .order("expense_date", { ascending: false })
        .limit(50),
      demoData.expenses
    ),
    fetchOrDemo(
      supabase
        .from("supplier_purchases")
        .select("*, suppliers(name), branches(name, code)")
        .order("purchase_date", { ascending: false })
        .limit(50),
      demoData.purchases
    ),
    fetchOrDemo(
      supabase
        .from("supplier_payments")
        .select("*, suppliers(name), branches(name, code), bank_accounts(name, bank_name, account_no)")
        .order("payment_date", { ascending: false })
        .limit(50),
      demoData.supplierPayments
    ),
    fetchOrDemo(
      supabase
        .from("panel_claims")
        .select("*, panel_companies(name), branches(name, code)")
        .order("claim_month", { ascending: false })
        .limit(50),
      demoData.panels
    ),
    fetchOrDemo(
      supabase
        .from("panel_payments")
        .select("*, bank_accounts(name, bank_name, account_no), panel_claims(branch_id, claim_no, panel_company_id, branches(name, code), panel_companies(name))")
        .order("payment_date", { ascending: false })
        .limit(50),
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
    purchases: purchaseRows as SupplierPurchase[],
    supplierPayments: paymentRows as SupplierPayment[],
    panels: panelRows as PanelClaim[],
    panelPayments: normalizedPanelPayments
  }, profile);
}

type BankingDataOptions = {
  bankAccessOnly?: boolean;
};

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

export type BranchPicCashBankInTarget = {
  bankAccount: BankAccount | null;
  branch: Branch | null;
  mapping: BranchBankMapping | null;
};

export async function getBranchPicCashBankInTarget(branchId: string | null | undefined): Promise<BranchPicCashBankInTarget> {
  if (!branchId) return { bankAccount: null, branch: null, mapping: null };

  if (!hasSupabaseEnv()) {
    const branch = branches.find((item) => item.id === branchId) ?? null;
    const mapping = branchBankMappings.find((item) => item.branch_id === branchId && item.is_active) ?? null;
    const bankAccount = mapping
      ? bankAccounts.find((account) => account.id === mapping.bank_account_id && account.is_active) ?? null
      : null;

    return { bankAccount, branch, mapping };
  }

  const supabase = await createClient();
  const [branchRow, mappingRow] = await Promise.all([
    supabase.from("branches").select("*").eq("id", branchId).maybeSingle(),
    supabase
      .from("branch_bank_mappings")
      .select("id, branch_id, bank_account_id, is_active")
      .eq("branch_id", branchId)
      .eq("is_active", true)
      .maybeSingle()
  ]);

  const branch = branchRow.error || !branchRow.data ? null : branchRow.data as Branch;
  const mapping = mappingRow.error || !mappingRow.data ? null : mappingRow.data as BranchBankMapping;
  if (!mapping) return { bankAccount: null, branch, mapping: null };

  const { data: bankAccountRow, error: bankAccountError } = await supabase
    .from("bank_accounts")
    .select("*")
    .eq("id", mapping.bank_account_id)
    .eq("is_active", true)
    .maybeSingle();

  return {
    bankAccount: bankAccountError || !bankAccountRow ? null : bankAccountRow as BankAccount,
    branch,
    mapping
  };
}

export async function getBankingDataForScope(options: BankingDataOptions = {}): Promise<BankingData> {
  const profile = await getCurrentProfile();
  if (!hasSupabaseEnv()) return filterBankingDataForProfile(demoBankingData, profile, options);

  const supabase = await createClient();
  const role = normalizeRole(profile?.role);
  const [branchRows, openingBalanceRows, salesRows, permissionRows, transactionRows, mappingRows, cashBankInRows, pettyCashRows, supplierPaymentRows, panelPaymentRows] = await Promise.all([
    fetchOrDemo(supabase.from("branches").select("*").eq("is_active", true).order("name"), demoBankingData.branches),
    fetchOrDemo(
      supabase
        .from("opening_balances")
        .select("*, branches(name, code), bank_accounts(name, bank_name, account_no), suppliers(name), panel_companies(name)")
        .order("balance_date", { ascending: false }),
      demoBankingData.openingBalances
    ),
    fetchOrDemo(
      supabase
        .from("daily_sales")
        .select("*, branches(name, code)")
        .order("sale_date", { ascending: false })
        .limit(1000),
      demoBankingData.sales
    ),
    fetchOrDemo<BankAccountPermission[]>(
      supabase
        .from("bank_account_permissions")
        .select("id, user_id, bank_account_id, can_view, can_create_transaction, can_edit_transaction, can_manage_account"),
      demoBankingData.bankAccountPermissions
    ),
    fetchOrDemo(
      supabase
        .from("bank_transactions")
        .select("*, branches(name, code), bank_accounts(name, bank_name, account_no)")
        .order("transaction_date", { ascending: false })
        .limit(2000),
      demoBankingData.bankTransactions
    ),
    fetchOrDemo(
      supabase
        .from("branch_bank_mappings")
        .select("*, branches(name, code), bank_accounts(name, bank_name, account_no)")
        .eq("is_active", true),
      demoBankingData.branchBankMappings
    ),
    fetchOrDemo(
      supabase
        .from("cash_bank_ins")
        .select("*, branches(name, code), bank_accounts(name, bank_name, account_no)")
        .order("bank_in_date", { ascending: false })
        .limit(1000),
      demoBankingData.cashBankIns
    ),
    fetchOrDemo(
      supabase
        .from("petty_cash_transactions")
        .select("*, branches(name, code), bank_accounts(name, bank_name, account_no), profiles(full_name)")
        .order("transaction_date", { ascending: false })
        .limit(2000),
      demoBankingData.pettyCashTransactions
    ),
    fetchOrDemo(
      supabase
        .from("supplier_payments")
        .select("*, suppliers(name), branches(name, code), bank_accounts(name, bank_name, account_no)")
        .order("payment_date", { ascending: false })
        .limit(2000),
      demoBankingData.supplierPayments
    ),
    fetchOrDemo(
      supabase
        .from("panel_payments")
        .select("*, bank_accounts(name, bank_name, account_no), panel_claims(branch_id, claim_no, panel_company_id, branches(name, code), panel_companies(name))")
        .order("payment_date", { ascending: false })
        .limit(2000),
      demoBankingData.panelPayments
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
      bankAccounts: bankRows as BankAccount[],
      bankAccountPermissions: permissionRowsTyped,
      bankTransactions: transactionRows as BankTransaction[],
      branchBankMappings: mappingRows as BranchBankMapping[],
      cashBankIns: cashBankInRows as CashBankIn[],
      pettyCashTransactions: pettyCashRows as PettyCashTransaction[],
      supplierPayments: supplierPaymentRows as SupplierPayment[],
      panelPayments: normalizedPanelPayments
    },
    profile,
    options
  );
}

export async function getSuppliers() {
  if (!hasSupabaseEnv()) return suppliers;
  const supabase = await createClient();
  return fetchOrDemo(supabase.from("suppliers").select("*").order("name"), suppliers);
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
        .order("purchase_date", { ascending: false })
        .limit(1000),
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
    return [] as SupplierOutstandingRow[];
  }

  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const rows = await fetchOrDemo(
    supabase
      .from("v_supplier_outstanding")
      .select("*")
      .order("due_date", { ascending: true }),
    []
  );

  if (!profile || canViewAllBranches(profile)) return rows as SupplierOutstandingRow[];
  if (!profile.branch_id) return [];
  return (rows as SupplierOutstandingRow[]).filter((row) => row.branch_id === profile.branch_id);
}
