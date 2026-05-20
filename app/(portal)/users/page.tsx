import { ModuleHeader } from "@/components/module-header";
import { UserManagementTable } from "@/components/users/user-management-table";
import { getUserManagementData } from "@/lib/users";
import { requirePermission } from "@/lib/permissions";

export default async function UsersPage() {
  const profile = await requirePermission("manage_users");
  const data = await getUserManagementData();

  return (
    <>
      <ModuleHeader
        eyebrow="Access control"
        title="User management"
        description="Manage existing authenticated users from the profiles table. New users are created manually in Supabase Authentication."
      />

      <UserManagementTable actor={profile} branches={data.branches} users={data.users} />
    </>
  );
}
