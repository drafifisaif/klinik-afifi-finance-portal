import { DataTable } from "@/components/data-table";
import { ModuleHeader } from "@/components/module-header";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient, hasSupabaseEnv } from "@/lib/supabase-server";
import { canViewAllBranches, normalizeRole, requirePermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

type DataDebugSearchParams = {
  branch?: string;
  end?: string;
  module?: string;
  start?: string;
};

type DebugModule = {
  branchColumn?: string;
  dateColumn: string;
  key: string;
  label: string;
  orderColumn?: string;
  select: string;
  table: string;
  voidColumn?: string;
};

type DebugQueryError = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};

type DebugQueryResult = {
  count: number | null;
  data: Record<string, unknown>[] | null;
  error: DebugQueryError | null;
};

type DebugQuery = {
  eq: (column: string, value: string | boolean) => DebugQuery;
  gte: (column: string, value: string) => DebugQuery;
  lt: (column: string, value: string) => DebugQuery;
  order: (column: string, options?: { ascending?: boolean }) => DebugQuery;
  limit: (count: number) => Promise<DebugQueryResult>;
};

const debugModules: DebugModule[] = [
  {
    branchColumn: "branch_id",
    dateColumn: "sale_date",
    key: "daily_sales",
    label: "Daily Sales",
    select: "id, branch_id, sale_date, total_amount, is_void, created_at",
    table: "daily_sales",
    voidColumn: "is_void"
  },
  {
    branchColumn: "branch_id",
    dateColumn: "expense_date",
    key: "expenses",
    label: "Expenses",
    select: "id, branch_id, expense_date, category, vendor_name, amount, is_void, created_at",
    table: "expenses",
    voidColumn: "is_void"
  },
  {
    branchColumn: "branch_id",
    dateColumn: "bank_in_date",
    key: "cash_bank_ins",
    label: "Cash Bank-In",
    select: "id, branch_id, bank_account_id, bank_in_date, amount, is_void, created_at",
    table: "cash_bank_ins",
    voidColumn: "is_void"
  },
  {
    branchColumn: "branch_id",
    dateColumn: "transaction_date",
    key: "petty_cash_transactions",
    label: "Petty Cash",
    select: "id, branch_id, bank_account_id, transaction_date, transaction_type, amount, is_void, created_at",
    table: "petty_cash_transactions",
    voidColumn: "is_void"
  },
  {
    branchColumn: "branch_id",
    dateColumn: "claim_month",
    key: "panel_claims",
    label: "Panel Claims",
    select: "id, branch_id, panel_company_id, claim_no, claim_month, due_date, amount, is_void, created_at",
    table: "panel_claims",
    voidColumn: "is_void"
  },
  {
    branchColumn: "panel_claims.branch_id",
    dateColumn: "payment_date",
    key: "panel_payments",
    label: "Panel Payments",
    select: "id, panel_claim_id, bank_account_id, payment_date, amount, is_void, created_at, panel_claims!inner(branch_id, claim_no)",
    table: "panel_payments",
    voidColumn: "is_void"
  },
  {
    branchColumn: "branch_id",
    dateColumn: "purchase_date",
    key: "supplier_purchase_entries",
    label: "Supplier Purchases V2",
    select: "id, supplier_id, branch_id, invoice_no, purchase_date, due_date, total_amount, is_void, created_at",
    table: "supplier_purchase_entries",
    voidColumn: "is_void"
  },
  {
    branchColumn: "branch_id",
    dateColumn: "payment_date",
    key: "supplier_payment_entries",
    label: "Supplier Payments V2",
    select: "id, supplier_id, branch_id, bank_account_id, payment_date, amount, is_void, created_at",
    table: "supplier_payment_entries",
    voidColumn: "is_void"
  },
  {
    branchColumn: "branch_id",
    dateColumn: "created_at",
    key: "transaction_documents",
    label: "Documents",
    select: "id, entity_name, entity_id, branch_id, bank_account_id, file_name, created_at, deleted_at",
    table: "transaction_documents",
    voidColumn: "deleted_at"
  }
];

function todayMonthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function addOneDay(dateString: string) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function compactRow(row: Record<string, unknown>, module: DebugModule) {
  const branchValue = module.branchColumn?.includes(".")
    ? row.panel_claims && typeof row.panel_claims === "object" && "branch_id" in row.panel_claims
      ? (row.panel_claims as { branch_id?: unknown }).branch_id
      : null
    : module.branchColumn
      ? row[module.branchColumn]
      : null;

  return {
    id: row.id,
    branch_id: branchValue,
    date: row[module.dateColumn],
    amount: row.amount ?? row.total_amount,
    status: module.voidColumn ? row[module.voidColumn] : null,
    sample: row
  };
}

async function runDebugQuery(client: unknown, module: DebugModule, startDate: string, endExclusive: string, branchId: string) {
  const supabase = client as {
    from: (table: string) => {
      select: (columns: string, options?: { count?: "exact" }) => unknown;
    };
  };

  let query = supabase
    .from(module.table)
    .select(module.select, { count: "exact" }) as DebugQuery;

  query = query.gte(module.dateColumn, startDate).lt(module.dateColumn, endExclusive);

  if (branchId !== "all" && module.branchColumn) {
    query = query.eq(module.branchColumn, branchId);
  }

  const result = await query.order(module.orderColumn ?? module.dateColumn, { ascending: false }).limit(20);
  const rows = result.data ?? [];
  const voidedCount = module.voidColumn
    ? rows.filter((row) => module.voidColumn === "deleted_at" ? Boolean(row.deleted_at) : row[module.voidColumn!] === true).length
    : 0;

  return {
    count: result.count ?? 0,
    error: result.error,
    rows: rows.map((row) => compactRow(row, module)),
    voidedCount
  };
}

