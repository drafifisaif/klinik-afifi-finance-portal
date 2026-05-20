import { updateUserProfile } from "@/app/actions";
import { ModuleHeader } from "@/components/module-header";
import { userRoles } from "@/lib/constants";
import { editableUserRows, getUserManagementData } from "@/lib/users";
import { requirePermission } from "@/lib/permissions";

export default async function UsersPage() {
  const profile = await requirePermission("manage_users");
  const data = await getUserManagementData();
  const rows = editableUserRows(profile, data.users);
  const roleOptions = profile.role === "owner" ? userRoles : userRoles.filter((role) => role.value !== "owner");

  return (
    <>
      <ModuleHeader
        eyebrow="Access control"
        title="User management"
        description="Review users, update roles, assign branch access, and activate or deactivate finance portal accounts."
      />

      <section className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Branch</th>
              <th>Status</th>
              <th>Update access</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ user, canEdit }) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.full_name}</strong>
                  <span className="table-subtext">{user.id}</span>
                </td>
                <td>{user.role}</td>
                <td>{user.branches?.name ?? "All / unassigned"}</td>
                <td>
                  <span className={`status-pill ${user.is_active ? "status-paid" : "status-overdue"}`}>
                    {user.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td>
                  {canEdit ? (
                    <form action={updateUserProfile} className="inline-form">
                      <input name="user_id" type="hidden" value={user.id} />
                      <select aria-label={`Role for ${user.full_name}`} name="role" defaultValue={user.role}>
                        {roleOptions.map((role) => (
                          <option key={role.value} value={role.value}>
                            {role.label}
                          </option>
                        ))}
                      </select>
                      <select aria-label={`Branch for ${user.full_name}`} name="branch_id" defaultValue={user.branch_id ?? ""}>
                        <option value="">All / unassigned</option>
                        {data.branches.map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {branch.name}
                          </option>
                        ))}
                      </select>
                      <select aria-label={`Status for ${user.full_name}`} name="is_active" defaultValue={String(user.is_active)}>
                        <option value="true">Active</option>
                        <option value="false">Inactive</option>
                      </select>
                      <button className="primary-button" type="submit">
                        Save
                      </button>
                    </form>
                  ) : (
                    <span className="table-subtext">Protected account</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
