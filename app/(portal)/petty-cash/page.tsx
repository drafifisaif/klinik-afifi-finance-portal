import { createPettyCashTransaction, updatePettyCashTransaction, voidPettyCashTransaction } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { DocumentManager } from "@/components/documents/document-manager";
import { ExportCsvLink } from "@/components/export-csv-link";
import { FinanceRecordDetails } from "@/components/finance-record-details";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { bankAccountLabel, branchLabel, buildPettyCashBalanceRows, pettyCashAmount } from "@/lib/bank-reporting";
import { pettyCashCategories, pettyCashTransactionTypes } from "@/lib/constants";
import { getBankingData, totalBy } from "@/lib/data";
import { userDisplayLabel } from "@/lib/display";
import { formatCurrency, formatDate } from "@/lib/format";
import { canViewAllBranches, hasPermission, normalizeRole, requirePermission } from "@/lib/permissions";
import { getTransactionDocuments } from "@/lib/transaction-documents";
import { getVisibleProfilesById } from "@/lib/users";
import type { PettyCashTransaction, PettyCashTransactionType } from "@/lib/types";
import { Banknote, ReceiptText, WalletCards } from "lucide-react";

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function pettyCashTypeLabel(type: PettyCashTransactionType) {
  return pettyCashTransactionTypes.find((option) => option.value === type)?.label ?? type;
}

function pettyCashCategoryLabel(category: string | null | undefined) {
  if (!category) return "-";
  return pettyCashCategories.find((option) => option.value === category)?.label ?? category;
}

function entryAmount(transaction: PettyCashTransaction) {
  const amount = pettyCashAmount(transaction);
  return transaction.transaction_type === "petty_cash_adjustment" && amount > 0 ? `+${formatCurrency(amount)}` : formatCurrency(amount);
}

type PettyCashPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function searchValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function PettyCashPage({ searchParams }: PettyCashPageProps) {
  const profile = await requirePermission("record_petty_cash");
  const params = searchParams ? await searchParams : {};
  const data = await getBankingData();
  const role = normalizeRole(profile.role);
  const canSelectBranches = canViewAllBranches(profile);
  const selectedBranchFilter = searchValue(params.branch);
  const visibleBranchIds = new Set(data.branches.map((branch) => branch.id));
  const effectiveBranchId = canSelectBranches && selectedBranchFilter && visibleBranchIds.has(selectedBranchFilter)
    ? selectedBranchFilter
    : !canSelectBranches
      ? profile.branch_id ?? data.branches[0]?.id ?? null
      : null;
  const filteredTransactions = data.pettyCashTransactions.filter((transaction) => !effectiveBranchId || transaction.branch_id === effectiveBranchId);
  const visibleUsers = await getVisibleProfilesById(data.pettyCashTransactions.flatMap((transaction) => [transaction.entered_by, transaction.voided_by]));
  const userById = new Map(visibleUsers.map((user) => [user.id, user]));
  const pettyCashDocuments = await getTransactionDocuments("petty_cash_transactions", filteredTransactions.map((transaction) => transaction.id));
  const balanceRows = buildPettyCashBalanceRows(data).filter((row) => !effectiveBranchId || row.branch.id === effectiveBranchId);
  const typeOptions = role === "owner"
    ? pettyCashTransactionTypes
    : role === "branch_pic"
      ? pettyCashTransactionTypes.filter((type) => type.value === "petty_cash_spent" || type.value === "petty_cash_returned")
      : pettyCashTransactionTypes.filter((type) => type.value !== "petty_cash_adjustment");
  const canEditPettyCash = hasPermission(profile, "edit_finance") && role !== "branch_pic";
  const totalBalance = totalBy(balanceRows, (row) => row.balance);
  const totalIssued = totalBy(balanceRows, (row) => row.issued);
  const totalSpent = totalBy(balanceRows, (row) => row.spent);
  const branchGroups = balanceRows.map((row) => {
    const branchTransactions = filteredTransactions.filter((transaction) => transaction.branch_id === row.branch.id);
    return {
      balanceRow: row,
      branchId: row.branch.id,
      branchLabel: row.branch.name,
      transactions: branchTransactions
    };
  });
  const exportParams = effectiveBranchId ? { branch_id: effectiveBranchId } : undefined;
  const selectedBranchLabel = effectiveBranchId
    ? (data.branches.find((branch) => branch.id === effectiveBranchId)?.name ?? "Selected branch")
    : "All Branches";

  return (
    <>
      <ModuleHeader
        eyebrow="Branch cash float"
        title="Petty Cash"
        description="Track branch petty cash separately from patient cash sales and cash in hand."
      />

      <section className="dashboard-grid">
        <MetricCard icon={Banknote} label="Petty cash issued" value={formatCurrency(totalIssued)} detail="Bank to branch float" tone="blue" />
        <MetricCard icon={ReceiptText} label="Petty cash spent" value={formatCurrency(totalSpent)} detail="Branch petty cash ledger" tone="rose" />
        <MetricCard icon={WalletCards} label="Petty cash balance" value={formatCurrency(totalBalance)} detail={canSelectBranches ? selectedBranchLabel : "Own branch"} tone="teal" />
      </section>

      {canSelectBranches ? (
        <section className="table-section mt-section">
          <form className="reporting-filter panel-outstanding-filter" method="get">
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
            <p className="selected-branches">Showing {selectedBranchLabel}</p>
          </form>
        </section>
      ) : null}

      <section className="table-section mt-section">
        <h2>Petty cash balance by branch</h2>
        <DataTable
          columns={["Branch", "Opening balance", "Total issued", "Total spent", "Total returned", "Adjustments", "Current petty cash balance"]}
          rows={balanceRows.map((row) => [
            row.branch.name,
            formatCurrency(row.openingBalance),
            formatCurrency(row.issued),
            formatCurrency(row.spent),
            formatCurrency(row.returned),
            formatCurrency(row.adjustments),
            formatCurrency(row.balance)
          ])}
        />
      </section>

      <section className="table-section mt-section">
        <div className="report-toolbar">
          <h2>Petty cash ledger</h2>
          <ExportCsvLink label="Export ledger CSV" report="petty-cash" searchParams={exportParams} />
        </div>
        <div className="ledger-group-list">
          {branchGroups.map((group) => (
            <article className="ledger-group-card" key={group.branchId}>
              <div className="ledger-group-header">
                <div>
                  <h3>{group.branchLabel}</h3>
                  <p>{group.transactions.length} transactions</p>
                </div>
                <div className="ledger-group-summary">
                  <span className="ledger-summary-chip">Opening {formatCurrency(group.balanceRow.openingBalance)}</span>
                  <span className="ledger-summary-chip">Issued {formatCurrency(group.balanceRow.issued)}</span>
                  <span className="ledger-summary-chip">Spent {formatCurrency(group.balanceRow.spent)}</span>
                  <span className="ledger-summary-chip">Returned {formatCurrency(group.balanceRow.returned)}</span>
                  <span className="ledger-summary-chip">Adjustments {formatCurrency(group.balanceRow.adjustments)}</span>
                  <span className="ledger-summary-chip">Balance {formatCurrency(group.balanceRow.balance)}</span>
                </div>
              </div>
              <DataTable
                columns={["Date", "Branch", "Transaction type", "Category", "Amount", "Entered by", "Reference", "Notes", "Documents", "Status", "View details", "Edit", "Void"]}
                rowKeys={group.transactions.map((transaction) => transaction.id)}
                rows={group.transactions.map((transaction) => {
                  const canCorrectTransaction = canEditPettyCash && !transaction.is_void;

                  return [
                    formatDate(transaction.transaction_date),
                    branchLabel(transaction.branches),
                    pettyCashTypeLabel(transaction.transaction_type),
                    pettyCashCategoryLabel(transaction.category),
                    entryAmount(transaction),
                    userDisplayLabel(userById.get(transaction.entered_by ?? "") ?? transaction.profiles, transaction.entered_by),
                    transaction.reference_no ?? "-",
                    transaction.description ?? "-",
                    <DocumentManager
                      canDelete={role !== "branch_pic"}
                      documents={pettyCashDocuments.get(transaction.id) ?? []}
                      entityId={transaction.id}
                      entityName="petty_cash_transactions"
                      key={`${transaction.id}-documents`}
                    />,
                    <span className={`status-pill ${transaction.is_void ? "status-voided" : "status-paid"}`} key={`${transaction.id}-status`}>
                      {transaction.is_void ? "VOIDED" : "Active"}
                    </span>,
                    <FinanceRecordDetails
                      enteredBy={userDisplayLabel(userById.get(transaction.entered_by ?? "") ?? transaction.profiles, transaction.entered_by)}
                      key={`${transaction.id}-details`}
                      originalSummary={`Petty Cash • ${branchLabel(transaction.branches)} • ${bankAccountLabel(transaction.bank_accounts)} • ${formatDate(transaction.transaction_date)} • ${entryAmount(transaction)}`}
                      recordId={transaction.id}
                      status={transaction.is_void ? "Voided" : "Active"}
                      voidReason={transaction.void_reason}
                      voidedAt={transaction.voided_at}
                      voidedBy={userDisplayLabel(userById.get(transaction.voided_by ?? ""), transaction.voided_by)}
                    />,
                    canCorrectTransaction ? (
                      <details className="manual-bank-editor" key={`${transaction.id}-edit`}>
                        <summary>Edit</summary>
                        <form action={updatePettyCashTransaction} className="manual-bank-edit-form">
                          <input name="transaction_id" type="hidden" value={transaction.id} />
                          <label>
                            Date
                            <input name="transaction_date" type="date" defaultValue={transaction.transaction_date} required />
                          </label>
                          <label>
                            Amount
                            <input name="amount" step="0.01" type="number" defaultValue={transaction.amount} required />
                          </label>
                          {transaction.transaction_type === "petty_cash_spent" ? (
                            <label>
                              Category
                              <select name="category" defaultValue={transaction.category ?? ""}>
                                <option value="">No category</option>
                                {pettyCashCategories.map((category) => (
                                  <option key={category.value} value={category.value}>
                                    {category.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                          <label>
                            Reference
                            <input name="reference_no" defaultValue={transaction.reference_no ?? ""} />
                          </label>
                          <label>
                            Notes
                            <textarea name="description" defaultValue={transaction.description ?? ""} />
                          </label>
                          <button className="primary-button compact-button" type="submit">
                            Save
                          </button>
                        </form>
                      </details>
                    ) : (
                      "-"
                    ),
                    canCorrectTransaction ? (
                      <details className="manual-bank-editor" key={`${transaction.id}-void`}>
                        <summary>Void</summary>
                        <form action={voidPettyCashTransaction} className="manual-bank-edit-form void-record-form">
                          <input name="transaction_id" type="hidden" value={transaction.id} />
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

      <section className="petty-cash-entry-layout mt-section">
        <form action={createPettyCashTransaction} className="form-card petty-cash-entry-form">
          <h2>Record petty cash transaction</h2>
          <div className="form-grid">
            <label>
              Branch
              <select name="branch_id" defaultValue={profile.branch_id ?? ""} required>
                {data.branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date
              <input name="transaction_date" type="date" defaultValue={todayInput()} required />
            </label>
            <label>
              Transaction type
              <select name="transaction_type" defaultValue={typeOptions[0]?.value} required>
                {typeOptions.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Related bank account
              <select name="bank_account_id" defaultValue="">
                <option value="">Not bank-linked</option>
                {data.bankAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {bankAccountLabel(account)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Spending category
              <select name="category" defaultValue="">
                <option value="">No category</option>
                {pettyCashCategories.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount
              <input name="amount" step="0.01" type="number" required />
            </label>
            <label>
              Reference number
              <input name="reference_no" />
            </label>
            <label className="full-span">
              Notes
              <textarea name="description" />
            </label>
          </div>
          <button className="primary-button" disabled={!data.branches.length || !typeOptions.length} type="submit">
            Save petty cash transaction
          </button>
        </form>
      </section>
    </>
  );
}
