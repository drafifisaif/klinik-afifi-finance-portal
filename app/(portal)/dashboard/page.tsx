import { BranchCard } from "@/components/branch-card";
import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { getDashboardData, totalBy } from "@/lib/data";
import { formatCurrency, formatDate } from "@/lib/format";
import { requirePermission } from "@/lib/permissions";
import { ChartNoAxesCombined, CreditCard, ReceiptText, ShieldAlert } from "lucide-react";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const profile = await requirePermission("view_dashboard");
  const params = await searchParams;
  const data = await getDashboardData();
  const isLimitedDashboard = profile.role === "staff";
  const selectedBranch = data.branches.find((branch) => branch.id === params.branch);
  const sales = selectedBranch ? data.sales.filter((sale) => sale.branch_id === selectedBranch.id) : data.sales;
  const expenses = selectedBranch ? data.expenses.filter((expense) => expense.branch_id === selectedBranch.id) : data.expenses;
  const purchases = selectedBranch ? data.purchases.filter((purchase) => purchase.branch_id === selectedBranch.id) : data.purchases;
  const panels = selectedBranch ? data.panels.filter((panel) => panel.branch_id === selectedBranch.id) : data.panels;
  const dailySales = sales.filter((sale) => sale.sale_date === sales[0]?.sale_date);
  const totalSales = totalBy(sales, (sale) => sale.total_amount);
  const todaySales = totalBy(dailySales, (sale) => sale.total_amount);
  const totalExpenses = totalBy(expenses, (expense) => expense.amount);
  const purchaseCost = totalBy(purchases, (purchase) => purchase.total_amount);
  const profit = totalSales - totalExpenses - purchaseCost;
  const panelOutstanding = totalBy(
    panels.filter((panel) => panel.status !== "paid"),
    (panel) => panel.amount
  );

  return (
    <>
      <ModuleHeader
        eyebrow="Finance overview"
        title={
          isLimitedDashboard
            ? "Branch dashboard"
            : selectedBranch
              ? `${selectedBranch.name} finance command center`
              : "Multi-branch finance command center"
        }
        description={
          isLimitedDashboard
            ? "A limited branch view for quick sales visibility."
            : selectedBranch
            ? "Track revenue, operating cost, supplier commitments, and panel receivables for this branch."
            : "Track clinic revenue, operating cost, supplier commitments, and panel receivables across Putatan, Papar, Ranau, and Kinabatangan."
        }
      />

      <section className="dashboard-grid" aria-label="Finance metrics">
        <MetricCard icon={CreditCard} label="Daily sales" value={formatCurrency(todaySales)} detail="Latest entered day" />
        <MetricCard icon={ChartNoAxesCombined} label="Monthly sales" value={formatCurrency(totalSales)} detail="All branches" tone="blue" />
        {!isLimitedDashboard ? (
          <>
            <MetricCard icon={ReceiptText} label="Expenses" value={formatCurrency(totalExpenses + purchaseCost)} detail="Operating and purchases" tone="amber" />
            <MetricCard icon={ShieldAlert} label="Panel outstanding" value={formatCurrency(panelOutstanding)} detail="Unpaid and partial claims" tone="rose" />
          </>
        ) : null}
      </section>

      {!isLimitedDashboard ? (
        <section className="section-grid">
        <div className="cards-grid">
          {data.branches.map((branch) => {
            const branchSales = totalBy(
              data.sales.filter((sale) => sale.branch_id === branch.id),
              (sale) => sale.total_amount
            );
            const branchExpenses = totalBy(
              data.expenses.filter((expense) => expense.branch_id === branch.id),
              (expense) => expense.amount
            );
            const branchPurchases = totalBy(
              data.purchases.filter((purchase) => purchase.branch_id === branch.id),
              (purchase) => purchase.total_amount
            );
            const branchPanels = totalBy(
              data.panels.filter((panel) => panel.branch_id === branch.id && panel.status !== "paid"),
              (panel) => panel.amount
            );

            return (
              <BranchCard
                expenses={branchExpenses}
                key={branch.id}
                name={branch.name}
                panelOutstanding={branchPanels}
                purchases={branchPurchases}
                sales={branchSales}
              />
            );
          })}
        </div>

        <aside className="report-panel">
          <h2>Monthly finance overview</h2>
          <dl className="summary-list">
            <div>
              <dt>Total revenue</dt>
              <dd>{formatCurrency(totalSales)}</dd>
            </div>
            <div>
              <dt>Operating expenses</dt>
              <dd>{formatCurrency(totalExpenses)}</dd>
            </div>
            <div>
              <dt>Supplier purchase cost</dt>
              <dd>{formatCurrency(purchaseCost)}</dd>
            </div>
            <div>
              <dt>Profit summary</dt>
              <dd className={profit >= 0 ? "positive" : "negative"}>{formatCurrency(profit)}</dd>
            </div>
          </dl>
        </aside>
      </section>
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
