import { createPanelClaim, createPanelCompany, updatePanelCompany } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { DocumentManager } from "@/components/documents/document-manager";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { getDashboardData, getPanelCompanies, totalBy } from "@/lib/data";
import { formatCurrency, formatDate, labelize } from "@/lib/format";
import { outstandingOpeningBalanceTotal } from "@/lib/opening-balances";
import { hasPermission, normalizeRole, requirePermission } from "@/lib/permissions";
import { getTransactionDocuments } from "@/lib/transaction-documents";
import { Building, CalendarClock, FileClock, ShieldCheck } from "lucide-react";

function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill status-${status}`}>{labelize(status)}</span>;
}

export default async function PanelsPage() {
  const profile = await requirePermission("view_panel_records");
  const data = await getDashboardData();
  const panelCompanies = await getPanelCompanies();
  const activePanelCompanies = panelCompanies.filter((company) => company.is_active);
  const claimDocuments = await getTransactionDocuments("panel_claims", data.panels.map((claim) => claim.id));
  const role = normalizeRole(profile.role);
  const canManageMasterData = hasPermission(profile, "edit_finance") && role !== "branch_pic";
  const canDeleteDocuments = role !== "branch_pic";
  const totalClaims = totalBy(data.panels, (claim) => claim.amount);
  const openingOutstanding = outstandingOpeningBalanceTotal(data.openingBalances, "panel_outstanding");
  const outstanding = openingOutstanding + totalBy(
    data.panels.filter((claim) => claim.status !== "paid"),
    (claim) => claim.amount
  );
  const unpaid = data.panels.filter((claim) => claim.status === "unpaid").length;

  return (
    <>
      <ModuleHeader
        eyebrow="Receivables"
        title="Panel outstanding"
        description="Track panel company claims, payment status, and a simple aging view for clinic finance follow-up."
      />

      <section className="dashboard-grid">
        <MetricCard icon={ShieldCheck} label="Total claims" value={formatCurrency(totalClaims)} />
        <MetricCard icon={FileClock} label="Outstanding" value={formatCurrency(outstanding)} detail="Opening balance plus unpaid claims" tone="blue" />
        <MetricCard icon={CalendarClock} label="Unpaid claims" value={String(unpaid)} tone="amber" />
        <MetricCard icon={Building} label="Panel companies" value={String(panelCompanies.length)} tone="rose" />
      </section>

      <section className="section-grid">
        <DataTable
          columns={["Claim month", "Panel", "Branch", "Claim no.", "Due", "Status", "Amount", "Documents"]}
          rows={data.panels.map((claim) => [
            formatDate(claim.claim_month),
            claim.panel_companies?.name ?? "-",
            claim.branches?.name ?? "-",
            claim.claim_no ?? "-",
            formatDate(claim.due_date),
            <StatusPill key={claim.id} status={claim.status} />,
            formatCurrency(claim.amount),
            <DocumentManager
              canDelete={canDeleteDocuments}
              documents={claimDocuments.get(claim.id) ?? []}
              entityId={claim.id}
              entityName="panel_claims"
              key={`${claim.id}-documents`}
            />
          ])}
        />

        <div className="cards-grid single-column">
          <form action={createPanelClaim} className="form-card">
            <h2>Record panel claim</h2>
            <label>
              Panel company
              <select name="panel_company_id" required>
                {activePanelCompanies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Branch
              <select name="branch_id" required>
                {data.branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Claim no.
              <input name="claim_no" />
            </label>
            <label>
              Claim month
              <input name="claim_month" type="date" required />
            </label>
            <label>
              Submitted date
              <input name="submitted_date" type="date" />
            </label>
            <label>
              Due date
              <input name="due_date" type="date" />
            </label>
            <label>
              Amount
              <input min="0" name="amount" required step="0.01" type="number" />
            </label>
            <label>
              Status
              <select name="status">
                <option value="unpaid">Unpaid</option>
                <option value="partial">Partial</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
              </select>
            </label>
            <label>
              Notes
              <textarea name="notes" />
            </label>
            <button className="primary-button" type="submit">
              Save panel claim
            </button>
          </form>

          {canManageMasterData ? (
          <form action={createPanelCompany} className="form-card">
            <h2>Panel company management</h2>
            <label>
              Company name
              <input name="name" required />
            </label>
            <label>
              Contact person
              <input name="contact_person" />
            </label>
            <label>
              Phone
              <input name="phone" />
            </label>
            <label>
              Email
              <input name="email" type="email" />
            </label>
            <label>
              Address
              <textarea name="address" />
            </label>
            <label>
              Notes
              <textarea name="notes" />
            </label>
            <label>
              Status
              <select name="is_active" defaultValue="true">
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
            <button className="primary-button" type="submit">
              Add Panel Company
            </button>
          </form>
          ) : null}

          <div className="table-section">
            <div className="report-toolbar">
              <h2>Panel company directory</h2>
            </div>
            <DataTable
              columns={["Company", "Contact", "Phone", "Email", "Status", "Edit"]}
              rows={panelCompanies.map((company) => [
                company.name,
                company.contact_person ?? "-",
                company.phone ?? "-",
                company.email ?? "-",
                <span className={`status-pill ${company.is_active ? "status-paid" : "status-overdue"}`} key={`${company.id}-status`}>
                  {company.is_active ? "Active" : "Inactive"}
                </span>,
                canManageMasterData ? (
                  <details className="manual-bank-editor" key={`${company.id}-edit`}>
                    <summary>Edit</summary>
                    <form action={updatePanelCompany} className="manual-bank-edit-form">
                      <input name="panel_company_id" type="hidden" value={company.id} />
                      <label>
                        Company name
                        <input defaultValue={company.name} name="name" required />
                      </label>
                      <label>
                        Contact person
                        <input defaultValue={company.contact_person ?? ""} name="contact_person" />
                      </label>
                      <label>
                        Phone
                        <input defaultValue={company.phone ?? ""} name="phone" />
                      </label>
                      <label>
                        Email
                        <input defaultValue={company.email ?? ""} name="email" type="email" />
                      </label>
                      <label>
                        Address
                        <textarea defaultValue={company.address ?? ""} name="address" />
                      </label>
                      <label>
                        Notes
                        <textarea defaultValue={company.notes ?? ""} name="notes" />
                      </label>
                      <label>
                        Status
                        <select defaultValue={company.is_active ? "true" : "false"} name="is_active">
                          <option value="true">Active</option>
                          <option value="false">Inactive</option>
                        </select>
                      </label>
                      <button className="primary-button compact-button" type="submit">
                        Save
                      </button>
                    </form>
                  </details>
                ) : (
                  "-"
                )
              ])}
            />
          </div>
        </div>
      </section>
    </>
  );
}
