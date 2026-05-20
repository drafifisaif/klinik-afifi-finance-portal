import { canManageTargetProfile, getCurrentProfile, normalizeProfileRow } from "@/lib/permissions";
import { createClient, hasSupabaseEnv } from "@/lib/supabase-server";
import type { BankAccount, BankAccountPermission, Branch, Profile } from "@/lib/types";

const demoUsers: Profile[] = [
  {
    id: "demo-owner",
    full_name: "Demo Owner",
    email: "owner@klinikafifi.local",
    role: "owner",
    branch_id: null,
    is_active: true,
    branches: null
  },
  {
    id: "demo-branch-pic",
    full_name: "Putatan PIC",
    email: "putatan.pic@klinikafifi.local",
    role: "branch_pic",
    branch_id: "putatan",
    is_active: true,
    branches: { name: "Putatan", code: "PUT" }
  }
];

const demoBankAccounts: BankAccount[] = [
  { id: "bank-cimb-ranau-operation", name: "CIMB Ranau Operation", bank_name: "CIMB", account_no: null, is_active: true },
  { id: "bank-cimb-ranau-panel", name: "CIMB Ranau Panel", bank_name: "CIMB", account_no: null, is_active: true },
  { id: "bank-cimb-putatan-operation", name: "CIMB Putatan Operation", bank_name: "CIMB", account_no: null, is_active: true },
  { id: "bank-cimb-putatan-panel", name: "CIMB Putatan Panel", bank_name: "CIMB", account_no: null, is_active: true },
  { id: "bank-agrobank", name: "Agrobank", bank_name: "Agrobank", account_no: null, is_active: true }
];

export type UserManagementData = {
  currentUser: Profile;
  users: Profile[];
  branches: Branch[];
  bankAccounts: BankAccount[];
  bankAccountPermissions: BankAccountPermission[];
};

export async function getUserManagementData(): Promise<UserManagementData> {
  const currentUser = await getCurrentProfile();
  if (!currentUser) throw new Error("Missing current user profile.");

  if (!hasSupabaseEnv()) {
    return {
      currentUser,
      users: demoUsers,
      bankAccounts: demoBankAccounts,
      bankAccountPermissions: [],
      branches: [
        { id: "putatan", name: "Putatan", code: "PUT", is_active: true },
        { id: "papar", name: "Papar", code: "PAP", is_active: true },
        { id: "ranau", name: "Ranau", code: "RAN", is_active: true },
        { id: "kinabatangan", name: "Kinabatangan", code: "KIN", is_active: true }
      ]
    };
  }

  const supabase = await createClient();
  const usersWithEmail = await supabase
    .from("profiles")
    .select("id, full_name, email, role, branch_id, is_active, created_at, updated_at, branches(name, code)")
    .order("full_name");

  const userRows = usersWithEmail.error?.code === "42703"
    ? await supabase
        .from("profiles")
        .select("id, full_name, role, branch_id, is_active, created_at, updated_at, branches(name, code)")
        .order("full_name")
    : usersWithEmail;

  const [branchRows, bankAccountRows, bankPermissionRows] = await Promise.all([
    supabase.from("branches").select("*").eq("is_active", true).order("name"),
    supabase.from("bank_accounts").select("*").eq("is_active", true).order("name"),
    supabase
      .from("bank_account_permissions")
      .select("id, user_id, bank_account_id, can_view, can_create_transaction, can_edit_transaction, can_manage_account, granted_by, created_at, updated_at")
  ]);

  if (userRows.error) throw userRows.error;
  if (branchRows.error) throw branchRows.error;
  if (bankAccountRows.error && bankAccountRows.error.code !== "42P01") throw bankAccountRows.error;
  if (bankPermissionRows.error && bankPermissionRows.error.code !== "42P01") throw bankPermissionRows.error;

  return {
    currentUser,
    users: (userRows.data ?? []).map(normalizeProfileRow),
    branches: (branchRows.data ?? []) as Branch[],
    bankAccounts: (bankAccountRows.data ?? []) as BankAccount[],
    bankAccountPermissions: (bankPermissionRows.data ?? []) as BankAccountPermission[]
  };
}

export function editableUserRows(actor: Profile, users: Profile[]) {
  return users.map((user) => ({
    user,
    canEdit: canManageTargetProfile(actor, user)
  }));
}
