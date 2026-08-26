import { createCashBankIn, updateCashBankIn, voidCashBankIn } from "@/app/actions";
import { CashBankInTargetFields } from "@/components/cash-bank-in-target-fields";
import { DataTable } from "@/components/data-table";
import { DocumentManager } from "@/components/documents/document-manager";
import { ExportCsvLink } from "@/components/export-csv-link";
import { FinanceRecordDetails } from "@/components/finance-record-details";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import {
  bankAccountLabel,
  bankInAmount,
  branchLabel,
  buildCashInHandRows,
  cashBankInCashMonth,
  cashBankInCashSalesFrom,
  cashBankInCashSalesTo,
  cashBankInMatchesCashControlRange,
  getBankAccountById,
  getBranchById,
  resolveDateRange
} from "@/lib/bank-reporting";
import { getBankingData, getBranchPicCashBankInTarget, totalBy } from "@/lib/data";
import { userDisplayLabel } from "@/lib/display";
import { formatCurrency, formatDate } from "@/lib/format";
import { canViewAllBranches, hasBankAccountPermission, normalizeRole, requirePermission } from "@/lib/permissions";
import { getTransactionDocuments } from "@/lib/transaction-documents";
import { getVisibleProfilesById } from "@/lib/users";
import type { BankAccount } from "@/lib/types";
import { Banknote, Landmark, WalletCards } from "lucide-react";

type CashBankInsSearchParams = {
  branch?: string;
  error?: string;
  end?: string;
  period?: string;
  start?: string;
};

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function monthInput(value: string | null | undefined) {
  return value?.slice(0, 7) ?? todayInput().slice(0, 7);
}

function cashMonthLabel(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric" }).format(new Date(value));
}

function cashSalesPeriodLabel(from: string | null | undefined, to: string | null | undefined) {
  if (!from && !to) return "-";
  if (!from || !to) return formatDate(from ?? to);
  if (from === to) return formatDate(from);
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const sameYear = fromDate.getUTCFullYear() === toDate.getUTCFullYear();
  const sameMonth = sameYear && fromDate.getUTCMonth() === toDate.getUTCMonth();
  if (sameMonth) {
    return `${new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short" }).format(fromDate)} - ${formatDate(to)}`;
  }
  return `${formatDate(from)} - ${formatDate(to)}`;
}

function isPanelBankAccount(account: Pick<BankAccount, "name" | "bank_name"> | null | undefined) {
  const haystack = `${account?.name ?? ""} ${account?.bank_name ?? ""}`.trim().toLowerCase();
  return haystack.includes("panel");
}

