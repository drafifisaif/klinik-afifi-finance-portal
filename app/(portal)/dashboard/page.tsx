import { BranchCard } from "@/components/branch-card";
import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { branchGroups, getBranchGroup, resolveSelectedBranchIds, toParamArray } from "@/lib/branch-reporting";
import { getDashboardData, totalBy } from "@/lib/data";
import { formatCurrency, formatDate, monthKey } from "@/lib/format";
import { canViewAllBranches, requirePermission } from "@/lib/permissions";
import { ChartNoAxesCombined, CreditCard, ReceiptText, ShieldAlert, TrendingUp } from "lucide-react";

type DashboardSearchParams = {
  branch?: string | string[];
  branches?: string | string[];
  group?: string;
};

type ChartRow = {
  label: string;
  value: number;
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
  const data = await getDashboardData();
  const isLimitedDashboard = profile.role === "staff";
  const canSelectMultiple = canViewAllBranches(profile);
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
  const sales = data.sales.filter((sale) => selectedBranchIdSet.has(sale.branch_id));
  const expenses = data.expenses.filter((expense) => selectedBranchIdSet.has(expense.branch_id));
  const purchases = data.purchases.filter((purchase) => selectedBranchIdSet.has(purchase.branch_id));
  const panels = data.panels.filter((panel) => selectedBranchIdSet.has(panel.branch_id));
  const latestSaleDate = sales[0]?.sale_date;
  const dailySales = latestSaleDate ? sales.filter((sale) => sale.sale_date === latestSaleDate) : [];

  const totalSales = totalBy(sales, (sale) => money(sale.total_amount));
  const todaySales = totalBy(dailySales, (sale) => money(sale.total_amount));
  const totalExpenses = totalBy(expenses, (expense) => money(expense.amount));
  const purchaseCost = totalBy(purchases, (purchase) => money(purchase.total_amount));
  const profit = totalSales - totalExpenses - purchaseCost;
  const panelOutstanding = totalBy(
    panels.filter((panel) => panel.status !== "paid"),
    (panel) => money(panel.amount)
  );
  const selectedBranchLabel = selectedBranches.length > 0 ? selectedBranches.map((branch) => branch.name).join(", ") : "No branches selected";

  const branchMetrics = selectedBranches.map((branch) => {
    const branchSalesRows = sales.filter((sale) => sale.branch_id === branch.id);
    const branchExpenseRows = expenses.filter((expense) => expense.branch_id === branch.id);
    const branchPurchaseRows = purchases.filter((purchase) => purchase.branch_id === branch.id);
    const branchPanelRows = panels.filter((panel) => panel.branch_id === branch.id && panel.status !== "paid");
    const branchSales = totalBy(branchSalesRows, (sale) => money(sale.total_amount));
    const branchExpenses = totalBy(branchExpenseRows, (expense) => money(expense.amount));
    const branchPurchases = totalBy(branchPurchaseRows, (purchase) => money(purchase.total_amount));

    return {
      branch,
      expenses: branchExpenses,
      panelOutstanding: totalBy(branchPanelRows, (panel) => money(panel.amount)),
      profit: branchSales - branchExpenses - branchPurchases,
      purchases: branchPurchases,
      sales: branchSales
    };
  });

  const monthlySales = new Map<string, number>();
  const monthlyCosts = new Map<string, number>();
  const monthlyProfit = new Map<string, number>();
  sales.forEach((sale) => {
    const key = monthSortKey(sale.sale_date);
    const value = money(sale.total_amount);
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

  return (
    <>
      <ModuleHeader
        eyebrow="Finance overview"
        title={
          isLimitedDashboard
            ? "Branch dashboard"
            : selectedBranches.length === 1
              ? `${selectedBranches[0].name} finance command center`
              : "Multi-branch finance command center"
        }
        description={
          isLimitedDashboard
            ? "A limited branch view for quick sales visibility."
            : "Track raw clinic revenue, operating cost, supplier commitments, and branch-level contribution."
        }
      />

      {!isLimitedDashboard ? (
        <form className="reporting-filter" method="get">
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
            Selected reporting group: {selectedGroup.label}. Selected branches: {selectedBranchLabel}
          </p>
        </form>
      ) : null}

      <section className="dashboard-grid" aria-label="Finance metrics">
        <MetricCard icon={CreditCard} label="Daily sales" value={formatCurrency(todaySales)} detail="Latest entered day" />
        <MetricCard icon={ChartNoAxesCombined} label="Raw sales total" value={formatCurrency(totalSales)} detail={selectedBranchLabel} tone="blue" />
        {!isLimitedDashboard ? (
          <>
            <MetricCard icon={ReceiptText} label="Raw expenses" value={formatCurrency(totalExpenses + purchaseCost)} detail="Operating and purchases" tone="amber" />
            <MetricCard icon={TrendingUp} label="Raw net profit" value={formatCurrency(profit)} detail={selectedGroup.label} tone={profit >= 0 ? "teal" : "rose"} />
            <MetricCard icon={ShieldAlert} label="Panel outstanding" value={formatCurrency(panelOutstanding)} detail="Unpaid and partial claims" tone="rose" />
          </>
        ) : null}
      </section>

      {!isLimitedDashboard ? (
        <>
          <section className="section-grid">
            <div className="cards-grid">
              {branchMetrics.map((metric) => (
                <BranchCard
                  expenses={metric.expenses}
                  key={metric.branch.id}
                  name={metric.branch.name}
                  panelOutstanding={metric.panelOutstanding}
                  purchases={metric.purchases}
                  sales={metric.sales}
                />
              ))}
            </div>

            <aside className="report-panel">
              <h2>P&amp;L summary</h2>
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
                  <dt>Raw revenue</dt>
                  <dd>{formatCurrency(totalSales)}</dd>
                </div>
                <div>
                  <dt>Raw operating expenses</dt>
                  <dd>{formatCurrency(totalExpenses)}</dd>
                </div>
                <div>
                  <dt>Raw supplier purchases</dt>
                  <dd>{formatCurrency(purchaseCost)}</dd>
                </div>
                <div>
                  <dt>Raw net profit</dt>
                  <dd className={profit >= 0 ? "positive" : "negative"}>{formatCurrency(profit)}</dd>
                </div>
              </dl>
            </aside>
          </section>

          <section className="chart-grid mt-section" aria-label="Finance charts">
            <BarChart rows={buildChartRows(monthlySales)} title="Raw monthly sales" tone="blue" />
            <BarChart rows={buildChartRows(monthlyCosts)} title="Raw expenses and purchases" tone="amber" />
            <BarChart rows={buildChartRows(monthlyProfit)} title="Raw net profit" tone={profit >= 0 ? "teal" : "rose"} />
          </section>

          <section className="table-section mt-section">
            <h2>Branch contribution breakdown</h2>
            <DataTable
              columns={["Branch", "Raw sales", "Raw expenses", "Raw purchases", "Raw profit", "Panel outstanding"]}
              rows={branchMetrics.map((metric) => [
                metric.branch.name,
                formatCurrency(metric.sales),
                formatCurrency(metric.expenses),
                formatCurrency(metric.purchases),
                formatCurrency(metric.profit),
                formatCurrency(metric.panelOutstanding)
              ])}
            />
          </section>
        </>
      ) : null}

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
    </>
  );
}
