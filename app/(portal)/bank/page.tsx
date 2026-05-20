import { createBankAccount, revokeBankAccountPermission, upsertBankAccountPermission } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import {
  bankAccountLabel,
  bankInAmount,
  branchLabel,
  buildCashInHandRows,
  directBankInflow,
  getBankAccountById,
  getBranchById,
  getMappingByBranch,
  isWithinDateRange,
  panelSalesAmount,
  resolveDateRange
} from "@/lib/bank-reporting";
import { getBankingDataForScope, totalBy } from "@/lib/data";
import { formatCurrency, formatDate } from "@/lib/format";
import { canManageBankPermissions, requireBankPositionAccess } from "@/lib/permissions";
import { getUserManagementData } from "@/lib/users";
import { Banknote, CreditCard, Landmark, ReceiptText, WalletCards } from "lucide-react";

type BankPageSearchParams = {
  end?: string;
  period?: string;
  start?: string;
};

type StatementRow = {
  bankAccount: string;
  bankTransferAmount: number;
  branch: string;
  cardAmount: number;
  cashBankInAmount: number;
  date: string;
  notes: string;
  qrAmount: number;
  referenceNo: string;
  sourceType: "Cash Bank-In" | "Direct Sales Inflow";
  totalInflow: number;
};

function addToMap(map: Map<string, number>, key: string, amount: number) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function permissionSummary(permission: {
  can_create_transaction: boolean;
  can_edit_transaction: boolean;
  can_manage_account: boolean;
  can_view: boolean;
}) {
  const flags = [
    permission.can_view ? "View" : null,
    permission.can_create_transaction ? "Create transactions" : null,
    permission.can_edit_transaction ? "Edit transactions" : null,
    permission.can_manage_account ? "Manage account" : null
  ].filter(Boolean);

  return flags.length ? flags.join(", ") : "No access";
}

