export type UserRole = "owner" | "admin" | "finance" | "branch_pic" | "staff";

export type AuditAction =
  | "create"
  | "update"
  | "void"
  | "delete"
  | "document_upload"
  | "document_delete"
  | "role_change"
  | "permission_change";

export type AuditSnapshot = Record<string, unknown>;

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
  entered_by?: string | null;
  created_at?: string;
  updated_at?: string;
  is_void?: boolean;
  voided_at?: string | null;
  voided_by?: string | null;
  void_reason?: string | null;
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
  receipt_path?: string | null;
  entered_by?: string | null;
  is_void?: boolean;
  voided_at?: string | null;
  voided_by?: string | null;
  void_reason?: string | null;
  branches?: Pick<Branch, "name" | "code"> | null;
};

export type Supplier = {
  id: string;
  code?: string | null;
  name: string;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  default_credit_term_days?: number;
  payment_terms_days: number;
  is_active: boolean;
};

export type SupplierPurchase = {
  id: string;
  supplier_id: string;
  branch_id: string;
  invoice_no?: string | null;
  invoice_date?: string | null;
  purchase_date: string;
  credit_term_days?: number | null;
  due_date?: string | null;
  payment_status?: "unpaid" | "partially_paid" | "paid" | "overdue" | null;
  category: PurchaseCategory;
  medicine_cost: number;
  consumables_cost: number;
  other_cost: number;
  total_amount: number;
  notes?: string | null;
  is_void?: boolean;
  voided_at?: string | null;
  voided_by?: string | null;
  void_reason?: string | null;
  suppliers?: Pick<Supplier, "name"> | null;
  branches?: Pick<Branch, "name" | "code"> | null;
};

export type SupplierPurchaseEntry = {
  id: string;
  supplier_id: string;
  branch_id: string;
  invoice_no?: string | null;
  invoice_date?: string | null;
  purchase_date: string;
  credit_term_days: number;
  due_date?: string | null;
  category?: PurchaseCategory | null;
  medicine_cost: number;
  consumables_cost: number;
  other_cost: number;
  total_amount: number;
  notes?: string | null;
  is_void: boolean;
  void_reason?: string | null;
  voided_at?: string | null;
  voided_by?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
  suppliers?: Pick<Supplier, "name"> | null;
  branches?: Pick<Branch, "name" | "code"> | null;
};

export type SupplierPayment = {
  id: string;
  supplier_id: string;
  purchase_id?: string | null;
  branch_id?: string | null;
  bank_account_id?: string | null;
  payment_date: string;
  payment_type: PaymentType;
  amount: number;
  reference_no?: string | null;
  notes?: string | null;
  entered_by?: string | null;
  suppliers?: Pick<Supplier, "name"> | null;
  branches?: Pick<Branch, "name" | "code"> | null;
  bank_accounts?: Pick<BankAccount, "name" | "bank_name" | "account_no"> | null;
};

export type SupplierPaymentEntry = {
  id: string;
  supplier_purchase_entry_id?: string | null;
  supplier_id: string;
  branch_id: string;
  payment_date: string;
  payment_method?: PaymentType | string | null;
  bank_account_id?: string | null;
  amount: number;
  reference_no?: string | null;
  notes?: string | null;
  is_void: boolean;
  void_reason?: string | null;
  voided_at?: string | null;
  voided_by?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
  suppliers?: Pick<Supplier, "name"> | null;
  branches?: Pick<Branch, "name" | "code"> | null;
  bank_accounts?: Pick<BankAccount, "name" | "bank_name" | "account_no"> | null;
  supplier_purchase_entries?: Pick<SupplierPurchaseEntry, "id" | "invoice_no" | "branch_id" | "supplier_id" | "due_date" | "total_amount"> | null;
};

