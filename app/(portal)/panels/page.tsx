import { createPanelClaim, createPanelCompany, updatePanelClaim, updatePanelCompany } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { DocumentManager } from "@/components/documents/document-manager";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { PanelPaymentForm } from "@/components/panel-payment-form";
import { getBankingDataForScope, getDashboardData, getPanelCompanies, totalBy } from "@/lib/data";
import { formatCurrency, formatDate, labelize } from "@/lib/format";
import { outstandingOpeningBalanceTotal } from "@/lib/opening-balances";
import { canEditBranch, hasPermission, normalizeRole, requirePermission } from "@/lib/permissions";
import { getTransactionDocuments } from "@/lib/transaction-documents";
import { Building, CalendarClock, FileClock, ShieldCheck } from "lucide-react";

function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill status-${status}`}>{labelize(status)}</span>;
}

function panelClaimPriority(status: string, dueDate?: string | null, outstandingAmount = 0) {
  const today = new Date().toISOString().slice(0, 10);
  if (status === "paid" || outstandingAmount <= 0) return 2;
  if (dueDate && dueDate < today) return 0;
  return 1;
}

export default async function PanelsPage() {
  const profile = await requirePermission("view_panel_records");
  const data = await getDashboardData();
  const bankingData = await getBankingDataForScope({ bankAccessOnly: true });
  const panelCompanies = await getPanelCompanies();
  const activePanelCompanies = panelCompanies.filter((company) => company.is_active);
  const claimDocuments = await getTransactionDocuments("panel_claims", data.panels.map((claim) => claim.id));
  const role = normalizeRole(profile.role);
  const canManageMasterData = hasPermission(profile, "edit_finance") && role !== "branch_pic";
  const canDeleteDocuments = role !== "branch_pic";
  const totalClaims = totalBy(data.panels, (claim) => claim.amount);
  const panelPaymentsByClaimId = new Map<string, number>();
  data.panelPayments.forEach((payment) => {
    panelPaymentsByClaimId.set(payment.panel_claim_id, (panelPaymentsByClaimId.get(payment.panel_claim_id) ?? 0) + payment.amount);
  });
  const openingOutstanding = outstandingOpeningBalanceTotal(data.openingBalances, "panel_outstanding");
  const outstanding = openingOutstanding + totalBy(
    data.panels.filter((claim) => claim.status !== "paid"),
    (claim) => claim.amount
  );
  const unpaid = data.panels.filter((claim) => claim.status === "unpaid").length;
  const groupedClaims = Array.from(
    data.panels.reduce<Map<string, typeof data.panels>>((groups, claim) => {
      const key = claim.panel_company_id;
      const items = groups.get(key) ?? [];
      items.push(claim);
      groups.set(key, items);
      return groups;
    }, new Map())
  ).map(([panelCompanyId, claims]) => {
    const rows = claims.map((claim) => {
      const paidAmount = panelPaymentsByClaimId.get(claim.id) ?? 0;
      const balanceAmount = Math.max(0, claim.amount - paidAmount);
      const displayStatus = balanceAmount <= 0 ? "paid" : claim.status === "partial" || paidAmount > 0 ? "partial" : claim.status === "paid" ? "paid" : "unpaid";
      return {
        balanceAmount,
        claim,
        displayStatus,
        paidAmount,
        priority: panelClaimPriority(displayStatus, claim.due_date, balanceAmount)
      };
    }).sort((first, second) => {
      if (first.priority !== second.priority) return first.priority - second.priority;
      if (first.priority === 0 || first.priority === 1) {
        return (first.claim.due_date ?? "9999-12-31").localeCompare(second.claim.due_date ?? "9999-12-31");
      }
      return (second.claim.claim_month ?? "").localeCompare(first.claim.claim_month ?? "");
    });

    return {
      balanceAmount: totalBy(rows, (row) => row.balanceAmount),
      paidAmount: totalBy(rows, (row) => row.paidAmount),
      panelCompanyId,
      panelLabel: rows[0]?.claim.panel_companies?.name ?? "Panel company",
      paidCount: rows.filter((row) => row.displayStatus === "paid").length,
      partialCount: rows.filter((row) => row.displayStatus === "partial").length,
      rows,
      totalAmount: totalBy(rows, (row) => row.claim.amount),
      unpaidCount: rows.filter((row) => row.displayStatus === "unpaid").length
    };
  }).sort((first, second) => first.panelLabel.localeCompare(second.panelLabel));

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

      <section className="table-section mt-section">
        <div className="ledger-group-list">
          {groupedClaims.map((group) => (
            <article className="ledger-group-card" key={group.panelCompanyId}>
              <div className="ledger-group-header">
                <div>
                  <h3>{group.panelLabel}</h3>
                  <p>{group.rows.length} claims</p>
                </div>
                <div className="ledger-group-summary">
                  <span className="ledger-summary-chip">Total {formatCurrency(group.totalAmount)}</span>
                  <span className="ledger-summary-chip">Paid {formatCurrency(group.paidAmount)}</span>
                  <span className="ledger-summary-chip">Balance {formatCurrency(group.balanceAmount)}</span>
                  <span className="ledger-summary-chip">{group.unpaidCount} unpaid</span>
                  <span className="ledger-summary-chip">{group.partialCount} partial</span>
                  <span className="ledger-summary-chip">{group.paidCount} paid</span>
                </div>
              </div>
              <DataTable
                columns={["Claim month", "Branch", "Claim no.", "Due", "Status", "Amount", "Paid", "Balance", "Edit", "Documents"]}
                rows={group.rows.map(({ claim, displayStatus, paidAmount, balanceAmount }) => [
                  formatDate(claim.claim_month),
                  claim.branches?.name ?? "-",
                  claim.claim_no ?? "-",
                  formatDate(claim.due_date),
                  <StatusPill key={claim.id} status={displayStatus} />,
                  formatCurrency(claim.amount),
                  formatCurrency(paidAmount),
                  formatCurrency(balanceAmount),
                  canEditBranch(profile, claim.branch_id) ? (
                    <details className="manual-bank-editor" key={`${claim.id}-edit`}>
                      <summary>Edit</summary>
                      <form action={updatePanelClaim} className="manual-bank-edit-form">
                        <input name="claim_id" type="hidden" value={claim.id} />
                        <label>
                          Panel company
                          <select defaultValue={claim.panel_company_id} name="panel_company_id" required>
                            {activePanelCompanies.map((company) => (
                              <option key={company.id} value={company.id}>
                                {company.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Branch
                          <select defaultValue={claim.branch_id} name="branch_id" required>
                            {data.branches.map((branch) => (
                              <option key={branch.id} value={branch.id}>
                                {branch.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Claim no.
                          <input defaultValue={claim.claim_no ?? ""} name="claim_no" />
                        </label>
                        <label>
                          Claim month
                          <input defaultValue={claim.claim_month} name="claim_month" required type="date" />
                        </label>
                        <label>
                          Submitted date
                          <input defaultValue={claim.submitted_date ?? ""} name="submitted_date" type="date" />
                        </label>
                        <label>
                          Due date
                          <input defaultValue={claim.due_date ?? ""} name="due_date" type="date" />
                        </label>
                        <label>
                          Amount
                          <input defaultValue={claim.amount} min="0" name="amount" required step="0.01" type="number" />
                        </label>
                        <label>
                          Status
                          <select defaultValue={claim.status} name="status">
                            <option value="unpaid">Unpaid</option>
                            <option value="partial">Partial</option>
                            <option value="paid">Paid</option>
                            <option value="overdue">Overdue</option>
                          </select>
                        </label>
                        <label>
                          Notes
                          <textarea defaultValue={claim.notes ?? ""} name="notes" />
                        </label>
                        <button className="primary-button compact-button" type="submit">
                          Save
                        </button>
                      </form>
                    </details>
                  ) : (
                    "-"
                  ),
                  <DocumentManager
                    canDelete={canDeleteDocuments}
                    documents={claimDocuments.get(claim.id) ?? []}
                    entityId={claim.id}
                    entityName="panel_claims"
                    key={`${claim.id}-documents`}
                  />
                ])}
              />
            </article>
          ))}
        </div>
      </section>

      <section className="table-section mt-section">
        <div className="report-toolbar">
          <h2>Panel payment records</h2>
        </div>
        <DataTable
          columns={["Date", "Panel Company", "Claim", "Branch", "Method", "Received Into", "Reference", "Amount"]}
          rows={data.panelPayments.map((payment) => [
            formatDate(payment.payment_date),
            payment.panel_companies?.name ?? "-",
            payment.panel_claims?.claim_no ?? payment.panel_claim_id,
            payment.branches?.name ?? "-",
            labelize(payment.payment_type),
            payment.bank_accounts?.name ?? "-",
            payment.reference_no ?? "-",
            formatCurrency(payment.amount)
          ])}
        />
      </section>

      <section className="section-grid mt-section">
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

          <PanelPaymentForm
            claims={data.panels}
            panelCompanies={panelCompanies}
            panelPayments={data.panelPayments}
            bankAccounts={bankingData.bankAccounts}
          />

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