export default async function BankPage({ searchParams }: { searchParams: Promise<BankPageSearchParams> }) {
  const profile = await requireBankPositionAccess();
  const canManageBankAccounts = canManageBankPermissions(profile);
  const params = await searchParams;
  const range = resolveDateRange(params);
  const todayRange = resolveDateRange({ period: "today" });
  const monthRange = resolveDateRange({ period: "this_month" });
  const data = await getBankingDataForScope({ bankAccessOnly: true });
  const accessManagementData = canManageBankAccounts ? await getUserManagementData() : null;
  const bankAccessUsers = accessManagementData?.users.filter((user) => user.is_active && ["admin", "finance", "branch_pic"].includes(user.role)) ?? [];
  const bankAccessAccounts = accessManagementData?.bankAccounts ?? [];
  const bankAccessPermissions = accessManagementData?.bankAccountPermissions ?? [];
  const accessUserById = new Map(bankAccessUsers.map((user) => [user.id, user]));
  const accessAccountById = new Map(bankAccessAccounts.map((account) => [account.id, account]));
  const mappingByBranch = getMappingByBranch(data);
  const bankAccountById = getBankAccountById(data);
  const branchById = getBranchById(data);
  const selectedSales = data.sales.filter((sale) => isWithinDateRange(sale.sale_date, range));
  const selectedCashBankIns = data.cashBankIns.filter((bankIn) => isWithinDateRange(bankIn.bank_in_date, range));
  const todaySales = data.sales.filter((sale) => isWithinDateRange(sale.sale_date, todayRange));
  const monthSales = data.sales.filter((sale) => isWithinDateRange(sale.sale_date, monthRange));
  const todayCashBankIns = data.cashBankIns.filter((bankIn) => isWithinDateRange(bankIn.bank_in_date, todayRange));
  const monthCashBankIns = data.cashBankIns.filter((bankIn) => isWithinDateRange(bankIn.bank_in_date, monthRange));

  const selectedDirectBankInflow = totalBy(selectedSales, directBankInflow);
  const selectedCashBankIn = totalBy(selectedCashBankIns, bankInAmount);
  const selectedCashSales = totalBy(selectedSales, (sale) => Number(sale.cash_amount ?? 0));
  const selectedPanelSales = totalBy(selectedSales, panelSalesAmount);
  const cashInHandRows = buildCashInHandRows(data, range);

  const bankInflows = new Map(data.bankAccounts.map((account) => [account.id, 0]));
  const branchInflows = new Map(data.branches.map((branch) => [branch.id, 0]));
  const statementRows: StatementRow[] = [];

  selectedSales.forEach((sale) => {
    const mapping = mappingByBranch.get(sale.branch_id);
    const account = mapping ? bankAccountById.get(mapping.bank_account_id) : undefined;
    const directAmount = directBankInflow(sale);
    addToMap(branchInflows, sale.branch_id, directAmount);
    if (mapping) addToMap(bankInflows, mapping.bank_account_id, directAmount);

    if (directAmount > 0) {
      statementRows.push({
        bankAccount: bankAccountLabel(account),
        bankTransferAmount: Number(sale.bank_transfer_amount ?? 0),
        branch: branchLabel(sale.branches ?? branchById.get(sale.branch_id)),
        cardAmount: Number(sale.card_amount ?? 0),
        cashBankInAmount: 0,
        date: sale.sale_date,
        notes: sale.notes ?? "",
        qrAmount: Number(sale.qr_amount ?? 0),
        referenceNo: sale.id,
        sourceType: "Direct Sales Inflow",
        totalInflow: directAmount
      });
    }
  });

  selectedCashBankIns.forEach((bankIn) => {
    const account = bankAccountById.get(bankIn.bank_account_id);
    const amount = bankInAmount(bankIn);
    addToMap(bankInflows, bankIn.bank_account_id, amount);
    addToMap(branchInflows, bankIn.branch_id, amount);
    statementRows.push({
      bankAccount: bankAccountLabel(bankIn.bank_accounts ?? account),
      bankTransferAmount: 0,
      branch: branchLabel(bankIn.branches ?? branchById.get(bankIn.branch_id)),
      cardAmount: 0,
      cashBankInAmount: amount,
      date: bankIn.bank_in_date,
      notes: bankIn.notes ?? "",
      qrAmount: 0,
      referenceNo: bankIn.reference_no ?? "-",
      sourceType: "Cash Bank-In",
      totalInflow: amount
    });
  });

  statementRows.sort((first, second) => second.date.localeCompare(first.date) || second.sourceType.localeCompare(first.sourceType));

  return (
    <>
      <ModuleHeader
        eyebrow="Banking"
        title="Bank Position"
        description="View direct bank inflow, cash bank-ins, and cash in hand for assigned bank accounts."
      />

      <form className="reporting-filter bank-filter" method="get">
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
        <p className="selected-branches">
          Showing {range.label}: {formatDate(range.startDate)} to {formatDate(range.endDate)}
        </p>
      </form>

      <section className="dashboard-grid" aria-label="Bank position metrics">
        <MetricCard icon={CreditCard} label="Direct bank inflow today" value={formatCurrency(totalBy(todaySales, directBankInflow))} detail="Card, QR, transfer" />
        <MetricCard icon={Landmark} label="Direct bank inflow this month" value={formatCurrency(totalBy(monthSales, directBankInflow))} detail="Existing daily sales" tone="blue" />
        <MetricCard icon={Banknote} label="Cash bank-in today" value={formatCurrency(totalBy(todayCashBankIns, bankInAmount))} detail="Cash moved to bank" tone="amber" />
        <MetricCard icon={WalletCards} label="Cash bank-in this month" value={formatCurrency(totalBy(monthCashBankIns, bankInAmount))} detail="Not new sales" tone="teal" />
        <MetricCard icon={Landmark} label="Total bank inflow" value={formatCurrency(selectedDirectBankInflow + selectedCashBankIn)} detail={range.label} tone="blue" />
        <MetricCard icon={ReceiptText} label="Cash sales" value={formatCurrency(selectedCashSales)} detail="Held by branch until banked in" tone="amber" />
        <MetricCard icon={WalletCards} label="Panel sales" value={formatCurrency(selectedPanelSales)} detail="Outstanding, not bank inflow" tone="rose" />
      </section>

      <section className="section-grid">
        <div className="table-section">
          <h2>Cash in hand by branch</h2>
          <DataTable
            columns={["Branch", "Total cash sales", "Total cash banked in", "Remaining cash in hand"]}
            rows={cashInHandRows.map((row) => [
              row.branch.name,
              formatCurrency(row.cashSales),
              formatCurrency(row.bankedIn),
              formatCurrency(row.remaining)
            ])}
          />
        </div>

        <aside className="report-panel">
          <h2>Bank accounts</h2>
          <dl className="summary-list">
            {data.bankAccounts.map((account) => (
              <div key={account.id}>
                <dt>{bankAccountLabel(account)}</dt>
                <dd>{formatCurrency(bankInflows.get(account.id) ?? 0)}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </section>

      <section className="section-grid">
        <div className="table-section">
          <h2>Bank inflow by bank account</h2>
          <DataTable
            columns={["Bank account", "Total inflow"]}
            rows={data.bankAccounts.map((account) => [bankAccountLabel(account), formatCurrency(bankInflows.get(account.id) ?? 0)])}
          />
        </div>

        <div className="table-section">
          <h2>Bank inflow by branch</h2>
          <DataTable
            columns={["Branch", "Direct bank inflow + cash bank-in"]}
            rows={data.branches.map((branch) => [branch.name, formatCurrency(branchInflows.get(branch.id) ?? 0)])}
          />
        </div>
      </section>

      <section className="table-section mt-section">
        <h2>Bank statement-style report</h2>
        <DataTable
          columns={["Date", "Bank account", "Source type", "Branch", "Card", "QR", "Bank transfer", "Cash bank-in", "Total inflow", "Reference", "Notes"]}
          rows={statementRows.map((row) => [
            formatDate(row.date),
            row.bankAccount,
            row.sourceType,
            row.branch,
            formatCurrency(row.cardAmount),
            formatCurrency(row.qrAmount),
            formatCurrency(row.bankTransferAmount),
            formatCurrency(row.cashBankInAmount),
            formatCurrency(row.totalInflow),
            row.referenceNo,
            row.notes || "-"
          ])}
        />
      </section>

      <section className="section-grid">
        <div className="table-section">
          <h2>Branch bank mapping</h2>
          <DataTable
            columns={["Branch", "Default direct inflow bank"]}
            rows={data.branchBankMappings.map((mapping) => [
              branchLabel(mapping.branches ?? branchById.get(mapping.branch_id)),
              bankAccountLabel(mapping.bank_accounts ?? bankAccountById.get(mapping.bank_account_id))
            ])}
          />
        </div>

        {canManageBankAccounts ? (
          <form action={createBankAccount} className="form-card">
            <h2>Add bank account</h2>
            <label>
              Account name
              <input name="name" placeholder="Example: CIMB Inanam" required />
            </label>
            <label>
              Bank name
              <input name="bank_name" placeholder="Example: CIMB" />
            </label>
            <label>
              Account number
              <input name="account_no" />
            </label>
            <button className="primary-button" type="submit">
              Add account
            </button>
          </form>
        ) : null}
      </section>

      {canManageBankAccounts ? (
        <section className="section-grid mt-section">
          <form action={upsertBankAccountPermission} className="form-card">
            <h2>Bank access management</h2>
            <label>
              User
              <select name="user_id" required>
                {bankAccessUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name} ({user.role})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Bank account
              <select name="bank_account_id" required>
                {bankAccessAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {bankAccountLabel(account)}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="permission-checklist">
              <legend>Access level</legend>
              <label>
                <input name="can_view" type="checkbox" value="true" defaultChecked />
                View
              </label>
              <label>
                <input name="can_create_transaction" type="checkbox" value="true" />
                Create transactions
              </label>
              <label>
                <input name="can_edit_transaction" type="checkbox" value="true" />
                Edit transactions
              </label>
              <label>
                <input name="can_manage_account" type="checkbox" value="true" />
                Manage account
              </label>
            </fieldset>
            <button className="primary-button" disabled={!bankAccessUsers.length || !bankAccessAccounts.length} type="submit">
              Grant or update access
            </button>
          </form>

          <div className="table-section">
            <h2>Current bank access</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Bank account</th>
                    <th>Permissions</th>
                    <th>Revoke</th>
                  </tr>
                </thead>
                <tbody>
                  {bankAccessPermissions.length ? (
                    bankAccessPermissions.map((permission) => (
                      <tr key={permission.id}>
                        <td>{accessUserById.get(permission.user_id)?.full_name ?? permission.user_id}</td>
                        <td>{bankAccountLabel(accessAccountById.get(permission.bank_account_id))}</td>
                        <td>{permissionSummary(permission)}</td>
                        <td>
                          <form action={revokeBankAccountPermission}>
                            <input name="permission_id" type="hidden" value={permission.id} />
                            <button className="ghost-button compact-button" type="submit">
                              Revoke
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4}>No bank account permissions have been granted yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
