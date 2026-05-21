"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuditChangedFields, logAuditEvent } from "@/lib/audit";
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
import type { BankTransactionType, ExpenseCategory, PaymentType, PettyCashTransactionType, PurchaseCategory, UserRole } from "@/lib/types";

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
};

type CashBankInAuditRow = {
  amount: number;
  bank_account_id: string;
  bank_in_date: string;
  branch_id: string;
  notes: string | null;
  reference_no: string | null;
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
    transfer_group_id: transaction.transfer_group_id
  };
}

function cashBankInAuditData(bankIn: CashBankInAuditRow) {
  return {
    amount: bankIn.amount,
    bank_account_id: bankIn.bank_account_id,
    bank_in_date: bankIn.bank_in_date,
    branch_id: bankIn.branch_id,
    notes: bankIn.notes,
    reference_no: bankIn.reference_no
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
    transaction_type: transaction.transaction_type
  };
}

function hasAuditChanges(beforeData: Record<string, unknown>, afterData: Record<string, unknown>) {
  return Object.keys(getAuditChangedFields(beforeData, afterData)).length > 0;
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
  await supabase.from("branches").insert({
    name: text(formData, "name"),
    code: text(formData, "code"),
    address: text(formData, "address"),
    phone: text(formData, "phone")
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
  await supabase.from("bank_accounts").insert({
    name,
    bank_name: text(formData, "bank_name"),
    account_no: text(formData, "account_no")
  });
  revalidatePath("/bank");
  revalidatePath("/cash-bank-ins");
}

export async function createDailySale(formData: FormData) {
  if (!hasSupabaseEnv()) return;
  const branchId = text(formData, "branch_id");
  await requireEditableBranch(branchId);
  const supabase = await createClient();
  await supabase.from("daily_sales").upsert({
    branch_id: branchId,
    sale_date: text(formData, "sale_date"),
    cash_amount: number(formData, "cash_amount"),
    bank_transfer_amount: number(formData, "bank_transfer_amount"),
    card_amount: number(formData, "card_amount"),
    panel_amount: number(formData, "panel_amount"),
    qr_amount: number(formData, "qr_amount"),
    notes: text(formData, "notes"),
    entered_by: await getUserId()
  });
  revalidatePath("/sales");
  revalidatePath("/dashboard");
}

export async function createCashBankIn(formData: FormData) {
  if (!hasSupabaseEnv()) return;
  await requirePermission("record_cash_bank_in");
  const branchId = text(formData, "branch_id");
  const bankAccountId = text(formData, "bank_account_id");
  const bankInDate = text(formData, "bank_in_date");
  const amount = number(formData, "amount");

  if (!branchId || !bankAccountId || !bankInDate || amount <= 0) {
    throw new Error("Date, branch, destination bank account, and amount are required.");
  }

  const profile = await requireEditableBranch(branchId);
  if (!canEditBranch(profile, branchId)) {
    throw new Error("You do not have permission to bank in cash for this branch.");
  }
  if (normalizeRole(profile.role) === "admin" || normalizeRole(profile.role) === "finance") {
    await requireBankAccountPermission(bankAccountId, "create_transaction");
  }

  const supabase = await createClient();
  const { data: bankIn, error } = await supabase.from("cash_bank_ins").insert({
    branch_id: branchId,
    bank_account_id: bankAccountId,
    bank_in_date: bankInDate,
    amount,
    reference_no: text(formData, "reference_no"),
    notes: text(formData, "notes"),
    entered_by: await getUserId()
  }).select("id, branch_id, bank_account_id, bank_in_date, amount, reference_no, notes").single();

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
    .select("id, bank_account_id, related_bank_account_id, transfer_group_id, transaction_date, transaction_type, direction, category, amount, description, reference_no, branch_id")
    .eq("id", transactionId)
    .maybeSingle();

  if (transactionError || !transaction) throw new Error("Manual bank transaction not found.");
  await requireBankAccountPermission(transaction.bank_account_id, "edit_transaction");

  const updates = {
    transaction_date: transactionDate,
    amount,
    description: text(formData, "description"),
    reference_no: text(formData, "reference_no"),
    branch_id: text(formData, "branch_id")
  };

  if (transaction.transaction_type === "interbank_transfer") {
    if (!transaction.transfer_group_id) throw new Error("Interbank transfer pair is incomplete.");

    const { data: transferRows, error: transferError } = await supabase
      .from("bank_transactions")
      .select("id, bank_account_id, related_bank_account_id, transfer_group_id, transaction_date, transaction_type, direction, category, amount, description, reference_no, branch_id")
      .eq("transfer_group_id", transaction.transfer_group_id)
      .eq("transaction_type", "interbank_transfer");

    if (transferError || !transferRows || transferRows.length < 2) {
      throw new Error("Interbank transfer pair could not be loaded.");
    }

    await Promise.all(transferRows.map((row) => requireBankAccountPermission(row.bank_account_id, "edit_transaction")));
    const { data: updatedTransferRows, error } = await supabase
      .from("bank_transactions")
      .update(updates)
      .eq("transfer_group_id", transaction.transfer_group_id)
      .eq("transaction_type", "interbank_transfer")
      .select("id, bank_account_id, related_bank_account_id, transfer_group_id, transaction_date, transaction_type, direction, category, amount, description, reference_no, branch_id");

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
      .select("id, bank_account_id, related_bank_account_id, transfer_group_id, transaction_date, transaction_type, direction, category, amount, description, reference_no, branch_id")
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
  }).select("id, branch_id, bank_account_id, transaction_date, transaction_type, direction, category, amount, description, reference_no").single();

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
    .select("id, branch_id, bank_account_id, transaction_date, transaction_type, direction, category, amount, description, reference_no")
    .eq("id", transactionId)
    .maybeSingle();

  if (transactionError || !transaction) throw new Error("Petty cash transaction not found.");
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
    .select("id, branch_id, bank_account_id, transaction_date, transaction_type, direction, category, amount, description, reference_no")
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

export async function createExpense(formData: FormData) {
  if (!hasSupabaseEnv()) return;
  const branchId = text(formData, "branch_id");
  await requireEditableBranch(branchId);
  const supabase = await createClient();
  await supabase.from("expenses").insert({
    branch_id: branchId,
    expense_date: text(formData, "expense_date"),
    category: text(formData, "category") as ExpenseCategory,
    vendor_name: text(formData, "vendor_name"),
    description: text(formData, "description"),
    payment_type: text(formData, "payment_type") as PaymentType,
    amount: number(formData, "amount"),
    entered_by: await getUserId()
  });
  revalidatePath("/expenses");
  revalidatePath("/dashboard");
}

export async function createSupplier(formData: FormData) {
  if (!hasSupabaseEnv()) return;
  await requirePermission("view_reports");
  const supabase = await createClient();
  await supabase.from("suppliers").insert({
    name: text(formData, "name"),
    contact_person: text(formData, "contact_person"),
    phone: text(formData, "phone"),
    email: text(formData, "email"),
    payment_terms_days: number(formData, "payment_terms_days") || 30
  });
  revalidatePath("/purchases");
  revalidatePath("/suppliers/payments");
}

export async function createSupplierPurchase(formData: FormData) {
  if (!hasSupabaseEnv()) return;
  const branchId = text(formData, "branch_id");
  await requireEditableBranch(branchId);
  const supabase = await createClient();
  await supabase.from("supplier_purchases").insert({
    supplier_id: text(formData, "supplier_id"),
    branch_id: branchId,
    invoice_no: text(formData, "invoice_no"),
    purchase_date: text(formData, "purchase_date"),
    due_date: text(formData, "due_date"),
    category: text(formData, "category") as PurchaseCategory,
    medicine_cost: number(formData, "medicine_cost"),
    consumables_cost: number(formData, "consumables_cost"),
    other_cost: number(formData, "other_cost"),
    notes: text(formData, "notes"),
    entered_by: await getUserId()
  });
  revalidatePath("/purchases");
  revalidatePath("/dashboard");
}

export async function createSupplierPayment(formData: FormData) {
  if (!hasSupabaseEnv()) return;
  const supabase = await createClient();
  const purchaseId = text(formData, "purchase_id");
  const submittedBranchId = text(formData, "branch_id");
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

  const profile = await requirePermission("view_supplier_records");
  const canRecordPayment = resolvedBranchId ? canEditBranch(profile, resolvedBranchId) : canViewAllBranches(profile);
  if (!canRecordPayment) {
    throw new Error("You do not have permission to record supplier payments for this branch.");
  }

  await supabase.from("supplier_payments").insert({
    supplier_id: text(formData, "supplier_id"),
    purchase_id: purchaseId,
    branch_id: resolvedBranchId,
    payment_date: text(formData, "payment_date"),
    payment_type: text(formData, "payment_type") as PaymentType,
    amount: number(formData, "amount"),
    reference_no: text(formData, "reference_no"),
    notes: text(formData, "notes"),
    entered_by: await getUserId()
  });
  revalidatePath("/suppliers/payments");
  revalidatePath("/dashboard");
}

export async function createPanelCompany(formData: FormData) {
  if (!hasSupabaseEnv()) return;
  await requirePermission("view_reports");
  const supabase = await createClient();
  await supabase.from("panel_companies").insert({
    name: text(formData, "name"),
    contact_person: text(formData, "contact_person"),
    phone: text(formData, "phone"),
    email: text(formData, "email"),
    payment_terms_days: number(formData, "payment_terms_days") || 30
  });
  revalidatePath("/panels");
}

export async function createPanelClaim(formData: FormData) {
  if (!hasSupabaseEnv()) return;
  const branchId = text(formData, "branch_id");
  await requireEditableBranch(branchId);
  const supabase = await createClient();
  await supabase.from("panel_claims").insert({
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
  });
  revalidatePath("/panels");
  revalidatePath("/dashboard");
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
