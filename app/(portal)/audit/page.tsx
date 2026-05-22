import { DataTable } from "@/components/data-table";
import { ExportCsvLink } from "@/components/export-csv-link";
import { ModuleHeader } from "@/components/module-header";
import { bankAccountLabel, branchLabel } from "@/lib/bank-reporting";
import { getAuditChangedFields, getAuditEvents } from "@/lib/audit";
import { byteSize, shortId, userDisplayLabel } from "@/lib/display";
import { formatCurrency, formatDate, formatDateTime, labelize } from "@/lib/format";
import { requirePermission } from "@/lib/permissions";
import { getUserManagementData } from "@/lib/users";
import type { AuditEvent, AuditSnapshot, BankAccount, Branch, Profile } from "@/lib/types";

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

const auditActions = ["create", "update", "void", "delete", "document_upload", "document_delete", "role_change", "permission_change"];

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
  "petty_cash_transactions",
  "opening_balances",
  "transaction_documents"
];

const auditActionLabels: Record<string, string> = {
  create: "Created",
  delete: "Deleted",
  document_delete: "Document Deleted",
  document_upload: "Document Uploaded",
  permission_change: "Permission Changed",
  role_change: "Role Changed",
  update: "Updated",
  void: "Voided"
};

const auditEntityLabels: Record<string, string> = {
  bank_account_permissions: "Bank Permission",
  bank_accounts: "Bank Account",
  bank_transactions: "Bank Transaction",
  branches: "Branch",
  cash_bank_ins: "Cash Bank-In",
  daily_sales: "Daily Sales",
  expenses: "Expense",
  opening_balances: "Opening Balance",
  panel_claims: "Panel Claim",
  panel_companies: "Panel Company",
  panel_payments: "Panel Payment",
  petty_cash_transactions: "Petty Cash",
  profiles: "User Profile",
  supplier_payments: "Supplier Payment",
  supplier_purchases: "Supplier Purchase",
  suppliers: "Supplier",
  transaction_documents: "Document"
};

const auditFieldLabels: Record<string, string> = {
  account_no: "Account no.",
  amount: "Amount",
  bank_account_id: "Bank account",
  bank_in_date: "Bank-in date",
  bank_name: "Bank name",
  bank_transfer_amount: "Bank transfer amount",
  balance_date: "Balance date",
  balance_type: "Balance type",
  branch_id: "Branch",
  can_create_transaction: "Can create transaction",
  can_edit_transaction: "Can edit transaction",
  can_manage_account: "Can manage account",
  can_view: "Can view",
  card_amount: "Card amount",
  cash_amount: "Cash amount",
  claim_month: "Claim month",
  compressed_size_bytes: "Stored file size",
  document_type: "Document type",
  expense_date: "Expense date",
  file_name: "File name",
  file_size_bytes: "Original file size",
  full_name: "Full name",
  is_active: "Status",
  is_void: "Status",
  payment_date: "Payment date",
  panel_company_id: "Panel company",
  purchase_date: "Purchase date",
  qr_amount: "QR amount",
  reference_no: "Reference",
  related_bank_account_id: "Related bank account",
  reviewed_at: "Reviewed at",
  reviewed_by: "Reviewed by",
  sale_date: "Sale date",
  source_notes: "Source notes",
  source_reference: "Source reference",
  supplier_id: "Supplier",
  transaction_date: "Transaction date",
  transaction_type: "Transaction type",
  transfer_group_id: "Transfer group",
  user_id: "User",
  verification_status: "Verification status",
  void_reason: "Void reason",
  voided_at: "Voided at",
  voided_by: "Voided by"
};

function jsonDetails(value: AuditEvent["after_data"]) {
  return value ? JSON.stringify(value, null, 2) : "No data.";
}

type AuditReferences = {
  bankAccountById: Map<string, BankAccount>;
  branchById: Map<string, Branch>;
  userById: Map<string, Profile>;
};

function auditActionLabel(action: string) {
  return auditActionLabels[action] ?? labelize(action);
}

function auditEntityLabel(entityName: string) {
  return auditEntityLabels[entityName] ?? labelize(entityName);
}

function snapshot(value: AuditSnapshot | null | undefined) {
  return value && !Array.isArray(value) ? value : {};
}

function auditFieldLabel(field: string) {
  return auditFieldLabels[field] ?? labelize(field);
}

function isMoneyField(field: string) {
  return field === "amount" || field.endsWith("_amount") || field.endsWith("_cost");
}

function isUserField(field: string) {
  return ["actor_id", "created_by", "deleted_by", "entered_by", "granted_by", "reviewed_by", "updated_by", "uploaded_by", "user_id", "voided_by"].includes(field);
}

