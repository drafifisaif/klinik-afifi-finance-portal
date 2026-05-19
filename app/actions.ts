"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, hasSupabaseEnv } from "@/lib/supabase-server";
import type { ExpenseCategory, PaymentType, PurchaseCategory } from "@/lib/types";

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
  const supabase = await createClient();
  await supabase.from("branches").insert({
    name: text(formData, "name"),
    code: text(formData, "code"),
    address: text(formData, "address"),
    phone: text(formData, "phone")
  });
  revalidatePath("/branches");
}

export async function createDailySale(formData: FormData) {
  if (!hasSupabaseEnv()) return;
  const supabase = await createClient();
  await supabase.from("daily_sales").upsert({
    branch_id: text(formData, "branch_id"),
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

export async function createExpense(formData: FormData) {
  if (!hasSupabaseEnv()) return;
  const supabase = await createClient();
  await supabase.from("expenses").insert({
    branch_id: text(formData, "branch_id"),
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
  const supabase = await createClient();
  await supabase.from("supplier_purchases").insert({
    supplier_id: text(formData, "supplier_id"),
    branch_id: text(formData, "branch_id"),
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
  await supabase.from("supplier_payments").insert({
    supplier_id: text(formData, "supplier_id"),
    purchase_id: text(formData, "purchase_id"),
    branch_id: text(formData, "branch_id"),
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
  const supabase = await createClient();
  await supabase.from("panel_claims").insert({
    panel_company_id: text(formData, "panel_company_id"),
    branch_id: text(formData, "branch_id"),
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
