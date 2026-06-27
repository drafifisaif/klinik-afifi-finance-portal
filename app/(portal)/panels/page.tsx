import { createPanelClaim, createPanelCompany, updatePanelClaim, updatePanelCompany, updatePanelPayment, voidPanelClaim } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { DocumentManager } from "@/components/documents/document-manager";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { PanelPaymentForm } from "@/components/panel-payment-form";
import { getDashboardData, getPanelCompanies, getPanelPaymentBankAccounts, totalBy } from "@/lib/data";
import { formatCurrency, formatDate, labelize } from "@/lib/format";
import { outstandingOpeningBalanceTotal } from "@/lib/opening-balances";
import { activePanelClaims, panelClaimDisplayStatus, panelClaimOutstandingAmount, panelPaymentsByClaimId, panelReceivingBankAccounts, panelReceivingBankError } from "@/lib/panel-accounting";
import { canEditBranch, canViewAllBranches, hasPermission, normalizeRole, requirePermission } from "@/lib/permissions";
import { getTransactionDocuments } from "@/lib/transaction-documents";
import { Building, CalendarClock, FileClock, ShieldCheck } from "lucide-react";

type PanelsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function searchValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill status-${status}`}>{labelize(status)}</span>;
}

function panelClaimPriority(status: string, dueDate?: string | null, outstandingAmount = 0) {
  const today = new Date().toISOString().slice(0, 10);
  if (status === "voided") return 3;
  if (status === "paid" || outstandingAmount <= 0) return 2;
  if (dueDate && dueDate < today) return 0;
  return 1;
}

export default async function PanelsPage({ searchParams }: PanelsPageProps) {
  const profile = await requirePermission("view_panel_records");
  const data = await getDashboardData();
  const panelPaymentBanking = await getPanelPaymentBankAccounts();
  const panelCompanies = await getPanelCompanies();
  const params = searchParams ? await searchParams : {};
  const errorMessage = searchValue(params.error);
  const selectedBranchFilter = searchValue(params.branch);
  const visibleBranchIds = canViewAllBranches(profile)
    ? new Set(data.branches.map((branch) => branch.id))
    : new Set(profile.branch_id ? [profile.branch_id] : []);
  const effectiveBranchId = selectedBranchFilter && visibleBranchIds.has(selectedBranchFilter)
    ? selectedBranchFilter
    : null;
  const filteredClaims = data.panels.filter((claim) => visibleBranchIds.has(claim.branch_id) && (!effectiveBranchId || claim.branch_id === effectiveBranchId));
  const filteredPayments = data.panelPayments.filter((payment) => {
    const branchId = payment.branch_id ?? payment.panel_claims?.branch_id ?? null;
    return Boolean(branchId && visibleBranchIds.has(branchId) && (!effectiveBranchId || branchId === effectiveBranchId));
  });
  const activePanelCompanies = panelCompanies.filter((company) => company.is_active);
  const claimDocuments = await getTransactionDocuments("panel_claims", filteredClaims.map((claim) => claim.id));
  const role = normalizeRole(profile.role);
  const canManageMasterData = hasPermission(profile, "edit_finance") && role !== "branch_pic";
  const canDeleteDocuments = role !== "branch_pic";
  const totalClaims = totalBy(activePanelClaims(filteredClaims), (claim) => claim.amount);
  const claimPaidTotals = panelPaymentsByClaimId(filteredPayments);
  const openingOutstanding = outstandingOpeningBalanceTotal(data.openingBalances, "panel_outstanding");
  const outstanding = openingOutstanding + totalBy(
    activePanelClaims(filteredClaims),
    (claim) => panelClaimOutstandingAmount(claim, filteredPayments)
  );
  const unpaid = activePanelClaims(filteredClaims).filter((claim) => panelClaimDisplayStatus(claim, filteredPayments) === "unpaid").length;
  const uniquePanelCompanyCount = new Set(filteredClaims.map((claim) => claim.panel_company_id)).size;
  const groupedClaims = Array.from(
    filteredClaims.reduce<Map<string, typeof filteredClaims>>((groups, claim) => {
      const key = `${claim.branch_id}::${claim.panel_company_id}`;
      const items = groups.get(key) ?? [];
      items.push(claim);
      groups.set(key, items);
      return groups;
    }, new Map())
  ).map(([groupKey, claims]) => {
    const rows = claims.map((claim) => {
      const paidAmount = claimPaidTotals.get(claim.id) ?? 0;
      const balanceAmount = panelClaimOutstandingAmount(claim, filteredPayments);
      const displayStatus = panelClaimDisplayStatus(claim, filteredPayments);
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
      branchId: rows[0]?.claim.branch_id ?? "",
      branchLabel: rows[0]?.claim.branches?.name ?? "Branch",
      balanceAmount: totalBy(rows, (row) => row.balanceAmount),
      paidAmount: totalBy(rows, (row) => row.paidAmount),
      groupKey,
      panelCompanyId: rows[0]?.claim.panel_company_id ?? "",
      panelLabel: rows[0]?.claim.panel_companies?.name ?? "Panel company",
      paidCount: rows.filter((row) => row.displayStatus === "paid").length,
      partialCount: rows.filter((row) => row.displayStatus === "partial").length,
      rows,
      totalAmount: totalBy(rows.filter((row) => row.displayStatus !== "voided"), (row) => row.claim.amount),
      unpaidCount: rows.filter((row) => row.displayStatus === "unpaid").length,
      voidedCount: rows.filter((row) => row.displayStatus === "voided").length
    };
  }).sort((first, second) => first.branchLabel.localeCompare(second.branchLabel) || first.panelLabel.localeCompare(second.panelLabel));

  const branchGroups = Array.from(
    groupedClaims.reduce<Map<string, typeof groupedClaims>>((groups, group) => {
      const items = groups.get(group.branchId) ?? [];
      items.push(group);
      groups.set(group.branchId, items);
      return groups;
    }, new Map())
  ).map(([branchId, groups]) => ({
    branchId,
    branchLabel: groups[0]?.branchLabel ?? "Branch",
    totalAmount: totalBy(groups, (group) => group.totalAmount),
    paidAmount: totalBy(groups, (group) => group.paidAmount),
    balanceAmount: totalBy(groups, (group) => group.balanceAmount),
    unpaidCount: totalBy(groups, (group) => group.unpaidCount),
    partialCount: totalBy(groups, (group) => group.partialCount),
    paidCount: totalBy(groups, (group) => group.paidCount),
    voidedCount: totalBy(groups, (group) => group.voidedCount),
    groups
  })).sort((first, second) => first.branchLabel.localeCompare(second.branchLabel));

  return (
    <>
      <ModuleHeader
        eyebrow="Receivables"
        title="Panel outstanding"
        description="Track panel company claims, payment status, and a simple aging view for clinic finance follow-up."
      />

      <section className="dashboard-grid">
        <MetricCard icon={ShieldCheck} label="Total claims" value={formatCurrency(totalClaims)} />
        <MetricCard icon={FileClock} label="Outstanding" value={formatCurrency(outstanding)} detail="Opening balance plus claims less linked payments" tone="blue" />
        <MetricCard icon={CalendarClock} label="Unpaid claims" value={String(unpaid)} tone="amber" />
        <MetricCard icon={Building} label="Panel companies" value={String(uniquePanelCompanyCount)} tone="rose" />
      </section>

      {errorMessage ? (
        <section className="table-section mt-section">
          <p className="void-warning">{errorMessage}</p>
        </section>
      ) : null}

      {canViewAllBranches(profile) ? (
        <form className="reporting-filter mt-section" method="get">
          <label>
            Branch
            <select defaultValue={effectiveBranchId ?? "all"} name="branch">
              <option value="all">All Branches</option>
              {data.branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button" type="submit">
            Apply
          </button>
          <p className="selected-branches">Showing {effectiveBranchId ? (data.branches.find((branch) => branch.id === effectiveBranchId)?.name ?? "Selected branch") : "All Branches"}</p>
        </form>
      ) : null}

      <section className="table-section mt-section">
        <div className="ledger-group-list">
          {branchGroups.map((branchGroup) => (
            <section className="ledger-branch-section" key={branchGroup.branchId}>
              <div className="ledger-group-card">
                <div className="ledger-group-header">
                  <div>
                    <h3>{branchGroup.branchLabel}</h3>
                    <p>{branchGroup.groups.reduce((sum, group) => sum + group.rows.length, 0)} claims</p>
                  </div>
                  <div className="ledger-group-summary">
                    <span className="ledger-summary-chip">Total {formatCurrency(branchGroup.totalAmount)}</span>
                    <span className="ledger-summary-chip">Paid {formatCurrency(branchGroup.paidAmount)}</span>
                    <span className="ledger-summary-chip">Balance {formatCurrency(branchGroup.balanceAmount)}</span>
                    <span className="ledger-summary-chip">{branchGroup.unpaidCount} unpaid</span>
                    <span className="ledger-summary-chip">{branchGroup.partialCount} partial</span>
                    <span className="ledger-summary-chip">{branchGroup.paidCount} paid</span>
                    <span className="ledger-summary-chip">{branchGroup.voidedCount} voided</span>
                  </div>
                </div>
              </div>
              {branchGroup.groups.map((group) => (
                <article className="ledger-group-card" key={group.groupKey}>
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
                      <span className="ledger-summary-chip">{group.voidedCount} voided</span>
                    </div>
                  </div>
                  <DataTable
                columns={["Claim month", "Branch", "Claim no.", "Due", "Status", "Amount", "Paid", "Balance", "Edit", "Void / details", "Documents"]}
                rows={group.rows.map(({ claim, displayStatus, paidAmount, balanceAmount }) => [
                  formatDate(claim.claim_month),
                  claim.branches?.name ?? "-",
                  claim.claim_no ?? "-",
                  formatDate(claim.due_date),
                  <StatusPill key={claim.id} status={displayStatus} />,
                  formatCurrency(claim.amount),
                  formatCurrency(paidAmount),
                  formatCurrency(balanceAmount),
                  !claim.is_void && canEditBranch(profile, claim.branch_id) ? (
                    <details className="manual-bank-editor" key={`${claim.id}-edit`}>
                      <summary>Edit</summary>
                      <form action={updatePanelClaim} className="manual-bank-edit-form">
                        <input name="claim_id" type="hidden" value={claim.id} />
                        <input name="claim_no_debug" type="hidden" value={claim.claim_no ?? ""} />
                        <input name="branch_name_debug" type="hidden" value={claim.branches?.name ?? ""} />
                        <input name="panel_company_name_debug" type="hidden" value={claim.panel_companies?.name ?? ""} />
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
                  !claim.is_void && canEditBranch(profile, claim.branch_id) ? (
                    <details className="manual-bank-editor" key={`${claim.id}-void`}>
                      <summary>Void</summary>
                      <form action={voidPanelClaim} className="manual-bank-edit-form void-record-form">
                        <input name="claim_id" type="hidden" value={claim.id} />
                        <input name="claim_no_debug" type="hidden" value={claim.claim_no ?? ""} />
                        <input name="branch_name_debug" type="hidden" value={claim.branches?.name ?? ""} />
                        <input name="panel_company_name_debug" type="hidden" value={claim.panel_companies?.name ?? ""} />
                        <p className="void-warning">Voided panel claims stay in history and are excluded from outstanding totals.</p>
                        <label>
                          Void reason
                          <textarea name="void_reason" required />
                        </label>
                        <button className="primary-button compact-button" type="submit">
                          Void this panel claim
                        </button>
                      </form>
                    </details>
                  ) : claim.is_void ? (
                    <div key={`${claim.id}-voided-details`}>
                      <strong>Voided</strong>
                      <div>{claim.void_reason ?? "-"}</div>
                      <small>{claim.voided_at ? formatDate(claim.voided_at) : "-"}</small>
                    </div>
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
                    rowKeys={group.rows.map(({ claim }) => claim.id)}
                  />
                </article>
              ))}
            </section>
          ))}
        </div>
      </section>

      <section className="table-section mt-section">
        <div className="report-toolbar">
          <h2>Panel payment records</h2>
        </div>
        <DataTable
          columns={["Date", "Panel Company", "Claim", "Branch", "Method", "Received Into", "Reference", "Amount", "Edit"]}
          rows={data.panelPayments.map((payment) => {
            const receivingAccounts = panelReceivingBankAccounts(
              payment.branches ?? payment.panel_claims?.branches ?? null,
              panelPaymentBanking.bankAccounts,
              payment.bank_account_id ?? null
            );
            const defaultReceivingAccountId = payment.bank_account_id ?? (receivingAccounts.length === 1 ? receivingAccounts[0].id : "");

            return [
              formatDate(payment.payment_date),
              payment.panel_companies?.name ?? "-",
              payment.panel_claims?.claim_no ?? payment.panel_claim_id,
              payment.branches?.name ?? "-",
              labelize(payment.payment_type),
              payment.bank_accounts?.name ?? "-",
              payment.reference_no ?? "-",
              formatCurrency(payment.amount),
              canEditBranch(profile, payment.branch_id ?? payment.panel_claims?.branch_id ?? null) ? (
              <details className="manual-bank-editor" key={`${payment.id}-edit`}>
                <summary>Edit</summary>
                <form action={updatePanelPayment} className="manual-bank-edit-form">
                  <input name="panel_payment_id" type="hidden" value={payment.id} />
                  <label>
                    Panel claim
                    <select defaultValue={payment.panel_claim_id} name="panel_claim_id" required>
                      {data.panels.map((claim) => (
                        <option key={claim.id} value={claim.id}>
                          {(claim.claim_no ?? claim.id)} · {claim.panel_companies?.name ?? "Panel company"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Payment date
                    <input defaultValue={payment.payment_date} name="payment_date" required type="date" />
                  </label>
                  <label>
                    Payment method
                    <select defaultValue={payment.payment_type} name="payment_type" required>
                      <option value="cash">Cash</option>
                      <option value="bank_transfer">Bank transfer</option>
                      <option value="card">Card</option>
                      <option value="qr">QR</option>
                      <option value="panel">Panel</option>
                    </select>
                  </label>
                  <label>
                    Received into bank account
                    <select defaultValue={defaultReceivingAccountId} name="bank_account_id">
                      <option value="">Select bank account</option>
                      {receivingAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                    </select>
                    {!receivingAccounts.length ? (
                      <small className="void-warning">
                        {panelReceivingBankError(payment.branches ?? payment.panel_claims?.branches ?? null)}
                      </small>
                    ) : null}
                  </label>
                  <label>
                    Amount
                    <input defaultValue={payment.amount} min="0.01" name="amount" required step="0.01" type="number" />
                  </label>
                  <label>
                    Reference
                    <input defaultValue={payment.reference_no ?? ""} name="reference_no" />
                  </label>
                  <label>
                    Notes
                    <textarea defaultValue={payment.notes ?? ""} name="notes" />
                  </label>
                  <button className="primary-button compact-button" type="submit">
                    Save
                  </button>
                </form>
              </details>
              ) : "-",
            ];
          })}
          rowKeys={data.panelPayments.map((payment) => payment.id)}
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
            claims={filteredClaims.filter((claim) => !claim.is_void)}
            panelCompanies={panelCompanies}
            panelPayments={filteredPayments}
            bankAccounts={panelPaymentBanking.bankAccounts}
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
