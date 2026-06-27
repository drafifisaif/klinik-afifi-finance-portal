"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuditChangedFields, logAuditEvent } from "@/lib/audit";
import { importConfigs, type ImportType } from "@/lib/import-config";
import { panelReceivingBankAccounts, panelReceivingBankError, panelReceivingBankRequirement } from "@/lib/panel-accounting";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient, hasSupabaseEnv } from "@/lib/supabase-server";
import {
  canEditBranch,
  canManageBankPermissions,
  canManageTargetProfile,
  canViewAllBranches,
  hasPermission,
  normalizeRole,
  requireBankAccountPermission,
  requirePermission
} from "@/lib/permissions";
import type { BankAccount, BankTransactionType, ExpenseCategory, OpeningBalanceType, OpeningBalanceVerificationStatus, PaymentType, PettyCashTransactionType, PurchaseCategory, UserRole } from "@/lib/types";

type ImportPayload = Record<string, string | number | null>;

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(formData: FormData, key: string) {
  const value = Number(formData.get(key) ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function checked(formData: FormData, key: string) {
  return formData.get(key) === "true";
}

function addDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function supplierPurchaseRpcErrorMessage(error: {
  code?: string | null;
  details?: string | null;
  hint?: string | null;
  message?: string | null;
}) {
  const message = error.message ?? "";
  const details = error.details ?? "";
  const hint = error.hint ?? "";
  const haystack = `${message} ${details} ${hint}`.toLowerCase();

  if (error.code === "PGRST202" || haystack.includes("could not find the function public.update_supplier_purchase")) {
    return "Supplier purchase update function is unavailable. Run the latest Supabase migration.";
  }
  if (haystack.includes("stack depth limit exceeded")) {
    return "Supplier purchase update policy is still recursive. Run the latest supplier purchase RPC migration.";
  }
  if (error.code === "42501" || haystack.includes("permission")) {
    return "You do not have permission to edit this supplier purchase.";
  }
  if (error.code === "P0002" || haystack.includes("supplier purchase not found")) {
    return "Supplier purchase not found.";
  }
  if (error.code === "22007" || haystack.includes("date/time field value out of range") || haystack.includes("invalid input syntax for type date")) {
    return "Supplier purchase dates are invalid.";
  }
  if (error.code === "22P02" || haystack.includes("invalid input syntax for type uuid")) {
    return "Supplier purchase record contains an invalid branch, supplier, or purchase id.";
  }

  return "Supplier purchase update failed. Please try again.";
}

function booleanText(formData: FormData, key: string, fallback = true) {
  const value = text(formData, key);
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function failSupplierManager(message: string): never {
  redirect(`/suppliers?error=${encodeURIComponent(message)}`);
}

function failPanelManager(message: string): never {
  redirect(`/panels?error=${encodeURIComponent(message)}`);
}

async function loadPanelClaimForMutation(
  claimId: string,
  profile: Awaited<ReturnType<typeof requirePermission>>,
  action: "updatePanelClaim" | "voidPanelClaim",
  claimNo?: string | null
) {
  const supabase = await createClient();
  const admin = createAdminClient();
  const selectClause = "id, panel_company_id, branch_id, claim_no, claim_month, submitted_date, due_date, amount, status, notes, is_void, void_reason, voided_at, voided_by";

  const { data: directClaim, error: directError } = await supabase
    .from("panel_claims")
    .select(selectClause)
    .eq("id", claimId)
    .maybeSingle();

  if (directClaim) {
    return directClaim;
  }

  const { data: adminClaim, error: adminError } = await admin
    .from("panel_claims")
    .select(selectClause)
    .eq("id", claimId)
    .maybeSingle();

  if (!adminClaim) {
    console.error(`${action} load failed`, {
      action,
      claimId,
      claimNo: claimNo ?? null,
      userId: profile.id,
      role: profile.role,
      userBranchId: profile.branch_id ?? null,
      code: directError?.code ?? adminError?.code,
      error: directError?.message ?? adminError?.message,
      details: directError?.details ?? adminError?.details,
      hint: directError?.hint ?? adminError?.hint
    });
    return null;
  }

  return adminClaim;
}

async function getSupplierFieldSupport(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [{ error: codeError }, { error: creditError }] = await Promise.all([
    supabase.from("suppliers").select("code").limit(1),
    supabase.from("suppliers").select("default_credit_term_days").limit(1)
  ]);

  return {
    hasCode: !codeError,
    hasDefaultCreditTermDays: !creditError
  };
}

function supplierMutationErrorMessage(error: { code?: string | null; message?: string | null; details?: string | null }) {
  const code = error.code ?? "";
  const message = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();

  if (code === "23505" && message.includes("suppliers_name_key")) {
    return "A supplier with this name already exists.";
  }
  if (code === "23505" && message.includes("idx_suppliers_code_unique")) {
    return "Supplier code is already in use. Please choose a different code.";
  }
  if (code === "42703" && (message.includes("default_credit_term_days") || message.includes("code"))) {
    return "Supplier registration fields are not fully available yet. Run the latest supplier migration and try again.";
  }
  return "Supplier record could not be saved.";
}

async function requirePanelPaymentBankAccount(
  profile: Awaited<ReturnType<typeof requirePermission>>,
  bankAccountId: string,
  branch: { code?: string | null; name?: string | null } | null | undefined,
  branchId?: string | null,
  claimId?: string | null
) {
  const admin = createAdminClient();
  let appliedIsActiveFilter = true;
  let bankAccounts: Array<{
    id: string;
    name: string;
    bank_name?: string | null;
    account_no?: string | null;
    is_active?: boolean | null;
  }> | null = null;
  let bankError:
    | {
        code?: string;
        message?: string;
        details?: string;
        hint?: string;
      }
    | null = null;

  const activeQuery = await admin
    .from("bank_accounts")
    .select("id, name, bank_name, account_no, is_active")
    .eq("is_active", true)
    .order("name");

  if (activeQuery.error && (activeQuery.error.code === "42703" || activeQuery.error.message?.toLowerCase().includes("is_active"))) {
    appliedIsActiveFilter = false;
    const fallbackQuery = await admin
      .from("bank_accounts")
      .select("id, name, bank_name, account_no")
      .order("name");
    bankAccounts = (fallbackQuery.data ?? []).map((account) => ({ ...account, is_active: true }));
    bankError = fallbackQuery.error;
  } else {
    bankAccounts = activeQuery.data ?? [];
    bankError = activeQuery.error;
  }

  if (!bankError && appliedIsActiveFilter && (bankAccounts?.length ?? 0) === 0) {
    const fallbackQuery = await admin
      .from("bank_accounts")
      .select("id, name, bank_name, account_no")
      .order("name");

    if (!fallbackQuery.error && fallbackQuery.data && fallbackQuery.data.length > 0) {
      console.warn("requirePanelPaymentBankAccount active filter returned zero rows; falling back to all accounts", {
        action: "requirePanelPaymentBankAccount",
        userId: profile.id,
        role: profile.role,
        claimId,
        branchId,
        branchName: branch?.name ?? null,
        branchCode: branch?.code ?? null,
        branchIdFilterApplied: false,
        isActiveFilterApplied: appliedIsActiveFilter,
        rawBankAccountRowsReturned: 0,
        fallbackBankAccountRowsReturned: fallbackQuery.data.length,
        fallbackBankAccountNames: fallbackQuery.data.map((account) => account.name)
      });
      bankAccounts = fallbackQuery.data.map((account) => ({ ...account, is_active: true }));
      appliedIsActiveFilter = false;
    }
  }

  if (bankError) {
    console.error("requirePanelPaymentBankAccount lookup failed", {
      action: "requirePanelPaymentBankAccount",
      userId: profile.id,
      role: profile.role,
      claimId,
      branchId,
      branchName: branch?.name ?? null,
      branchCode: branch?.code ?? null,
      code: bankError.code,
      error: bankError.message,
      details: bankError.details,
      hint: bankError.hint,
      isActiveFilterApplied: appliedIsActiveFilter,
      branchIdFilterApplied: false
    });
    throw new Error("Panel receiving bank accounts could not be loaded.");
  }

  const requirement = panelReceivingBankRequirement(branch);
  const allowedAccounts = panelReceivingBankAccounts(branch, (bankAccounts ?? []) as BankAccount[]);

  if (!allowedAccounts.length) {
    console.error("requirePanelPaymentBankAccount no mapped account", {
      action: "requirePanelPaymentBankAccount",
      userId: profile.id,
      role: profile.role,
      claimId,
      branchId,
      branchName: branch?.name ?? null,
      branchCode: branch?.code ?? null,
      mappedTargetType: requirement.targetType,
      tokens: requirement.tokens,
      availableBankAccountNames: (bankAccounts ?? []).map((account) => account.name),
      isActiveFilterApplied: appliedIsActiveFilter,
      branchIdFilterApplied: false
    });
    throw new Error(panelReceivingBankError(branch));
  }

  const bankAccount = allowedAccounts.find((account) => account.id === bankAccountId);
  if (!bankAccount) {
    throw new Error("Selected bank account is not allowed for this panel payment.");
  }

  const role = normalizeRole(profile.role);
  if (role === "owner" || role === "admin" || role === "finance") {
    return bankAccount;
  }

  await requireBankAccountPermission(bankAccountId, "create_transaction");
  return bankAccount;
}

function bankTransactionType(formData: FormData) {
  const value = text(formData, "transaction_type");
  if (value === "money_in" || value === "money_out" || value === "interbank_transfer" || value === "owner_drawing") {
    return value;
  }
  throw new Error("Select a valid manual bank transaction type.");
}

function bankTransactionDirection(type: BankTransactionType) {
  return type === "money_in" ? "in" : "out";
}

function pettyCashTransactionType(formData: FormData) {
  const value = text(formData, "transaction_type");
  if (
    value === "petty_cash_issued"
    || value === "petty_cash_spent"
    || value === "petty_cash_returned"
    || value === "petty_cash_adjustment"
  ) {
    return value;
  }
  throw new Error("Select a valid petty cash transaction type.");
}

function pettyCashDirection(type: PettyCashTransactionType) {
  if (type === "petty_cash_issued") return "in";
  if (type === "petty_cash_adjustment") return "adjustment";
  return "out";
}

type UserProfileAuditRow = {
  branch_id: string | null;
  full_name: string;
  is_active: boolean;
  role: string;
};

type BankPermissionAuditRow = {
  bank_account_id: string;
  can_create_transaction: boolean;
  can_edit_transaction: boolean;
  can_manage_account: boolean;
  can_view: boolean;
  user_id: string;
};

type BankTransactionAuditRow = {
  amount: number;
  bank_account_id: string;
  branch_id: string | null;
  category: string | null;
  description: string | null;
  direction: string;
  reference_no: string | null;
  related_bank_account_id: string | null;
  transaction_date: string;
  transaction_type: string;
  transfer_group_id: string | null;
  is_void?: boolean;
  void_reason?: string | null;
  voided_at?: string | null;
  voided_by?: string | null;
};

type CashBankInAuditRow = {
  amount: number;
  bank_account_id: string;
  bank_in_date: string;
  branch_id: string;
  notes: string | null;
  reference_no: string | null;
  is_void?: boolean;
  void_reason?: string | null;
  voided_at?: string | null;
  voided_by?: string | null;
};

type PettyCashAuditRow = {
  amount: number;
  bank_account_id: string | null;
  branch_id: string;
  category: string | null;
  description: string | null;
  direction: string;
  reference_no: string | null;
  transaction_date: string;
  transaction_type: string;
  is_void?: boolean;
  void_reason?: string | null;
  voided_at?: string | null;
  voided_by?: string | null;
};

type BranchAuditRow = {
  address: string | null;
  code: string;
  is_active: boolean;
  name: string;
  phone: string | null;
};

type BankAccountAuditRow = {
  account_no: string | null;
  bank_name: string | null;
  is_active: boolean;
  name: string;
};

type DailySaleAuditRow = {
  bank_transfer_amount: number;
  branch_id: string;
  card_amount: number;
  cash_amount: number;
  notes: string | null;
  panel_amount: number;
  qr_amount: number;
  sale_date: string;
  is_void?: boolean;
  void_reason?: string | null;
  voided_at?: string | null;
  voided_by?: string | null;
};

type ExpenseAuditRow = {
  amount: number;
  branch_id: string;
  category: string;
  description: string;
  expense_date: string;
  payment_type: string;
  receipt_path: string | null;
  vendor_name: string | null;
  is_void?: boolean;
  void_reason?: string | null;
  voided_at?: string | null;
  voided_by?: string | null;
};

type SupplierAuditRow = {
  address?: string | null;
  code?: string | null;
  contact_person: string | null;
  default_credit_term_days?: number | null;
  email: string | null;
  is_active: boolean;
  name: string;
  notes?: string | null;
  payment_terms_days: number;
  phone: string | null;
};

type SupplierPurchaseAuditRow = {
  attachment_path: string | null;
  branch_id: string;
  category: string;
  consumables_cost: number;
  due_date: string | null;
  invoice_no: string | null;
  is_void?: boolean;
  medicine_cost: number;
  notes: string | null;
  other_cost: number;
  purchase_date: string;
  supplier_id: string;
  void_reason?: string | null;
  voided_at?: string | null;
  voided_by?: string | null;
};

type SupplierPurchaseEntryAuditRow = {
  branch_id: string;
  category: string | null;
  consumables_cost: number;
  credit_term_days: number;
  due_date: string | null;
  invoice_date: string | null;
  invoice_no: string | null;
  is_void: boolean;
  medicine_cost: number;
  notes: string | null;
  other_cost: number;
  purchase_date: string;
  supplier_id: string;
  total_amount: number;
  void_reason?: string | null;
  voided_at?: string | null;
  voided_by?: string | null;
};

type SupplierPaymentAuditRow = {
  amount: number;
  bank_account_id: string | null;
  branch_id: string | null;
  notes: string | null;
  payment_date: string;
  payment_type: string;
  purchase_id: string | null;
  receipt_path: string | null;
  reference_no: string | null;
  supplier_id: string;
};

type SupplierPaymentEntryAuditRow = {
  amount: number;
  bank_account_id: string | null;
  branch_id: string;
  created_by?: string | null;
  is_void: boolean;
  notes: string | null;
  payment_date: string;
  payment_method: string | null;
  reference_no: string | null;
  supplier_id: string;
  supplier_purchase_entry_id: string | null;
  updated_by?: string | null;
  void_reason?: string | null;
  voided_at?: string | null;
  voided_by?: string | null;
};

type PanelPaymentAuditRow = {
  amount: number;
  bank_account_id: string | null;
  branch_id: string | null;
  notes: string | null;
  panel_claim_id: string;
  payment_date: string;
  payment_type: string;
  reference_no: string | null;
};

type PanelCompanyAuditRow = {
  address?: string | null;
  contact_person: string | null;
  email: string | null;
  is_active: boolean;
  name: string;
  notes?: string | null;
  payment_terms_days: number;
  phone: string | null;
};

type PanelClaimAuditRow = {
  amount: number;
  branch_id: string;
  claim_month: string;
  claim_no: string | null;
  due_date: string | null;
  is_void?: boolean;
  notes: string | null;
  panel_company_id: string;
  status: string;
  submitted_date: string | null;
  void_reason?: string | null;
  voided_at?: string | null;
  voided_by?: string | null;
};

type OpeningBalanceAuditRow = {
  amount: number;
  balance_date: string;
  balance_type: OpeningBalanceType;
  bank_account_id: string | null;
  branch_id: string | null;
  created_by: string | null;
  notes: string | null;
  panel_company_id: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  source_notes: string | null;
  source_reference: string | null;
  supplier_id: string | null;
  updated_by: string | null;
  verification_status: OpeningBalanceVerificationStatus;
};

function userProfileAuditData(profile: UserProfileAuditRow) {
  return {
    branch_id: profile.branch_id,
    full_name: profile.full_name,
    is_active: profile.is_active,
    role: profile.role
  };
}

function bankPermissionAuditData(permission: BankPermissionAuditRow) {
  return {
    bank_account_id: permission.bank_account_id,
    can_create_transaction: permission.can_create_transaction,
    can_edit_transaction: permission.can_edit_transaction,
    can_manage_account: permission.can_manage_account,
    can_view: permission.can_view,
    user_id: permission.user_id
  };
}

function bankTransactionAuditData(transaction: BankTransactionAuditRow) {
  return {
    amount: transaction.amount,
    bank_account_id: transaction.bank_account_id,
    branch_id: transaction.branch_id,
    category: transaction.category,
    description: transaction.description,
    direction: transaction.direction,
    reference_no: transaction.reference_no,
    related_bank_account_id: transaction.related_bank_account_id,
    transaction_date: transaction.transaction_date,
    transaction_type: transaction.transaction_type,
    transfer_group_id: transaction.transfer_group_id,
    is_void: transaction.is_void ?? false,
    void_reason: transaction.void_reason ?? null,
    voided_at: transaction.voided_at ?? null,
    voided_by: transaction.voided_by ?? null
  };
}

function cashBankInAuditData(bankIn: CashBankInAuditRow) {
  return {
    amount: bankIn.amount,
    bank_account_id: bankIn.bank_account_id,
    bank_in_date: bankIn.bank_in_date,
    branch_id: bankIn.branch_id,
    notes: bankIn.notes,
    reference_no: bankIn.reference_no,
    is_void: bankIn.is_void ?? false,
    void_reason: bankIn.void_reason ?? null,
    voided_at: bankIn.voided_at ?? null,
    voided_by: bankIn.voided_by ?? null
  };
}

function pettyCashAuditData(transaction: PettyCashAuditRow) {
  return {
    amount: transaction.amount,
    bank_account_id: transaction.bank_account_id,
    branch_id: transaction.branch_id,
    category: transaction.category,
    description: transaction.description,
    direction: transaction.direction,
    reference_no: transaction.reference_no,
    transaction_date: transaction.transaction_date,
    transaction_type: transaction.transaction_type,
    is_void: transaction.is_void ?? false,
    void_reason: transaction.void_reason ?? null,
    voided_at: transaction.voided_at ?? null,
    voided_by: transaction.voided_by ?? null
  };
}

function branchAuditData(branch: BranchAuditRow) {
  return {
    address: branch.address,
    code: branch.code,
    is_active: branch.is_active,
    name: branch.name,
    phone: branch.phone
  };
}

function bankAccountAuditData(account: BankAccountAuditRow) {
  return {
    account_no: account.account_no,
    bank_name: account.bank_name,
    is_active: account.is_active,
    name: account.name
  };
}

function dailySaleAuditData(sale: DailySaleAuditRow) {
  return {
    bank_transfer_amount: sale.bank_transfer_amount,
    branch_id: sale.branch_id,
    card_amount: sale.card_amount,
    cash_amount: sale.cash_amount,
    notes: sale.notes,
    panel_amount: sale.panel_amount,
    qr_amount: sale.qr_amount,
    sale_date: sale.sale_date,
    is_void: sale.is_void ?? false,
    void_reason: sale.void_reason ?? null,
    voided_at: sale.voided_at ?? null,
    voided_by: sale.voided_by ?? null
  };
}

function expenseAuditData(expense: ExpenseAuditRow) {
  return {
    amount: expense.amount,
    branch_id: expense.branch_id,
    category: expense.category,
    description: expense.description,
    expense_date: expense.expense_date,
    payment_type: expense.payment_type,
    receipt_path: expense.receipt_path,
    vendor_name: expense.vendor_name,
    is_void: expense.is_void ?? false,
    void_reason: expense.void_reason ?? null,
    voided_at: expense.voided_at ?? null,
    voided_by: expense.voided_by ?? null
  };
}

function supplierAuditData(supplier: SupplierAuditRow) {
  return {
    address: supplier.address ?? null,
    code: supplier.code ?? null,
    contact_person: supplier.contact_person,
    default_credit_term_days: supplier.default_credit_term_days ?? supplier.payment_terms_days,
    email: supplier.email,
    is_active: supplier.is_active,
    name: supplier.name,
    notes: supplier.notes ?? null,
    payment_terms_days: supplier.payment_terms_days,
    phone: supplier.phone
  };
}

function supplierPurchaseAuditData(purchase: SupplierPurchaseAuditRow) {
  return {
    attachment_path: purchase.attachment_path,
    branch_id: purchase.branch_id,
    category: purchase.category,
    consumables_cost: purchase.consumables_cost,
    due_date: purchase.due_date,
    invoice_no: purchase.invoice_no,
    is_void: purchase.is_void ?? false,
    medicine_cost: purchase.medicine_cost,
    notes: purchase.notes,
    other_cost: purchase.other_cost,
    purchase_date: purchase.purchase_date,
    supplier_id: purchase.supplier_id,
    void_reason: purchase.void_reason ?? null,
    voided_at: purchase.voided_at ?? null,
    voided_by: purchase.voided_by ?? null
  };
}

function supplierPurchaseEntryAuditData(purchase: SupplierPurchaseEntryAuditRow) {
  return {
    branch_id: purchase.branch_id,
    category: purchase.category ?? null,
    consumables_cost: purchase.consumables_cost,
    credit_term_days: purchase.credit_term_days,
    due_date: purchase.due_date,
    invoice_date: purchase.invoice_date,
    invoice_no: purchase.invoice_no,
    is_void: purchase.is_void ?? false,
    medicine_cost: purchase.medicine_cost,
    notes: purchase.notes,
    other_cost: purchase.other_cost,
    purchase_date: purchase.purchase_date,
    supplier_id: purchase.supplier_id,
    total_amount: purchase.total_amount,
    void_reason: purchase.void_reason ?? null,
    voided_at: purchase.voided_at ?? null,
    voided_by: purchase.voided_by ?? null
  };
}

function supplierPaymentAuditData(payment: SupplierPaymentAuditRow) {
  return {
    amount: payment.amount,
    bank_account_id: payment.bank_account_id,
    branch_id: payment.branch_id,
    notes: payment.notes,
    payment_date: payment.payment_date,
    payment_type: payment.payment_type,
    purchase_id: payment.purchase_id,
    receipt_path: payment.receipt_path,
    reference_no: payment.reference_no,
    supplier_id: payment.supplier_id
  };
}

function supplierPaymentEntryAuditData(payment: SupplierPaymentEntryAuditRow) {
  return {
    amount: payment.amount,
    bank_account_id: payment.bank_account_id,
    branch_id: payment.branch_id,
    created_by: payment.created_by ?? null,
    is_void: payment.is_void,
    notes: payment.notes,
    payment_date: payment.payment_date,
    payment_method: payment.payment_method,
    reference_no: payment.reference_no,
    supplier_id: payment.supplier_id,
    supplier_purchase_entry_id: payment.supplier_purchase_entry_id,
    updated_by: payment.updated_by ?? null,
    void_reason: payment.void_reason ?? null,
    voided_at: payment.voided_at ?? null,
    voided_by: payment.voided_by ?? null
  };
}

function panelPaymentAuditData(payment: PanelPaymentAuditRow) {
  return {
    amount: payment.amount,
    bank_account_id: payment.bank_account_id,
    branch_id: payment.branch_id,
    notes: payment.notes,
    panel_claim_id: payment.panel_claim_id,
    payment_date: payment.payment_date,
    payment_type: payment.payment_type,
    reference_no: payment.reference_no
  };
}

function panelCompanyAuditData(company: PanelCompanyAuditRow) {
  return {
    address: company.address ?? null,
    contact_person: company.contact_person,
    email: company.email,
    is_active: company.is_active,
    name: company.name,
    notes: company.notes ?? null,
    payment_terms_days: company.payment_terms_days,
    phone: company.phone
  };
}

function panelClaimAuditData(claim: PanelClaimAuditRow) {
  return {
    amount: claim.amount,
    branch_id: claim.branch_id,
    claim_month: claim.claim_month,
    claim_no: claim.claim_no,
    due_date: claim.due_date,
    is_void: claim.is_void ?? false,
    notes: claim.notes,
    panel_company_id: claim.panel_company_id,
    status: claim.status,
    submitted_date: claim.submitted_date,
    void_reason: claim.void_reason ?? null,
    voided_at: claim.voided_at ?? null,
    voided_by: claim.voided_by ?? null
  };
}

function openingBalanceAuditData(balance: OpeningBalanceAuditRow) {
  return {
    amount: balance.amount,
    balance_date: balance.balance_date,
    balance_type: balance.balance_type,
    bank_account_id: balance.bank_account_id,
    branch_id: balance.branch_id,
    created_by: balance.created_by,
    notes: balance.notes,
    panel_company_id: balance.panel_company_id,
    reviewed_at: balance.reviewed_at,
    reviewed_by: balance.reviewed_by,
    source_notes: balance.source_notes,
    source_reference: balance.source_reference,
    supplier_id: balance.supplier_id,
    updated_by: balance.updated_by,
    verification_status: balance.verification_status
  };
}

function hasAuditChanges(beforeData: Record<string, unknown>, afterData: Record<string, unknown>) {
  return Object.keys(getAuditChangedFields(beforeData, afterData)).length > 0;
}

function importAuditData(type: ImportType, row: Record<string, unknown>) {
  if (type === "daily_sales") return dailySaleAuditData(row as unknown as DailySaleAuditRow);
  if (type === "expenses") return expenseAuditData(row as unknown as ExpenseAuditRow);
  if (type === "opening_balances") return openingBalanceAuditData(row as unknown as OpeningBalanceAuditRow);
  if (type === "supplier_purchases") return supplierPurchaseAuditData(row as unknown as SupplierPurchaseAuditRow);
  if (type === "supplier_payments") return supplierPaymentAuditData(row as unknown as SupplierPaymentAuditRow);
  return panelClaimAuditData(row as unknown as PanelClaimAuditRow);
}

function importRevalidationPaths(type: ImportType) {
  if (type === "daily_sales") return ["/sales", "/dashboard"];
  if (type === "expenses") return ["/expenses", "/dashboard"];
  if (type === "opening_balances") return [
    "/opening-balances",
    "/dashboard",
    "/bank",
    "/cash-bank-ins",
    "/petty-cash",
    "/suppliers/payments",
    "/panels"
  ];
  if (type === "supplier_purchases") return ["/purchases", "/dashboard"];
  if (type === "supplier_payments") return ["/suppliers/payments", "/dashboard"];
  return ["/panels", "/dashboard"];
}

function paymentUsesBankAccount(paymentType: PaymentType) {
  return paymentType === "bank_transfer" || paymentType === "card" || paymentType === "qr";
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function getUserId() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

async function requireEditableBranch(branchId: string | null) {
  const profile = await requirePermission("edit_finance");
  if (!canEditBranch(profile, branchId)) {
    throw new Error("You do not have permission to edit records for this branch.");
  }
  return profile;
}

async function requireOpeningBalanceOwner() {
  const profile = await requirePermission("view_settings");
  if (normalizeRole(profile.role) !== "owner") {
    throw new Error("Only Owner can manage opening balances.");
  }
  return profile;
}

function openingBalanceType(formData: FormData): OpeningBalanceType {
  const value = text(formData, "balance_type");
  if (
    value === "bank_account"
    || value === "cash_in_hand"
    || value === "petty_cash"
    || value === "supplier_outstanding"
    || value === "panel_outstanding"
  ) {
    return value;
  }
  throw new Error("Select a valid opening balance type.");
}

function openingBalanceVerificationStatus(value: string | null): OpeningBalanceVerificationStatus {
  if (value === "confirmed" || value === "estimated" || value === "pending_review") return value;
  return "pending_review";
}

function openingBalanceInput(formData: FormData) {
  const balanceDate = text(formData, "balance_date");
  const balanceType = openingBalanceType(formData);
  const amount = number(formData, "amount");
  const branchId = text(formData, "branch_id");
  const bankAccountId = text(formData, "bank_account_id");
  const supplierId = text(formData, "supplier_id");
  const panelCompanyId = text(formData, "panel_company_id");
  const verificationStatus = openingBalanceVerificationStatus(text(formData, "verification_status"));
  const sourceReference = text(formData, "source_reference");
  const sourceNotes = text(formData, "source_notes");
  const commonInput = {
    notes: text(formData, "notes"),
    source_notes: sourceNotes,
    source_reference: sourceReference,
    verification_status: verificationStatus
  };

  if (!balanceDate) throw new Error("Opening balance date is required.");
  if (amount < 0) throw new Error("Opening balance amount cannot be negative.");

  if (balanceType === "bank_account") {
    if (!bankAccountId) throw new Error("Select the bank account for this opening balance.");
    return {
      amount,
      balance_date: balanceDate,
      balance_type: balanceType,
      bank_account_id: bankAccountId,
      branch_id: null,
      ...commonInput,
      panel_company_id: null,
      supplier_id: null
    };
  }

  if (balanceType === "cash_in_hand" || balanceType === "petty_cash") {
    if (!branchId) throw new Error("Select the branch for this opening balance.");
    return {
      amount,
      balance_date: balanceDate,
      balance_type: balanceType,
      bank_account_id: null,
      branch_id: branchId,
      ...commonInput,
      panel_company_id: null,
      supplier_id: null
    };
  }

  if (balanceType === "supplier_outstanding") {
    if (!supplierId) throw new Error("Select the supplier for this opening balance.");
    return {
      amount,
      balance_date: balanceDate,
      balance_type: balanceType,
      bank_account_id: null,
      branch_id: branchId,
      ...commonInput,
      panel_company_id: null,
      supplier_id: supplierId
    };
  }

  if (!panelCompanyId) throw new Error("Select the panel company for this opening balance.");
  return {
    amount,
    balance_date: balanceDate,
    balance_type: balanceType,
    bank_account_id: null,
    branch_id: branchId,
    ...commonInput,
    panel_company_id: panelCompanyId,
    supplier_id: null
  };
}

function revalidateOpeningBalanceReports() {
  [
    "/opening-balances",
    "/dashboard",
    "/bank",
    "/cash-bank-ins",
    "/petty-cash",
    "/suppliers/payments",
    "/panels"
  ].forEach((path) => revalidatePath(path));
}

function revalidateExpenseReports() {
  ["/expenses", "/dashboard", "/reports/profit-loss", "/reports/cashflow"].forEach((path) => revalidatePath(path));
}

async function requireMasterDataManager() {
  const profile = await requirePermission("edit_finance");
  const role = normalizeRole(profile.role);
  if (role !== "owner" && role !== "admin" && role !== "finance") {
    throw new Error("You do not have permission to manage supplier or panel company records.");
  }
  return profile;
}

function requiredVoidReason(formData: FormData) {
  const reason = text(formData, "void_reason");
  if (!reason) throw new Error("Void reason is required.");
  return reason;
}

function voidFields(reason: string, userId: string | null) {
  return {
    is_void: true,
    void_reason: reason,
    voided_at: new Date().toISOString(),
    voided_by: userId
  };
}

function failSupplierPurchaseEntry(message: string): never {
  redirect(`/purchases?error=${encodeURIComponent(message)}`);
}

function supplierPurchaseEntryInput(formData: FormData) {
  const supplierId = text(formData, "supplier_id");
  const branchId = text(formData, "branch_id");
  const invoiceDate = text(formData, "invoice_date");
  const purchaseDate = text(formData, "purchase_date");
  const creditTermDays = Math.max(0, number(formData, "credit_term_days"));
  const dueDate = text(formData, "due_date") || (invoiceDate ? addDays(invoiceDate, creditTermDays) : null);
  const medicineCost = number(formData, "medicine_cost");
  const consumablesCost = number(formData, "consumables_cost");
  const otherCost = number(formData, "other_cost");

  if (!supplierId) failSupplierPurchaseEntry("Supplier is required.");
  if (!branchId) failSupplierPurchaseEntry("Branch is required.");
  if (!purchaseDate) failSupplierPurchaseEntry("Purchase date is required.");

  return {
    branch_id: branchId,
    category: text(formData, "category") as PurchaseCategory | null,
    consumables_cost: consumablesCost,
    credit_term_days: creditTermDays,
    due_date: dueDate,
    invoice_date: invoiceDate,
    invoice_no: text(formData, "invoice_no"),
    medicine_cost: medicineCost,
    notes: text(formData, "notes"),
    other_cost: otherCost,
    purchase_date: purchaseDate,
    supplier_id: supplierId
  };
}

function canManageSupplierPurchaseEntry(profile: Awaited<ReturnType<typeof requirePermission>>, branchId: string) {
  return canEditBranch(profile, branchId);
}

function isSupplierPurchaseEntryManager(profile: Awaited<ReturnType<typeof requirePermission>>) {
  const role = normalizeRole(profile.role);
  return role === "owner" || role === "admin" || role === "finance" || role === "branch_pic";
}

function failSupplierPaymentEntry(message: string): never {
  redirect(`/suppliers/payments?error=${encodeURIComponent(message)}`);
}

function supplierPaymentEntryInput(formData: FormData) {
  const supplierId = text(formData, "supplier_id");
  const branchId = text(formData, "branch_id");
  const paymentDate = text(formData, "payment_date");
  const paymentMethod = text(formData, "payment_method");
  const bankAccountId = text(formData, "bank_account_id");
  const amount = number(formData, "amount");
  const supplierPurchaseEntryId = text(formData, "supplier_purchase_entry_id");

  if (!supplierId) failSupplierPaymentEntry("Supplier is required.");
  if (!branchId) failSupplierPaymentEntry("Branch is required.");
  if (!paymentDate) failSupplierPaymentEntry("Payment date is required.");
  if (amount <= 0) failSupplierPaymentEntry("Amount must be greater than zero.");
  if (!supplierPurchaseEntryId) {
    failSupplierPaymentEntry("Please select the supplier purchase/invoice this payment belongs to.");
  }
  if (paymentMethod && paymentUsesBankAccount(paymentMethod as PaymentType) && !bankAccountId) {
    failSupplierPaymentEntry("Paid from bank account is required for bank-based supplier payments.");
  }

  return {
    amount,
    bank_account_id: bankAccountId,
    branch_id: branchId,
    notes: text(formData, "notes"),
    payment_date: paymentDate,
    payment_method: paymentMethod,
    reference_no: text(formData, "reference_no"),
    supplier_id: supplierId,
    supplier_purchase_entry_id: supplierPurchaseEntryId
  };
}

function isSupplierPaymentEntryManager(profile: Awaited<ReturnType<typeof requirePermission>>) {
  const role = normalizeRole(profile.role);
  return role === "owner" || role === "admin" || role === "finance" || role === "branch_pic";
}

function canManageSupplierPaymentEntry(profile: Awaited<ReturnType<typeof requirePermission>>, branchId: string) {
  return canEditBranch(profile, branchId);
}

export async function signIn(formData: FormData) {
  if (!hasSupabaseEnv()) redirect("/dashboard");

  const supabase = await createClient();
  const email = text(formData, "email") ?? "";
  const password = text(formData, "password") ?? "";
  const redirectTo = text(formData, "redirect") ?? "/dashboard";
  const safeRedirectTo = redirectTo.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : "/dashboard";
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) redirect("/login?error=Invalid%20login");
  redirect(safeRedirectTo);
}

export async function signOut() {
  if (hasSupabaseEnv()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}

export async function createBranch(formData: FormData) {
  if (!hasSupabaseEnv()) return;
  await requirePermission("manage_branches");
  const supabase = await createClient();
  const { data: branch, error } = await supabase.from("branches").insert({
    name: text(formData, "name"),
    code: text(formData, "code"),
    address: text(formData, "address"),
    phone: text(formData, "phone")
  }).select("id, name, code, address, phone, is_active").single();

  if (error || !branch) throw error ?? new Error("Branch could not be loaded after creation.");

  await logAuditEvent({
    action: "create",
    afterData: branchAuditData(branch),
    description: `Created branch ${branch.name}.`,
    entityId: branch.id,
    entityName: "branches"
  });
  revalidatePath("/branches");
}

export async function createBankAccount(formData: FormData) {
  if (!hasSupabaseEnv()) return;
  const profile = await requirePermission("view_bank_position");
  if (!canManageBankPermissions(profile)) throw new Error("Only Owner can create bank accounts.");
  const name = text(formData, "name");
  if (!name) throw new Error("Bank account name is required.");

  const supabase = await createClient();
  const { data: account, error } = await supabase.from("bank_accounts").insert({
    name,
    bank_name: text(formData, "bank_name"),
    account_no: text(formData, "account_no")
  }).select("id, name, bank_name, account_no, is_active").single();

  if (error || !account) throw error ?? new Error("Bank account could not be loaded after creation.");

  await logAuditEvent({
    action: "create",
    afterData: bankAccountAuditData(account),
    bankAccountId: account.id,
    description: `Created bank account ${account.name}.`,
    entityId: account.id,
    entityName: "bank_accounts"
  });
  revalidatePath("/bank");
  revalidatePath("/cash-bank-ins");
}

export async function createOpeningBalance(formData: FormData) {
  if (!hasSupabaseEnv()) return;
  await requireOpeningBalanceOwner();
  const input = openingBalanceInput(formData);
  const userId = await getUserId();
  const reviewedFields = input.verification_status === "confirmed"
    ? { reviewed_at: new Date().toISOString(), reviewed_by: userId }
    : {};
  const supabase = await createClient();
  const { data: balance, error } = await supabase
    .from("opening_balances")
    .insert({
      ...input,
      created_by: userId,
      ...reviewedFields,
      updated_by: userId
    })
    .select("id, amount, balance_date, balance_type, bank_account_id, branch_id, created_by, notes, panel_company_id, reviewed_at, reviewed_by, source_notes, source_reference, supplier_id, updated_by, verification_status")
    .single();

  if (error || !balance) throw error ?? new Error("Opening balance could not be loaded after creation.");

  await logAuditEvent({
    action: "create",
    afterData: openingBalanceAuditData(balance as OpeningBalanceAuditRow),
    bankAccountId: balance.bank_account_id,
    branchId: balance.branch_id,
    description: "Created opening balance.",
    entityId: balance.id,
    entityName: "opening_balances"
  });
  revalidateOpeningBalanceReports();
}

export async function updateOpeningBalance(formData: FormData) {
  if (!hasSupabaseEnv()) return;
  await requireOpeningBalanceOwner();
  const balanceId = text(formData, "balance_id");
  if (!balanceId) throw new Error("Opening balance is required.");

  const supabase = await createClient();
  const { data: currentBalance, error: currentError } = await supabase
    .from("opening_balances")
    .select("id, amount, balance_date, balance_type, bank_account_id, branch_id, created_by, notes, panel_company_id, reviewed_at, reviewed_by, source_notes, source_reference, supplier_id, updated_by, verification_status")
    .eq("id", balanceId)
    .maybeSingle();

  if (currentError || !currentBalance) throw new Error("Opening balance not found.");
  const input = openingBalanceInput(formData);
  if (currentBalance.balance_type !== input.balance_type) {
    throw new Error("Opening balance type cannot change during edit.");
  }
  const userId = await getUserId();

  const { data: updatedBalance, error } = await supabase
    .from("opening_balances")
    .update({
      ...input,
      ...(currentBalance.verification_status !== input.verification_status
        ? { reviewed_at: new Date().toISOString(), reviewed_by: userId }
        : {}),
      updated_by: userId
    })
    .eq("id", currentBalance.id)
    .select("id, amount, balance_date, balance_type, bank_account_id, branch_id, created_by, notes, panel_company_id, reviewed_at, reviewed_by, source_notes, source_reference, supplier_id, updated_by, verification_status")
    .single();

  if (error || !updatedBalance) throw error ?? new Error("Updated opening balance could not be loaded.");

  const beforeData = openingBalanceAuditData(currentBalance as OpeningBalanceAuditRow);
  const afterData = openingBalanceAuditData(updatedBalance as OpeningBalanceAuditRow);
  if (hasAuditChanges(beforeData, afterData)) {
    await logAuditEvent({
      action: "update",
      afterData,
      bankAccountId: updatedBalance.bank_account_id,
      beforeData,
      branchId: updatedBalance.branch_id,
      description: "Updated opening balance.",
      entityId: updatedBalance.id,
      entityName: "opening_balances"
    });
  }

  revalidateOpeningBalanceReports();
}

export async function createDailySale(formData: FormData) {
  if (!hasSupabaseEnv()) return;
  const branchId = text(formData, "branch_id");
  const saleDate = text(formData, "sale_date");
  await requireEditableBranch(branchId);
  const supabase = await createClient();
  const { data: existingSale, error: existingSaleError } = await supabase
    .from("daily_sales")
    .select("id, branch_id, sale_date, cash_amount, bank_transfer_amount, card_amount, panel_amount, qr_amount, notes, is_void, void_reason, voided_at, voided_by")
    .eq("branch_id", branchId)
    .eq("sale_date", saleDate)
    .maybeSingle();

  if (existingSaleError) throw existingSaleError;
  if (existingSale?.is_void) throw new Error("Voided daily sales cannot be edited. Record a correction with Owner support.");

  const { data: sale, error } = await supabase.from("daily_sales").upsert({
    branch_id: branchId,
    sale_date: saleDate,
    cash_amount: number(formData, "cash_amount"),
    bank_transfer_amount: number(formData, "bank_transfer_amount"),
    card_amount: number(formData, "card_amount"),
    panel_amount: number(formData, "panel_amount"),
    qr_amount: number(formData, "qr_amount"),
    notes: text(formData, "notes"),
    entered_by: await getUserId()
  }).select("id, branch_id, sale_date, cash_amount, bank_transfer_amount, card_amount, panel_amount, qr_amount, notes, is_void, void_reason, voided_at, voided_by").single();

  if (error || !sale) throw error ?? new Error("Daily sale could not be loaded after save.");

  const beforeData = existingSale ? dailySaleAuditData(existingSale) : null;
  const afterData = dailySaleAuditData(sale);
  if (!beforeData || hasAuditChanges(beforeData, afterData)) {
    await logAuditEvent({
      action: beforeData ? "update" : "create",
      afterData,
      beforeData,
      branchId: sale.branch_id,
      description: beforeData ? "Updated daily sales summary." : "Created daily sales summary.",
      entityId: sale.id,
      entityName: "daily_sales"
    });
  }
  revalidatePath("/sales");
  revalidatePath("/dashboard");
}

export async function updateDailySale(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const saleId = text(formData, "sale_id");
  if (!saleId) throw new Error("Daily sales record is required.");

  const supabase = await createClient();
  const { data: sale, error: saleError } = await supabase
    .from("daily_sales")
    .select("id, branch_id, sale_date, cash_amount, bank_transfer_amount, card_amount, panel_amount, qr_amount, notes, is_void, void_reason, voided_at, voided_by")
    .eq("id", saleId)
    .maybeSingle();

  if (saleError || !sale) throw new Error("Daily sales record not found.");
  await requireEditableBranch(sale.branch_id);
  if (sale.is_void) throw new Error("Voided daily sales cannot be edited.");

  const { data: updatedSale, error } = await supabase
    .from("daily_sales")
    .update({
      bank_transfer_amount: number(formData, "bank_transfer_amount"),
      card_amount: number(formData, "card_amount"),
      cash_amount: number(formData, "cash_amount"),
      notes: text(formData, "notes"),
      panel_amount: number(formData, "panel_amount"),
      qr_amount: number(formData, "qr_amount")
    })
    .eq("id", sale.id)
    .select("id, branch_id, sale_date, cash_amount, bank_transfer_amount, card_amount, panel_amount, qr_amount, notes, is_void, void_reason, voided_at, voided_by")
    .single();

  if (error || !updatedSale) throw error ?? new Error("Updated daily sales record could not be loaded.");

  const beforeData = dailySaleAuditData(sale);
  const afterData = dailySaleAuditData(updatedSale);
  if (hasAuditChanges(beforeData, afterData)) {
    await logAuditEvent({
      action: "update",
      afterData,
      beforeData,
      branchId: updatedSale.branch_id,
      description: "Edited daily sales summary.",
      entityId: updatedSale.id,
      entityName: "daily_sales"
    });
  }

  revalidatePath("/sales");
  revalidatePath("/dashboard");
}

export async function voidDailySale(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const saleId = text(formData, "sale_id");
  const reason = requiredVoidReason(formData);
  if (!saleId) throw new Error("Daily sales record is required.");

  const supabase = await createClient();
  const { data: sale, error: saleError } = await supabase
    .from("daily_sales")
    .select("id, branch_id, sale_date, cash_amount, bank_transfer_amount, card_amount, panel_amount, qr_amount, notes, is_void, void_reason, voided_at, voided_by")
    .eq("id", saleId)
    .maybeSingle();

  if (saleError || !sale) throw new Error("Daily sales record not found.");
  await requireEditableBranch(sale.branch_id);
  if (sale.is_void) throw new Error("Daily sales record is already voided.");

  const { data: voidedSale, error } = await supabase
    .from("daily_sales")
    .update(voidFields(reason, await getUserId()))
    .eq("id", sale.id)
    .eq("is_void", false)
    .select("id, branch_id, sale_date, cash_amount, bank_transfer_amount, card_amount, panel_amount, qr_amount, notes, is_void, void_reason, voided_at, voided_by")
    .single();

  if (error || !voidedSale) throw error ?? new Error("Voided daily sales record could not be loaded.");

  await logAuditEvent({
    action: "void",
    afterData: dailySaleAuditData(voidedSale),
    beforeData: dailySaleAuditData(sale),
    branchId: voidedSale.branch_id,
    description: `Voided daily sales summary: ${reason}`,
    entityId: voidedSale.id,
    entityName: "daily_sales"
  });
  revalidatePath("/sales");
  revalidatePath("/dashboard");
}

export async function createCashBankIn(formData: FormData) {
  if (!hasSupabaseEnv()) return;
  const profile = await requirePermission("record_cash_bank_in");
  const branchId = text(formData, "branch_id");
  const bankAccountId = text(formData, "bank_account_id");
  const bankInDate = text(formData, "bank_in_date");
  const amount = number(formData, "amount");
  const role = normalizeRole(profile.role);

  if (role === "branch_pic" && !profile.branch_id) {
    throw new Error("Your user account is not assigned to a branch. Please contact Owner/Admin.");
  }

  if (!branchId || !bankAccountId || !bankInDate || amount <= 0) {
    throw new Error("Date, branch, destination bank account, and amount are required.");
  }

  await requireEditableBranch(branchId);
  if (!canEditBranch(profile, branchId)) {
    throw new Error("You do not have permission to bank in cash for this branch.");
  }
  const supabase = await createClient();

  if (role === "branch_pic") {
    if (branchId !== profile.branch_id) {
      throw new Error("Branch PIC can only bank in cash for their assigned branch.");
    }

    const { data: mapping, error: mappingError } = await supabase
      .from("branch_bank_mappings")
      .select("bank_account_id")
      .eq("branch_id", profile.branch_id)
      .eq("is_active", true)
      .maybeSingle();

    if (mappingError || !mapping) {
      throw new Error("No destination bank account is mapped for your branch. Please contact Owner/Admin.");
    }
    if (bankAccountId !== mapping.bank_account_id) {
      await requireBankAccountPermission(bankAccountId, "create_transaction");
    }
  }

  if (role === "admin" || role === "finance") {
    await requireBankAccountPermission(bankAccountId, "create_transaction");
  }

  const { data: bankIn, error } = await supabase.from("cash_bank_ins").insert({
    branch_id: branchId,
    bank_account_id: bankAccountId,
    bank_in_date: bankInDate,
    amount,
    reference_no: text(formData, "reference_no"),
    notes: text(formData, "notes"),
    entered_by: await getUserId()
  }).select("id, branch_id, bank_account_id, bank_in_date, amount, reference_no, notes, is_void, void_reason, voided_at, voided_by").single();

  if (error || !bankIn) throw error ?? new Error("Cash bank-in could not be loaded after creation.");

  const afterData = cashBankInAuditData(bankIn);
  await logAuditEvent({
    action: "create",
    afterData,
    bankAccountId: bankIn.bank_account_id,
    branchId: bankIn.branch_id,
    description: "Created cash bank-in.",
    entityId: bankIn.id,
    entityName: "cash_bank_ins"
  });
  revalidatePath("/cash-bank-ins");
  revalidatePath("/bank");
  revalidatePath("/dashboard");
}

async function requireCashBankInEditor(branchId: string, bankAccountId: string) {
  const profile = await requirePermission("record_cash_bank_in");
  const role = normalizeRole(profile.role);
  if (role === "branch_pic" || role === "staff" || !canEditBranch(profile, branchId)) {
    throw new Error("You do not have permission to edit cash bank-ins.");
  }
  if (role === "admin" || role === "finance") {
    await requireBankAccountPermission(bankAccountId, "edit_transaction");
  }
  return profile;
}

export async function updateCashBankIn(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const bankInId = text(formData, "bank_in_id");
  const bankInDate = text(formData, "bank_in_date");
  const amount = number(formData, "amount");
  if (!bankInId || !bankInDate || amount <= 0) {
    throw new Error("Cash bank-in, date, and a positive amount are required.");
  }

  const supabase = await createClient();
  const { data: bankIn, error: bankInError } = await supabase
    .from("cash_bank_ins")
    .select("id, branch_id, bank_account_id, bank_in_date, amount, reference_no, notes, is_void, void_reason, voided_at, voided_by")
    .eq("id", bankInId)
    .maybeSingle();

  if (bankInError || !bankIn) throw new Error("Cash bank-in not found.");
  await requireCashBankInEditor(bankIn.branch_id, bankIn.bank_account_id);
  if (bankIn.is_void) throw new Error("Voided cash bank-ins cannot be edited.");

  const { data: updatedBankIn, error } = await supabase
    .from("cash_bank_ins")
    .update({
      amount,
      bank_in_date: bankInDate,
      notes: text(formData, "notes"),
      reference_no: text(formData, "reference_no")
    })
    .eq("id", bankIn.id)
    .select("id, branch_id, bank_account_id, bank_in_date, amount, reference_no, notes, is_void, void_reason, voided_at, voided_by")
    .single();

  if (error || !updatedBankIn) throw error ?? new Error("Updated cash bank-in could not be loaded.");

  const beforeData = cashBankInAuditData(bankIn);
  const afterData = cashBankInAuditData(updatedBankIn);
  if (hasAuditChanges(beforeData, afterData)) {
    await logAuditEvent({
      action: "update",
      afterData,
      bankAccountId: updatedBankIn.bank_account_id,
      beforeData,
      branchId: updatedBankIn.branch_id,
      description: "Edited cash bank-in.",
      entityId: updatedBankIn.id,
      entityName: "cash_bank_ins"
    });
  }
  revalidatePath("/cash-bank-ins");
  revalidatePath("/bank");
  revalidatePath("/dashboard");
}

export async function voidCashBankIn(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const bankInId = text(formData, "bank_in_id");
  const reason = requiredVoidReason(formData);
  if (!bankInId) throw new Error("Cash bank-in record is required.");

  const supabase = await createClient();
  const { data: bankIn, error: bankInError } = await supabase
    .from("cash_bank_ins")
    .select("id, branch_id, bank_account_id, bank_in_date, amount, reference_no, notes, is_void, void_reason, voided_at, voided_by")
    .eq("id", bankInId)
    .maybeSingle();

  if (bankInError || !bankIn) throw new Error("Cash bank-in not found.");
  await requireCashBankInEditor(bankIn.branch_id, bankIn.bank_account_id);
  if (bankIn.is_void) throw new Error("Cash bank-in is already voided.");

  const { data: voidedBankIn, error } = await supabase
    .from("cash_bank_ins")
    .update(voidFields(reason, await getUserId()))
    .eq("id", bankIn.id)
    .eq("is_void", false)
    .select("id, branch_id, bank_account_id, bank_in_date, amount, reference_no, notes, is_void, void_reason, voided_at, voided_by")
    .single();

  if (error || !voidedBankIn) throw error ?? new Error("Voided cash bank-in could not be loaded.");

  await logAuditEvent({
    action: "void",
    afterData: cashBankInAuditData(voidedBankIn),
    bankAccountId: voidedBankIn.bank_account_id,
    beforeData: cashBankInAuditData(bankIn),
    branchId: voidedBankIn.branch_id,
    description: `Voided cash bank-in: ${reason}`,
    entityId: voidedBankIn.id,
    entityName: "cash_bank_ins"
  });
  revalidatePath("/cash-bank-ins");
  revalidatePath("/bank");
  revalidatePath("/dashboard");
}

export async function createBankTransaction(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const type = bankTransactionType(formData);
  const bankAccountId = text(formData, "bank_account_id");
  const relatedBankAccountId = text(formData, "related_bank_account_id");
  const transactionDate = text(formData, "transaction_date");
  const amount = number(formData, "amount");

  if (!bankAccountId || !transactionDate || amount <= 0) {
    throw new Error("Bank account, date, and a positive amount are required.");
  }

  await requireBankAccountPermission(bankAccountId, "create_transaction");

  const branchId = text(formData, "branch_id");
  const referenceNo = text(formData, "reference_no");
  const notes = text(formData, "description");
  const userId = await getUserId();
  const supabase = await createClient();

  if (type === "interbank_transfer") {
    if (!relatedBankAccountId || relatedBankAccountId === bankAccountId) {
      throw new Error("Interbank transfers need different source and destination bank accounts.");
    }

    await requireBankAccountPermission(relatedBankAccountId, "create_transaction");
    const transferGroupId = crypto.randomUUID();
    const { data: transferRows, error } = await supabase.from("bank_transactions").insert([
      {
        bank_account_id: bankAccountId,
        related_bank_account_id: relatedBankAccountId,
        transfer_group_id: transferGroupId,
        transaction_date: transactionDate,
        transaction_type: type,
        direction: "out",
        amount,
        description: notes,
        reference_no: referenceNo,
        branch_id: branchId,
        entered_by: userId
      },
      {
        bank_account_id: relatedBankAccountId,
        related_bank_account_id: bankAccountId,
        transfer_group_id: transferGroupId,
        transaction_date: transactionDate,
        transaction_type: type,
        direction: "in",
        amount,
        description: notes,
        reference_no: referenceNo,
        branch_id: branchId,
        entered_by: userId
      }
    ]).select("id, bank_account_id, related_bank_account_id, transfer_group_id, transaction_date, transaction_type, direction, category, amount, description, reference_no, branch_id");

    if (error || !transferRows) throw error ?? new Error("Interbank transfer could not be loaded after creation.");

    await Promise.all(transferRows.map((transaction) => logAuditEvent({
      action: "create",
      afterData: bankTransactionAuditData(transaction),
      bankAccountId: transaction.bank_account_id,
      branchId: transaction.branch_id,
      description: `Created ${transaction.direction} interbank transfer entry.`,
      entityId: transaction.id,
      entityName: "bank_transactions"
    })));
  } else {
    const { data: transaction, error } = await supabase.from("bank_transactions").insert({
      bank_account_id: bankAccountId,
      transaction_date: transactionDate,
      transaction_type: type,
      direction: bankTransactionDirection(type),
      category: type === "money_out" ? text(formData, "category") : null,
      amount,
      description: notes,
      reference_no: referenceNo,
      branch_id: branchId,
      entered_by: userId
    }).select("id, bank_account_id, related_bank_account_id, transfer_group_id, transaction_date, transaction_type, direction, category, amount, description, reference_no, branch_id").single();

    if (error || !transaction) throw error ?? new Error("Manual bank transaction could not be loaded after creation.");

    await logAuditEvent({
      action: "create",
      afterData: bankTransactionAuditData(transaction),
      bankAccountId: transaction.bank_account_id,
      branchId: transaction.branch_id,
      description: `Created ${transaction.transaction_type} manual bank transaction.`,
      entityId: transaction.id,
      entityName: "bank_transactions"
    });
  }

  revalidatePath("/bank");
}

export async function updateBankTransaction(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const transactionId = text(formData, "transaction_id");
  const transactionDate = text(formData, "transaction_date");
  const amount = number(formData, "amount");
  if (!transactionId || !transactionDate || amount <= 0) {
    throw new Error("Transaction, date, and a positive amount are required.");
  }

  const supabase = await createClient();
  const { data: transaction, error: transactionError } = await supabase
    .from("bank_transactions")
    .select("id, bank_account_id, related_bank_account_id, transfer_group_id, transaction_date, transaction_type, direction, category, amount, description, reference_no, branch_id, is_void, void_reason, voided_at, voided_by")
    .eq("id", transactionId)
    .maybeSingle();

  if (transactionError || !transaction) throw new Error("Manual bank transaction not found.");
  const profile = await requireBankAccountPermission(transaction.bank_account_id, "edit_transaction");
  if (normalizeRole(profile.role) === "branch_pic" && transaction.branch_id !== profile.branch_id) {
    throw new Error("Branch PIC can only edit own-branch bank transactions.");
  }
  if (transaction.is_void) throw new Error("Voided manual bank transactions cannot be edited.");

  const nextBranchId = text(formData, "branch_id");
  if (normalizeRole(profile.role) === "branch_pic" && nextBranchId !== transaction.branch_id) {
    throw new Error("Branch PIC cannot retag bank transactions to another branch.");
  }

  const updates = {
    transaction_date: transactionDate,
    amount,
    description: text(formData, "description"),
    reference_no: text(formData, "reference_no"),
    branch_id: nextBranchId
  };

  if (transaction.transaction_type === "interbank_transfer") {
    if (!transaction.transfer_group_id) throw new Error("Interbank transfer pair is incomplete.");

    const { data: transferRows, error: transferError } = await supabase
      .from("bank_transactions")
      .select("id, bank_account_id, related_bank_account_id, transfer_group_id, transaction_date, transaction_type, direction, category, amount, description, reference_no, branch_id, is_void, void_reason, voided_at, voided_by")
      .eq("transfer_group_id", transaction.transfer_group_id)
      .eq("transaction_type", "interbank_transfer");

    if (transferError || !transferRows || transferRows.length < 2) {
      throw new Error("Interbank transfer pair could not be loaded.");
    }

    await Promise.all(transferRows.map(async (row) => {
      const rowProfile = await requireBankAccountPermission(row.bank_account_id, "edit_transaction");
      if (normalizeRole(rowProfile.role) === "branch_pic" && row.branch_id !== rowProfile.branch_id) {
        throw new Error("Branch PIC can only edit own-branch bank transactions.");
      }
      if (row.is_void) throw new Error("Voided interbank transfer entries cannot be edited.");
    }));
    const { data: updatedTransferRows, error } = await supabase
      .from("bank_transactions")
      .update(updates)
      .eq("transfer_group_id", transaction.transfer_group_id)
      .eq("transaction_type", "interbank_transfer")
      .select("id, bank_account_id, related_bank_account_id, transfer_group_id, transaction_date, transaction_type, direction, category, amount, description, reference_no, branch_id, is_void, void_reason, voided_at, voided_by");

    if (error || !updatedTransferRows) throw error ?? new Error("Updated interbank transfer could not be loaded.");

    const transferBeforeById = new Map(transferRows.map((row) => [row.id, row]));
    await Promise.all(updatedTransferRows.map((updatedTransaction) => {
      const beforeTransaction = transferBeforeById.get(updatedTransaction.id);
      if (!beforeTransaction) return Promise.resolve();

      const beforeData = bankTransactionAuditData(beforeTransaction);
      const afterData = bankTransactionAuditData(updatedTransaction);
      if (!hasAuditChanges(beforeData, afterData)) return Promise.resolve();

      return logAuditEvent({
        action: "update",
        afterData,
        bankAccountId: updatedTransaction.bank_account_id,
        beforeData,
        branchId: updatedTransaction.branch_id,
        description: `Edited ${updatedTransaction.direction} interbank transfer entry.`,
        entityId: updatedTransaction.id,
        entityName: "bank_transactions"
      });
    }));
  } else {
    const { data: updatedTransaction, error } = await supabase
      .from("bank_transactions")
      .update({
        ...updates,
        category: transaction.transaction_type === "money_out" ? text(formData, "category") : null
      })
      .eq("id", transaction.id)
      .select("id, bank_account_id, related_bank_account_id, transfer_group_id, transaction_date, transaction_type, direction, category, amount, description, reference_no, branch_id, is_void, void_reason, voided_at, voided_by")
      .single();

    if (error || !updatedTransaction) throw error ?? new Error("Updated manual bank transaction could not be loaded.");

    const beforeData = bankTransactionAuditData(transaction);
    const afterData = bankTransactionAuditData(updatedTransaction);
    if (hasAuditChanges(beforeData, afterData)) {
      await logAuditEvent({
        action: "update",
        afterData,
        bankAccountId: updatedTransaction.bank_account_id,
        beforeData,
        branchId: updatedTransaction.branch_id,
        description: `Edited ${updatedTransaction.transaction_type} manual bank transaction.`,
        entityId: updatedTransaction.id,
        entityName: "bank_transactions"
      });
    }
  }

  revalidatePath("/bank");
}

export async function voidBankTransaction(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const transactionId = text(formData, "transaction_id");
  const reason = requiredVoidReason(formData);
  if (!transactionId) throw new Error("Manual bank transaction is required.");

  const supabase = await createClient();
  const { data: transaction, error: transactionError } = await supabase
    .from("bank_transactions")
    .select("id, bank_account_id, related_bank_account_id, transfer_group_id, transaction_date, transaction_type, direction, category, amount, description, reference_no, branch_id, is_void, void_reason, voided_at, voided_by")
    .eq("id", transactionId)
    .maybeSingle();

  if (transactionError || !transaction) throw new Error("Manual bank transaction not found.");
  const profile = await requireBankAccountPermission(transaction.bank_account_id, "edit_transaction");
  if (normalizeRole(profile.role) === "branch_pic" && transaction.branch_id !== profile.branch_id) {
    throw new Error("Branch PIC can only void own-branch bank transactions.");
  }
  if (transaction.is_void) throw new Error("Manual bank transaction is already voided.");

  const transferRows = transaction.transaction_type === "interbank_transfer"
    ? await supabase
        .from("bank_transactions")
        .select("id, bank_account_id, related_bank_account_id, transfer_group_id, transaction_date, transaction_type, direction, category, amount, description, reference_no, branch_id, is_void, void_reason, voided_at, voided_by")
        .eq("transfer_group_id", transaction.transfer_group_id)
        .eq("transaction_type", "interbank_transfer")
    : null;

  if (transferRows?.error) throw transferRows.error;
  const rowsToVoid = transferRows?.data?.length ? transferRows.data : [transaction];
  if (transaction.transaction_type === "interbank_transfer" && (!transaction.transfer_group_id || rowsToVoid.length < 2)) {
    throw new Error("Interbank transfer pair could not be loaded.");
  }

  await Promise.all(rowsToVoid.map(async (row) => {
    const rowProfile = await requireBankAccountPermission(row.bank_account_id, "edit_transaction");
    if (normalizeRole(rowProfile.role) === "branch_pic" && row.branch_id !== rowProfile.branch_id) {
      throw new Error("Branch PIC can only void own-branch bank transactions.");
    }
    if (row.is_void) throw new Error("Bank transaction is already voided.");
  }));

  const rowIds = rowsToVoid.map((row) => row.id);
  const { data: voidedRows, error } = await supabase
    .from("bank_transactions")
    .update(voidFields(reason, await getUserId()))
    .in("id", rowIds)
    .eq("is_void", false)
    .select("id, bank_account_id, related_bank_account_id, transfer_group_id, transaction_date, transaction_type, direction, category, amount, description, reference_no, branch_id, is_void, void_reason, voided_at, voided_by");

  if (error || !voidedRows || voidedRows.length !== rowIds.length) {
    throw error ?? new Error("Voided bank transaction entries could not be loaded.");
  }

  const beforeById = new Map(rowsToVoid.map((row) => [row.id, row]));
  await Promise.all(voidedRows.map((voidedTransaction) => {
    const beforeTransaction = beforeById.get(voidedTransaction.id);
    if (!beforeTransaction) return Promise.resolve();

    return logAuditEvent({
      action: "void",
      afterData: bankTransactionAuditData(voidedTransaction),
      bankAccountId: voidedTransaction.bank_account_id,
      beforeData: bankTransactionAuditData(beforeTransaction),
      branchId: voidedTransaction.branch_id,
      description: `Voided ${voidedTransaction.transaction_type} manual bank transaction: ${reason}`,
      entityId: voidedTransaction.id,
      entityName: "bank_transactions"
    });
  }));
  revalidatePath("/bank");
  revalidatePath("/dashboard");
}

export async function createPettyCashTransaction(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const profile = await requirePermission("record_petty_cash");
  const role = normalizeRole(profile.role);
  const type = pettyCashTransactionType(formData);
  const branchId = text(formData, "branch_id");
  const bankAccountId = text(formData, "bank_account_id");
  const transactionDate = text(formData, "transaction_date");
  const amount = number(formData, "amount");
  const category = text(formData, "category");

  if (!branchId || !transactionDate || amount === 0) {
    throw new Error("Branch, date, and amount are required.");
  }

  if (type !== "petty_cash_adjustment" && amount <= 0) {
    throw new Error("Petty cash issued, spent, and returned amounts must be positive.");
  }

  if (type === "petty_cash_adjustment" && role !== "owner") {
    throw new Error("Only Owner can record petty cash adjustments.");
  }

  if (role === "branch_pic") {
    if (profile.branch_id !== branchId) {
      throw new Error("You can only record petty cash for your own branch.");
    }
    if (type === "petty_cash_issued") {
      throw new Error("Branch PIC cannot issue petty cash from a bank account.");
    }
  } else if (!canEditBranch(profile, branchId)) {
    throw new Error("You do not have permission to manage petty cash for this branch.");
  }

  if (type === "petty_cash_issued" || (type === "petty_cash_returned" && role !== "branch_pic")) {
    if (!bankAccountId) throw new Error("Select the related bank account.");
    await requireBankAccountPermission(bankAccountId, "create_transaction");
  }

  if (type === "petty_cash_returned" && !bankAccountId) {
    throw new Error("Petty cash returned needs a bank account.");
  }
  if (type === "petty_cash_spent" && !category) {
    throw new Error("Petty cash spending needs a category.");
  }

  const supabase = await createClient();
  const { data: transaction, error } = await supabase.from("petty_cash_transactions").insert({
    branch_id: branchId,
    bank_account_id: type === "petty_cash_issued" || type === "petty_cash_returned" ? bankAccountId : null,
    transaction_date: transactionDate,
    transaction_type: type,
    direction: pettyCashDirection(type),
    category: type === "petty_cash_spent" ? category : null,
    amount,
    description: text(formData, "description"),
    reference_no: text(formData, "reference_no"),
    entered_by: await getUserId()
  }).select("id, branch_id, bank_account_id, transaction_date, transaction_type, direction, category, amount, description, reference_no, is_void, void_reason, voided_at, voided_by").single();

  if (error || !transaction) throw error ?? new Error("Petty cash transaction could not be loaded after creation.");

  await logAuditEvent({
    action: "create",
    afterData: pettyCashAuditData(transaction),
    bankAccountId: transaction.bank_account_id,
    branchId: transaction.branch_id,
    description: `Created ${transaction.transaction_type} petty cash transaction.`,
    entityId: transaction.id,
    entityName: "petty_cash_transactions"
  });
  revalidatePath("/petty-cash");
  revalidatePath("/bank");
}

export async function updatePettyCashTransaction(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const profile = await requirePermission("record_petty_cash");
  const role = normalizeRole(profile.role);
  if (!hasPermission(profile, "edit_finance") || role === "branch_pic") {
    throw new Error("You do not have permission to edit petty cash transactions.");
  }

  const transactionId = text(formData, "transaction_id");
  const transactionDate = text(formData, "transaction_date");
  const amount = number(formData, "amount");
  const category = text(formData, "category");
  if (!transactionId || !transactionDate || amount === 0) {
    throw new Error("Transaction, date, and amount are required.");
  }

  const supabase = await createClient();
  const { data: transaction, error: transactionError } = await supabase
    .from("petty_cash_transactions")
    .select("id, branch_id, bank_account_id, transaction_date, transaction_type, direction, category, amount, description, reference_no, is_void, void_reason, voided_at, voided_by")
    .eq("id", transactionId)
    .maybeSingle();

  if (transactionError || !transaction) throw new Error("Petty cash transaction not found.");
  if (transaction.is_void) throw new Error("Voided petty cash transactions cannot be edited.");
  if (!canEditBranch(profile, transaction.branch_id)) {
    throw new Error("You do not have permission to edit petty cash for this branch.");
  }
  if (transaction.transaction_type === "petty_cash_adjustment" && role !== "owner") {
    throw new Error("Only Owner can edit petty cash adjustments.");
  }
  if (transaction.transaction_type !== "petty_cash_adjustment" && amount <= 0) {
    throw new Error("Petty cash issued, spent, and returned amounts must be positive.");
  }
  if (transaction.transaction_type === "petty_cash_spent" && !category) {
    throw new Error("Petty cash spending needs a category.");
  }
  if (transaction.bank_account_id && role !== "owner") {
    await requireBankAccountPermission(transaction.bank_account_id, "edit_transaction");
  }

  const { data: updatedTransaction, error } = await supabase
    .from("petty_cash_transactions")
    .update({
      transaction_date: transactionDate,
      amount,
      category: transaction.transaction_type === "petty_cash_spent" ? category : null,
      description: text(formData, "description"),
      reference_no: text(formData, "reference_no")
    })
    .eq("id", transaction.id)
    .select("id, branch_id, bank_account_id, transaction_date, transaction_type, direction, category, amount, description, reference_no, is_void, void_reason, voided_at, voided_by")
    .single();

  if (error || !updatedTransaction) throw error ?? new Error("Updated petty cash transaction could not be loaded.");

  const beforeData = pettyCashAuditData(transaction);
  const afterData = pettyCashAuditData(updatedTransaction);
  if (hasAuditChanges(beforeData, afterData)) {
    await logAuditEvent({
      action: "update",
      afterData,
      bankAccountId: updatedTransaction.bank_account_id,
      beforeData,
      branchId: updatedTransaction.branch_id,
      description: `Edited ${updatedTransaction.transaction_type} petty cash transaction.`,
      entityId: updatedTransaction.id,
      entityName: "petty_cash_transactions"
    });
  }
  revalidatePath("/petty-cash");
  revalidatePath("/bank");
}

export async function voidPettyCashTransaction(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const profile = await requirePermission("record_petty_cash");
  const role = normalizeRole(profile.role);
  if (!hasPermission(profile, "edit_finance") || role === "branch_pic") {
    throw new Error("You do not have permission to void petty cash transactions.");
  }

  const transactionId = text(formData, "transaction_id");
  const reason = requiredVoidReason(formData);
  if (!transactionId) throw new Error("Petty cash transaction is required.");

  const supabase = await createClient();
  const { data: transaction, error: transactionError } = await supabase
    .from("petty_cash_transactions")
    .select("id, branch_id, bank_account_id, transaction_date, transaction_type, direction, category, amount, description, reference_no, is_void, void_reason, voided_at, voided_by")
    .eq("id", transactionId)
    .maybeSingle();

  if (transactionError || !transaction) throw new Error("Petty cash transaction not found.");
  if (!canEditBranch(profile, transaction.branch_id)) {
    throw new Error("You do not have permission to void petty cash for this branch.");
  }
  if (transaction.transaction_type === "petty_cash_adjustment" && role !== "owner") {
    throw new Error("Only Owner can void petty cash adjustments.");
  }
  if (transaction.bank_account_id && role !== "owner") {
    await requireBankAccountPermission(transaction.bank_account_id, "edit_transaction");
  }
  if (transaction.is_void) throw new Error("Petty cash transaction is already voided.");

  const { data: voidedTransaction, error } = await supabase
    .from("petty_cash_transactions")
    .update(voidFields(reason, await getUserId()))
    .eq("id", transaction.id)
    .eq("is_void", false)
    .select("id, branch_id, bank_account_id, transaction_date, transaction_type, direction, category, amount, description, reference_no, is_void, void_reason, voided_at, voided_by")
    .single();

  if (error || !voidedTransaction) throw error ?? new Error("Voided petty cash transaction could not be loaded.");

  await logAuditEvent({
    action: "void",
    afterData: pettyCashAuditData(voidedTransaction),
    bankAccountId: voidedTransaction.bank_account_id,
    beforeData: pettyCashAuditData(transaction),
    branchId: voidedTransaction.branch_id,
    description: `Voided ${voidedTransaction.transaction_type} petty cash transaction: ${reason}`,
    entityId: voidedTransaction.id,
    entityName: "petty_cash_transactions"
  });
  revalidatePath("/petty-cash");
  revalidatePath("/bank");
  revalidatePath("/dashboard");
}

export async function createExpense(formData: FormData) {
  if (!hasSupabaseEnv()) return;
  const branchId = text(formData, "branch_id");
  await requireEditableBranch(branchId);
  const supabase = await createClient();
  const { data: expense, error } = await supabase.from("expenses").insert({
    branch_id: branchId,
    expense_date: text(formData, "expense_date"),
    category: text(formData, "category") as ExpenseCategory,
    vendor_name: text(formData, "vendor_name"),
    description: text(formData, "description"),
    payment_type: text(formData, "payment_type") as PaymentType,
    amount: number(formData, "amount"),
    entered_by: await getUserId()
  }).select("id, branch_id, expense_date, category, vendor_name, description, payment_type, amount, receipt_path, is_void, void_reason, voided_at, voided_by").single();

  if (error || !expense) throw error ?? new Error("Expense could not be loaded after creation.");

  await logAuditEvent({
    action: "create",
    afterData: expenseAuditData(expense),
    branchId: expense.branch_id,
    description: "Created expense.",
    entityId: expense.id,
    entityName: "expenses"
  });
  revalidateExpenseReports();
}

export async function updateExpense(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const expenseId = text(formData, "expense_id");
  const branchId = text(formData, "branch_id");
  if (!expenseId) throw new Error("Expense record is required.");
  if (!branchId) throw new Error("Expense branch is required.");

  const supabase = await createClient();
  const { data: expense, error: expenseError } = await supabase
    .from("expenses")
    .select("id, branch_id, expense_date, category, vendor_name, description, payment_type, amount, receipt_path, is_void, void_reason, voided_at, voided_by")
    .eq("id", expenseId)
    .maybeSingle();

  if (expenseError || !expense) throw new Error("Expense record not found.");
  await requireEditableBranch(expense.branch_id);
  await requireEditableBranch(branchId);
  if (expense.is_void) throw new Error("Voided expenses cannot be edited.");

  const { data: updatedExpense, error } = await supabase
    .from("expenses")
    .update({
      amount: number(formData, "amount"),
      branch_id: branchId,
      category: text(formData, "category") as ExpenseCategory,
      description: text(formData, "description"),
      expense_date: text(formData, "expense_date"),
      payment_type: text(formData, "payment_type") as PaymentType,
      vendor_name: text(formData, "vendor_name")
    })
    .eq("id", expense.id)
    .eq("is_void", false)
    .select("id, branch_id, expense_date, category, vendor_name, description, payment_type, amount, receipt_path, is_void, void_reason, voided_at, voided_by")
    .single();

  if (error || !updatedExpense) throw error ?? new Error("Updated expense could not be loaded.");

  const beforeData = expenseAuditData(expense);
  const afterData = expenseAuditData(updatedExpense);
  if (hasAuditChanges(beforeData, afterData)) {
    await logAuditEvent({
      action: "update",
      afterData,
      beforeData,
      branchId: updatedExpense.branch_id,
      description: "Edited expense.",
      entityId: updatedExpense.id,
      entityName: "expenses"
    });
  }

  revalidateExpenseReports();
}

export async function voidExpense(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const expenseId = text(formData, "expense_id");
  const reason = requiredVoidReason(formData);
  if (!expenseId) throw new Error("Expense record is required.");

  const supabase = await createClient();
  const { data: expense, error: expenseError } = await supabase
    .from("expenses")
    .select("id, branch_id, expense_date, category, vendor_name, description, payment_type, amount, receipt_path, is_void, void_reason, voided_at, voided_by")
    .eq("id", expenseId)
    .maybeSingle();

  if (expenseError || !expense) throw new Error("Expense record not found.");
  await requireEditableBranch(expense.branch_id);
  if (expense.is_void) throw new Error("Expense record is already voided.");

  const { data: voidedExpense, error } = await supabase
    .from("expenses")
    .update(voidFields(reason, await getUserId()))
    .eq("id", expense.id)
    .eq("is_void", false)
    .select("id, branch_id, expense_date, category, vendor_name, description, payment_type, amount, receipt_path, is_void, void_reason, voided_at, voided_by")
    .single();

  if (error || !voidedExpense) throw error ?? new Error("Voided expense could not be loaded.");

  await logAuditEvent({
    action: "void",
    afterData: expenseAuditData(voidedExpense),
    beforeData: expenseAuditData(expense),
    branchId: voidedExpense.branch_id,
    description: `Voided expense: ${reason}`,
    entityId: voidedExpense.id,
    entityName: "expenses"
  });
  revalidateExpenseReports();
}

export async function createSupplier(formData: FormData) {
  if (!hasSupabaseEnv()) return failSupplierManager("Supabase environment is not configured.");
  await requireMasterDataManager();
  const supabase = await createClient();
  const supplierName = text(formData, "name");
  if (!supplierName) failSupplierManager("Supplier name is required.");
  const fieldSupport = await getSupplierFieldSupport(supabase);
  const insertPayload: Record<string, unknown> = {
    name: supplierName,
    contact_person: text(formData, "contact_person"),
    phone: text(formData, "phone"),
    email: text(formData, "email"),
    address: text(formData, "address"),
    notes: text(formData, "notes"),
    is_active: booleanText(formData, "is_active", true),
    payment_terms_days: number(formData, "default_credit_term_days") || 30
  };
  if (fieldSupport.hasCode) insertPayload.code = text(formData, "code");
  if (fieldSupport.hasDefaultCreditTermDays) insertPayload.default_credit_term_days = number(formData, "default_credit_term_days") || 30;

  const selectColumns = [
    "id",
    fieldSupport.hasCode ? "code" : null,
    "name",
    "contact_person",
    "phone",
    "email",
    "address",
    "notes",
    fieldSupport.hasDefaultCreditTermDays ? "default_credit_term_days" : null,
    "payment_terms_days",
    "is_active"
  ].filter(Boolean).join(", ");

  const { data: supplier, error } = await supabase.from("suppliers").insert(insertPayload).select(selectColumns).single();

  if (error || !supplier) {
    console.error("createSupplier failed", {
      action: "createSupplier",
      code: error?.code,
      error: error?.message,
      details: error?.details
    });
    failSupplierManager(supplierMutationErrorMessage(error ?? {}));
  }
  const createdSupplier = supplier as unknown as SupplierAuditRow & { id: string; name: string };

  await logAuditEvent({
    action: "create",
    afterData: supplierAuditData(createdSupplier),
    description: `Created supplier ${createdSupplier.name}.`,
    entityId: createdSupplier.id,
    entityName: "suppliers"
  });
  revalidatePath("/purchases");
  revalidatePath("/suppliers/payments");
  revalidatePath("/suppliers");
}

export async function updateSupplier(formData: FormData) {
  if (!hasSupabaseEnv()) return failSupplierManager("Supabase environment is not configured.");
  await requireMasterDataManager();

  const supplierId = text(formData, "supplier_id");
  if (!supplierId) failSupplierManager("Supplier record is required.");

  const supabase = await createClient();
  const fieldSupport = await getSupplierFieldSupport(supabase);
  const { data: supplier, error: supplierError } = await supabase
    .from("suppliers")
    .select([
      "id",
      fieldSupport.hasCode ? "code" : null,
      "name",
      "contact_person",
      "phone",
      "email",
      "address",
      "notes",
      fieldSupport.hasDefaultCreditTermDays ? "default_credit_term_days" : null,
      "payment_terms_days",
      "is_active"
    ].filter(Boolean).join(", "))
    .eq("id", supplierId)
    .maybeSingle();

  if (supplierError || !supplier) failSupplierManager("Supplier record not found.");

  const updatePayload: Record<string, unknown> = {
    address: text(formData, "address"),
    contact_person: text(formData, "contact_person"),
    email: text(formData, "email"),
    is_active: booleanText(formData, "is_active", true),
    name: text(formData, "name"),
    notes: text(formData, "notes"),
    payment_terms_days: number(formData, "default_credit_term_days") || 30,
    phone: text(formData, "phone")
  };
  if (fieldSupport.hasCode) updatePayload.code = text(formData, "code");
  if (fieldSupport.hasDefaultCreditTermDays) updatePayload.default_credit_term_days = number(formData, "default_credit_term_days") || 30;
  const existingSupplier = supplier as unknown as SupplierAuditRow & { id: string; name: string };
  const { data: updatedSupplier, error } = await supabase
    .from("suppliers")
    .update(updatePayload)
    .eq("id", existingSupplier.id)
    .select([
      "id",
      fieldSupport.hasCode ? "code" : null,
      "name",
      "contact_person",
      "phone",
      "email",
      "address",
      "notes",
      fieldSupport.hasDefaultCreditTermDays ? "default_credit_term_days" : null,
      "payment_terms_days",
      "is_active"
    ].filter(Boolean).join(", "))
    .single();

  if (error || !updatedSupplier) {
    console.error("updateSupplier failed", {
      action: "updateSupplier",
      supplierId,
      code: error?.code,
      error: error?.message,
      details: error?.details
    });
    failSupplierManager(supplierMutationErrorMessage(error ?? {}));
  }
  const nextSupplier = updatedSupplier as unknown as SupplierAuditRow & { id: string; name: string };

  const beforeData = supplierAuditData(existingSupplier);
  const afterData = supplierAuditData(nextSupplier);
  if (hasAuditChanges(beforeData, afterData)) {
    await logAuditEvent({
      action: "update",
      afterData,
      beforeData,
      description: `Updated supplier ${nextSupplier.name}.`,
      entityId: nextSupplier.id,
      entityName: "suppliers"
    });
  }

  revalidatePath("/purchases");
  revalidatePath("/suppliers/payments");
  revalidatePath("/suppliers");
}

export async function createSupplierPurchaseEntry(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const profile = await requirePermission("view_supplier_records");
  if (!isSupplierPurchaseEntryManager(profile)) {
    failSupplierPurchaseEntry("You do not have permission to create supplier purchases.");
  }

  const payload = supplierPurchaseEntryInput(formData);
  if (!canManageSupplierPurchaseEntry(profile, payload.branch_id)) {
    failSupplierPurchaseEntry("You do not have permission to create supplier purchases for this branch.");
  }

  const adminSupabase = createAdminClient();
  const timestamp = new Date().toISOString();
  const insertPayload = {
    ...payload,
    created_at: timestamp,
    created_by: profile.id,
    updated_at: timestamp,
    updated_by: profile.id
  };

  const { data: createdEntry, error } = await adminSupabase
    .from("supplier_purchase_entries")
    .insert(insertPayload)
    .select("id, supplier_id, branch_id, invoice_no, invoice_date, purchase_date, credit_term_days, due_date, category, medicine_cost, consumables_cost, other_cost, total_amount, notes, is_void, void_reason, voided_at, voided_by, created_by, updated_by, created_at, updated_at")
    .single();

  if (error || !createdEntry) {
    console.error("createSupplierPurchaseEntry failed", {
      action: "createSupplierPurchaseEntry",
      branchId: payload.branch_id,
      role: normalizeRole(profile.role),
      profileBranchId: profile.branch_id,
      code: error?.code,
      error: error?.message,
      details: error?.details,
      hint: error?.hint
    });
    failSupplierPurchaseEntry("Supplier purchase could not be created.");
  }

  await logAuditEvent({
    action: "create",
    afterData: supplierPurchaseEntryAuditData(createdEntry),
    branchId: createdEntry.branch_id,
    description: "Created supplier purchase entry.",
    entityId: createdEntry.id,
    entityName: "supplier_purchase_entries"
  });

  revalidatePath("/purchases");
  revalidatePath("/dashboard");
}

export async function updateSupplierPurchaseEntry(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const profile = await requirePermission("view_supplier_records");
  if (!isSupplierPurchaseEntryManager(profile)) {
    failSupplierPurchaseEntry("You do not have permission to edit supplier purchases.");
  }

  const purchaseEntryId = String(formData.get("purchase_entry_id") || "").trim();
  if (!purchaseEntryId) failSupplierPurchaseEntry("Supplier purchase entry is required.");

  const payload = supplierPurchaseEntryInput(formData);
  const adminSupabase = createAdminClient();
  const { data: existingEntry, error: loadError } = await adminSupabase
    .from("supplier_purchase_entries")
    .select("id, supplier_id, branch_id, invoice_no, invoice_date, purchase_date, credit_term_days, due_date, category, medicine_cost, consumables_cost, other_cost, total_amount, notes, is_void, void_reason, voided_at, voided_by, created_by, updated_by, created_at, updated_at")
    .eq("id", purchaseEntryId)
    .maybeSingle();

  if (loadError || !existingEntry) {
    console.error("updateSupplierPurchaseEntry load failed", {
      action: "updateSupplierPurchaseEntry",
      purchaseEntryId,
      code: loadError?.code,
      error: loadError?.message,
      details: loadError?.details,
      hint: loadError?.hint
    });
    failSupplierPurchaseEntry("Supplier purchase not found.");
  }

  if (!canManageSupplierPurchaseEntry(profile, existingEntry.branch_id)) {
    failSupplierPurchaseEntry("You do not have permission to edit this supplier purchase.");
  }
  if (existingEntry.is_void) {
    failSupplierPurchaseEntry("Voided supplier purchases cannot be edited.");
  }

  const role = normalizeRole(profile.role);
  const nextBranchId = role === "branch_pic" ? existingEntry.branch_id : payload.branch_id;
  if (!canManageSupplierPurchaseEntry(profile, nextBranchId)) {
    failSupplierPurchaseEntry(role === "branch_pic"
      ? "Branch PIC cannot move supplier purchases to another branch."
      : "You do not have permission to edit this supplier purchase.");
  }

  const timestamp = new Date().toISOString();
  const updatePayload = {
    ...payload,
    branch_id: nextBranchId,
    updated_at: timestamp,
    updated_by: profile.id
  };

  const { data: updatedEntry, error } = await adminSupabase
    .from("supplier_purchase_entries")
    .update(updatePayload)
    .eq("id", existingEntry.id)
    .eq("is_void", false)
    .select("id, supplier_id, branch_id, invoice_no, invoice_date, purchase_date, credit_term_days, due_date, category, medicine_cost, consumables_cost, other_cost, total_amount, notes, is_void, void_reason, voided_at, voided_by, created_by, updated_by, created_at, updated_at")
    .single();

  if (error || !updatedEntry) {
    console.error("updateSupplierPurchaseEntry failed", {
      action: "updateSupplierPurchaseEntry",
      purchaseEntryId,
      role,
      profileBranchId: profile.branch_id,
      purchaseBranchId: existingEntry.branch_id,
      submittedBranchId: payload.branch_id,
      code: error?.code,
      error: error?.message,
      details: error?.details,
      hint: error?.hint
    });
    failSupplierPurchaseEntry("Supplier purchase could not be updated.");
  }

  const beforeData = supplierPurchaseEntryAuditData(existingEntry);
  const afterData = supplierPurchaseEntryAuditData(updatedEntry);
  if (hasAuditChanges(beforeData, afterData)) {
    await logAuditEvent({
      action: "update",
      afterData,
      beforeData,
      branchId: updatedEntry.branch_id,
      description: "Updated supplier purchase entry.",
      entityId: updatedEntry.id,
      entityName: "supplier_purchase_entries"
    });
  }

  revalidatePath("/purchases");
  revalidatePath("/dashboard");
}

export async function voidSupplierPurchaseEntry(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const profile = await requirePermission("view_supplier_records");
  if (!isSupplierPurchaseEntryManager(profile)) {
    failSupplierPurchaseEntry("You do not have permission to void supplier purchases.");
  }

  const purchaseEntryId = String(formData.get("purchase_entry_id") || "").trim();
  const reason = text(formData, "void_reason");
  if (!purchaseEntryId) failSupplierPurchaseEntry("Supplier purchase entry is required.");
  if (!reason) failSupplierPurchaseEntry("Void reason is required.");

  const adminSupabase = createAdminClient();
  const { data: existingEntry, error: loadError } = await adminSupabase
    .from("supplier_purchase_entries")
    .select("id, supplier_id, branch_id, invoice_no, invoice_date, purchase_date, credit_term_days, due_date, category, medicine_cost, consumables_cost, other_cost, total_amount, notes, is_void, void_reason, voided_at, voided_by, created_by, updated_by, created_at, updated_at")
    .eq("id", purchaseEntryId)
    .maybeSingle();

  if (loadError || !existingEntry) {
    console.error("voidSupplierPurchaseEntry load failed", {
      action: "voidSupplierPurchaseEntry",
      purchaseEntryId,
      code: loadError?.code,
      error: loadError?.message,
      details: loadError?.details,
      hint: loadError?.hint
    });
    failSupplierPurchaseEntry("Supplier purchase not found.");
  }

  if (!canManageSupplierPurchaseEntry(profile, existingEntry.branch_id)) {
    failSupplierPurchaseEntry("You do not have permission to void this supplier purchase.");
  }
  if (existingEntry.is_void) {
    failSupplierPurchaseEntry("Supplier purchase is already voided.");
  }

  const timestamp = new Date().toISOString();
  const { data: voidedEntry, error } = await adminSupabase
    .from("supplier_purchase_entries")
    .update({
      is_void: true,
      updated_at: timestamp,
      updated_by: profile.id,
      void_reason: reason,
      voided_at: timestamp,
      voided_by: profile.id
    })
    .eq("id", existingEntry.id)
    .eq("is_void", false)
    .select("id, supplier_id, branch_id, invoice_no, invoice_date, purchase_date, credit_term_days, due_date, category, medicine_cost, consumables_cost, other_cost, total_amount, notes, is_void, void_reason, voided_at, voided_by, created_by, updated_by, created_at, updated_at")
    .single();

  if (error || !voidedEntry) {
    console.error("voidSupplierPurchaseEntry failed", {
      action: "voidSupplierPurchaseEntry",
      purchaseEntryId,
      role: normalizeRole(profile.role),
      profileBranchId: profile.branch_id,
      purchaseBranchId: existingEntry.branch_id,
      code: error?.code,
      error: error?.message,
      details: error?.details,
      hint: error?.hint
    });
    failSupplierPurchaseEntry("Supplier purchase could not be voided.");
  }

  await logAuditEvent({
    action: "void",
    afterData: supplierPurchaseEntryAuditData(voidedEntry),
    beforeData: supplierPurchaseEntryAuditData(existingEntry),
    branchId: voidedEntry.branch_id,
    description: `Voided supplier purchase entry. Reason: ${reason}`,
    entityId: voidedEntry.id,
    entityName: "supplier_purchase_entries"
  });

  revalidatePath("/purchases");
  revalidatePath("/dashboard");
}

export async function createSupplierPaymentEntry(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const profile = await requirePermission("view_supplier_payments");
  if (!isSupplierPaymentEntryManager(profile)) {
    failSupplierPaymentEntry("You do not have permission to create supplier payments.");
  }

  const adminSupabase = createAdminClient();
  const payload = supplierPaymentEntryInput(formData);
  let nextSupplierId = payload.supplier_id;
  let nextBranchId = payload.branch_id;

  if (payload.supplier_purchase_entry_id) {
    const { data: linkedPurchase, error: linkedPurchaseError } = await adminSupabase
      .from("supplier_purchase_entries")
      .select("id, supplier_id, branch_id, is_void")
      .eq("id", payload.supplier_purchase_entry_id)
      .maybeSingle();

    if (linkedPurchaseError || !linkedPurchase) failSupplierPaymentEntry("Linked supplier purchase was not found.");
    if (linkedPurchase.is_void) failSupplierPaymentEntry("Voided supplier purchases cannot receive supplier payments.");
    nextSupplierId = linkedPurchase.supplier_id;
    nextBranchId = linkedPurchase.branch_id;
  }

  if (!canManageSupplierPaymentEntry(profile, nextBranchId)) {
    failSupplierPaymentEntry("You do not have permission to record supplier payments for this branch.");
  }

  if (payload.bank_account_id) {
    const { data: bankAccount, error: bankAccountError } = await adminSupabase
      .from("bank_accounts")
      .select("id, is_active")
      .eq("id", payload.bank_account_id)
      .eq("is_active", true)
      .maybeSingle();
    if (bankAccountError || !bankAccount) failSupplierPaymentEntry("Selected bank account is not active or not available.");
  }

  const timestamp = new Date().toISOString();
  const { data: createdPayment, error } = await adminSupabase
    .from("supplier_payment_entries")
    .insert({
      amount: payload.amount,
      bank_account_id: payload.bank_account_id,
      branch_id: nextBranchId,
      created_at: timestamp,
      created_by: profile.id,
      notes: payload.notes,
      payment_date: payload.payment_date,
      payment_method: payload.payment_method,
      reference_no: payload.reference_no,
      supplier_id: nextSupplierId,
      supplier_purchase_entry_id: payload.supplier_purchase_entry_id,
      updated_at: timestamp,
      updated_by: profile.id
    })
    .select("id, supplier_purchase_entry_id, supplier_id, branch_id, payment_date, payment_method, bank_account_id, amount, reference_no, notes, is_void, void_reason, voided_at, voided_by, created_by, updated_by, created_at, updated_at")
    .single();

  if (error || !createdPayment) {
    console.error("createSupplierPaymentEntry failed", {
      action: "createSupplierPaymentEntry",
      branchId: nextBranchId,
      linkedPurchaseId: payload.supplier_purchase_entry_id,
      role: normalizeRole(profile.role),
      profileBranchId: profile.branch_id,
      code: error?.code,
      error: error?.message,
      details: error?.details,
      hint: error?.hint
    });
    failSupplierPaymentEntry("Supplier payment could not be created.");
  }

  await logAuditEvent({
    action: "create",
    afterData: supplierPaymentEntryAuditData(createdPayment),
    bankAccountId: createdPayment.bank_account_id,
    branchId: createdPayment.branch_id,
    description: "Created supplier payment entry.",
    entityId: createdPayment.id,
    entityName: "supplier_payment_entries"
  });

  revalidatePath("/suppliers/payments");
  revalidatePath("/purchases");
  revalidatePath("/dashboard");
  revalidatePath("/bank");
  revalidatePath("/reports/cashflow");
}

export async function updateSupplierPaymentEntry(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const profile = await requirePermission("view_supplier_payments");
  if (!isSupplierPaymentEntryManager(profile)) {
    failSupplierPaymentEntry("You do not have permission to edit supplier payments.");
  }

  const paymentEntryId = String(formData.get("payment_entry_id") || "").trim();
  if (!paymentEntryId) failSupplierPaymentEntry("Supplier payment entry is required.");

  const adminSupabase = createAdminClient();
  const payload = supplierPaymentEntryInput(formData);
  const { data: existingPayment, error: loadError } = await adminSupabase
    .from("supplier_payment_entries")
    .select("id, supplier_purchase_entry_id, supplier_id, branch_id, payment_date, payment_method, bank_account_id, amount, reference_no, notes, is_void, void_reason, voided_at, voided_by, created_by, updated_by, created_at, updated_at")
    .eq("id", paymentEntryId)
    .maybeSingle();

  if (loadError || !existingPayment) failSupplierPaymentEntry("Supplier payment not found.");
  if (!canManageSupplierPaymentEntry(profile, existingPayment.branch_id)) {
    failSupplierPaymentEntry("You do not have permission to edit this supplier payment.");
  }
  if (existingPayment.is_void) failSupplierPaymentEntry("Voided supplier payments cannot be edited.");

  let nextSupplierId = payload.supplier_id;
  let nextBranchId = normalizeRole(profile.role) === "branch_pic" ? existingPayment.branch_id : payload.branch_id;

  if (payload.supplier_purchase_entry_id) {
    const { data: linkedPurchase, error: linkedPurchaseError } = await adminSupabase
      .from("supplier_purchase_entries")
      .select("id, supplier_id, branch_id, is_void")
      .eq("id", payload.supplier_purchase_entry_id)
      .maybeSingle();
    if (linkedPurchaseError || !linkedPurchase) failSupplierPaymentEntry("Linked supplier purchase was not found.");
    if (linkedPurchase.is_void) failSupplierPaymentEntry("Voided supplier purchases cannot receive supplier payments.");
    if (normalizeRole(profile.role) === "branch_pic" && linkedPurchase.branch_id !== existingPayment.branch_id) {
      failSupplierPaymentEntry("Branch PIC cannot move supplier payments to another branch.");
    }
    nextSupplierId = linkedPurchase.supplier_id;
    nextBranchId = normalizeRole(profile.role) === "branch_pic" ? existingPayment.branch_id : linkedPurchase.branch_id;
  }

  if (!canManageSupplierPaymentEntry(profile, nextBranchId)) {
    failSupplierPaymentEntry(
      normalizeRole(profile.role) === "branch_pic"
        ? "Branch PIC cannot move supplier payments to another branch."
        : "You do not have permission to edit this supplier payment."
    );
  }

  if (payload.bank_account_id) {
    const { data: bankAccount, error: bankAccountError } = await adminSupabase
      .from("bank_accounts")
      .select("id, is_active")
      .eq("id", payload.bank_account_id)
      .eq("is_active", true)
      .maybeSingle();
    if (bankAccountError || !bankAccount) failSupplierPaymentEntry("Selected bank account is not active or not available.");
  }

  const timestamp = new Date().toISOString();
  const { data: updatedPayment, error } = await adminSupabase
    .from("supplier_payment_entries")
    .update({
      amount: payload.amount,
      bank_account_id: payload.bank_account_id,
      branch_id: nextBranchId,
      notes: payload.notes,
      payment_date: payload.payment_date,
      payment_method: payload.payment_method,
      reference_no: payload.reference_no,
      supplier_id: nextSupplierId,
      supplier_purchase_entry_id: payload.supplier_purchase_entry_id,
      updated_at: timestamp,
      updated_by: profile.id
    })
    .eq("id", existingPayment.id)
    .eq("is_void", false)
    .select("id, supplier_purchase_entry_id, supplier_id, branch_id, payment_date, payment_method, bank_account_id, amount, reference_no, notes, is_void, void_reason, voided_at, voided_by, created_by, updated_by, created_at, updated_at")
    .single();

  if (error || !updatedPayment) {
    console.error("updateSupplierPaymentEntry failed", {
      action: "updateSupplierPaymentEntry",
      paymentEntryId,
      linkedPurchaseId: payload.supplier_purchase_entry_id,
      role: normalizeRole(profile.role),
      profileBranchId: profile.branch_id,
      paymentBranchId: existingPayment.branch_id,
      submittedBranchId: payload.branch_id,
      code: error?.code,
      error: error?.message,
      details: error?.details,
      hint: error?.hint
    });
    failSupplierPaymentEntry("Supplier payment could not be updated.");
  }

  const beforeData = supplierPaymentEntryAuditData(existingPayment);
  const afterData = supplierPaymentEntryAuditData(updatedPayment);
  if (hasAuditChanges(beforeData, afterData)) {
    await logAuditEvent({
      action: "update",
      afterData,
      beforeData,
      bankAccountId: updatedPayment.bank_account_id,
      branchId: updatedPayment.branch_id,
      description: "Updated supplier payment entry.",
      entityId: updatedPayment.id,
      entityName: "supplier_payment_entries"
    });
  }

  revalidatePath("/suppliers/payments");
  revalidatePath("/purchases");
  revalidatePath("/dashboard");
  revalidatePath("/bank");
  revalidatePath("/reports/cashflow");
}

export async function voidSupplierPaymentEntry(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const profile = await requirePermission("view_supplier_payments");
  if (!isSupplierPaymentEntryManager(profile)) {
    failSupplierPaymentEntry("You do not have permission to void supplier payments.");
  }

  const paymentEntryId = String(formData.get("payment_entry_id") || "").trim();
  const reason = text(formData, "void_reason");
  if (!paymentEntryId) failSupplierPaymentEntry("Supplier payment entry is required.");
  if (!reason) failSupplierPaymentEntry("Void reason is required.");

  const adminSupabase = createAdminClient();
  const { data: existingPayment, error: loadError } = await adminSupabase
    .from("supplier_payment_entries")
    .select("id, supplier_purchase_entry_id, supplier_id, branch_id, payment_date, payment_method, bank_account_id, amount, reference_no, notes, is_void, void_reason, voided_at, voided_by, created_by, updated_by, created_at, updated_at")
    .eq("id", paymentEntryId)
    .maybeSingle();

  if (loadError || !existingPayment) failSupplierPaymentEntry("Supplier payment not found.");
  if (!canManageSupplierPaymentEntry(profile, existingPayment.branch_id)) {
    failSupplierPaymentEntry("You do not have permission to void this supplier payment.");
  }
  if (existingPayment.is_void) failSupplierPaymentEntry("Supplier payment is already voided.");

  const timestamp = new Date().toISOString();
  const { data: voidedPayment, error } = await adminSupabase
    .from("supplier_payment_entries")
    .update({
      is_void: true,
      updated_at: timestamp,
      updated_by: profile.id,
      void_reason: reason,
      voided_at: timestamp,
      voided_by: profile.id
    })
    .eq("id", existingPayment.id)
    .eq("is_void", false)
    .select("id, supplier_purchase_entry_id, supplier_id, branch_id, payment_date, payment_method, bank_account_id, amount, reference_no, notes, is_void, void_reason, voided_at, voided_by, created_by, updated_by, created_at, updated_at")
    .single();

  if (error || !voidedPayment) {
    console.error("voidSupplierPaymentEntry failed", {
      action: "voidSupplierPaymentEntry",
      paymentEntryId,
      role: normalizeRole(profile.role),
      profileBranchId: profile.branch_id,
      paymentBranchId: existingPayment.branch_id,
      code: error?.code,
      error: error?.message,
      details: error?.details,
      hint: error?.hint
    });
    failSupplierPaymentEntry("Supplier payment could not be voided.");
  }

  await logAuditEvent({
    action: "void",
    afterData: supplierPaymentEntryAuditData(voidedPayment),
    beforeData: supplierPaymentEntryAuditData(existingPayment),
    bankAccountId: voidedPayment.bank_account_id,
    branchId: voidedPayment.branch_id,
    description: `Voided supplier payment entry. Reason: ${reason}`,
    entityId: voidedPayment.id,
    entityName: "supplier_payment_entries"
  });

  revalidatePath("/suppliers/payments");
  revalidatePath("/purchases");
  revalidatePath("/dashboard");
  revalidatePath("/bank");
  revalidatePath("/reports/cashflow");
}

export async function createSupplierPurchase(formData: FormData) {
  if (!hasSupabaseEnv()) return;
  const branchId = text(formData, "branch_id");
  await requireEditableBranch(branchId);
  const supabase = await createClient();
  const invoiceDate = text(formData, "invoice_date") ?? text(formData, "purchase_date");
  if (!invoiceDate) throw new Error("Invoice date is required.");
  const termDays = Math.max(0, number(formData, "credit_term_days"));
  const calculatedDueDate = addDays(invoiceDate, termDays);

  const { data: purchase, error } = await supabase.from("supplier_purchases").insert({
    supplier_id: text(formData, "supplier_id"),
    branch_id: branchId,
    invoice_no: text(formData, "invoice_no"),
    invoice_date: invoiceDate,
    purchase_date: invoiceDate,
    credit_term_days: termDays,
    due_date: calculatedDueDate,
    category: text(formData, "category") as PurchaseCategory,
    medicine_cost: number(formData, "medicine_cost"),
    consumables_cost: number(formData, "consumables_cost"),
    other_cost: number(formData, "other_cost"),
    notes: text(formData, "notes"),
    entered_by: await getUserId()
  }).select("id, supplier_id, branch_id, invoice_no, invoice_date, purchase_date, credit_term_days, due_date, category, medicine_cost, consumables_cost, other_cost, attachment_path, notes").single();

  if (error || !purchase) throw error ?? new Error("Supplier purchase could not be loaded after creation.");

  await logAuditEvent({
    action: "create",
    afterData: supplierPurchaseAuditData(purchase),
    branchId: purchase.branch_id,
    description: "Created supplier purchase.",
    entityId: purchase.id,
    entityName: "supplier_purchases"
  });
  revalidatePath("/purchases");
  revalidatePath("/dashboard");
}

// Supplier purchases now use void + recreate from the UI. This action remains for history only.
export async function updateSupplierPurchase(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const failPurchaseEdit = (message: string): never => {
    redirect(`/purchases?error=${encodeURIComponent(message)}`);
  };

  const profile = await requirePermission("view_supplier_records");
  const role = normalizeRole(profile.role);
  const purchaseId = String(formData.get("purchase_id") || "").trim();
  const branchId = text(formData, "branch_id");
  const supplierId = text(formData, "supplier_id");
  const invoiceDate = text(formData, "invoice_date") ?? text(formData, "purchase_date");
  const purchaseDate = text(formData, "purchase_date") ?? invoiceDate;
  const manualDueDate = text(formData, "due_date");
  const termDays = Math.max(0, number(formData, "credit_term_days"));

  if (!purchaseId) failPurchaseEdit("Supplier purchase id is missing.");
  if (!branchId) failPurchaseEdit("Supplier purchase branch is required.");
  if (!supplierId) failPurchaseEdit("Supplier is required.");
  if (!invoiceDate || !purchaseDate) failPurchaseEdit("Invoice date is required.");

  const safePurchaseId = purchaseId;
  const safeBranchId = branchId as string;
  const safeSupplierId = supplierId as string;
  const safeInvoiceDate = invoiceDate as string;
  const safePurchaseDate = purchaseDate as string;

  const dueDate = manualDueDate || addDays(safeInvoiceDate, termDays);

  const supabase = await createClient();
  const { data: purchase, error: purchaseError } = await supabase
    .from("supplier_purchases")
    .select("id, supplier_id, branch_id, invoice_no, invoice_date, purchase_date, credit_term_days, due_date, category, medicine_cost, consumables_cost, other_cost, attachment_path, notes")
    .eq("id", safePurchaseId)
    .maybeSingle();

  if (purchaseError || !purchase) {
    console.error("updateSupplierPurchase load failed", {
      action: "updateSupplierPurchase",
      purchaseId: safePurchaseId,
      error: purchaseError?.message ?? "no row returned"
    });
    failPurchaseEdit("Supplier purchase not found.");
  }
  const existingPurchase = purchase as NonNullable<typeof purchase>;
  const nextBranchId = role === "branch_pic" ? existingPurchase.branch_id : safeBranchId;

  if (!canEditBranch(profile, existingPurchase.branch_id)) {
    console.error("updateSupplierPurchase permission denied", {
      action: "updateSupplierPurchase",
      purchaseId: safePurchaseId,
      role,
      profileBranchId: profile.branch_id,
      purchaseBranchId: existingPurchase.branch_id
    });
    failPurchaseEdit("You do not have permission to edit this supplier purchase.");
  }
  if (!canEditBranch(profile, nextBranchId)) {
    console.error("updateSupplierPurchase target branch denied", {
      action: "updateSupplierPurchase",
      purchaseId: safePurchaseId,
      role,
      profileBranchId: profile.branch_id,
      purchaseBranchId: existingPurchase.branch_id,
      submittedBranchId: safeBranchId,
      nextBranchId
    });
    failPurchaseEdit(role === "branch_pic"
      ? "Branch PIC cannot move supplier purchases to another branch."
      : "You do not have permission to edit this supplier purchase.");
  }

  const rpcParams = {
    p_purchase_id: existingPurchase.id,
    p_supplier_id: safeSupplierId,
    p_branch_id: nextBranchId,
    p_invoice_no: text(formData, "invoice_no"),
    p_invoice_date: safeInvoiceDate,
    p_purchase_date: safePurchaseDate,
    p_credit_term_days: termDays,
    p_due_date: dueDate,
    p_category: text(formData, "category") as PurchaseCategory,
    p_medicine_cost: number(formData, "medicine_cost"),
    p_consumables_cost: number(formData, "consumables_cost"),
    p_other_cost: number(formData, "other_cost"),
    p_notes: text(formData, "notes")
  };

  const { data: updatedPurchase, error } = await supabase.rpc("update_supplier_purchase", rpcParams);

  if (error) {
    console.error("updateSupplierPurchase update failed", {
      action: "updateSupplierPurchase",
      purchaseId: safePurchaseId,
      rpcParamKeys: Object.keys(rpcParams),
      role,
      profileBranchId: profile.branch_id,
      purchaseBranchId: existingPurchase.branch_id,
      submittedBranchId: safeBranchId,
      attemptedBranchId: nextBranchId,
      code: error.code,
      error: error.message,
      details: error.details,
      hint: error.hint
    });
    failPurchaseEdit(supplierPurchaseRpcErrorMessage(error));
  }
  if (!updatedPurchase) {
    console.error("updateSupplierPurchase update returned no rows", {
      action: "updateSupplierPurchase",
      purchaseId: safePurchaseId,
      error: "no row returned",
      role,
      profileBranchId: profile.branch_id,
      purchaseBranchId: existingPurchase.branch_id,
      attemptedBranchId: nextBranchId
    });
    failPurchaseEdit("You do not have permission to edit this supplier purchase.");
  }
  const savedPurchase = updatedPurchase as NonNullable<typeof updatedPurchase>;

  const beforeData = supplierPurchaseAuditData(existingPurchase);
  const afterData = supplierPurchaseAuditData(savedPurchase);
  if (hasAuditChanges(beforeData, afterData)) {
    await logAuditEvent({
      action: "update",
      afterData,
      beforeData,
      branchId: savedPurchase.branch_id,
      description: "Edited supplier purchase.",
      entityId: savedPurchase.id,
      entityName: "supplier_purchases"
    });
  }

  revalidatePath("/purchases");
  revalidatePath("/dashboard");
}

function supplierPurchaseVoidRpcErrorMessage(error: {
  code?: string | null;
  details?: string | null;
  hint?: string | null;
  message?: string | null;
}) {
  const message = error.message ?? "";
  const details = error.details ?? "";
  const hint = error.hint ?? "";
  const haystack = `${message} ${details} ${hint}`.toLowerCase();

  if (error.code === "PGRST202" || haystack.includes("could not find the function public.void_supplier_purchase")) {
    return "Supplier purchase void function is unavailable. Run the latest Supabase migration.";
  }
  if (haystack.includes("stack depth limit exceeded")) {
    return "Supplier purchase void policy is still recursive. Run the latest supplier purchase void RPC migration.";
  }
  if (error.code === "42501" || haystack.includes("permission")) {
    return "You do not have permission to void this supplier purchase.";
  }
  if (error.code === "P0002" || haystack.includes("supplier purchase not found")) {
    return "Supplier purchase not found.";
  }
  if (haystack.includes("already voided")) {
    return "Supplier purchase is already voided.";
  }

  return "Supplier purchase could not be voided. Please try again.";
}

export async function voidSupplierPurchase(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const failSupplierPurchaseVoid = (message: string): never => {
    redirect(`/purchases?error=${encodeURIComponent(message)}`);
  };

  const profile = await requirePermission("view_supplier_records");
  const role = normalizeRole(profile.role);
  const purchaseId = String(formData.get("purchase_id") || "").trim();
  const reason = text(formData, "void_reason");

  if (!purchaseId) failSupplierPurchaseVoid("Supplier purchase record is required.");
  if (!reason) failSupplierPurchaseVoid("Void reason is required.");

  const supabase = await createClient();
  const adminSupabase = createAdminClient();
  const { data: purchase, error: purchaseError } = await supabase
    .from("supplier_purchases")
    .select("id, supplier_id, branch_id, invoice_no, invoice_date, purchase_date, credit_term_days, due_date, category, medicine_cost, consumables_cost, other_cost, attachment_path, notes, is_void, void_reason, voided_at, voided_by")
    .eq("id", purchaseId)
    .maybeSingle();

  let existingPurchase = purchase as NonNullable<typeof purchase> | null;
  if (purchaseError || !existingPurchase) {
    const { data: adminPurchase, error: adminPurchaseError } = await adminSupabase
      .from("supplier_purchases")
      .select("id, supplier_id, branch_id, invoice_no, invoice_date, purchase_date, credit_term_days, due_date, category, medicine_cost, consumables_cost, other_cost, attachment_path, notes, is_void, void_reason, voided_at, voided_by")
      .eq("id", purchaseId)
      .maybeSingle();

    if (adminPurchaseError || !adminPurchase) {
      console.error("voidSupplierPurchase load failed", {
        action: "voidSupplierPurchase",
        purchaseId,
        error: adminPurchaseError?.message ?? purchaseError?.message ?? "no row returned"
      });
      failSupplierPurchaseVoid("Supplier purchase not found.");
    }
    existingPurchase = adminPurchase;
  }
  const safePurchase = existingPurchase as NonNullable<typeof existingPurchase>;

  if (!canEditBranch(profile, safePurchase.branch_id)) {
    failSupplierPurchaseVoid("You do not have permission to void this supplier purchase.");
  }
  if (safePurchase.is_void) {
    failSupplierPurchaseVoid("Supplier purchase is already voided.");
  }

  const voidedAt = new Date().toISOString();
  const { data: voidedPurchaseId, error } = await adminSupabase
    .from("supplier_purchases")
    .update({
      is_void: true,
      void_reason: reason,
      voided_at: voidedAt,
      voided_by: profile.id,
      updated_at: voidedAt
    })
    .eq("id", safePurchase.id)
    .eq("is_void", false)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("voidSupplierPurchase failed", {
      action: "voidSupplierPurchase",
      purchaseId,
      role,
      profileBranchId: profile.branch_id,
      purchaseBranchId: safePurchase.branch_id,
      code: error.code,
      error: error.message,
      details: error.details,
      hint: error.hint
    });
    failSupplierPurchaseVoid(supplierPurchaseVoidRpcErrorMessage(error));
  }
  if (!voidedPurchaseId) {
    console.error("voidSupplierPurchase returned no rows", {
      action: "voidSupplierPurchase",
      purchaseId,
      error: "no row returned"
    });
    failSupplierPurchaseVoid("Supplier purchase could not be voided. Please try again.");
  }
  const safeVoidedPurchaseId = voidedPurchaseId as NonNullable<typeof voidedPurchaseId>;

  const beforeData = supplierPurchaseAuditData(safePurchase);
  const afterData = supplierPurchaseAuditData({
    ...safePurchase,
    is_void: true,
    void_reason: reason,
    voided_at: voidedAt,
    voided_by: profile.id
  });
  await logAuditEvent({
    action: "void",
    afterData,
    beforeData,
    branchId: safePurchase.branch_id,
    description: `Voided supplier purchase. Reason: ${reason}`,
    entityId: safeVoidedPurchaseId.id,
    entityName: "supplier_purchases"
  });

  revalidatePath("/purchases");
  revalidatePath("/dashboard");
  revalidatePath("/reports/profit-loss");
  revalidatePath("/suppliers/payments");
}

export async function createSupplierPayment(formData: FormData) {
  if (!hasSupabaseEnv()) return;
  const supabase = await createClient();
  const supplierId = text(formData, "supplier_id");
  const purchaseId = text(formData, "purchase_id");
  const submittedBranchId = text(formData, "branch_id");
  const paymentType = (text(formData, "payment_type") as PaymentType) ?? "bank_transfer";
  const bankAccountId = text(formData, "bank_account_id");
  const paymentDate = text(formData, "payment_date");
  const amount = number(formData, "amount");
  if (!supplierId) throw new Error("Supplier is required.");
  if (!paymentDate) throw new Error("Payment date is required.");
  if (amount <= 0) throw new Error("Amount must be greater than zero.");
  let resolvedBranchId = submittedBranchId;

  if (purchaseId) {
    const { data: purchase, error } = await supabase
      .from("supplier_purchases")
      .select("branch_id")
      .eq("id", purchaseId)
      .single();

    if (error || !purchase) throw new Error("Selected supplier purchase was not found.");
    resolvedBranchId = submittedBranchId ?? purchase.branch_id;
  }

  const profile = await requirePermission("view_supplier_payments");
  const canRecordPayment = resolvedBranchId ? canEditBranch(profile, resolvedBranchId) : canViewAllBranches(profile);
  if (!canRecordPayment) {
    throw new Error("You do not have permission to record supplier payments for this branch.");
  }
  if (paymentUsesBankAccount(paymentType) && !bankAccountId) {
    throw new Error("Paid from bank account is required for bank-based supplier payments.");
  }
  if (bankAccountId) {
    await requireBankAccountPermission(bankAccountId, "create_transaction");
    const { data: bankAccount, error: bankError } = await supabase
      .from("bank_accounts")
      .select("id, name, is_active")
      .eq("id", bankAccountId)
      .eq("is_active", true)
      .maybeSingle();
    if (bankError || !bankAccount) throw new Error("Selected paid from bank account is not active or not available.");
  }

  const { data: payment, error } = await supabase.from("supplier_payments").insert({
    supplier_id: supplierId,
    purchase_id: purchaseId,
    branch_id: resolvedBranchId,
    bank_account_id: bankAccountId,
    payment_date: paymentDate,
    payment_type: paymentType,
    amount,
    reference_no: text(formData, "reference_no"),
    notes: text(formData, "notes"),
    entered_by: await getUserId()
  }).select("id, supplier_id, purchase_id, branch_id, bank_account_id, payment_date, payment_type, amount, reference_no, receipt_path, notes, bank_accounts(name)").single();

  if (error || !payment) throw error ?? new Error("Supplier payment could not be loaded after creation.");

  const bankRelation = firstRelation(payment.bank_accounts as { name?: string } | { name?: string }[] | null | undefined);
  const bankName = bankRelation?.name ?? "selected bank account";
  await logAuditEvent({
    action: "create",
    afterData: supplierPaymentAuditData(payment),
    bankAccountId: payment.bank_account_id,
    branchId: payment.branch_id,
    description: `Supplier payment recorded from ${bankName}.`,
    entityId: payment.id,
    entityName: "supplier_payments"
  });
  revalidatePath("/suppliers/payments");
  revalidatePath("/bank");
  revalidatePath("/reports/cashflow");
  revalidatePath("/dashboard");
}

export async function createPanelCompany(formData: FormData) {
  if (!hasSupabaseEnv()) return;
  await requireMasterDataManager();
  const supabase = await createClient();
  const { data: company, error } = await supabase.from("panel_companies").insert({
    name: text(formData, "name"),
    contact_person: text(formData, "contact_person"),
    phone: text(formData, "phone"),
    email: text(formData, "email"),
    address: text(formData, "address"),
    notes: text(formData, "notes"),
    is_active: booleanText(formData, "is_active", true),
    payment_terms_days: number(formData, "payment_terms_days") || 30
  }).select("id, name, contact_person, phone, email, address, notes, payment_terms_days, is_active").single();

  if (error || !company) throw error ?? new Error("Panel company could not be loaded after creation.");

  await logAuditEvent({
    action: "create",
    afterData: panelCompanyAuditData(company),
    description: `Created panel company ${company.name}.`,
    entityId: company.id,
    entityName: "panel_companies"
  });
  revalidatePath("/panels");
}

export async function updatePanelCompany(formData: FormData) {
  if (!hasSupabaseEnv()) return;
  await requireMasterDataManager();

  const panelCompanyId = text(formData, "panel_company_id");
  if (!panelCompanyId) throw new Error("Panel company record is required.");

  const supabase = await createClient();
  const { data: company, error: companyError } = await supabase
    .from("panel_companies")
    .select("id, name, contact_person, phone, email, address, notes, payment_terms_days, is_active")
    .eq("id", panelCompanyId)
    .maybeSingle();

  if (companyError || !company) throw new Error("Panel company record not found.");

  const { data: updatedCompany, error } = await supabase
    .from("panel_companies")
    .update({
      address: text(formData, "address"),
      contact_person: text(formData, "contact_person"),
      email: text(formData, "email"),
      is_active: booleanText(formData, "is_active", true),
      name: text(formData, "name"),
      notes: text(formData, "notes"),
      payment_terms_days: number(formData, "payment_terms_days") || 30,
      phone: text(formData, "phone")
    })
    .eq("id", company.id)
    .select("id, name, contact_person, phone, email, address, notes, payment_terms_days, is_active")
    .single();

  if (error || !updatedCompany) throw error ?? new Error("Updated panel company could not be loaded.");

  const beforeData = panelCompanyAuditData(company);
  const afterData = panelCompanyAuditData(updatedCompany);
  if (hasAuditChanges(beforeData, afterData)) {
    await logAuditEvent({
      action: "update",
      afterData,
      beforeData,
      description: `Updated panel company ${updatedCompany.name}.`,
      entityId: updatedCompany.id,
      entityName: "panel_companies"
    });
  }

  revalidatePath("/panels");
}

export async function createPanelClaim(formData: FormData) {
  if (!hasSupabaseEnv()) return failPanelManager("Supabase environment is not configured.");
  const branchId = text(formData, "branch_id");
  if (!branchId) failPanelManager("Panel claim branch is required.");
  await requireEditableBranch(branchId);
  const supabase = await createClient();
  const { data: claim, error } = await supabase.from("panel_claims").insert({
    panel_company_id: text(formData, "panel_company_id"),
    branch_id: branchId,
    claim_no: text(formData, "claim_no"),
    claim_month: text(formData, "claim_month"),
    submitted_date: text(formData, "submitted_date"),
    due_date: text(formData, "due_date"),
    amount: number(formData, "amount"),
    status: text(formData, "status") ?? "unpaid",
    notes: text(formData, "notes"),
    entered_by: await getUserId()
  }).select("id, panel_company_id, branch_id, claim_no, claim_month, submitted_date, due_date, amount, status, notes").single();

  if (error || !claim) {
    console.error("createPanelClaim failed", {
      action: "createPanelClaim",
      branchId,
      code: error?.code,
      error: error?.message,
      details: error?.details
    });
    failPanelManager("Panel claim could not be saved.");
  }

  await logAuditEvent({
    action: "create",
    afterData: panelClaimAuditData(claim),
    branchId: claim.branch_id,
    description: "Created panel claim.",
    entityId: claim.id,
    entityName: "panel_claims"
  });
  revalidatePath("/panels");
  revalidatePath("/dashboard");
}

export async function updatePanelClaim(formData: FormData) {
  if (!hasSupabaseEnv()) return failPanelManager("Supabase environment is not configured.");

  const profile = await requirePermission("view_panel_records");
  const role = normalizeRole(profile.role);
  const claimId = text(formData, "claim_id");
  const branchId = text(formData, "branch_id");

  if (!claimId) failPanelManager("Panel claim id is missing.");
  if (!branchId) failPanelManager("Panel claim branch is required.");
  const claimNo = text(formData, "claim_no");
  const claim = await loadPanelClaimForMutation(claimId, profile, "updatePanelClaim", claimNo);
  if (!claim) failPanelManager("Panel claim record not found.");
  if (!canEditBranch(profile, claim.branch_id)) {
    failPanelManager(role === "branch_pic"
      ? "You do not have permission to update this panel claim."
      : "You do not have permission to update this panel claim.");
  }
  if (!canEditBranch(profile, branchId)) {
    failPanelManager(role === "branch_pic"
      ? "Branch PIC cannot move panel claims to another branch."
      : "You do not have permission to assign this panel claim to the selected branch.");
  }
  if (claim.is_void) failPanelManager("Voided panel claims cannot be edited.");
  const claimMonth = text(formData, "claim_month");
  if (!claimMonth) failPanelManager("Claim month is required.");
  const amount = number(formData, "amount");
  if (amount < 0) failPanelManager("Amount must be zero or more.");
  const panelCompanyId = text(formData, "panel_company_id");
  if (!panelCompanyId) failPanelManager("Panel company is required.");
  const submittedDate = text(formData, "submitted_date");
  const dueDate = text(formData, "due_date");
  const status = text(formData, "status") ?? "unpaid";
  const attemptedPayload = {
    panel_company_id: panelCompanyId,
    branch_id: branchId,
    claim_no: text(formData, "claim_no"),
    claim_month: claimMonth,
    submitted_date: submittedDate,
    due_date: dueDate,
    amount,
    status,
    notes: text(formData, "notes")
  };

  const admin = createAdminClient();
  const { data: updatedClaim, error } = await admin
    .from("panel_claims")
    .update(attemptedPayload)
    .eq("id", claim.id)
    .select("id, panel_company_id, branch_id, claim_no, claim_month, submitted_date, due_date, amount, status, notes, is_void, void_reason, voided_at, voided_by")
    .maybeSingle();

  if (error || !updatedClaim) {
    console.error("updatePanelClaim failed", {
      action: "updatePanelClaim",
      userId: profile.id,
      role,
      claimId,
      claimNo: claim.claim_no ?? claimNo,
      userBranchId: profile.branch_id ?? null,
      branchId: claim.branch_id,
      nextBranchId: branchId,
      payloadKeys: Object.keys(attemptedPayload),
      code: error?.code,
      error: error?.message,
      details: error?.details,
      hint: error?.hint
    });
    failPanelManager(error?.code === "42501"
      ? "You do not have permission to update this panel claim."
      : error?.message ?? "Panel claim could not be updated.");
  }

  const beforeData = panelClaimAuditData(claim);
  const afterData = panelClaimAuditData(updatedClaim);
  if (hasAuditChanges(beforeData, afterData)) {
    await logAuditEvent({
      action: "update",
      afterData,
      beforeData,
      branchId: updatedClaim.branch_id,
      description: "Edited panel claim.",
      entityId: updatedClaim.id,
      entityName: "panel_claims"
    });
  }

  revalidatePath("/panels");
  revalidatePath("/dashboard");
}

export async function voidPanelClaim(formData: FormData) {
  if (!hasSupabaseEnv()) return failPanelManager("Supabase environment is not configured.");

  const profile = await requirePermission("view_panel_records");
  const role = normalizeRole(profile.role);
  const claimId = text(formData, "claim_id");
  const reason = text(formData, "void_reason");

  if (!claimId) failPanelManager("Panel claim id is missing.");
  if (!reason) failPanelManager("Void reason is required.");
  const claim = await loadPanelClaimForMutation(claimId, profile, "voidPanelClaim");
  if (!claim) failPanelManager("Panel claim record not found.");
  if (!canEditBranch(profile, claim.branch_id)) {
    failPanelManager(role === "branch_pic"
      ? "You do not have permission to update this panel claim."
      : "You do not have permission to update this panel claim.");
  }
  if (claim.is_void) failPanelManager("Panel claim is already voided.");

  const voidedAt = new Date().toISOString();
  const attemptedPayload = {
    is_void: true,
    void_reason: reason,
    voided_at: voidedAt,
    voided_by: profile.id
  };

  const admin = createAdminClient();
  const { data: updatedClaim, error } = await admin
    .from("panel_claims")
    .update(attemptedPayload)
    .eq("id", claim.id)
    .eq("is_void", false)
    .select("id, panel_company_id, branch_id, claim_no, claim_month, submitted_date, due_date, amount, status, notes, is_void, void_reason, voided_at, voided_by")
    .maybeSingle();

  if (error || !updatedClaim) {
    console.error("voidPanelClaim failed", {
      action: "voidPanelClaim",
      userId: profile.id,
      role,
      claimId,
      claimNo: claim.claim_no ?? null,
      userBranchId: profile.branch_id ?? null,
      branchId: claim.branch_id,
      payloadKeys: Object.keys(attemptedPayload),
      code: error?.code,
      error: error?.message,
      details: error?.details,
      hint: error?.hint
    });
    failPanelManager(error?.code === "42501"
      ? "You do not have permission to update this panel claim."
      : error?.message ?? "Panel claim could not be voided.");
  }

  await logAuditEvent({
    action: "void",
    afterData: panelClaimAuditData(updatedClaim),
    beforeData: panelClaimAuditData(claim),
    branchId: updatedClaim.branch_id,
    description: `Voided panel claim. Reason: ${reason}`,
    entityId: updatedClaim.id,
    entityName: "panel_claims"
  });

  revalidatePath("/panels");
  revalidatePath("/dashboard");
}

export async function createPanelPayment(formData: FormData) {
  if (!hasSupabaseEnv()) return failPanelManager("Supabase environment is not configured.");
  const panelClaimId = text(formData, "panel_claim_id");
  const paymentType = (text(formData, "payment_type") as PaymentType) ?? "bank_transfer";
  const bankAccountId = text(formData, "bank_account_id");
  const paymentDate = text(formData, "payment_date");
  const amount = number(formData, "amount");
  if (!panelClaimId) failPanelManager("Panel claim is required.");
  if (!paymentDate) failPanelManager("Payment date is required.");
  if (amount <= 0) failPanelManager("Amount must be greater than zero.");

  const supabase = await createClient();
  const { data: claim, error: claimError } = await supabase
    .from("panel_claims")
    .select("id, branch_id, panel_company_id, is_void, branches(name, code)")
    .eq("id", panelClaimId)
    .maybeSingle();
  if (claimError || !claim) failPanelManager("Selected panel claim was not found.");
  if (claim.is_void) failPanelManager("Voided panel claims cannot receive panel payments.");
  const claimBranch = firstRelation(claim.branches as { name?: string | null; code?: string | null } | { name?: string | null; code?: string | null }[] | null | undefined);

  const profile = await requireEditableBranch(claim.branch_id);
  if (paymentUsesBankAccount(paymentType) && !bankAccountId) {
    failPanelManager("Received into bank account is required for bank-based panel payments.");
  }
  let bankAccount: { id: string; name: string; is_active: boolean } | null = null;
  if (bankAccountId) {
    bankAccount = await requirePanelPaymentBankAccount(profile, bankAccountId, claimBranch, claim.branch_id, claim.id);
  }

  const { data: payment, error } = await supabase.from("panel_payments").insert({
    panel_claim_id: panelClaimId,
    bank_account_id: bankAccountId,
    payment_date: paymentDate,
    amount,
    payment_type: paymentType,
    reference_no: text(formData, "reference_no"),
    notes: text(formData, "notes"),
    entered_by: await getUserId()
  }).select("id, panel_claim_id, payment_date, amount, payment_type, reference_no, notes, bank_account_id, bank_accounts(name), panel_claims(branch_id)").single();
  if (error || !payment) {
    console.error("createPanelPayment failed", {
      action: "createPanelPayment",
      panelClaimId,
      bankAccountId,
      code: error?.code,
      error: error?.message,
      details: error?.details
    });
    failPanelManager("Panel payment could not be saved.");
  }
  const panelClaimRelation = firstRelation(payment.panel_claims as { branch_id?: string | null } | { branch_id?: string | null }[] | null | undefined);
  const panelBankRelation = firstRelation(payment.bank_accounts as { name?: string } | { name?: string }[] | null | undefined);

  await logAuditEvent({
    action: "create",
    afterData: panelPaymentAuditData({
      amount: payment.amount,
      bank_account_id: payment.bank_account_id,
      branch_id: panelClaimRelation?.branch_id ?? null,
      notes: payment.notes ?? null,
      panel_claim_id: payment.panel_claim_id,
      payment_date: payment.payment_date,
      payment_type: payment.payment_type,
      reference_no: payment.reference_no ?? null
    }),
    bankAccountId: payment.bank_account_id,
    branchId: panelClaimRelation?.branch_id ?? null,
    description: `Panel payment received into ${panelBankRelation?.name ?? bankAccount?.name ?? "selected bank account"}.`,
    entityId: payment.id,
    entityName: "panel_payments"
  });

  revalidatePath("/panels");
  revalidatePath("/bank");
  revalidatePath("/reports/cashflow");
  revalidatePath("/dashboard");
}

export async function updatePanelPayment(formData: FormData) {
  if (!hasSupabaseEnv()) return failPanelManager("Supabase environment is not configured.");

  const panelPaymentId = text(formData, "panel_payment_id");
  const panelClaimId = text(formData, "panel_claim_id");
  const paymentType = (text(formData, "payment_type") as PaymentType) ?? "bank_transfer";
  const bankAccountId = text(formData, "bank_account_id");
  const paymentDate = text(formData, "payment_date");
  const amount = number(formData, "amount");
  if (!panelPaymentId) failPanelManager("Panel payment record is required.");
  if (!panelClaimId) failPanelManager("Panel claim is required.");
  if (!paymentDate) failPanelManager("Payment date is required.");
  if (amount <= 0) failPanelManager("Amount must be greater than zero.");

  const supabase = await createClient();
  const { data: existingPayment, error: paymentError } = await supabase
    .from("panel_payments")
    .select("id, panel_claim_id, payment_date, amount, payment_type, reference_no, notes, bank_account_id, panel_claims(branch_id)")
    .eq("id", panelPaymentId)
    .maybeSingle();
  if (paymentError || !existingPayment) failPanelManager("Panel payment record not found.");

  const { data: claim, error: claimError } = await supabase
    .from("panel_claims")
    .select("id, branch_id, is_void, branches(name, code)")
    .eq("id", panelClaimId)
    .maybeSingle();
  if (claimError || !claim) failPanelManager("Selected panel claim was not found.");
  if (claim.is_void) failPanelManager("Voided panel claims cannot receive panel payments.");
  const claimBranch = firstRelation(claim.branches as { name?: string | null; code?: string | null } | { name?: string | null; code?: string | null }[] | null | undefined);

  const profile = await requireEditableBranch(claim.branch_id);
  if (paymentUsesBankAccount(paymentType) && !bankAccountId) {
    failPanelManager("Received into bank account is required for bank-based panel payments.");
  }
  if (bankAccountId) {
    await requirePanelPaymentBankAccount(profile, bankAccountId, claimBranch, claim.branch_id, claim.id);
  }

  const { data: updatedPayment, error } = await supabase
    .from("panel_payments")
    .update({
      panel_claim_id: panelClaimId,
      bank_account_id: bankAccountId,
      payment_date: paymentDate,
      amount,
      payment_type: paymentType,
      reference_no: text(formData, "reference_no"),
      notes: text(formData, "notes")
    })
    .eq("id", panelPaymentId)
    .select("id, panel_claim_id, payment_date, amount, payment_type, reference_no, notes, bank_account_id, panel_claims(branch_id)")
    .maybeSingle();

  if (error || !updatedPayment) {
    console.error("updatePanelPayment failed", {
      action: "updatePanelPayment",
      panelPaymentId,
      panelClaimId,
      bankAccountId,
      code: error?.code,
      error: error?.message,
      details: error?.details
    });
    failPanelManager("Panel payment could not be updated.");
  }

  const previousClaim = firstRelation(existingPayment.panel_claims as { branch_id?: string | null } | { branch_id?: string | null }[] | null | undefined);
  const nextClaim = firstRelation(updatedPayment.panel_claims as { branch_id?: string | null } | { branch_id?: string | null }[] | null | undefined);
  const beforeData = panelPaymentAuditData({
    amount: existingPayment.amount,
    bank_account_id: existingPayment.bank_account_id ?? null,
    branch_id: previousClaim?.branch_id ?? null,
    notes: existingPayment.notes ?? null,
    panel_claim_id: existingPayment.panel_claim_id,
    payment_date: existingPayment.payment_date,
    payment_type: existingPayment.payment_type,
    reference_no: existingPayment.reference_no ?? null
  });
  const afterData = panelPaymentAuditData({
    amount: updatedPayment.amount,
    bank_account_id: updatedPayment.bank_account_id ?? null,
    branch_id: nextClaim?.branch_id ?? null,
    notes: updatedPayment.notes ?? null,
    panel_claim_id: updatedPayment.panel_claim_id,
    payment_date: updatedPayment.payment_date,
    payment_type: updatedPayment.payment_type,
    reference_no: updatedPayment.reference_no ?? null
  });

  if (hasAuditChanges(beforeData, afterData)) {
    await logAuditEvent({
      action: "update",
      afterData,
      beforeData,
      bankAccountId: updatedPayment.bank_account_id ?? null,
      branchId: nextClaim?.branch_id ?? null,
      description: "Updated panel payment.",
      entityId: updatedPayment.id,
      entityName: "panel_payments"
    });
  }

  revalidatePath("/panels");
  revalidatePath("/bank");
  revalidatePath("/reports/cashflow");
  revalidatePath("/dashboard");
}

export async function importFinanceRows(type: ImportType, payloads: ImportPayload[]) {
  if (!hasSupabaseEnv() || !payloads.length) return;
  if (type === "opening_balances") {
    await requireOpeningBalanceOwner();
  } else {
    await requirePermission("import_data");
  }

  const config = importConfigs[type];
  if (!config) throw new Error("Select a valid import type.");

  const enteredBy = await getUserId();
  const supabase = await createClient();
  const { data, error } = type === "opening_balances"
    ? await supabase.from("opening_balances").insert(payloads.map((payload) => ({
        ...payload,
        created_by: enteredBy,
        ...(payload.verification_status === "confirmed"
          ? { reviewed_at: new Date().toISOString(), reviewed_by: enteredBy }
          : {}),
        updated_by: enteredBy
      }))).select("*")
    : await supabase.from(type).insert(payloads.map((payload) => ({ ...payload, entered_by: enteredBy }))).select("*");

  if (error || !data) throw error ?? new Error("Imported rows could not be loaded.");

  await Promise.all(data.map((row) => {
    const record = row as Record<string, unknown> & { bank_account_id?: unknown; branch_id?: unknown; id?: unknown };
    return logAuditEvent({
      action: "create",
      afterData: importAuditData(type, record),
      bankAccountId: typeof record.bank_account_id === "string" ? record.bank_account_id : null,
      branchId: typeof record.branch_id === "string" ? record.branch_id : null,
      description: type === "opening_balances" ? "Imported opening balance." : `Imported ${config.label} row.`,
      entityId: typeof record.id === "string" ? record.id : null,
      entityName: config.table
    });
  }));

  for (const path of importRevalidationPaths(type)) {
    revalidatePath(path);
  }
}

export async function updateUserProfile(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const actor = await requirePermission("manage_users");
  const targetId = text(formData, "user_id");
  const fullName = text(formData, "full_name");
  const nextRole = text(formData, "role") as UserRole | null;
  const branchId = text(formData, "branch_id");
  const isActive = formData.get("is_active") === "true";

  if (!targetId || !fullName || !nextRole) {
    throw new Error("Missing user, name, or role.");
  }

  const supabase = await createClient();
  const { data: target, error: targetError } = await supabase
    .from("profiles")
    .select("id, full_name, role, branch_id, is_active")
    .eq("id", targetId)
    .single();

  if (targetError || !target) throw new Error("User profile not found.");
  if (!canManageTargetProfile(actor, target, nextRole)) {
    throw new Error("You do not have permission to update this user.");
  }

  const { data: updatedTarget, error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      role: nextRole,
      branch_id: branchId,
      is_active: isActive
    })
    .eq("id", targetId)
    .select("id, full_name, role, branch_id, is_active")
    .single();

  if (error || !updatedTarget) throw error ?? new Error("Updated user profile could not be loaded.");

  const beforeData = userProfileAuditData(target);
  const afterData = userProfileAuditData(updatedTarget);
  if (hasAuditChanges(beforeData, afterData)) {
    const roleChanged = target.role !== updatedTarget.role;
    await logAuditEvent({
      action: roleChanged ? "role_change" : "update",
      afterData,
      beforeData,
      branchId: updatedTarget.branch_id,
      description: roleChanged
        ? `Changed role for ${updatedTarget.full_name} from ${target.role} to ${updatedTarget.role}.`
        : `Updated access profile for ${updatedTarget.full_name}.`,
      entityId: updatedTarget.id,
      entityName: "profiles"
    });
  }
  revalidatePath("/users");
}

export async function updateUserBankPermissions(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const actor = await requirePermission("manage_users");
  if (!canManageBankPermissions(actor)) {
    throw new Error("Only Owner can assign bank account permissions.");
  }

  const targetId = text(formData, "user_id");
  const bankAccountIds = formData.getAll("bank_account_ids").filter((value): value is string => typeof value === "string" && Boolean(value));
  if (!targetId) throw new Error("Missing user.");

  const supabase = await createClient();
  const { data: target, error: targetError } = await supabase
    .from("profiles")
    .select("id, full_name, role, branch_id, is_active")
    .eq("id", targetId)
    .single();

  if (targetError || !target) throw new Error("User profile not found.");
  const targetRole = normalizeRole(target.role);
  if (targetRole !== "admin" && targetRole !== "finance" && targetRole !== "branch_pic") {
    throw new Error("Bank account permissions can only be assigned to Admin, Finance, or Branch PIC users.");
  }

  const { data: currentPermissions, error: currentPermissionsError } = await supabase
    .from("bank_account_permissions")
    .select("id, user_id, bank_account_id, can_view, can_create_transaction, can_edit_transaction, can_manage_account")
    .eq("user_id", targetId);

  if (currentPermissionsError) throw currentPermissionsError;

  const grants = bankAccountIds
    .map((bankAccountId) => {
      const canView = checked(formData, `bank_permission_${bankAccountId}_view`);
      const canCreateTransaction = checked(formData, `bank_permission_${bankAccountId}_create`);
      const canEditTransaction = checked(formData, `bank_permission_${bankAccountId}_edit`);
      const canManageAccount = checked(formData, `bank_permission_${bankAccountId}_manage`);
      if (!canView && !canCreateTransaction && !canEditTransaction && !canManageAccount) return null;
      return {
        user_id: targetId,
        bank_account_id: bankAccountId,
        can_view: canView,
        can_create_transaction: canCreateTransaction,
        can_edit_transaction: canEditTransaction,
        can_manage_account: canManageAccount,
        granted_by: actor.id
      };
    })
    .filter((grant): grant is NonNullable<typeof grant> => Boolean(grant));

  const { error: deleteError } = await supabase.from("bank_account_permissions").delete().eq("user_id", targetId);
  if (deleteError) throw deleteError;

  let insertedPermissions: (BankPermissionAuditRow & { id: string })[] = [];
  if (grants.length) {
    const { data, error: insertError } = await supabase
      .from("bank_account_permissions")
      .insert(grants)
      .select("id, user_id, bank_account_id, can_view, can_create_transaction, can_edit_transaction, can_manage_account");

    if (insertError) throw insertError;
    insertedPermissions = (data ?? []) as (BankPermissionAuditRow & { id: string })[];
  }

  const previousByAccount = new Map((currentPermissions ?? []).map((permission) => [permission.bank_account_id, permission]));
  const insertedByAccount = new Map(insertedPermissions.map((permission) => [permission.bank_account_id, permission]));
  const changedBankAccountIds = new Set([...previousByAccount.keys(), ...insertedByAccount.keys()]);

  await Promise.all([...changedBankAccountIds].map((bankAccountId) => {
    const beforePermission = previousByAccount.get(bankAccountId);
    const afterPermission = insertedByAccount.get(bankAccountId);
    const beforeData = beforePermission ? bankPermissionAuditData(beforePermission) : null;
    const afterData = afterPermission ? bankPermissionAuditData(afterPermission) : null;

    if (beforeData && afterData && !hasAuditChanges(beforeData, afterData)) return Promise.resolve();

    return logAuditEvent({
      action: "permission_change",
      afterData,
      bankAccountId,
      beforeData,
      branchId: target.branch_id,
      description: beforeData && afterData
        ? `Changed bank access for ${target.full_name}.`
        : afterData
          ? `Granted bank access to ${target.full_name}.`
          : `Revoked bank access from ${target.full_name}.`,
      entityId: afterPermission?.id ?? beforePermission?.id ?? null,
      entityName: "bank_account_permissions"
    });
  }));

  revalidatePath("/users");
  revalidatePath("/bank");
  revalidatePath("/cash-bank-ins");
}

export async function upsertBankAccountPermission(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const actor = await requirePermission("manage_users");
  if (!canManageBankPermissions(actor)) {
    throw new Error("Only Owner can assign bank account permissions.");
  }

  const userId = text(formData, "user_id");
  const bankAccountId = text(formData, "bank_account_id");
  if (!userId || !bankAccountId) throw new Error("User and bank account are required.");

  const canView = checked(formData, "can_view");
  const canCreateTransaction = checked(formData, "can_create_transaction");
  const canEditTransaction = checked(formData, "can_edit_transaction");
  const canManageAccount = checked(formData, "can_manage_account");

  if (!canView && !canCreateTransaction && !canEditTransaction && !canManageAccount) {
    throw new Error("Select at least one access level.");
  }

  const supabase = await createClient();
  const { data: target, error: targetError } = await supabase
    .from("profiles")
    .select("id, full_name, role, branch_id")
    .eq("id", userId)
    .single();

  if (targetError || !target) throw new Error("User profile not found.");
  const targetRole = normalizeRole(target.role);
  if (targetRole === "owner" || targetRole === "staff") {
    throw new Error("Bank account access can only be granted to Admin, Finance, or Branch PIC users.");
  }

  const { data: existingPermission, error: existingPermissionError } = await supabase
    .from("bank_account_permissions")
    .select("id, user_id, bank_account_id, can_view, can_create_transaction, can_edit_transaction, can_manage_account")
    .eq("user_id", userId)
    .eq("bank_account_id", bankAccountId)
    .maybeSingle();

  if (existingPermissionError) throw existingPermissionError;

  const { data: permission, error } = await supabase.from("bank_account_permissions").upsert({
    user_id: userId,
    bank_account_id: bankAccountId,
    can_view: canView,
    can_create_transaction: canCreateTransaction,
    can_edit_transaction: canEditTransaction,
    can_manage_account: canManageAccount,
    granted_by: actor.id
  }, { onConflict: "user_id,bank_account_id" })
    .select("id, user_id, bank_account_id, can_view, can_create_transaction, can_edit_transaction, can_manage_account")
    .single();

  if (error || !permission) throw error ?? new Error("Bank account permission could not be loaded after update.");

  const beforeData = existingPermission ? bankPermissionAuditData(existingPermission) : null;
  const afterData = bankPermissionAuditData(permission);
  if (!beforeData || hasAuditChanges(beforeData, afterData)) {
    await logAuditEvent({
      action: "permission_change",
      afterData,
      bankAccountId: permission.bank_account_id,
      beforeData,
      branchId: target.branch_id ?? null,
      description: beforeData
        ? `Changed bank access for ${target.full_name}.`
        : `Granted bank access to ${target.full_name}.`,
      entityId: permission.id,
      entityName: "bank_account_permissions"
    });
  }
  revalidatePath("/bank");
  revalidatePath("/users");
  revalidatePath("/cash-bank-ins");
}

export async function revokeBankAccountPermission(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const actor = await requirePermission("manage_users");
  if (!canManageBankPermissions(actor)) {
    throw new Error("Only Owner can revoke bank account permissions.");
  }

  const permissionId = text(formData, "permission_id");
  if (!permissionId) throw new Error("Missing bank account permission.");

  const supabase = await createClient();
  const { data: permission, error: permissionError } = await supabase
    .from("bank_account_permissions")
    .select("id, user_id, bank_account_id, can_view, can_create_transaction, can_edit_transaction, can_manage_account")
    .eq("id", permissionId)
    .maybeSingle();

  if (permissionError || !permission) throw permissionError ?? new Error("Bank account permission not found.");

  const { error } = await supabase.from("bank_account_permissions").delete().eq("id", permissionId);
  if (error) throw error;

  await logAuditEvent({
    action: "permission_change",
    bankAccountId: permission.bank_account_id,
    beforeData: bankPermissionAuditData(permission),
    description: `Revoked bank access for ${permission.user_id}.`,
    entityId: permission.id,
    entityName: "bank_account_permissions"
  });

  revalidatePath("/bank");
  revalidatePath("/users");
  revalidatePath("/cash-bank-ins");
}