export default async function DataDebugPage({ searchParams }: { searchParams: Promise<DataDebugSearchParams> }) {
  const profile = await requirePermission("view_reports");
  const params = await searchParams;
  const role = normalizeRole(profile.role);

  if (!["owner", "admin", "finance"].includes(role)) {
    return (
      <>
        <ModuleHeader eyebrow="Diagnostics" title="Data debug" description="This diagnostic view is only available to finance management users." />
        <section className="table-section">
          <p className="void-warning">You do not have permission to view data diagnostics.</p>
        </section>
      </>
    );
  }

  const selectedModule = debugModules.find((item) => item.key === params.module) ?? debugModules[0];
  const startDate = params.start ?? todayMonthStart();
  const endDate = params.end ?? new Date().toISOString().slice(0, 10);
  const endExclusive = addOneDay(endDate);
  const supabase = await createClient();
  const { data: branches } = await supabase.from("branches").select("id, name, code").order("name");
  const branchId = canViewAllBranches(profile) ? params.branch ?? "all" : profile.branch_id ?? "all";

  let rawResult: Awaited<ReturnType<typeof runDebugQuery>> | null = null;
  let visibleResult: Awaited<ReturnType<typeof runDebugQuery>> | null = null;
  let setupError: string | null = null;

  if (hasSupabaseEnv()) {
    try {
      const admin = createAdminClient();
      [rawResult, visibleResult] = await Promise.all([
        runDebugQuery(admin, selectedModule, startDate, endExclusive, branchId),
        runDebugQuery(supabase, selectedModule, startDate, endExclusive, branchId)
      ]);
    } catch (error) {
      setupError = error instanceof Error ? error.message : String(error);
    }
  } else {
    setupError = "Supabase environment is not configured.";
  }

  const samples = visibleResult?.rows ?? rawResult?.rows ?? [];

  return (
    <>
      <ModuleHeader
        eyebrow="Diagnostics"
        title="Data debug"
        description="Compare raw database rows with rows visible through the current app session, date filters, branch filters, and void flags."
      />

      <section className="table-section">
        <form className="reporting-filter audit-filter" method="get">
          <label>
            Module
            <select name="module" defaultValue={selectedModule.key}>
              {debugModules.map((module) => (
                <option key={module.key} value={module.key}>
                  {module.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Branch
            <select name="branch" defaultValue={branchId}>
              <option value="all">All Branches</option>
              {(branches ?? []).map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start date
            <input name="start" type="date" defaultValue={startDate} />
          </label>
          <label>
            End date
            <input name="end" type="date" defaultValue={endDate} />
          </label>
          <button className="primary-button" type="submit">
            Apply
          </button>
          <p className="selected-branches">
            Table {selectedModule.table} · date column {selectedModule.dateColumn} · branch filter {selectedModule.branchColumn ?? "none"} · end date is treated as inclusive in the form and exclusive in the query.
          </p>
        </form>
      </section>

      {setupError ? (
        <section className="table-section mt-section">
          <p className="void-warning">{setupError}</p>
        </section>
      ) : null}

      <section className="dashboard-grid mt-section">
        <div className="metric-card">
          <div>
            <p>Raw DB count</p>
            <strong>{rawResult?.error ? "Error" : String(rawResult?.count ?? 0)}</strong>
            <span>Service-role server read</span>
          </div>
        </div>
        <div className="metric-card">
          <div>
            <p>RLS-visible count</p>
            <strong>{visibleResult?.error ? "Error" : String(visibleResult?.count ?? 0)}</strong>
            <span>Current user session read</span>
          </div>
        </div>
        <div className="metric-card">
          <div>
            <p>Voided/deleted in sample</p>
            <strong>{String(visibleResult?.voidedCount ?? rawResult?.voidedCount ?? 0)}</strong>
            <span>First 20 returned rows only</span>
          </div>
        </div>
        <div className="metric-card">
          <div>
            <p>Sample rows</p>
            <strong>{String(samples.length)}</strong>
            <span>Rendered below</span>
          </div>
        </div>
      </section>

      {(rawResult?.error || visibleResult?.error) ? (
        <section className="table-section mt-section">
          <h2>Query errors</h2>
          <DataTable
            columns={["Scope", "Code", "Message", "Details", "Hint"]}
            rows={[
              rawResult?.error ? ["Raw", rawResult.error.code ?? "-", rawResult.error.message ?? "-", rawResult.error.details ?? "-", rawResult.error.hint ?? "-"] : null,
              visibleResult?.error ? ["Visible", visibleResult.error.code ?? "-", visibleResult.error.message ?? "-", visibleResult.error.details ?? "-", visibleResult.error.hint ?? "-"] : null
            ].filter((row): row is string[] => Boolean(row))}
          />
        </section>
      ) : null}

      <section className="table-section mt-section">
        <h2>Sample rows</h2>
        <DataTable
          columns={["ID", "Branch", "Date", "Amount", "Void/delete flag", "Sample"]}
          rows={samples.map((row) => [
            String(row.id ?? "-"),
            String(row.branch_id ?? "-"),
            String(row.date ?? "-"),
            String(row.amount ?? "-"),
            String(row.status ?? "-"),
            <pre key={`${row.id}-sample`} className="audit-json">{JSON.stringify(row.sample, null, 2)}</pre>
          ])}
        />
      </section>
    </>
  );
}
