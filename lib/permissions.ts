import { redirect } from "next/navigation";
import { createClient, hasSupabaseEnv } from "@/lib/supabase-server";
import {
  canManageTargetProfile,
  canViewAllBranches,
  hasPermission,
  isManagementRole,
  normalizeRole,
  type PermissionKey
} from "@/lib/rbac";
import type { BankAccountPermission, Branch, DashboardData, Profile } from "@/lib/types";

export { canManageTargetProfile, canViewAllBranches, hasPermission, isManagementRole, normalizeRole, type PermissionKey };

export const demoProfile: Profile = {
  id: "demo-owner",
  full_name: "Demo Owner",
  role: "owner",
  branch_id: null,
  is_active: true
};

export function canEditBranch(profile: Pick<Profile, "role" | "branch_id" | "is_active"> | null, branchId: string | null | undefined) {
  if (!profile?.is_active || !branchId) return false;
  if (hasPermission(profile, "edit_finance") && canViewAllBranches(profile)) return true;
  return normalizeRole(profile.role) === "branch_pic" && profile.branch_id === branchId;
}

export function canManageBankPermissions(profile: Pick<Profile, "role" | "is_active"> | null) {
  return Boolean(profile?.is_active && normalizeRole(profile.role) === "owner");
}

export type BankAccountPermissionMode = "view" | "create_transaction" | "edit_transaction" | "manage_account";

function permissionAllows(permission: Pick<
  BankAccountPermission,
  "can_create_transaction" | "can_edit_transaction" | "can_manage_account" | "can_view"
>, mode: BankAccountPermissionMode) {
  if (mode === "manage_account") return permission.can_manage_account;
  if (mode === "edit_transaction") return permission.can_edit_transaction || permission.can_manage_account;
  if (mode === "create_transaction") return permission.can_create_transaction || permission.can_manage_account;
  return permission.can_view || permission.can_create_transaction || permission.can_edit_transaction || permission.can_manage_account;
}

export function hasBankAccountPermission(
  profile: Pick<Profile, "id" | "role" | "is_active"> | null,
  permissions: Pick<
    BankAccountPermission,
    "bank_account_id" | "can_create_transaction" | "can_edit_transaction" | "can_manage_account" | "can_view" | "user_id"
  >[],
  bankAccountId: string | null | undefined,
  mode: BankAccountPermissionMode = "view"
) {
  if (!profile?.is_active || !bankAccountId) return false;
  if (normalizeRole(profile.role) === "owner") return true;

  return permissions.some((permission) => {
    if (permission.user_id !== profile.id || permission.bank_account_id !== bankAccountId) return false;
    return permissionAllows(permission, mode);
  });
}

export function hasAnyBankAccountAccess(
  profile: Pick<Profile, "id" | "role" | "is_active"> | null,
  permissions: Pick<
    BankAccountPermission,
    "can_create_transaction" | "can_edit_transaction" | "can_manage_account" | "can_view" | "user_id"
  >[]
) {
  if (!profile?.is_active) return false;
  const role = normalizeRole(profile.role);
  if (role === "owner") return true;
  if (role === "staff") return false;

  return permissions.some((permission) => permission.user_id === profile.id && permissionAllows(permission, "view"));
}

export async function getCurrentBankAccountPermissions(profile?: Pick<Profile, "id" | "role" | "is_active"> | null) {
  const currentProfile = profile ?? (await getCurrentProfile());
  if (!currentProfile?.is_active || !hasSupabaseEnv()) return [];
  if (normalizeRole(currentProfile.role) === "staff") return [];

  const supabase = await createClient();
  const query = supabase
    .from("bank_account_permissions")
    .select("id, user_id, bank_account_id, can_view, can_create_transaction, can_edit_transaction, can_manage_account, granted_by, created_at, updated_at");

  const { data, error } = normalizeRole(currentProfile.role) === "owner" ? await query : await query.eq("user_id", currentProfile.id);
  if (error) return [];
  return (data ?? []) as BankAccountPermission[];
}

export async function requireBankPositionAccess() {
  const profile = await requirePermission("view_bank_position");
  const role = normalizeRole(profile.role);
  if (role === "owner") return profile;
  if (role === "staff") redirect("/unauthorized");

  const permissions = await getCurrentBankAccountPermissions(profile);
  if (!hasAnyBankAccountAccess(profile, permissions)) redirect("/unauthorized");
  return profile;
}

export async function requireBankAccountPermission(bankAccountId: string | null | undefined, mode: BankAccountPermissionMode = "view") {
  const profile = await requirePermission(mode === "view" || mode === "manage_account" ? "view_bank_position" : "record_cash_bank_in");
  if (normalizeRole(profile.role) === "owner") return profile;
  if (!bankAccountId) throw new Error("Bank account is required.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bank_account_permissions")
    .select("bank_account_id, can_view, can_create_transaction, can_edit_transaction, can_manage_account, user_id")
    .eq("user_id", profile.id)
    .eq("bank_account_id", bankAccountId)
    .maybeSingle();

  if (error || !hasBankAccountPermission(profile, data ? [data as BankAccountPermission] : [], bankAccountId, mode)) {
    throw new Error(`You do not have ${mode} access for this bank account.`);
  }

  return profile;
}

export function normalizeProfileRow(row: unknown): Profile {
  const profile = row as Profile & { branches?: Pick<Branch, "name" | "code"> | Pick<Branch, "name" | "code">[] | null };
  return {
    ...profile,
    email: profile.email ?? null,
    role: normalizeRole(profile.role),
    branches: Array.isArray(profile.branches) ? profile.branches[0] ?? null : profile.branches ?? null
  };
}

export async function getCurrentProfile(): Promise<Profile | null> {
  if (!hasSupabaseEnv()) return demoProfile;

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, branch_id, is_active, created_at, updated_at, branches(name, code)")
    .eq("id", user.id)
    .single();

  if (error || !data) return null;
  return normalizeProfileRow(data);
}

export async function requirePermission(permission: PermissionKey) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!hasPermission(profile, permission)) redirect("/unauthorized");
  return profile;
}

export async function requireAnyPermission(permissions: PermissionKey[]) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!permissions.some((permission) => hasPermission(profile, permission))) redirect("/unauthorized");
  return profile;
}

export function filterBranchesForProfile<T extends Branch>(branches: T[], profile: Profile | null) {
  if (!profile?.is_active) return [];
  if (canViewAllBranches(profile)) return branches;
  return branches.filter((branch) => branch.id === profile.branch_id);
}

export function filterDashboardDataForProfile(data: DashboardData, profile: Profile | null): DashboardData {
  if (!profile?.is_active) {
    return {
      branches: [],
      openingBalances: [],
      sales: [],
      expenses: [],
      purchases: [],
      supplierPayments: [],
      panels: [],
      panelPayments: []
    };
  }

  if (canViewAllBranches(profile)) return data;
  const branchId = profile.branch_id;
  if (!branchId) return { ...data, branches: [] };

  return {
    branches: data.branches.filter((branch) => branch.id === branchId),
    openingBalances: data.openingBalances.filter((balance) => balance.branch_id === branchId),
    sales: data.sales.filter((sale) => sale.branch_id === branchId),
    expenses: data.expenses.filter((expense) => expense.branch_id === branchId),
    purchases: data.purchases.filter((purchase) => purchase.branch_id === branchId),
    supplierPayments: data.supplierPayments.filter((payment) => payment.branch_id === branchId),
    panels: data.panels.filter((panel) => panel.branch_id === branchId),
    panelPayments: data.panelPayments.filter((payment) => payment.branch_id === branchId)
  };
}
