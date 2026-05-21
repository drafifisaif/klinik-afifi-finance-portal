import { createPettyCashTransaction, updatePettyCashTransaction } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { bankAccountLabel, branchLabel, buildPettyCashBalanceRows, pettyCashAmount } from "@/lib/bank-reporting";
import { pettyCashCategories, pettyCashTransactionTypes } from "@/lib/constants";
import { getBankingData, totalBy } from "@/lib/data";
import { formatCurrency, formatDate } from "@/lib/format";
import { hasPermission, normalizeRole, requirePermission } from "@/lib/permissions";
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

export default async function PettyCashPage() {
  const profile = await requirePermission("record_petty_cash");
  const data = await getBankingData();
  const role = normalizeRole(profile.role);
  const balanceRows = buildPettyCashBalanceRows(data);
  const typeOptions = role === "owner"
    ? pettyCashTransactionTypes
    : role === "branch_pic"
      ? pettyCashTransactionTypes.filter((type) => type.value === "petty_cash_spent" || type.value === "petty_cash_returned")
      : pettyCashTransactionTypes.filter((type) => type.value !== "petty_cash_adjustment");
  const canEditPettyCash = hasPermission(profile, "edit_finance") && role !== "branch_pic";
  const totalBalance = totalBy(balanceRows, (row) => row.balance);
  const totalIssued = totalBy(balanceRows, (row) => row.issued);
  const totalSpent = totalBy(balanceRows, (row) => row.spent);

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
        <MetricCard icon={WalletCards} label="Petty cash balance" value={formatCurrency(totalBalance)} detail="Separate from cash in hand" tone="teal" />
      </section>

      <section className="section-grid">
        <form action={createPettyCashTransaction} className="form-card">
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

        <div className="table-section">
          <h2>Petty cash balance by branch</h2>
          <DataTable
            columns={["Branch", "Total issued", "Total spent", "Total returned", "Adjustments", "Current petty cash balance"]}
            rows={balanceRows.map((row) => [
              row.branch.name,
              formatCurrency(row.issued),
              formatCurrency(row.spent),
              formatCurrency(row.returned),
              formatCurrency(row.adjustments),
              formatCurrency(row.balance)
            ])}
          />
        </div>
      </section>

      <section className="table-section mt-section">
        <h2>Petty cash ledger</h2>
        <DataTable
          columns={["Date", "Branch", "Transaction type", "Category", "Amount", "Entered by", "Reference", "Notes", "Edit"]}
          rows={data.pettyCashTransactions.map((transaction) => [
            formatDate(transaction.transaction_date),
            branchLabel(transaction.branches),
            pettyCashTypeLabel(transaction.transaction_type),
            pettyCashCategoryLabel(transaction.category),
            entryAmount(transaction),
            transaction.profiles?.full_name ?? transaction.entered_by ?? "-",
            transaction.reference_no ?? "-",
            transaction.description ?? "-",
            canEditPettyCash ? (
              <details className="manual-bank-editor">
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
            )
          ])}
        />
      </section>
    </>
  );
}