export default async function CashBankInsPage({ searchParams }: { searchParams: Promise<CashBankInsSearchParams> }) {
  const profile = await requirePermission("record_cash_bank_in");
  const params = await searchParams;
  const range = resolveDateRange(params);
  const role = normalizeRole(profile.role);
  const canSelectBranches = canViewAllBranches(profile);
  const [data, branchPicTarget] = await Promise.all([
    getBankingData(),
    role === "branch_pic"
      ? getBranchPicCashBankInTarget(profile.branch_id)
      : Promise.resolve({ bankAccount: null, bankAccounts: [], branch: null, mapping: null, mappings: [] })
  ]);
  const creatableBankAccountIds = new Set(
    data.bankAccountPermissions
      .filter((permission) => permission.user_id === profile.id && (permission.can_create_transaction || permission.can_manage_account))
      .map((permission) => permission.bank_account_id)
  );
  const destinationBankAccounts = role === "admin" || role === "finance"
    ? data.bankAccounts.filter((account) => creatableBankAccountIds.has(account.id))
    : data.bankAccounts;
  const bankAccountById = getBankAccountById(data);
  const branchById = getBranchById(data);
  const visibleBranchIds = new Set(data.branches.map((branch) => branch.id));
  const effectiveBranchId = canSelectBranches && params.branch && visibleBranchIds.has(params.branch)
    ? params.branch
    : !canSelectBranches
      ? profile.branch_id ?? data.branches[0]?.id ?? null
      : null;
  const ownBranch = branchPicTarget.branch;
  const ownBranchMapping = branchPicTarget.mapping;
  const ownBranchBankAccount = branchPicTarget.bankAccount;
  const ownBranchBankAccounts = branchPicTarget.bankAccounts;
  const branchPicMissingBranch = role === "branch_pic" && !profile.branch_id;
  const branchPicMissingMapping = role === "branch_pic" && Boolean(profile.branch_id) && (!ownBranch || !ownBranchBankAccounts.length);
  const canCreateCashBankIn = role === "branch_pic"
    ? !branchPicMissingBranch && !branchPicMissingMapping
    : Boolean(data.branches.length && destinationBankAccounts.length);
  const selectedBankIns = data.cashBankIns.filter((bankIn) => {
    return cashBankInMatchesCashControlRange(bankIn, range) && (!effectiveBranchId || bankIn.branch_id === effectiveBranchId);
  });
  const visibleUsers = await getVisibleProfilesById(selectedBankIns.flatMap((bankIn) => [bankIn.entered_by, bankIn.voided_by]));
  const userById = new Map(visibleUsers.map((user) => [user.id, user]));
  const bankInDocuments = await getTransactionDocuments("cash_bank_ins", selectedBankIns.map((bankIn) => bankIn.id));
  const cashInHandRows = buildCashInHandRows(data, range).filter((row) => !effectiveBranchId || row.branch.id === effectiveBranchId);
  const totalCashSales = totalBy(cashInHandRows, (row) => row.cashSales);
  const totalBankedIn = totalBy(cashInHandRows, (row) => row.bankedIn);
  const totalCashLocumPayments = totalBy(cashInHandRows, (row) => row.cashLocumPayments);
  const totalCashInHand = totalBy(cashInHandRows, (row) => row.remaining);
  const pendingBankIn = Math.max(0, totalCashSales - totalBankedIn - totalCashLocumPayments);
  const branchGroups = cashInHandRows.map((row) => ({
    balanceRow: row,
    branchId: row.branch.id,
    branchLabel: row.branch.name,
    records: selectedBankIns.filter((bankIn) => bankIn.branch_id === row.branch.id)
  }));
  const allowedDestinationAccounts = role === "admin" || role === "finance" ? destinationBankAccounts : data.bankAccounts;
  const destinationAccountsByBranchId = new Map(
    data.branches.map((branch) => {
      const branchAccounts = data.branchBankMappings
        .filter((mapping) => mapping.is_active && mapping.branch_id === branch.id)
        .map((mapping) => allowedDestinationAccounts.find((account) => account.id === mapping.bank_account_id) ?? null)
        .filter((account): account is BankAccount => Boolean(account))
        .filter((account) => !isPanelBankAccount(account));
      return [branch.id, branchAccounts];
    })
  );
  const selectedBranchLabel = effectiveBranchId
    ? (data.branches.find((branch) => branch.id === effectiveBranchId)?.name ?? "Selected branch")
    : "All Branches";
  const exportParams = {
    ...params,
    ...(effectiveBranchId ? { branch_id: effectiveBranchId, branch: effectiveBranchId } : {})
  };

  return (
    <>
      <ModuleHeader
        eyebrow="Branch cash control"
        title="Cash Bank-In"
        description="Record cash moved from branch cash in hand into a clinic bank account without changing sales or expenses."
      />

      {params.error ? (
        <section className="report-panel mt-section" role="alert">
          <p className="selected-branches">{params.error}</p>
        </section>
      ) : null}

      <section className="dashboard-grid">
        <MetricCard icon={Landmark} label="Total bank-in" value={formatCurrency(totalBankedIn)} detail={selectedBranchLabel} tone="blue" />
        <MetricCard icon={Banknote} label="Cash pending bank-in" value={formatCurrency(pendingBankIn)} detail={range.label} tone={pendingBankIn > 0 ? "amber" : "teal"} />
        <MetricCard icon={WalletCards} label="Cash in hand" value={formatCurrency(totalCashInHand)} detail="After bank-ins & cash locum" tone={totalCashInHand >= 0 ? "teal" : "rose"} />
        <MetricCard icon={Banknote} label="Bank-in count" value={String(selectedBankIns.length)} tone="rose" />
      </section>

      <section className="table-section mt-section">
        <form className="reporting-filter cash-bank-in-filter" method="get">
          {canSelectBranches ? (
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
          ) : (
            <input name="branch" type="hidden" value={effectiveBranchId ?? ""} />
          )}
          <label>
            Date filter
            <select name="period" defaultValue={range.period}>
              <option value="today">Today</option>
              <option value="this_month">This month</option>
              <option value="last_month">Last month</option>
              <option value="custom">Custom date range</option>
            </select>
          </label>
          <label>
            Start date
            <input name="start" type="date" defaultValue={range.startDate} />
          </label>
          <label>
            End date
            <input name="end" type="date" defaultValue={range.endDate} />
          </label>
          <button className="primary-button" type="submit">
            Apply
          </button>
          <p className="selected-branches">Showing {selectedBranchLabel} · {range.label}</p>
        </form>
      </section>

      <section className="table-section mt-section">
        <div className="report-toolbar">
          <h2>Cash in hand report</h2>
          <ExportCsvLink label="Export cash CSV" report="cash-in-hand" searchParams={exportParams} />
        </div>
        <DataTable
          columns={["Branch", "Opening balance", "Total cash sales", "Cash banked in by cash date", "Cash locum payments", "Remaining cash in hand"]}
          rows={cashInHandRows.map((row) => [
            row.branch.name,
            formatCurrency(row.openingBalance),
            formatCurrency(row.cashSales),
            formatCurrency(row.bankedIn),
            formatCurrency(row.cashLocumPayments),
            formatCurrency(row.remaining)
          ])}
        />
      </section>

      <section className="cash-bank-in-entry-layout mt-section">
        <form action={createCashBankIn} className="form-card cash-bank-in-entry-form">
          <h2>Record cash bank-in</h2>
          <label>
            Cash month
            <input name="cash_month" type="month" defaultValue={todayInput().slice(0, 7)} required />
            <span className="muted-copy">Month the banked-in cash belongs to.</span>
          </label>
          <label>
            Cash sales from
            <input name="cash_sales_from" type="date" required />
            <span className="muted-copy">First sales date included in this bank-in.</span>
          </label>
          <label>
            Cash sales to
            <input name="cash_sales_to" type="date" required />
            <span className="muted-copy">Last sales date included in this bank-in.</span>
          </label>
          <label>
            Bank-in date
            <input name="bank_in_date" type="date" defaultValue={todayInput()} required />
            <span className="muted-copy">Actual date deposited into bank.</span>
          </label>
          {role === "branch_pic" ? (
            <>
              <label>
                Branch
                <input readOnly value={ownBranch?.name ?? "-"} />
                {profile.branch_id ? <input name="branch_id" type="hidden" value={profile.branch_id} /> : null}
              </label>
              <label>
                Destination bank account
                {ownBranchBankAccounts.length > 1 ? (
                  <select name="bank_account_id" required defaultValue={ownBranchBankAccount?.id ?? ownBranchBankAccounts[0]?.id ?? ""}>
                    {ownBranchBankAccounts.map((account: BankAccount) => (
                      <option key={account.id} value={account.id}>
                        {bankAccountLabel(account)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    <input readOnly value={bankAccountLabel(ownBranchBankAccount)} />
                    {ownBranchMapping ? <input name="bank_account_id" type="hidden" value={ownBranchMapping.bank_account_id} /> : null}
                  </>
                )}
              </label>
            </>
          ) : (
            <CashBankInTargetFields
              bankAccounts={destinationBankAccounts}
              branches={data.branches}
              initialBranchId={effectiveBranchId}
              mappings={data.branchBankMappings}
            />
          )}
          <label>
            Amount
            <input min="0.01" name="amount" step="0.01" type="number" required />
          </label>
          <label>
            Reference number
            <input name="reference_no" placeholder="Bank slip or transaction reference" />
          </label>
          <label>
            Notes
            <textarea name="notes" placeholder="Optional cash bank-in notes" />
          </label>
          <button className="primary-button" disabled={!canCreateCashBankIn} type="submit">
            Save cash bank-in
          </button>
          {branchPicMissingBranch ? <p className="muted-copy">Your user account is not assigned to a branch. Please contact Owner/Admin.</p> : null}
          {branchPicMissingMapping ? <p className="muted-copy">No active operation bank account mapped for your branch.</p> : null}
          {role !== "branch_pic" && !destinationBankAccounts.length ? <p className="muted-copy">No editable bank accounts are assigned to your user.</p> : null}
        </form>
      </section>

      <section className="table-section mt-section">
        <div className="report-toolbar">
          <h2>Cash bank-in entries</h2>
          <ExportCsvLink label="Export bank-in CSV" report="cash-bank-ins" searchParams={exportParams} />
        </div>
        <div className="ledger-group-list">
          {branchGroups.map((group) => (
            <article className="ledger-group-card" key={group.branchId}>
              <div className="ledger-group-header">
                <div>
                  <h3>{group.branchLabel}</h3>
                  <p>{group.records.length} bank-in records</p>
                </div>
                <div className="ledger-group-summary">
                  <span className="ledger-summary-chip">Opening {formatCurrency(group.balanceRow.openingBalance)}</span>
                  <span className="ledger-summary-chip">Cash sales {formatCurrency(group.balanceRow.cashSales)}</span>
                  <span className="ledger-summary-chip">Banked in {formatCurrency(group.balanceRow.bankedIn)}</span>
                  <span className="ledger-summary-chip">Cash locum {formatCurrency(group.balanceRow.cashLocumPayments)}</span>
                  <span className="ledger-summary-chip">Cash in hand {formatCurrency(group.balanceRow.remaining)}</span>
                </div>
              </div>
              <DataTable
                columns={["Cash Month", "Cash Sales Period", "Bank-In Date", "Branch", "Destination Bank", "Amount", "Documents", "Status", "View Details", "Edit", "Void"]}
                rowKeys={group.records.map((bankIn) => bankIn.id)}
                rows={group.records.map((bankIn) => {
                  const editableBankOptions = role === "branch_pic"
                    ? ownBranchBankAccounts
                    : (destinationAccountsByBranchId.get(bankIn.branch_id) ?? []);
                  const resolvedEditBankId = editableBankOptions.some((account) => account.id === bankIn.bank_account_id)
                    ? bankIn.bank_account_id
                    : editableBankOptions[0]?.id ?? "";
                  const managementCanCorrect = !bankIn.is_void
                    && (role === "owner" || role === "admin" || role === "finance")
                    && editableBankOptions.length > 0
                    && hasBankAccountPermission(profile, data.bankAccountPermissions, bankIn.bank_account_id, "edit_transaction");
                  const branchPicCanCorrect = !bankIn.is_void
                    && role === "branch_pic"
                    && profile.branch_id === bankIn.branch_id
                    && editableBankOptions.length > 0;
                  const canCorrectBankIn = managementCanCorrect || branchPicCanCorrect;
                  const cashMonth = cashBankInCashMonth(bankIn);
                  const cashSalesFrom = cashBankInCashSalesFrom(bankIn);
                  const cashSalesTo = cashBankInCashSalesTo(bankIn);
                  const cashSalesPeriod = cashSalesPeriodLabel(cashSalesFrom, cashSalesTo);

                  return [
                    cashMonthLabel(cashMonth),
                    cashSalesPeriod,
                    formatDate(bankIn.bank_in_date),
                    branchLabel(bankIn.branches ?? branchById.get(bankIn.branch_id)),
                    bankAccountLabel(bankIn.bank_accounts ?? bankAccountById.get(bankIn.bank_account_id)),
                    formatCurrency(bankInAmount(bankIn)),
                    <DocumentManager
                      canDelete={role !== "branch_pic"}
                      documents={bankInDocuments.get(bankIn.id) ?? []}
                      entityId={bankIn.id}
                      entityName="cash_bank_ins"
                      key={`${bankIn.id}-documents`}
                    />,
                    <span className={`status-pill ${bankIn.is_void ? "status-voided" : "status-paid"}`} key={`${bankIn.id}-status`}>
                      {bankIn.is_void ? "VOIDED" : "Active"}
                    </span>,
                    <FinanceRecordDetails
                      enteredBy={userDisplayLabel(userById.get(bankIn.entered_by ?? ""), bankIn.entered_by)}
                      extraDetails={[
                        { label: "Cash month", value: cashMonthLabel(cashMonth) },
                        { label: "Cash sales period", value: cashSalesPeriod },
                        { label: "Bank-in date", value: formatDate(bankIn.bank_in_date) },
                        { label: "Branch", value: branchLabel(bankIn.branches ?? branchById.get(bankIn.branch_id)) },
                        { label: "Destination bank", value: bankAccountLabel(bankIn.bank_accounts ?? bankAccountById.get(bankIn.bank_account_id)) },
                        { label: "Amount", value: formatCurrency(bankInAmount(bankIn)) },
                        { label: "Reference", value: bankIn.reference_no ?? "-" },
                        { label: "Notes", value: bankIn.notes ?? "-" }
                      ]}
                      key={`${bankIn.id}-details`}
                      originalSummary={`Cash Bank-In • ${branchLabel(bankIn.branches ?? branchById.get(bankIn.branch_id))} • ${cashMonthLabel(cashMonth)} • ${cashSalesPeriod} • Banked ${formatDate(bankIn.bank_in_date)} • ${formatCurrency(bankInAmount(bankIn))}`}
                      recordId={bankIn.id}
                      status={bankIn.is_void ? "Voided" : "Active"}
                      voidReason={bankIn.void_reason}
                      voidedAt={bankIn.voided_at}
                      voidedBy={userDisplayLabel(userById.get(bankIn.voided_by ?? ""), bankIn.voided_by)}
                    />,
                    canCorrectBankIn ? (
                      <details className="manual-bank-editor" key={`${bankIn.id}-edit`}>
                        <summary>Edit</summary>
                        <form action={updateCashBankIn} className="manual-bank-edit-form">
                          <input name="bank_in_id" type="hidden" value={bankIn.id} />
                          <label>
                            Destination bank account
                            <select name="bank_account_id" defaultValue={resolvedEditBankId} required>
                              {editableBankOptions.map((account) => (
                                <option key={account.id} value={account.id}>
                                  {bankAccountLabel(account)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Cash month
                            <input name="cash_month" type="month" defaultValue={monthInput(cashMonth)} required />
                          </label>
                          <label>
                            Cash sales from
                            <input name="cash_sales_from" type="date" defaultValue={cashSalesFrom} required />
                          </label>
                          <label>
                            Cash sales to
                            <input name="cash_sales_to" type="date" defaultValue={cashSalesTo} required />
                          </label>
                          <label>
                            Bank-in date
                            <input name="bank_in_date" type="date" defaultValue={bankIn.bank_in_date} required />
                          </label>
                          <label>
                            Amount
                            <input name="amount" min="0.01" step="0.01" type="number" defaultValue={bankIn.amount} required />
                          </label>
                          <label>
                            Reference
                            <input name="reference_no" defaultValue={bankIn.reference_no ?? ""} />
                          </label>
                          <label>
                            Notes
                            <textarea name="notes" defaultValue={bankIn.notes ?? ""} />
                          </label>
                          <button className="primary-button compact-button" type="submit">
                            Save
                          </button>
                        </form>
                      </details>
                    ) : (
                      "-"
                    ),
                    canCorrectBankIn ? (
                      <details className="manual-bank-editor" key={`${bankIn.id}-void`}>
                        <summary>Void</summary>
                        <form action={voidCashBankIn} className="manual-bank-edit-form void-record-form">
                          <input name="bank_in_id" type="hidden" value={bankIn.id} />
                          <p className="void-warning">Voided records stay in history and are excluded from reports.</p>
                          <label>
                            Void reason
                            <textarea name="void_reason" required />
                          </label>
                          <button className="primary-button compact-button" type="submit">
                            Confirm void
                          </button>
                        </form>
                      </details>
                    ) : (
                      "-"
                    )
                  ];
                })}
              />
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
