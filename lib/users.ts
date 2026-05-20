import { canManageTargetProfile, getCurrentProfile, normalizeProfileRow } from "@/lib/permissions";
import { createClient, hasSupabaseEnv } from "@/lib/supabase-server";
import type { Branch, Profile } from "@/lib/types";

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

export type UserManagementData = {
  currentUser: Profile;
  users: Profile[];
  branches: Branch[];
};

export async function getUserManagementData(): Promise<UserManagementData> {
  const currentUser = await getCurrentProfile();
  if (!currentUser) throw new Error("Missing current user profile.");

  if (!hasSupabaseEnv()) {
    return {
      currentUser,
      users: demoUsers,
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

  const [branchRows] = await Promise.all([
    supabase.from("branches").select("*").eq("is_active", true).order("name")
  ]);

  if (userRows.error) throw userRows.error;
  if (branchRows.error) throw branchRows.error;

  return {
    currentUser,
    users: (userRows.data ?? []).map(normalizeProfileRow),
    branches: (branchRows.data ?? []) as Branch[]
  };
}

export function editableUserRows(actor: Profile, users: Profile[]) {
  return users.map((user) => ({
    user,
    canEdit: canManageTargetProfile(actor, user)
  }));
}
