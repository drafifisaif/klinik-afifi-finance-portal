import { DataTable } from "@/components/data-table";
import { DocumentManager } from "@/components/documents/document-manager";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { formatCurrency, formatDate } from "@/lib/format";
import { normalizeRole, requireAnyPermission } from "@/lib/permissions";
import { documentStatusLabel, getDocumentReportRows, transactionDocumentEntityLabels } from "@/lib/transaction-documents";
import type { TransactionDocumentEntityName } from "@/lib/types";
import { FileCheck2, FileClock, Files, FolderSearch } from "lucide-react";

type DocumentsSearchParams = {
  branch_id?: string;
  document_type?: string;
  end?: string;
  entity_name?: string;
  period?: string;
  start?: string;
  status?: string;
};

const documentTypes = [
  { label: "All document types", value: "all" },
  { label: "Receipt", value: "receipt" },
  { label: "Invoice", value: "invoice" },
  { label: "Payment proof", value: "payment_proof" },
  { label: "Bank slip", value: "bank_slip" },
  { label: "Claim document", value: "claim_document" },
  { label: "Supporting document", value: "supporting_document" },
  { label: "Other", value: "other" }
];

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<DocumentsSearchParams> }) {
  const profile = await requireAnyPermission([
    "edit_finance",
    "view_supplier_records",
    "view_panel_records",
    "record_cash_bank_in",
    "record_petty_cash",
    "view_bank_position"
  ]);
  const params = await searchParams;
  const report = await getDocumentReportRows({
    branchId: params.branch_id,
    documentType: params.document_type,
    end: params.end,
    entityName: params.entity_name,
    period: params.period,
    start: params.start,
    status: params.status
  });
  const uploadedRows = report.rows.filter((row) => row.documents.length > 0);
  const documentCount = report.rows.reduce((sum, row) => sum + row.documents.length, 0);
  const canDeleteDocuments = normalizeRole(profile.role) !== "branch_pic";

  return (
    <>
      <ModuleHeader
        eyebrow="Supporting records"
        title="Transaction Documents"
        description="Review optional transaction documents and identify finance records that still have no uploaded support."
      />

      <section className="dashboard-grid">
        <MetricCard icon={FolderSearch} label="Transactions" value={String(report.rows.length)} detail="Filtered report rows" />
        <MetricCard icon={FileCheck2} label="With documents" value={String(uploadedRows.length)} detail="Uploaded status" tone="teal" />
        <MetricCard icon={FileClock} label="Missing documents" value={String(report.rows.length - uploadedRows.length)} detail="Optional Phase 1 uploads" tone="amber" />
        <MetricCard icon={Files} label="Documents" value={String(documentCount)} detail="Visible files" tone="blue" />
      </section>

      <form className="reporting-filter document-report-filter" method="get">
        <label>
          Date filter
          <select name="period" defaultValue={report.filters.period}>
            <option value="today">Today</option>
            <option value="this_month">This month</option>
            <option value="last_month">Last month</option>
            <option value="custom">Custom date range</option>
          </select>
        </label>
        <label>
          Start date
          <input name="start" type="date" defaultValue={report.filters.start} />
        </label>
        <label>
          End date
          <input name="end" type="date" defaultValue={report.filters.end} />
        </label>
        <label>
          Branch
          <select name="branch_id" defaultValue={report.filters.branchId}>
            <option value="all">All branches</option>
            {report.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Transaction type
          <select name="entity_name" defaultValue={report.filters.entityName}>
            <option value="all">All transaction types</option>
            {(Object.entries(transactionDocumentEntityLabels) as [TransactionDocumentEntityName, string][]).map(([entityName, label]) => (
              <option key={entityName} value={entityName}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Document status
          <select name="status" defaultValue={report.filters.status}>
            <option value="all">Uploaded and missing</option>
            <option value="uploaded">Uploaded</option>
            <option value="missing">Missing</option>
          </select>
        </label>
        <label>
          Document type
          <select name="document_type" defaultValue={report.filters.documentType}>
            {documentTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        <button className="primary-button" type="submit">
          Apply
        </button>
      </form>

      <section className="table-section mt-section">
        <h2>Document report</h2>
        <DataTable
          columns={["Date", "Transaction type", "Branch", "Reference", "Amount", "Status", "Documents"]}
          rows={report.rows.map((row) => [
            formatDate(row.date),
            transactionDocumentEntityLabels[row.entityName],
            row.branchName,
            row.description || "-",
            row.amount === null || row.amount === undefined ? "-" : formatCurrency(row.amount),
            <span className={`status-pill ${row.documents.length ? "status-paid" : "status-unpaid"}`} key={`${row.entityId}-status`}>
              {documentStatusLabel(row.documents.length)}
            </span>,
            <DocumentManager
              canDelete={canDeleteDocuments}
              documents={row.documents}
              entityId={row.entityId}
              entityName={row.entityName}
              key={`${row.entityId}-documents`}
            />
          ])}
        />
      </section>
    </>
  );
}
