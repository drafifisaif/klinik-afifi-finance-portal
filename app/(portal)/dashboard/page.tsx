import { DataTable } from "@/components/data-table";
import { ExportCsvLink } from "@/components/export-csv-link";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import {
  bankAccountLabel,
  bankInAmount,
  cashBankInSourceDate,
  bankTransactionAmount,
  buildCashInHandRows,
  buildPettyCashBalanceRows,
  directBankInflow,
  getMappingByBranch,
  isActiveFinancialRecord,
  isWithinDateRange,
  pettyCashAmount,
  resolveDateRange
} from "@/lib/bank-reporting";
import { branchGroups, getBranchGroup, resolveSelectedBranchIds, toParamArray } from "@/lib/branch-reporting";
import { getBankingData, getDashboardData, getDashboardOperationalCashData, getSupplierOutstanding, totalBy } from "@/lib/data";
import { formatCurrency, formatDate, monthKey } from "@/lib/format";
import { bankOpeningBalanceTotal, needsOpeningBalanceCaution, outstandingOpeningBalanceTotal } from "@/lib/opening-balances";
import { activePanelPayments, activePanelClaims, panelClaimOutstandingAmount } from "@/lib/panel-accounting";
import { canViewAllBranches, normalizeRole, requirePermission } from "@/lib/permissions";
import type { BankAccount, BankingData, BankTransaction, DashboardData, PettyCashTransaction } from "@/lib/types";
import {
  BadgeDollarSign,
  Banknote,
  CircleDollarSign,
  Coins,
  CreditCard,
  Landmark,
  ReceiptText,
  ShieldAlert,
  TrendingUp,
  WalletCards
} from "lucide-react";

type DashboardSearchParams = {
  branch?: string | string[];
  branches?: string | string[];
  end?: string;
  group?: string;
  period?: string;
  start?: string;
};

type ChartRow = {
  label: string;
  value: number;
};

type BankAccountSummary = {
  account: BankAccount;
  cashBankIn: number;
  directSalesInflow: number;
  inflow: number;
  manualMoneyIn: number;
  manualMoneyOut: number;
  openingBalance: number;
  outflow: number;
  ownerDrawing: number;
  panelPaymentsReceived: number;
  pettyCashIssued: number;
  pettyCashReturned: number;
  supplierPayments: number;
  transferIn: number;
  transferOut: number;
};

function money(value: number) {
  return Number(value) || 0;
}

function monthSortKey(date: string) {
  return date.slice(0, 7);
}

function addAmount(totals: Map<string, number>, key: string, amount: number) {
  totals.set(key, (totals.get(key) ?? 0) + money(amount));
}

function buildChartRows(totals: Map<string, number>) {
  return Array.from(totals.entries())
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, value]) => ({ label: monthKey(`${key}-01`), value }));
}

function createBankAccountSummary(account: BankAccount): BankAccountSummary {
  return {
    account,
    cashBankIn: 0,
    directSalesInflow: 0,
    inflow: 0,
    manualMoneyIn: 0,
    manualMoneyOut: 0,
    openingBalance: 0,
    outflow: 0,
    ownerDrawing: 0,
    panelPaymentsReceived: 0,
    pettyCashIssued: 0,
    pettyCashReturned: 0,
    supplierPayments: 0,
    transferIn: 0,
    transferOut: 0
  };
}

function addManualBankMovement(summary: BankAccountSummary | undefined, transaction: BankTransaction) {
  if (!summary) return;

  const amount = bankTransactionAmount(transaction);
  if (transaction.transaction_type === "money_in") {
    summary.inflow += amount;
    summary.manualMoneyIn += amount;
  }
  if (transaction.transaction_type === "money_out") {
    summary.manualMoneyOut += amount;
    summary.outflow += amount;
  }
  if (transaction.transaction_type === "owner_drawing") {
    summary.outflow += amount;
    summary.ownerDrawing += amount;
  }
  if (transaction.transaction_type === "interbank_transfer" && transaction.direction === "in") {
    summary.inflow += amount;
    summary.transferIn += amount;
  }
  if (transaction.transaction_type === "interbank_transfer" && transaction.direction === "out") {
    summary.outflow += amount;
    summary.transferOut += amount;
  }
}

function addPettyCashBankMovement(summary: BankAccountSummary | undefined, transaction: PettyCashTransaction) {
  if (!summary) return;

  const amount = pettyCashAmount(transaction);
  if (transaction.transaction_type === "petty_cash_issued") {
    summary.outflow += amount;
    summary.pettyCashIssued += amount;
  }
  if (transaction.transaction_type === "petty_cash_returned") {
    summary.inflow += amount;
    summary.pettyCashReturned += amount;
  }
}