function formatAuditValue(field: string, value: unknown, references: AuditReferences) {
  if (value === null || value === undefined || value === "") return "-";
  if (field === "is_void") return value ? "Voided" : "Active";
  if (field === "is_active") return value ? "Active" : "Inactive";
  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (field === "branch_id" && typeof value === "string") {
    const branch = references.branchById.get(value);
    return branch ? branchLabel(branch) : shortId(value);
  }
  if ((field === "bank_account_id" || field === "related_bank_account_id") && typeof value === "string") {
    const account = references.bankAccountById.get(value);
    return account ? bankAccountLabel(account) : shortId(value);
  }
  if (isUserField(field) && typeof value === "string") {
    return userDisplayLabel(references.userById.get(value), value);
  }
  if ((field === "file_size_bytes" || field === "compressed_size_bytes") && (typeof value === "number" || typeof value === "string")) {
    return byteSize(value);
  }
  if (isMoneyField(field) && (typeof value === "number" || typeof value === "string") && Number.isFinite(Number(value))) {
    return formatCurrency(Number(value));
  }
  if (field.endsWith("_at") && typeof value === "string") return formatDateTime(value);
  if ((field.endsWith("_date") || field === "claim_month") && typeof value === "string") return formatDate(value);
  if (
    (field.endsWith("_type")
      || field === "category"
      || field === "document_type"
      || field === "direction"
      || field === "source_reference"
      || field === "verification_status")
    && typeof value === "string"
  ) {
    return labelize(value);
  }
  if (typeof value === "string" && field.endsWith("_id")) return shortId(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function readableChanges(event: AuditEvent) {
  const loggedChanges = snapshot(event.changed_fields);
  const changes = Object.keys(loggedChanges).length
    ? loggedChanges
    : getAuditChangedFields(snapshot(event.before_data), snapshot(event.after_data));

  return Object.entries(changes).flatMap(([field, change]) => {
    if (!change || typeof change !== "object" || Array.isArray(change)) return [];
    const before = "before" in change ? change.before : null;
    const after = "after" in change ? change.after : null;
    return [{ after, before, field }];
  });
}

function snapshotValue(event: AuditEvent, field: string) {
  return snapshot(event.after_data)[field] ?? snapshot(event.before_data)[field] ?? null;
}

function auditRecordSummary(event: AuditEvent, references: AuditReferences) {
  const values = [
    auditEntityLabel(event.entity_name),
    formatAuditValue("branch_id", event.branch_id ?? snapshotValue(event, "branch_id"), references),
    formatAuditValue("bank_account_id", event.bank_account_id ?? snapshotValue(event, "bank_account_id"), references),
    formatAuditValue(
      "record_date",
      snapshotValue(event, "sale_date")
        ?? snapshotValue(event, "bank_in_date")
        ?? snapshotValue(event, "transaction_date")
        ?? snapshotValue(event, "expense_date")
        ?? snapshotValue(event, "purchase_date")
        ?? snapshotValue(event, "payment_date")
        ?? snapshotValue(event, "balance_date")
        ?? snapshotValue(event, "claim_month"),
      references
    ),
    formatAuditValue("amount", snapshotValue(event, "amount"), references)
  ].filter((value, index, list) => value !== "-" && list.indexOf(value) === index);

  return values.join(" • ");
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
  const auditReferences: AuditReferences = {
    bankAccountById: new Map(references.bankAccounts.map((account) => [account.id, account])),
    branchById: new Map(references.branches.map((branch) => [branch.id, branch])),
    userById: new Map(references.users.map((user) => [user.id, user]))
  };

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
                {auditActionLabel(action)}
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
                {auditEntityLabel(entity)}
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
        <ExportCsvLink label="Export audit CSV" report="audit" searchParams={params} />
      </form>

      <section className="table-section">
        <h2>Recorded changes</h2>
        <DataTable
          columns={["Date / time", "Actor", "Action", "Module", "Branch", "Bank account", "Description", "Details"]}
          rows={events.map((event) => {
            const actorProfile = auditReferences.userById.get(event.actor_id ?? "") ?? event.profiles;
            const changes = readableChanges(event);

            return [
              formatDateTime(event.created_at),
              <span key={`${event.id}-actor`}>
                {userDisplayLabel(actorProfile, event.actor_id, event.actor_email) || "Unknown actor"}
                {event.actor_email ? <span className="table-subtext">{event.actor_email}</span> : null}
              </span>,
              auditActionLabel(event.action),
              <span key={`${event.id}-entity`}>
                {auditEntityLabel(event.entity_name)}
                {event.entity_id ? <span className="table-subtext">Record ID: {shortId(event.entity_id)}</span> : null}
              </span>,
              branchLabel(event.branches ?? auditReferences.branchById.get(event.branch_id ?? "")),
              bankAccountLabel(event.bank_accounts ?? auditReferences.bankAccountById.get(event.bank_account_id ?? "")),
              event.description ?? "-",
              <details className="audit-details" key={`${event.id}-details`}>
                <summary className="ghost-button compact-button">View details</summary>
                <div className="audit-readable-details">
                  <div className="record-summary">
                    <strong>{auditRecordSummary(event, auditReferences)}</strong>
                    {event.entity_id ? <span className="table-subtext">Record ID: {shortId(event.entity_id)}</span> : null}
                  </div>
                  {event.description ? <p className="audit-description">{event.description}</p> : null}
                  {changes.length ? (
                    <table className="audit-change-table">
                      <thead>
                        <tr>
                          <th>Field</th>
                          <th>Before</th>
                          <th>After</th>
                        </tr>
                      </thead>
                      <tbody>
                        {changes.map((change) => (
                          <tr key={`${event.id}-${change.field}`}>
                            <td>{auditFieldLabel(change.field)}</td>
                            <td>{formatAuditValue(change.field, change.before, auditReferences)}</td>
                            <td>{formatAuditValue(change.field, change.after, auditReferences)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="muted-copy">No field changes were recorded.</p>}
                  <details className="audit-raw-details">
                    <summary>Show raw data</summary>
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
                </div>
              </details>
            ];
          })}
        />
      </section>
    </>
  );
}
