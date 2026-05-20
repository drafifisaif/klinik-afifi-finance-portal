import { hasSupabaseEnv, createClient } from "@/lib/supabase-server";
import { canViewAllBranches, filterBranchesForProfile, filterDashboardDataForProfile, getCurrentProfile } from "@/lib/permissions";
import type {
  Branch,
  DailySale,
  DashboardData,
  Expense,
  PanelClaim,
  PanelCompany,
  Supplier,
  SupplierPayment,
  SupplierPurchase
} from "@/lib/types";

const branches: Branch[] = [
  { id: "putatan", name: "Putatan", code: "PUT", is_active: true },
  { id: "papar", name: "Papar", code: "PAP", is_active: true },
  { id: "ranau", name: "Ranau", code: "RAN", is_active: true },
  { id: "kinabatangan", name: "Kinabatangan", code: "KIN", is_active: true }
];

const suppliers: Supplier[] = [
  { id: "s1", name: "Medisupply Sabah", payment_terms_days: 30, is_active: true, phone: "088-100 200" },
  { id: "s2", name: "ClinicCare Consumables", payment_terms_days: 14, is_active: true, phone: "088-300 400" }
];

const panelCompanies: PanelCompany[] = [
  { id: "p1", name: "SabahCare Panel", payment_terms_days: 30, is_active: true },
  { id: "p2", name: "Borneo Corporate Health", payment_terms_days: 45, is_active: true }
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
    payment_date: "2026-05-18",
    payment_type: "bank_transfer",
    amount: 2500,
    reference_no: "BT-8591",
    suppliers: { name: "ClinicCare Consumables" },
    branches: { name: "Papar", code: "PAP" }
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

export const demoData: DashboardData = {
  branches,
  sales,
  expenses,
  purchases,
  supplierPayments,
  panels
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

  const [branchRows, salesRows, expenseRows, purchaseRows, paymentRows, panelRows] = await Promise.all([
    fetchOrDemo(supabase.from("branches").select("*").order("name"), demoData.branches),
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
        .select("*, suppliers(name), branches(name, code)")
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
    )
  ]);

  return filterDashboardDataForProfile({
    branches: branchRows as Branch[],
    sales: salesRows as DailySale[],
    expenses: expenseRows as Expense[],
    purchases: purchaseRows as SupplierPurchase[],
    supplierPayments: paymentRows as SupplierPayment[],
    panels: panelRows as PanelClaim[]
  }, profile);
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
      suppliers,
      panelCompanies,
      purchases
    };
  }

  const supabase = await createClient();
  const [branchRows, supplierRows, panelRows, purchaseRows] = await Promise.all([
    fetchOrDemo(supabase.from("branches").select("*").eq("is_active", true).order("name"), branches),
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
