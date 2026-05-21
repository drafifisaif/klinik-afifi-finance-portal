import { createCashBankIn, updateCashBankIn, voidCashBankIn } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { ExportCsvLink } from "@/components/export-csv-link";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import {
  bankAccountLabel,
  bankInAmount,
  branchLabel,
  buildCashInHandRows,
  getBankAccountById,
  getBranchById,
  isWithinDateRange,
  resolveDateRange
} from "@/lib/bank-reporting";
import { getBankingData, totalBy } from "@/lib/data";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { hasBankAccountPermission, normalizeRole, requirePermission } from "@/lib/permissions";
import { Banknote, Landmark, WalletCards } from "lucide-react";

type CashBankInsSearchParams = {
  end?: string;
  period?: string;
  start?: string;
};

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

export default async function CashBankInsPage({ searchParams }: { searchParams: Promise<CashBankInsSearchParams> }) {
  const profile = await requirePermission("record_cash_bank_in");
  const params = await searchParams;
  const range = resolveDateRange(params);
  const data = await getBankingData();
  const role = normalizeRole(profile.role);
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
  const selectedBankIns = data.cashBankIns.filter((bankIn) => isWithinDateRange(bankIn.bank_in_date, range));
  const cashInHandRows = buildCashInHandRows(data, range);
  const totalCashSales = totalBy(cashInHandRows, (row) => row.cashSales);
  const totalBankedIn = totalBy(cashInHandRows, (row) => row.bankedIn);
  const totalCashInHand = totalBy(cashInHandRows, (row) => row.remaining);

  return (
    <>
      <ModuleHeader
        eyebrow="Branch cash control"
        title="Cash Bank-In"
        description="Record cash moved from branch cash in hand into a clinic bank account without changing sales or expenses."
      />

      <section className="dashboard-grid">
        <MetricCard icon={Banknote} label="Cash sales" value={formatCurrency(totalCashSales)} detail={range.label} />
        <MetricCard icon={Landmark} label="Cash banked in" value={formatCurrency(totalBankedIn)} detail="Not counted as sales" tone="blue" />
        <MetricCard icon={WalletCards} label="Cash in hand" value={formatCurrency(totalCashInHand)} detail="Cash sales minus bank-ins" tone={totalCashInHand >= 0 ? "teal" : "rose"} />
      </section>

      <section className="section-grid">
        <form action={createCashBankIn} className="form-card">
          <h2>Record cash bank-in</h2>
          <label>
            Bank-in date
            <input name="bank_in_date" type="date" defaultValue={todayInput()} required />
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
            Destination bank account
            <select name="bank_account_id" required>
              {destinationBankAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {bankAccountLabel(account)}
                </option>
              ))}
            </select>
          </label>
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
          <button className="primary-button" disabled={!destinationBankAccounts.length} type="submit">
            Save cash bank-in
          </button>
          {!destinationBankAccounts.length ? <p className="muted-copy">No editable bank accounts are assigned to your user.</p> : null}
        </form>

        <form className="form-card" method="get">
          <h2>Cash in hand filter</h2>
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
        </form>
      </section>

      <section className="table-section mt-section">
        <div className="report-toolbar">
          <h2>Cash in hand report</h2>
          <ExportCsvLink label="Export cash CSV" report="cash-in-hand" searchParams={params} />
        </div>
        <DataTable
          columns={["Branch", "Total cash sales", "Total cash banked in", "Remaining cash in hand"]}
          rows={cashInHandRows.map((row) => [
            row.branch.name,
            formatCurrency(row.cashSales),
            formatCurrency(row.bankedIn),
            formatCurrency(row.remaining)
          ])}
        />
      </section>

      <section className="table-section mt-section">
        <h2>Cash bank-in entries</h2>
        <DataTable
          columns={["Date", "Branch", "Destination bank account", "Amount", "Reference", "Notes", "Status", "View details", "Edit", "Void"]}
          rows={selectedBankIns.map((bankIn) => {
            const canCorrectBankIn = !bankIn.is_void
              && (role === "owner" || role === "admin" || role === "finance")
              && hasBankAccountPermission(profile, data.bankAccountPermissions, bankIn.bank_account_id, "edit_transaction");

            return [
              formatDate(bankIn.bank_in_date),
              branchLabel(bankIn.branches ?? branchById.get(bankIn.branch_id)),
              bankAccountLabel(bankIn.bank_accounts ?? bankAccountById.get(bankIn.bank_account_id)),
              formatCurrency(bankInAmount(bankIn)),
              bankIn.reference_no ?? "-",
              bankIn.notes ?? "-",
              <span className={`status-pill ${bankIn.is_void ? "status-voided" : "status-paid"}`} key={`${bankIn.id}-status`}>
                {bankIn.is_void ? "VOIDED" : "Active"}
              </span>,
              <details className="manual-bank-editor" key={`${bankIn.id}-details`}>
                <summary>View details</summary>
                <div className="record-detail-grid">
                  <div>
                    <strong>Record ID</strong>
                    <span>{bankIn.id}</span>
                  </div>
                  <div>
                    <strong>Entered by</strong>
                    <span>{bankIn.entered_by ?? "-"}</span>
                  </div>
                  <div>
                    <strong>Voided at</strong>
                    <span>{formatDateTime(bankIn.voided_at)}</span>
                  </div>
                  <div>
                    <strong>Void reason</strong>
                    <span>{bankIn.void_reason ?? "-"}</span>
                  </div>
                </div>
              </details>,
              canCorrectBankIn ? (
                <details className="manual-bank-editor" key={`${bankIn.id}-edit`}>
                  <summary>Edit</summary>
                  <form action={updateCashBankIn} className="manual-bank-edit-form">
                    <input name="bank_in_id" type="hidden" value={bankIn.id} />
                    <label>
                      Date
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
      </section>
    </>
  );
}
