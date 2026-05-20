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
import type { Branch, DashboardData, Profile } from "@/lib/types";

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
      sales: [],
      expenses: [],
      purchases: [],
      supplierPayments: [],
      panels: []
    };
  }

  if (canViewAllBranches(profile)) return data;
  const branchId = profile.branch_id;
  if (!branchId) return { ...data, branches: [] };

  return {
    branches: data.branches.filter((branch) => branch.id === branchId),
    sales: data.sales.filter((sale) => sale.branch_id === branchId),
    expenses: data.expenses.filter((expense) => expense.branch_id === branchId),
    purchases: data.purchases.filter((purchase) => purchase.branch_id === branchId),
    supplierPayments: data.supplierPayments.filter((payment) => payment.branch_id === branchId),
    panels: data.panels.filter((panel) => panel.branch_id === branchId)
  };
}
