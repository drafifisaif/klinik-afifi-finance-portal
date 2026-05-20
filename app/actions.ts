"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, hasSupabaseEnv } from "@/lib/supabase-server";
import {
  canEditBranch,
  canManageBankPermissions,
  canManageTargetProfile,
  canViewAllBranches,
  normalizeRole,
  requireBankAccountPermission,
  requirePermission
} from "@/lib/permissions";
import type { ExpenseCategory, PaymentType, PurchaseCategory, UserRole } from "@/lib/types";

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
  await supabase.from("cash_bank_ins").insert({
    branch_id: branchId,
    bank_account_id: bankAccountId,
    bank_in_date: bankInDate,
    amount,
    reference_no: text(formData, "reference_no"),
    notes: text(formData, "notes"),
    entered_by: await getUserId()
  });
  revalidatePath("/cash-bank-ins");
  revalidatePath("/bank");
  revalidatePath("/dashboard");
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

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      role: nextRole,
      branch_id: branchId,
      is_active: isActive
    })
    .eq("id", targetId);

  if (error) throw error;
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

  if (grants.length) {
    const { error: insertError } = await supabase.from("bank_account_permissions").insert(grants);
    if (insertError) throw insertError;
  }

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
    .select("id, role")
    .eq("id", userId)
    .single();

  if (targetError || !target) throw new Error("User profile not found.");
  const targetRole = normalizeRole(target.role);
  if (targetRole === "owner" || targetRole === "staff") {
    throw new Error("Bank account access can only be granted to Admin, Finance, or Branch PIC users.");
  }

  const { error } = await supabase.from("bank_account_permissions").upsert({
    user_id: userId,
    bank_account_id: bankAccountId,
    can_view: canView,
    can_create_transaction: canCreateTransaction,
    can_edit_transaction: canEditTransaction,
    can_manage_account: canManageAccount,
    granted_by: actor.id
  }, { onConflict: "user_id,bank_account_id" });

  if (error) throw error;
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
  const { error } = await supabase.from("bank_account_permissions").delete().eq("id", permissionId);
  if (error) throw error;

  revalidatePath("/bank");
  revalidatePath("/users");
  revalidatePath("/cash-bank-ins");
}
