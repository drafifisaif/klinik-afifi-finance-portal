export type UserRole = "owner" | "admin" | "finance" | "branch_pic" | "staff";

export type PaymentType = "cash" | "bank_transfer" | "card" | "panel" | "qr";

export type ExpenseCategory =
  | "salary"
  | "locum_doctor"
  | "rental"
  | "utilities"
  | "supplier"
  | "medicine"
  | "consumables"
  | "maintenance"
  | "marketing"
  | "loan_financing"
  | "other";

export type PurchaseCategory = "medicine" | "consumables" | "other";

export type PaymentStatus = "unpaid" | "partial" | "paid" | "overdue";

export type Branch = {
  id: string;
  name: string;
  code: string;
  address?: string | null;
  phone?: string | null;
  is_active: boolean;
};

export type Profile = {
  id: string;
  full_name: string;
  email?: string | null;
  role: UserRole;
  branch_id?: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  branches?: Pick<Branch, "name" | "code"> | null;
};

export type DailySale = {
  id: string;
  branch_id: string;
  sale_date: string;
  cash_amount: number;
  bank_transfer_amount: number;
  card_amount: number;
  panel_amount: number;
  qr_amount: number;
  total_amount: number;
  notes?: string | null;
  branches?: Pick<Branch, "name" | "code"> | null;
};

export type Expense = {
  id: string;
  branch_id: string;
  expense_date: string;
  category: ExpenseCategory;
  vendor_name?: string | null;
  description: string;
  payment_type: PaymentType;
  amount: number;
  branches?: Pick<Branch, "name" | "code"> | null;
};

export type Supplier = {
  id: string;
  name: string;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  payment_terms_days: number;
  is_active: boolean;
};

export type SupplierPurchase = {
  id: string;
  supplier_id: string;
  branch_id: string;
  invoice_no?: string | null;
  purchase_date: string;
  due_date?: string | null;
  category: PurchaseCategory;
  medicine_cost: number;
  consumables_cost: number;
  other_cost: number;
  total_amount: number;
  notes?: string | null;
  suppliers?: Pick<Supplier, "name"> | null;
  branches?: Pick<Branch, "name" | "code"> | null;
};

export type SupplierPayment = {
  id: string;
  supplier_id: string;
  purchase_id?: string | null;
  branch_id?: string | null;
  payment_date: string;
  payment_type: PaymentType;
  amount: number;
  reference_no?: string | null;
  suppliers?: Pick<Supplier, "name"> | null;
  branches?: Pick<Branch, "name" | "code"> | null;
};

export type PanelCompany = {
  id: string;
  name: string;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  payment_terms_days: number;
  is_active: boolean;
};

export type PanelClaim = {
  id: string;
  panel_company_id: string;
  branch_id: string;
  claim_no?: string | null;
  claim_month: string;
  submitted_date?: string | null;
  due_date?: string | null;
  amount: number;
  status: PaymentStatus;
  notes?: string | null;
  panel_companies?: Pick<PanelCompany, "name"> | null;
  branches?: Pick<Branch, "name" | "code"> | null;
};

export type DashboardData = {
  branches: Branch[];
  sales: DailySale[];
  expenses: Expense[];
  purchases: SupplierPurchase[];
  supplierPayments: SupplierPayment[];
  panels: PanelClaim[];
};
