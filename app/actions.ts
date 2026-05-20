"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, hasSupabaseEnv } from "@/lib/supabase-server";
import { canEditBranch, canManageTargetProfile, canViewAllBranches, requirePermission } from "@/lib/permissions";
import type { ExpenseCategory, PaymentType, PurchaseCategory, UserRole } from "@/lib/types";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(formData: FormData, key: string) {
  const value = Number(formData.get(key) ?? 0);
  return Number.isFinite(value) ? value : 0;
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
  await requirePermission("view_bank_position");
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
