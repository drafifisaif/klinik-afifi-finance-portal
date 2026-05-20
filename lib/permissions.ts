import { redirect } from "next/navigation";
import { createClient, hasSupabaseEnv } from "@/lib/supabase-server";
import type { Branch, DashboardData, Profile, UserRole } from "@/lib/types";

export type PermissionKey =
  | "view_dashboard"
  | "view_branches"
  | "manage_branches"
  | "manage_users"
  | "edit_finance"
  | "delete_records"
  | "view_supplier_records"
  | "view_panel_records"
  | "view_reports"
  | "import_data"
  | "view_settings";

export const rolePermissions: Record<UserRole, PermissionKey[]> = {
  owner: [
    "view_dashboard",
    "view_branches",
    "manage_branches",
    "manage_users",
    "edit_finance",
    "delete_records",
    "view_supplier_records",
    "view_panel_records",
    "view_reports",
    "import_data",
    "view_settings"
  ],
  admin: [
    "view_dashboard",
    "view_branches",
    "manage_branches",
    "manage_users",
    "edit_finance",
    "view_supplier_records",
    "view_panel_records",
    "view_reports",
    "import_data"
  ],
  finance: [
    "view_dashboard",
    "view_branches",
    "edit_finance",
    "view_supplier_records",
    "view_panel_records",
    "view_reports",
    "import_data"
  ],
  branch_pic: ["view_dashboard", "view_branches", "edit_finance", "view_supplier_records", "view_panel_records"],
  staff: ["view_dashboard"]
};

export const demoProfile: Profile = {
  id: "demo-owner",
  full_name: "Demo Owner",
  role: "owner",
  branch_id: null,
  is_active: true
};

export function hasPermission(profile: Pick<Profile, "role" | "is_active"> | null, permission: PermissionKey) {
  if (!profile?.is_active) return false;
  return rolePermissions[profile.role]?.includes(permission) ?? false;
}

export function isManagementRole(role: UserRole) {
  return role === "owner" || role === "admin" || role === "finance";
}

export function canViewAllBranches(profile: Pick<Profile, "role" | "is_active"> | null) {
  return Boolean(profile?.is_active && isManagementRole(profile.role));
}

export function canEditBranch(profile: Pick<Profile, "role" | "branch_id" | "is_active"> | null, branchId: string | null | undefined) {
  if (!profile?.is_active || !branchId) return false;
  if (hasPermission(profile, "edit_finance") && canViewAllBranches(profile)) return true;
  return profile.role === "branch_pic" && profile.branch_id === branchId;
}

export function canManageTargetProfile(actor: Profile, target: Profile, nextRole?: UserRole) {
  if (!hasPermission(actor, "manage_users")) return false;
  if (actor.role === "owner") return true;
  if (target.role === "owner") return false;
  if (nextRole === "owner") return false;
  return actor.role === "admin";
}

export function normalizeProfileRow(row: unknown): Profile {
  const profile = row as Profile & { branches?: Pick<Branch, "name" | "code"> | Pick<Branch, "name" | "code">[] | null };
  return {
    ...profile,
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