function BarChart({ rows, title, tone = "teal" }: { rows: ChartRow[]; title: string; tone?: "teal" | "blue" | "amber" | "rose" }) {
  const maxValue = Math.max(...rows.map((row) => Math.abs(row.value)), 1);

  return (
    <article className={`chart-panel chart-${tone}`}>
      <h2>{title}</h2>
      <div className="bar-list">
        {rows.length > 0 ? (
          rows.map((row) => (
            <div className="bar-row" key={row.label}>
              <span>{row.label}</span>
              <div className="bar-track">
                <div className={row.value < 0 ? "bar-fill bar-negative" : "bar-fill"} style={{ width: `${Math.max(4, (Math.abs(row.value) / maxValue) * 100)}%` }} />
              </div>
              <strong className={row.value < 0 ? "negative" : undefined}>{formatCurrency(row.value)}</strong>
            </div>
          ))
        ) : (
          <p className="muted-copy">No records for the selected branches.</p>
        )}
      </div>
    </article>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<DashboardSearchParams> }) {
  const profile = await requirePermission("view_dashboard");
  const params = await searchParams;
  const role = normalizeRole(profile.role);
  const isFinanceDashboard = role === "owner" || role === "admin" || role === "finance";
  const isBranchPicDashboard = role === "branch_pic";
  const operationalData = isFinanceDashboard ? null : await getDashboardOperationalCashData();
  const data: DashboardData = isFinanceDashboard
    ? await getDashboardData()
    : {
        branches: operationalData?.branches ?? [],
        expenses: operationalData?.expenses ?? [],
        openingBalances: operationalData?.openingBalances ?? [],
        panelPayments: [],
        panels: [],
        purchases: [],
        sales: operationalData?.sales ?? [],
        supplierPayments: []
      };
  const supplierOutstandingRows = isFinanceDashboard ? await getSupplierOutstanding() : [];
  const fullBankingData = isFinanceDashboard ? await getBankingData() : null;
  const operationalBankingData: BankingData | null = operationalData
    ? {
        bankAccountPermissions: [],
        bankAccounts: [],
        bankTransactions: [],
        branchBankMappings: [],
        branches: operationalData.branches,
        cashBankIns: operationalData.cashBankIns,
        expenses: operationalData.expenses,
        monthlyOpeningBalances: operationalData.monthlyOpeningBalances,
        openingBalances: operationalData.openingBalances,
        panelPayments: [],
        pettyCashTransactions: operationalData.pettyCashTransactions,
        sales: operationalData.sales,
        supplierPayments: []
      }
    : null;
  const bankingData = fullBankingData ?? operationalBankingData;
  const canSelectMultiple = canViewAllBranches(profile);
  const range = resolveDateRange(params);
  const requestedBranches = [...toParamArray(params.branch), ...toParamArray(params.branches)];
  const selectedGroup = getBranchGroup(params.group ?? (requestedBranches.length > 0 ? "custom" : "all"));
  const selectedBranchIds = resolveSelectedBranchIds({
    allowedBranches: data.branches,
    branchParam: params.branch,
    branchesParam: params.branches,
    canSelectMultiple,
    groupParam: params.group
  });
  const selectedBranchIdSet = new Set(selectedBranchIds);
  const selectedBranches = data.branches.filter((branch) => selectedBranchIdSet.has(branch.id));
  const isAllSelectedBranches = selectedBranches.length === data.branches.length;
  const sales = data.sales.filter((sale) => {
    return isActiveFinancialRecord(sale) && selectedBranchIdSet.has(sale.branch_id) && isWithinDateRange(sale.sale_date, range);
  });
  const expenses = data.expenses.filter((expense) => isActiveFinancialRecord(expense) && selectedBranchIdSet.has(expense.branch_id) && isWithinDateRange(expense.expense_date, range));
  const purchases = data.purchases.filter((purchase) => {
    return isActiveFinancialRecord(purchase) && selectedBranchIdSet.has(purchase.branch_id) && isWithinDateRange(purchase.purchase_date, range);
  });
  const panels = activePanelClaims(
    data.panels.filter((panel) => selectedBranchIdSet.has(panel.branch_id) && isWithinDateRange(panel.claim_month, range))
  );
  const panelClaimsForOutstanding = activePanelClaims(
    data.panels.filter((panel) => selectedBranchIdSet.has(panel.branch_id) && panel.claim_month <= range.endDate)
  );
  const panelOutstandingPayments = activePanelPayments(
    data.panelPayments.filter((payment) => {
      return selectedBranchIdSet.has(payment.branch_id ?? payment.panel_claims?.branch_id ?? "")
        && payment.payment_date <= range.endDate;
    })
  );
  const totalSales = totalBy(sales, (sale) => money(sale.total_amount));
  const totalPanelSales = totalBy(sales, (sale) => money(sale.panel_amount));
  const directSales = totalSales - totalPanelSales;
  const panelClaimsIssued = totalBy(panels, (panel) => money(panel.amount));
  const accrualIncome = directSales + panelClaimsIssued;
  const operatingExpenses = totalBy(expenses, (expense) => money(expense.amount));
  const purchaseCost = totalBy(purchases, (purchase) => money(purchase.total_amount));
  const accrualExpenses = operatingExpenses + purchaseCost;
  const panelOpeningOutstanding = outstandingOpeningBalanceTotal(
    data.openingBalances,
    "panel_outstanding",
    selectedBranchIdSet,
    range.endDate,
    isAllSelectedBranches
  );
  const supplierOpeningOutstanding = outstandingOpeningBalanceTotal(
    data.openingBalances,
    "supplier_outstanding",
    selectedBranchIdSet,
    range.endDate,
    isAllSelectedBranches
  );
  const panelOutstanding = panelOpeningOutstanding + totalBy(
    panelClaimsForOutstanding,
    (panel) => money(panelClaimOutstandingAmount(panel, panelOutstandingPayments))
  );
  const selectedBranchLabel = selectedBranches.length > 0 ? selectedBranches.map((branch) => branch.name).join(", ") : "No branches selected";
  const filteredSupplierOutstanding = supplierOutstandingRows.filter((row) => selectedBranchIdSet.has(row.branch_id) && row.outstanding_amount > 0);
  const supplierOutstanding = supplierOpeningOutstanding + totalBy(filteredSupplierOutstanding, (row) => money(row.outstanding_amount));
  const supplierDueSoon = totalBy(
    filteredSupplierOutstanding.filter((row) => row.aging_bucket === "not_due" || row.aging_bucket === "due_within_30"),
    (row) => money(row.outstanding_amount)
  );
  const supplierOverdue = totalBy(
    filteredSupplierOutstanding.filter((row) => row.aging_bucket !== "not_due" && row.aging_bucket !== "due_within_30"),
    (row) => money(row.outstanding_amount)
  );
  const supplierOver90 = totalBy(
    filteredSupplierOutstanding.filter((row) => row.aging_bucket === "over_90"),
    (row) => money(row.outstanding_amount)
  );

  const selectedBankBranches = bankingData?.branches.filter((branch) => selectedBranchIdSet.has(branch.id)) ?? [];
  const selectedBankBranchIds = new Set(selectedBankBranches.map((branch) => branch.id));
  const hasOpeningBalanceCaution = isFinanceDashboard && [...data.openingBalances, ...(bankingData?.openingBalances ?? [])].some(needsOpeningBalanceCaution);
  const selectedBankSales = bankingData?.sales.filter((sale) => {
    return isActiveFinancialRecord(sale) && selectedBankBranchIds.has(sale.branch_id) && isWithinDateRange(sale.sale_date, range);
  }) ?? [];
  const selectedCashBankIns = bankingData?.cashBankIns.filter((bankIn) => {
    return isActiveFinancialRecord(bankIn) && selectedBankBranchIds.has(bankIn.branch_id) && isWithinDateRange(cashBankInSourceDate(bankIn), range);
  }) ?? [];
  const selectedBankTransactions = bankingData?.bankTransactions.filter((transaction) => {
    const matchesBranch = transaction.branch_id ? selectedBranchIdSet.has(transaction.branch_id) : isAllSelectedBranches;
    return isActiveFinancialRecord(transaction) && matchesBranch && isWithinDateRange(transaction.transaction_date, range);
  }) ?? [];
  const selectedPettyCashTransactions = bankingData?.pettyCashTransactions.filter((transaction) => {
    return isActiveFinancialRecord(transaction)
      && selectedBankBranchIds.has(transaction.branch_id)
      && isWithinDateRange(transaction.transaction_date, range);
  }) ?? [];
  const selectedSupplierPayments = bankingData?.supplierPayments.filter((payment) => {
    return !payment.is_void
      && selectedBankBranchIds.has(payment.branch_id)
      && isWithinDateRange(payment.payment_date, range);
  }) ?? [];
  const selectedPanelPayments = activePanelPayments((bankingData?.panelPayments ?? []).filter((payment) => {
    return selectedBranchIdSet.has(payment.branch_id ?? payment.panel_claims?.branch_id ?? "")
      && isWithinDateRange(payment.payment_date, range);
  }));
  const selectedBankLinkedPettyCash = selectedPettyCashTransactions.filter((transaction) => {
    return transaction.bank_account_id
      && (transaction.transaction_type === "petty_cash_issued" || transaction.transaction_type === "petty_cash_returned");
  });
  const cashInHandRows = bankingData
    ? buildCashInHandRows({
        branches: selectedBankBranches,
        cashBankIns: bankingData.cashBankIns,
        expenses: bankingData.expenses,
        monthlyOpeningBalances: bankingData.monthlyOpeningBalances,
        openingBalances: bankingData.openingBalances,
        sales: bankingData.sales
      }, range)
    : [];
  const pettyCashRows = bankingData
    ? buildPettyCashBalanceRows({
        branches: selectedBankBranches,
        monthlyOpeningBalances: bankingData.monthlyOpeningBalances,
        openingBalances: bankingData.openingBalances,
        pettyCashTransactions: bankingData.pettyCashTransactions
      })
    : [];
  const cashInHandByBranchId = new Map(cashInHandRows.map((row) => [row.branch.id, row]));
  const pettyCashByBranchId = new Map(pettyCashRows.map((row) => [row.branch.id, row]));
  const totalCashInHand = totalBy(cashInHandRows, (row) => row.remaining);
  const totalPettyCash = totalBy(pettyCashRows, (row) => row.balance);
  const totalPhysicalCash = totalCashInHand + totalPettyCash;
  const panelPaymentsReceived = totalBy(selectedPanelPayments, (payment) => money(payment.amount));
  const cashInflow = directSales + panelPaymentsReceived;

  const bankAccountSummaries = isFinanceDashboard
    ? new Map((bankingData?.bankAccounts ?? []).map((account) => [account.id, createBankAccountSummary(account)]))
    : new Map<string, BankAccountSummary>();
  bankAccountSummaries.forEach((summary) => {
    summary.openingBalance = bankOpeningBalanceTotal(bankingData?.openingBalances ?? [], summary.account.id, range.endDate);
  });
  if (isFinanceDashboard) {
    const mappingByBranch = bankingData ? getMappingByBranch(bankingData) : new Map();
    selectedBankSales.forEach((sale) => {
      const mapping = mappingByBranch.get(sale.branch_id);
      const summary = mapping ? bankAccountSummaries.get(mapping.bank_account_id) : undefined;
      if (!summary) return;

      const amount = directBankInflow(sale);
      summary.directSalesInflow += amount;
      summary.inflow += amount;
    });
    selectedCashBankIns.forEach((bankIn) => {
      const summary = bankAccountSummaries.get(bankIn.bank_account_id);
      if (!summary) return;

      const amount = bankInAmount(bankIn);
      summary.cashBankIn += amount;
      summary.inflow += amount;
    });
    selectedBankTransactions.forEach((transaction) => addManualBankMovement(bankAccountSummaries.get(transaction.bank_account_id), transaction));
    selectedBankLinkedPettyCash.forEach((transaction) => {
      if (transaction.bank_account_id) addPettyCashBankMovement(bankAccountSummaries.get(transaction.bank_account_id), transaction);
    });
    selectedSupplierPayments.forEach((payment) => {
      if (!payment.bank_account_id) return;
      const summary = bankAccountSummaries.get(payment.bank_account_id);
      if (!summary) return;
      const amount = money(payment.amount);
      summary.outflow += amount;
      summary.supplierPayments += amount;
    });
    selectedPanelPayments.forEach((payment) => {
      if (!payment.bank_account_id) return;
      const summary = bankAccountSummaries.get(payment.bank_account_id);
      if (!summary) return;
      const amount = money(payment.amount);
      summary.inflow += amount;
      summary.panelPaymentsReceived += amount;
    });
  }
  const bankSummaryRows = Array.from(bankAccountSummaries.values());
  const totalBankOutflow = totalBy(bankSummaryRows, (row) => row.outflow);
  const totalOwnerDrawing = totalBy(bankSummaryRows, (row) => row.ownerDrawing);
  const totalDirectSalesInflow = totalBy(bankSummaryRows, (row) => row.directSalesInflow);
  const totalCashBankIn = totalBy(bankSummaryRows, (row) => row.cashBankIn);
  const totalManualMoneyIn = totalBy(bankSummaryRows, (row) => row.manualMoneyIn);
  const totalManualMoneyOut = totalBy(bankSummaryRows, (row) => row.manualMoneyOut);
  const totalPettyCashIssued = totalBy(bankSummaryRows, (row) => row.pettyCashIssued);
  const totalPettyCashReturned = totalBy(bankSummaryRows, (row) => row.pettyCashReturned);
  const totalSupplierPaymentsOutflow = totalBy(bankSummaryRows, (row) => row.supplierPayments);
  const cashOutflow = operatingExpenses + totalSupplierPaymentsOutflow;
  const netCashflow = cashInflow - cashOutflow;
  const profit = accrualIncome - accrualExpenses;

  const branchMetrics = selectedBranches.map((branch) => {
    const branchSalesRows = sales.filter((sale) => sale.branch_id === branch.id);
    const branchExpenseRows = expenses.filter((expense) => expense.branch_id === branch.id);
    const branchPurchaseRows = purchases.filter((purchase) => purchase.branch_id === branch.id);
    const branchSales = totalBy(branchSalesRows, (sale) => money(sale.total_amount));
    const branchPanelSales = totalBy(branchSalesRows, (sale) => money(sale.panel_amount));
    const branchDirectSales = branchSales - branchPanelSales;
    const branchPanelClaims = totalBy(
      panels.filter((panel) => panel.branch_id === branch.id),
      (panel) => money(panel.amount)
    );
    const branchOperatingExpenses = totalBy(branchExpenseRows, (expense) => money(expense.amount));
    const branchPurchases = totalBy(branchPurchaseRows, (purchase) => money(purchase.total_amount));
    const branchCashInHand = cashInHandByBranchId.get(branch.id)?.remaining ?? 0;
    const branchPettyCash = pettyCashByBranchId.get(branch.id)?.balance ?? 0;
    const branchAccrualIncome = branchDirectSales + branchPanelClaims;

    return {
      branch,
      accrualIncome: branchAccrualIncome,
      cashInHand: branchCashInHand,
      expenses: branchOperatingExpenses + branchPurchases,
      netPosition: branchAccrualIncome - branchOperatingExpenses - branchPurchases,
      pettyCash: branchPettyCash,
      sales: branchSales
    };
  });

  const monthlySales = new Map<string, number>();
  const monthlyCosts = new Map<string, number>();
  const monthlyProfit = new Map<string, number>();
  sales.forEach((sale) => {
    const key = monthSortKey(sale.sale_date);
    const value = money(sale.total_amount) - money(sale.panel_amount);
    addAmount(monthlySales, key, value);
    addAmount(monthlyProfit, key, value);
  });
  panels.forEach((panel) => {
    const key = monthSortKey(panel.claim_month);
    const value = money(panel.amount);
    addAmount(monthlySales, key, value);
    addAmount(monthlyProfit, key, value);
  });
  expenses.forEach((expense) => {
    const key = monthSortKey(expense.expense_date);
    const value = money(expense.amount);
    addAmount(monthlyCosts, key, value);
    addAmount(monthlyProfit, key, -value);
  });
  purchases.forEach((purchase) => {
    const key = monthSortKey(purchase.purchase_date);
    const value = money(purchase.total_amount);
    addAmount(monthlyCosts, key, value);
    addAmount(monthlyProfit, key, -value);
  });
  const cashInHandChartRows = cashInHandRows.map((row) => ({ label: row.branch.name, value: row.remaining }));
  const bankMovementChartRows = bankSummaryRows.map((row) => ({ label: bankAccountLabel(row.account), value: row.inflow - row.outflow }));
  const cashInHandDetailLabel = range.label;
  const pettyCashDetailLabel = `As of ${formatDate(range.endDate)}`;
  const dashboardBalanceDiagnostics = cashInHandRows.map((cashRow) => {
    const pettyRow = pettyCashByBranchId.get(cashRow.branch.id);
    const periodCashSales = sales
      .filter((sale) => sale.branch_id === cashRow.branch.id)
      .reduce((sum, sale) => sum + money(sale.cash_amount), 0);
    const periodCashBankIns = (bankingData?.cashBankIns ?? [])
      .filter((bankIn) => {
        return isActiveFinancialRecord(bankIn)
          && bankIn.branch_id === cashRow.branch.id
          && isWithinDateRange(cashBankInSourceDate(bankIn), range);
      })
      .reduce((sum, bankIn) => sum + bankInAmount(bankIn), 0);
    const periodCashLocumPayments = (bankingData?.expenses ?? [])
      .filter((expense) => {
        return isActiveFinancialRecord(expense)
          && String(expense.category ?? "").trim().toLowerCase() === "locum_doctor"
          && String(expense.payment_type ?? "").trim().toLowerCase() === "cash"
          && expense.branch_id === cashRow.branch.id
          && isWithinDateRange(expense.expense_date, range);
      })
      .reduce((sum, expense) => sum + money(expense.amount), 0);

    return {
      branchId: cashRow.branch.id,
      branchName: cashRow.branch.name,
      selectedStartDate: range.startDate,
      selectedEndDate: range.endDate,
      openingCashInHand: cashRow.openingBalance,
      periodCashSales,
      periodCashBankIns,
      periodCashLocumPayments,
      closingCashInHand: cashRow.remaining,
      pettyCashAsOfEndDate: pettyRow?.balance ?? 0,
      totalPhysicalCashAsOfEndDate: cashRow.remaining + (pettyRow?.balance ?? 0)
    };
  });

  if (!isFinanceDashboard) {
    console.info("dashboard operational balance diagnostics", {
      action: "DashboardPage",
      userId: profile.id,
      role,
      currentUserBranchId: profile.branch_id ?? null,
      selectedBranchIds,
      periodStartDate: range.startDate,
      periodEndDate: range.endDate,
      balances: dashboardBalanceDiagnostics
    });
  }

  return (
    <>
      <ModuleHeader
        eyebrow="Finance overview"
        title={
          !isFinanceDashboard
            ? "Branch dashboard"
            : selectedBranches.length === 1
              ? `${selectedBranches[0].name} finance command center`
              : "Owner Dashboard V2"
        }
        description={
          !isFinanceDashboard
            ? "Operational cash visibility for your permitted branch."
            : "Review clinic sales, profit estimate, physical cash, payables, receivables, and bank movement in one practical owner view."
        }
      />

      {isFinanceDashboard ? (
        <div className="export-report-bar">
          <ExportCsvLink label="Export summary CSV" report="dashboard" searchParams={params} />
        </div>
      ) : null}

      {isFinanceDashboard ? (
        <form className="reporting-filter dashboard-filter" method="get">
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
          <label>
            Reporting group
            <select name="group" defaultValue={selectedGroup.id} disabled={!canSelectMultiple}>
              {branchGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.label}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>Branches</legend>
            <div className="checkbox-grid">
              {data.branches.map((branch) => (
                <label key={branch.id}>
                  <input disabled={!canSelectMultiple} type="checkbox" name="branches" value={branch.id} defaultChecked={selectedBranchIdSet.has(branch.id)} />
                  <span>{branch.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <button className="primary-button" type="submit">
            Apply
          </button>
          <p className="selected-branches">
            Showing {range.label}: {formatDate(range.startDate)} to {formatDate(range.endDate)}. Reporting group: {selectedGroup.label}. Branches: {selectedBranchLabel}
          </p>
        </form>
      ) : null}

      {!isFinanceDashboard ? (
        <form className="reporting-filter dashboard-filter" method="get">
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
            Showing {range.label}: {formatDate(range.startDate)} to {formatDate(range.endDate)}. Branch: {selectedBranchLabel}
          </p>
        </form>
      ) : null}

      {isFinanceDashboard && hasOpeningBalanceCaution ? (
        <p className="import-message opening-balance-warning">
          Some opening balances are estimated or pending review. Reports still include these starting values, so interpret totals with caution.
        </p>
      ) : null}

      <section className="dashboard-grid" aria-label="Finance metrics">
        {!isFinanceDashboard ? (
          <>
            <MetricCard icon={CreditCard} label="Direct Sales" value={formatCurrency(directSales)} detail="Sales for selected period" tone="blue" />
            <MetricCard icon={Banknote} label="Cash in Hand" value={formatCurrency(totalCashInHand)} detail={cashInHandDetailLabel} tone={totalCashInHand >= 0 ? "teal" : "rose"} />
            <MetricCard icon={Coins} label="Petty Cash" value={formatCurrency(totalPettyCash)} detail={pettyCashDetailLabel} tone={totalPettyCash >= 0 ? "teal" : "rose"} />
            {isBranchPicDashboard ? (
              <MetricCard icon={BadgeDollarSign} label="Total Physical Cash" value={formatCurrency(totalPhysicalCash)} detail="Cash in hand plus petty cash" tone={totalPhysicalCash >= 0 ? "teal" : "rose"} />
            ) : null}
          </>
        ) : null}
        {isFinanceDashboard ? (
          <>
            <MetricCard icon={CreditCard} label="Direct Sales" value={formatCurrency(directSales)} detail="Sales for selected period" tone="blue" />
            <MetricCard icon={BadgeDollarSign} label="Panel Claims Issued" value={formatCurrency(panelClaimsIssued)} detail="Accrual income from panel claims" tone="amber" />
            <MetricCard icon={TrendingUp} label="Accrual Income" value={formatCurrency(accrualIncome)} detail="Direct sales plus panel claims issued" tone="teal" />
            <MetricCard icon={Landmark} label="Panel Payments Received" value={formatCurrency(panelPaymentsReceived)} detail="Cash received by payment date" tone="blue" />
            <MetricCard icon={Landmark} label="Cash Inflow" value={formatCurrency(cashInflow)} detail="Direct sales plus panel payments received" tone="blue" />
            <MetricCard icon={ReceiptText} label="Accrual Expenses" value={formatCurrency(accrualExpenses)} detail="Operating expenses and supplier purchases" tone="amber" />
            <MetricCard icon={WalletCards} label="Cash Outflow" value={formatCurrency(cashOutflow)} detail="Operating expenses plus supplier payments" tone="rose" />
            <MetricCard icon={TrendingUp} label="Net Cashflow" value={formatCurrency(netCashflow)} detail={selectedGroup.label} tone={netCashflow >= 0 ? "teal" : "rose"} />
            <MetricCard icon={Banknote} label="Cash in Hand" value={formatCurrency(totalCashInHand)} detail={cashInHandDetailLabel} tone={totalCashInHand >= 0 ? "teal" : "rose"} />
            <MetricCard icon={Coins} label="Petty Cash" value={formatCurrency(totalPettyCash)} detail={pettyCashDetailLabel} tone={totalPettyCash >= 0 ? "teal" : "rose"} />
            <MetricCard icon={BadgeDollarSign} label="Total Physical Cash" value={formatCurrency(totalPhysicalCash)} detail="Cash in hand plus petty cash" tone={totalPhysicalCash >= 0 ? "teal" : "rose"} />
            <MetricCard icon={ShieldAlert} label="Panel Outstanding" value={formatCurrency(panelOutstanding)} detail="Panel claims less linked panel payments" tone="rose" />
            <MetricCard icon={CircleDollarSign} label="Supplier Outstanding" value={formatCurrency(supplierOutstanding)} detail="Purchases less supplier payments" tone="amber" />
            <MetricCard icon={ShieldAlert} label="Supplier Due Soon" value={formatCurrency(supplierDueSoon)} detail="Not due and within 30 days" tone="blue" />
            <MetricCard icon={ShieldAlert} label="Supplier Overdue" value={formatCurrency(supplierOverdue)} detail="Overdue invoices only" tone="rose" />
            <MetricCard icon={ShieldAlert} label="Supplier Over 90d" value={formatCurrency(supplierOver90)} detail="High-priority overdue" tone="rose" />
            <MetricCard icon={WalletCards} label="Bank Movement Outflow" value={formatCurrency(totalBankOutflow)} detail="All bank out movements including transfers" tone="amber" />
          </>
        ) : null}
      </section>

      {isFinanceDashboard ? (
        <>
          <section className="section-grid">
            <aside className="report-panel">
              <h2>Owner snapshot</h2>
              <dl className="summary-list">
                <div>
                  <dt>Reporting group</dt>
                  <dd>{selectedGroup.label}</dd>
                </div>
                <div>
                  <dt>Selected branches</dt>
                  <dd>{selectedBranchLabel}</dd>
                </div>
                <div>
                  <dt>Direct sales</dt>
                  <dd>{formatCurrency(directSales)}</dd>
                </div>
                <div>
                  <dt>Panel claims issued</dt>
                  <dd>{formatCurrency(panelClaimsIssued)}</dd>
                </div>
                <div>
                  <dt>Accrual income</dt>
                  <dd>{formatCurrency(accrualIncome)}</dd>
                </div>
                <div>
                  <dt>Operating expenses</dt>
                  <dd>{formatCurrency(operatingExpenses)}</dd>
                </div>
                <div>
                  <dt>Supplier purchases</dt>
                  <dd>{formatCurrency(purchaseCost)}</dd>
                </div>
                <div>
                  <dt>Accrual net profit</dt>
                  <dd className={profit >= 0 ? "positive" : "negative"}>{formatCurrency(profit)}</dd>
                </div>
              </dl>
            </aside>

            <aside className="report-panel">
              <h2>Bank movement mix</h2>
              <dl className="summary-list">
                <div>
                  <dt>Direct sales inflow</dt>
                  <dd>{formatCurrency(totalDirectSalesInflow)}</dd>
                </div>
                <div>
                  <dt>Cash bank-in</dt>
                  <dd>{formatCurrency(totalCashBankIn)}</dd>
                </div>
                <div>
                  <dt>Manual money in / out</dt>
                  <dd>{formatCurrency(totalManualMoneyIn)} / {formatCurrency(totalManualMoneyOut)}</dd>
                </div>
                <div>
                  <dt>Petty cash issued / returned</dt>
                  <dd>{formatCurrency(totalPettyCashIssued)} / {formatCurrency(totalPettyCashReturned)}</dd>
                </div>
                <div>
                  <dt>Panel payments received</dt>
                  <dd>{formatCurrency(panelPaymentsReceived)}</dd>
                </div>
                <div>
                  <dt>Supplier payments</dt>
                  <dd>{formatCurrency(totalSupplierPaymentsOutflow)}</dd>
                </div>
                <div>
                  <dt>Owner drawing</dt>
                  <dd>{formatCurrency(totalOwnerDrawing)}</dd>
                </div>
              </dl>
            </aside>
          </section>

          <section className="chart-grid mt-section" aria-label="Finance charts">
            <BarChart rows={buildChartRows(monthlySales)} title="Monthly accrual income trend" tone="blue" />
            <BarChart rows={buildChartRows(monthlyCosts)} title="Monthly expenses trend" tone="amber" />
            <BarChart rows={buildChartRows(monthlyProfit)} title="Monthly accrual net profit trend" tone={profit >= 0 ? "teal" : "rose"} />
          </section>

          <section className="chart-grid mt-section" aria-label="Cash and bank charts">
            <BarChart rows={cashInHandChartRows} title="Cash in hand by branch" tone={totalCashInHand >= 0 ? "teal" : "rose"} />
            <BarChart rows={bankMovementChartRows} title="Bank movement by account" tone="blue" />
          </section>

          <section className="table-section mt-section">
            <h2>Branch breakdown</h2>
            <DataTable
              columns={["Branch", "Accrual income", "Expenses", "Cash in hand", "Petty cash", "Net position"]}
              rows={branchMetrics.map((metric) => [
                metric.branch.name,
                formatCurrency(metric.accrualIncome),
                formatCurrency(metric.expenses),
                formatCurrency(metric.cashInHand),
                formatCurrency(metric.pettyCash),
                formatCurrency(metric.netPosition)
              ])}
            />
          </section>

          <section className="table-section mt-section">
            <h2>Bank summary by account</h2>
            <DataTable
              columns={["Bank account", "Opening balance", "Opening plus movement", "Inflow", "Outflow", "Direct sales inflow", "Cash bank-in", "Panel payments", "Manual money in", "Manual money out", "Supplier payments", "Transfer in", "Transfer out", "Petty cash issued", "Petty cash returned", "Owner drawing"]}
              rows={bankSummaryRows.map((row) => [
                bankAccountLabel(row.account),
                formatCurrency(row.openingBalance),
                formatCurrency(row.openingBalance + row.inflow - row.outflow),
                formatCurrency(row.inflow),
                formatCurrency(row.outflow),
                formatCurrency(row.directSalesInflow),
                formatCurrency(row.cashBankIn),
                formatCurrency(row.panelPaymentsReceived),
                formatCurrency(row.manualMoneyIn),
                formatCurrency(row.manualMoneyOut),
                formatCurrency(row.supplierPayments),
                formatCurrency(row.transferIn),
                formatCurrency(row.transferOut),
                formatCurrency(row.pettyCashIssued),
                formatCurrency(row.pettyCashReturned),
                formatCurrency(row.ownerDrawing)
              ])}
            />
          </section>
        </>
      ) : null}

      {isFinanceDashboard ? (
        <section className="mt-section">
          <DataTable
            columns={["Date", "Branch", "Cash", "Transfer", "Card", "Panel", "QR", "Total"]}
            rows={sales.slice(0, 8).map((sale) => [
              formatDate(sale.sale_date),
              sale.branches?.name ?? "-",
              formatCurrency(sale.cash_amount),
              formatCurrency(sale.bank_transfer_amount),
              formatCurrency(sale.card_amount),
              formatCurrency(sale.panel_amount),
              formatCurrency(sale.qr_amount),
              formatCurrency(sale.total_amount)
            ])}
          />
        </section>
      ) : null}
    </>
  );
}
