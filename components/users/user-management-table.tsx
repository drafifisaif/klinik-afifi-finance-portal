"use client";

import { useMemo, useState, useTransition } from "react";
import { updateUserBankPermissions, updateUserProfile } from "@/app/actions";
import { userRoles } from "@/lib/constants";
import { canManageTargetProfile } from "@/lib/rbac";
import type { BankAccount, BankAccountPermission, Branch, Profile } from "@/lib/types";
import { Search } from "lucide-react";

type UserManagementTableProps = {
  actor: Profile;
  bankAccountPermissions: BankAccountPermission[];
  bankAccounts: BankAccount[];
  branches: Branch[];
  users: Profile[];
};

type Message = {
  tone: "success" | "error";
  text: string;
};

export function UserManagementTable({ actor, bankAccountPermissions, bankAccounts, branches, users }: UserManagementTableProps) {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [message, setMessage] = useState<Message | null>(null);
  const [isPending, startTransition] = useTransition();

  const roleOptions = actor.role === "owner" ? userRoles : userRoles.filter((role) => role.value !== "owner");
  const canAssignBankPermissions = actor.role === "owner";

  const bankPermissionsByUser = useMemo(() => {
    const map = new Map<string, Map<string, BankAccountPermission>>();
    bankAccountPermissions.forEach((permission) => {
      if (!map.has(permission.user_id)) map.set(permission.user_id, new Map());
      map.get(permission.user_id)?.set(permission.bank_account_id, permission);
    });
    return map;
  }, [bankAccountPermissions]);

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return users.filter((user) => {
      const matchesQuery =
        !normalizedQuery ||
        user.full_name.toLowerCase().includes(normalizedQuery) ||
        (user.email ?? "").toLowerCase().includes(normalizedQuery);
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const matchesBranch = branchFilter === "all" || (branchFilter === "unassigned" ? !user.branch_id : user.branch_id === branchFilter);

      return matchesQuery && matchesRole && matchesBranch;
    });
  }, [branchFilter, query, roleFilter, users]);

  function submitUpdate(formData: FormData) {
    setMessage(null);
    startTransition(async () => {
      try {
        await updateUserProfile(formData);
        setMessage({ tone: "success", text: "User profile updated." });
      } catch (error) {
        setMessage({
          tone: "error",
          text: error instanceof Error ? error.message : "Could not update user profile."
        });
      }
    });
  }

  function submitBankPermissionUpdate(formData: FormData) {
    setMessage(null);
    startTransition(async () => {
      try {
        await updateUserBankPermissions(formData);
        setMessage({ tone: "success", text: "Bank account permissions updated." });
      } catch (error) {
        setMessage({
          tone: "error",
          text: error instanceof Error ? error.message : "Could not update bank account permissions."
        });
      }
    });
  }

  return (
    <section className="user-management">
      <div className="report-panel user-filter-panel">
        <label className="search-field">
          Search users
          <span>
            <Search size={16} />
            <input
              placeholder="Name or email"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </span>
        </label>

        <label>
          Role
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="all">All roles</option>
            {userRoles.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Branch
          <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
            <option value="all">All branches</option>
            <option value="unassigned">All / unassigned</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {message ? <p className={`import-message message-${message.tone}`}>{message.text}</p> : null}

      <section className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Current access</th>
              <th>Created</th>
              <th>Manage existing user</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length ? (
              filteredUsers.map((user) => {
                const canEdit = canManageTargetProfile(actor, user);
                const canAssignUserBankPermissions = canAssignBankPermissions && (user.role === "admin" || user.role === "finance" || user.role === "branch_pic");
                const userBankPermissions = bankPermissionsByUser.get(user.id) ?? new Map<string, BankAccountPermission>();
                return (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.full_name}</strong>
                      <span className="table-subtext">{user.id}</span>
                    </td>
                    <td>{user.email ?? "-"}</td>
                    <td>
                      <span className="status-pill status-paid">{user.role}</span>
                      <span className="table-subtext">{user.branches?.name ?? "All / unassigned"}</span>
                      <span className={`status-pill ${user.is_active ? "status-paid" : "status-overdue"}`}>
                        {user.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>{user.created_at ? new Date(user.created_at).toLocaleDateString("en-MY") : "-"}</td>
                    <td>
                      <div className="user-management-actions">
                        {canEdit ? (
                          <form action={submitUpdate} className="user-edit-form">
                            <input name="user_id" type="hidden" value={user.id} />
                            <label>
                              Full name
                              <input name="full_name" defaultValue={user.full_name} required />
                            </label>
                            <label>
                              Role
                              <select name="role" defaultValue={user.role} aria-label={`Role for ${user.full_name}`}>
                                {roleOptions.map((role) => (
                                  <option key={role.value} value={role.value}>
                                    {role.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Branch
                              <select name="branch_id" defaultValue={user.branch_id ?? ""} aria-label={`Branch for ${user.full_name}`}>
                                <option value="">All / unassigned</option>
                                {branches.map((branch) => (
                                  <option key={branch.id} value={branch.id}>
                                    {branch.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Status
                              <select name="is_active" defaultValue={String(user.is_active)} aria-label={`Status for ${user.full_name}`}>
                                <option value="true">Active</option>
                                <option value="false">Inactive</option>
                              </select>
                            </label>
                            <button className="primary-button" disabled={isPending} type="submit">
                              Save
                            </button>
                          </form>
                        ) : (
                          <span className="table-subtext">Protected account</span>
                        )}

                        {canAssignUserBankPermissions ? (
                          <form action={submitBankPermissionUpdate} className="bank-permission-form">
                            <input name="user_id" type="hidden" value={user.id} />
                            <strong>Bank account access</strong>
                            <div className="bank-permission-grid">
                              {bankAccounts.map((account) => (
                                <fieldset key={account.id}>
                                  <legend>{account.account_no ? `${account.name} (${account.account_no})` : account.name}</legend>
                                  <input name="bank_account_ids" type="hidden" value={account.id} />
                                  <label>
                                    <input
                                      defaultChecked={userBankPermissions.get(account.id)?.can_view ?? false}
                                      name={`bank_permission_${account.id}_view`}
                                      type="checkbox"
                                      value="true"
                                    />
                                    View
                                  </label>
                                  <label>
                                    <input
                                      defaultChecked={userBankPermissions.get(account.id)?.can_create_transaction ?? false}
                                      name={`bank_permission_${account.id}_create`}
                                      type="checkbox"
                                      value="true"
                                    />
                                    Create transactions
                                  </label>
                                  <label>
                                    <input
                                      defaultChecked={userBankPermissions.get(account.id)?.can_edit_transaction ?? false}
                                      name={`bank_permission_${account.id}_edit`}
                                      type="checkbox"
                                      value="true"
                                    />
                                    Edit transactions
                                  </label>
                                  <label>
                                    <input
                                      defaultChecked={userBankPermissions.get(account.id)?.can_manage_account ?? false}
                                      name={`bank_permission_${account.id}_manage`}
                                      type="checkbox"
                                      value="true"
                                    />
                                    Manage account
                                  </label>
                                </fieldset>
                              ))}
                            </div>
                            <button className="primary-button" disabled={isPending || !bankAccounts.length} type="submit">
                              Save bank access
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={5}>No users match the current filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </section>
  );
}