export type PanelCompany = {
  id: string;
  name: string;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
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

export type PanelPayment = {
  id: string;
  panel_claim_id: string;
  panel_company_id?: string | null;
  branch_id?: string | null;
  bank_account_id?: string | null;
  payment_date: string;
  amount: number;
  payment_type: PaymentType;
  reference_no?: string | null;
  notes?: string | null;
  entered_by?: string | null;
  panel_claims?: (Pick<PanelClaim, "claim_no" | "branch_id"> & {
    panel_company_id?: string | null;
    branches?: Pick<Branch, "name" | "code"> | null;
    panel_companies?: Pick<PanelCompany, "name"> | null;
  }) | null;
  panel_companies?: Pick<PanelCompany, "name"> | null;
  branches?: Pick<Branch, "name" | "code"> | null;
  bank_accounts?: Pick<BankAccount, "name" | "bank_name" | "account_no"> | null;
};

export type BankAccount = {
  id: string;
  name: string;
  bank_name?: string | null;
  account_no?: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type BankAccountPermission = {
  id: string;
  user_id: string;
  bank_account_id: string;
  can_view: boolean;
  can_create_transaction: boolean;
  can_edit_transaction: boolean;
  can_manage_account: boolean;
  granted_by?: string | null;
  created_at?: string;
  updated_at?: string;
  bank_accounts?: Pick<BankAccount, "name" | "bank_name" | "account_no"> | null;
  profiles?: Pick<Profile, "full_name" | "role"> | null;
};

export type OpeningBalanceType =
  | "bank_account"
  | "cash_in_hand"
  | "petty_cash"
  | "supplier_outstanding"
  | "panel_outstanding";

export type OpeningBalanceVerificationStatus = "confirmed" | "estimated" | "pending_review";

export type OpeningBalance = {
  id: string;
  balance_date: string;
  balance_type: OpeningBalanceType;
  branch_id?: string | null;
  bank_account_id?: string | null;
  supplier_id?: string | null;
  panel_company_id?: string | null;
  amount: number;
  notes?: string | null;
  verification_status?: OpeningBalanceVerificationStatus;
  source_reference?: string | null;
  source_notes?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
  branches?: Pick<Branch, "name" | "code"> | null;
  bank_accounts?: Pick<BankAccount, "name" | "bank_name" | "account_no"> | null;
  suppliers?: Pick<Supplier, "name"> | null;
  panel_companies?: Pick<PanelCompany, "name"> | null;
};

export type BankTransactionType = "money_in" | "money_out" | "interbank_transfer" | "owner_drawing";

export type BankTransactionDirection = "in" | "out";

export type BankTransaction = {
  id: string;
  bank_account_id: string;
  related_bank_account_id?: string | null;
  transfer_group_id?: string | null;
  transaction_date: string;
  transaction_type: BankTransactionType;
  direction: BankTransactionDirection;
  category?: string | null;
  amount: number;
  description?: string | null;
  reference_no?: string | null;
  branch_id?: string | null;
  entered_by?: string | null;
  created_at?: string;
  updated_at?: string;
  is_void?: boolean;
  voided_at?: string | null;
  voided_by?: string | null;
  void_reason?: string | null;
  bank_accounts?: Pick<BankAccount, "name" | "bank_name" | "account_no"> | null;
  branches?: Pick<Branch, "name" | "code"> | null;
};

export type PettyCashTransactionType =
  | "petty_cash_issued"
  | "petty_cash_spent"
  | "petty_cash_returned"
  | "petty_cash_adjustment";

export type PettyCashDirection = "in" | "out" | "adjustment";

export type PettyCashTransaction = {
  id: string;
  branch_id: string;
  bank_account_id?: string | null;
  transaction_date: string;
  transaction_type: PettyCashTransactionType;
  direction: PettyCashDirection;
  category?: string | null;
  amount: number;
  description?: string | null;
  reference_no?: string | null;
  receipt_path?: string | null;
  entered_by?: string | null;
  created_at?: string;
  updated_at?: string;
  is_void?: boolean;
  voided_at?: string | null;
  voided_by?: string | null;
  void_reason?: string | null;
  branches?: Pick<Branch, "name" | "code"> | null;
  bank_accounts?: Pick<BankAccount, "name" | "bank_name" | "account_no"> | null;
  profiles?: Pick<Profile, "full_name"> | null;
};

export type BranchBankMapping = {
  id: string;
  branch_id: string;
  bank_account_id: string;
  is_active: boolean;
  branches?: Pick<Branch, "name" | "code"> | null;
  bank_accounts?: Pick<BankAccount, "name" | "bank_name" | "account_no"> | null;
};

export type CashBankIn = {
  id: string;
  branch_id: string;
  bank_account_id: string;
  bank_in_date: string;
  amount: number;
  reference_no?: string | null;
  notes?: string | null;
  entered_by?: string | null;
  created_at?: string;
  updated_at?: string;
  is_void?: boolean;
  voided_at?: string | null;
  voided_by?: string | null;
  void_reason?: string | null;
  branches?: Pick<Branch, "name" | "code"> | null;
  bank_accounts?: Pick<BankAccount, "name" | "bank_name" | "account_no"> | null;
};

export type AuditEvent = {
  id: string;
  actor_id?: string | null;
  actor_email?: string | null;
  action: AuditAction;
  entity_name: string;
  entity_id?: string | null;
  branch_id?: string | null;
  bank_account_id?: string | null;
  before_data?: AuditSnapshot | null;
  after_data?: AuditSnapshot | null;
  changed_fields?: AuditSnapshot | null;
  description?: string | null;
  created_at: string;
  branches?: Pick<Branch, "name" | "code"> | null;
  bank_accounts?: Pick<BankAccount, "name" | "bank_name" | "account_no"> | null;
  profiles?: Pick<Profile, "full_name"> | null;
};

export type TransactionDocumentEntityName =
  | "expenses"
  | "supplier_purchases"
  | "supplier_purchase_entries"
  | "supplier_payments"
  | "supplier_payment_entries"
  | "cash_bank_ins"
  | "panel_claims"
  | "panel_payments"
  | "bank_transactions"
  | "petty_cash_transactions";

export type TransactionDocument = {
  id: string;
  entity_name: TransactionDocumentEntityName;
  entity_id: string;
  branch_id?: string | null;
  bank_account_id?: string | null;
  document_type?: string | null;
  file_name: string;
  file_path: string;
  file_size_bytes?: number | null;
  compressed_size_bytes?: number | null;
  mime_type?: string | null;
  notes?: string | null;
  uploaded_by?: string | null;
  created_at: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
  delete_reason?: string | null;
  profiles?: Pick<Profile, "full_name"> | null;
};

export type TransactionDocumentUploadResult =
  | {
      ok: true;
      message: string;
      document: TransactionDocument;
    }
  | {
      ok: false;
      message: string;
    };

export type DashboardData = {
  branches: Branch[];
  openingBalances: OpeningBalance[];
  sales: DailySale[];
  expenses: Expense[];
  purchases: SupplierPurchaseEntry[];
  supplierPayments: SupplierPaymentEntry[];
  panels: PanelClaim[];
  panelPayments: PanelPayment[];
};

export type BankingData = {
  branches: Branch[];
  openingBalances: OpeningBalance[];
  sales: DailySale[];
  bankAccounts: BankAccount[];
  bankAccountPermissions: BankAccountPermission[];
  bankTransactions: BankTransaction[];
  branchBankMappings: BranchBankMapping[];
  cashBankIns: CashBankIn[];
  pettyCashTransactions: PettyCashTransaction[];
  supplierPayments: SupplierPaymentEntry[];
  panelPayments: PanelPayment[];
};
