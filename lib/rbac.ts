import type { Profile, UserRole } from "@/lib/types";

export type PermissionKey =
  | "view_dashboard"
  | "view_branches"
  | "manage_branches"
  | "manage_users"
  | "edit_finance"
  | "delete_records"
  | "view_supplier_records"
  | "view_supplier_payments"
  | "view_panel_records"
  | "view_reports"
  | "import_data"
  | "view_bank_position"
  | "record_cash_bank_in"
  | "record_petty_cash"
  | "view_audit_trail"
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
    "view_supplier_payments",
    "view_panel_records",
    "view_reports",
    "import_data",
    "view_bank_position",
    "record_cash_bank_in",
    "record_petty_cash",
    "view_audit_trail",
    "view_settings"
  ],
  admin: [
    "view_dashboard",
    "view_branches",
    "manage_branches",
    "manage_users",
    "edit_finance",
    "view_supplier_records",
    "view_supplier_payments",
    "view_panel_records",
    "view_reports",
    "import_data",
    "view_bank_position",
    "record_cash_bank_in",
    "record_petty_cash"
  ],
  finance: [
    "view_dashboard",
    "view_branches",
    "edit_finance",
    "view_supplier_records",
    "view_supplier_payments",
    "view_panel_records",
    "view_reports",
    "import_data",
    "view_bank_position",
    "record_cash_bank_in",
    "record_petty_cash"
  ],
  branch_pic: [
    "view_dashboard",
    "view_branches",
    "edit_finance",
    "view_supplier_records",
    "view_supplier_payments",
    "view_panel_records",
    "view_bank_position",
    "record_cash_bank_in",
    "record_petty_cash"
  ],
  staff: ["view_dashboard"]
};

export function normalizeRole(value: unknown): UserRole {
  const normalized = String(value ?? "staff")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (normalized === "owner") return "owner";
  if (normalized === "admin") return "admin";
  if (normalized === "finance") return "finance";
  if (normalized === "branch_pic") return "branch_pic";
  return "staff";
}

export function hasPermission(profile: Pick<Profile, "role" | "is_active"> | null, permission: PermissionKey) {
  if (!profile?.is_active) return false;
  return rolePermissions[normalizeRole(profile.role)]?.includes(permission) ?? false;
}

export function isManagementRole(role: UserRole) {
  const normalized = normalizeRole(role);
  return normalized === "owner" || normalized === "admin" || normalized === "finance";
}

export function canViewAllBranches(profile: Pick<Profile, "role" | "is_active"> | null) {
  return Boolean(profile?.is_active && isManagementRole(profile.role));
}

export function canManageTargetProfile(actor: Profile, target: Profile, nextRole?: UserRole) {
  if (!hasPermission(actor, "manage_users")) return false;
  if (actor.role === "owner") return true;
  if (target.role === "owner") return false;
  if (nextRole === "owner") return false;
  return actor.role === "admin";
}
