import { DataTable } from "@/components/data-table";
import { ModuleHeader } from "@/components/module-header";
import { bankAccountLabel, branchLabel } from "@/lib/bank-reporting";
import { getAuditEvents } from "@/lib/audit";
import { formatDateTime, labelize } from "@/lib/format";
import { requirePermission } from "@/lib/permissions";
import { getUserManagementData } from "@/lib/users";
import type { AuditEvent } from "@/lib/types";

type AuditSearchParams = {
  action?: string;
  actor_id?: string;
  bank_account_id?: string;
  branch_id?: string;
  end?: string;
  entity_name?: string;
  q?: string;
  start?: string;
};

const auditActions = ["create", "update", "delete", "role_change", "permission_change"];

const auditEntities = [
  "branches",
  "daily_sales",
  "expenses",
  "suppliers",
  "supplier_purchases",
  "supplier_payments",
  "panel_companies",
  "panel_claims",
  "panel_payments",
  "bank_accounts",
  "profiles",
  "bank_account_permissions",
  "bank_transactions",
  "cash_bank_ins",
  "petty_cash_transactions"
];

function jsonDetails(value: AuditEvent["after_data"]) {
  return value ? JSON.stringify(value, null, 2) : "No data.";
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<AuditSearchParams> }) {
  await requirePermission("view_audit_trail");
  const params = await searchParams;
  const filters = {
    action: params.action,
    actorId: params.actor_id,
    bankAccountId: params.bank_account_id,
    branchId: params.branch_id,
    endDate: params.end,
    entityName: params.entity_name,
    keyword: params.q,
    startDate: params.start
  };
  const [events, references] = await Promise.all([getAuditEvents(filters), getUserManagementData()]);

  return (
    <>
      <ModuleHeader
        eyebrow="Owner control"
        title="Audit Trail"
        description="Review sensitive finance and access changes recorded by the portal."
      />

      <form className="reporting-filter audit-filter" method="get">
        <label>
          Start date
          <input name="start" type="date" defaultValue={params.start ?? ""} />
        </label>
        <label>
          End date
          <input name="end" type="date" defaultValue={params.end ?? ""} />
        </label>
        <label>
          Actor
          <select name="actor_id" defaultValue={params.actor_id ?? "all"}>
            <option value="all">All users</option>
            {references.users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.full_name}{user.email ? ` (${user.email})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Action
          <select name="action" defaultValue={params.action ?? "all"}>
            <option value="all">All actions</option>
            {auditActions.map((action) => (
              <option key={action} value={action}>
                {labelize(action)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Module
          <select name="entity_name" defaultValue={params.entity_name ?? "all"}>
            <option value="all">All modules</option>
            {auditEntities.map((entity) => (
              <option key={entity} value={entity}>
                {labelize(entity)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Branch
          <select name="branch_id" defaultValue={params.branch_id ?? "all"}>
            <option value="all">All branches</option>
            {references.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Bank account
          <select name="bank_account_id" defaultValue={params.bank_account_id ?? "all"}>
            <option value="all">All bank accounts</option>
            {references.bankAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {bankAccountLabel(account)}
              </option>
            ))}
          </select>
        </label>
        <label className="audit-search">
          Keyword
          <input name="q" type="search" defaultValue={params.q ?? ""} placeholder="Description, actor, changed value" />
        </label>
        <button className="primary-button" type="submit">
          Apply
        </button>
      </form>

      <section className="table-section">
        <h2>Recorded changes</h2>
        <DataTable
          columns={["Date / time", "Actor", "Action", "Module", "Branch", "Bank account", "Description", "Details"]}
          rows={events.map((event) => [
            formatDateTime(event.created_at),
            <span key={`${event.id}-actor`}>
              {event.profiles?.full_name ?? event.actor_email ?? event.actor_id ?? "Unknown actor"}
              {event.actor_email ? <span className="table-subtext">{event.actor_email}</span> : null}
            </span>,
            labelize(event.action),
            <span key={`${event.id}-entity`}>
              {labelize(event.entity_name)}
              {event.entity_id ? <span className="table-subtext">{event.entity_id}</span> : null}
            </span>,
            branchLabel(event.branches),
            bankAccountLabel(event.bank_accounts),
            event.description ?? "-",
            <details className="audit-details" key={`${event.id}-details`}>
              <summary className="ghost-button compact-button">View details</summary>
              <div className="audit-detail-grid">
                <section>
                  <strong>Before</strong>
                  <pre>{jsonDetails(event.before_data)}</pre>
                </section>
                <section>
                  <strong>After</strong>
                  <pre>{jsonDetails(event.after_data)}</pre>
                </section>
                <section>
                  <strong>Changed fields</strong>
                  <pre>{jsonDetails(event.changed_fields)}</pre>
                </section>
              </div>
            </details>
          ])}
        />
      </section>
    </>
  );
}
