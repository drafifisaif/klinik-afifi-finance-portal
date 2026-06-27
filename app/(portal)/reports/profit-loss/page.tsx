import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { isActiveFinancialRecord } from "@/lib/bank-reporting";
import { getDashboardData, totalBy } from "@/lib/data";
import { formatCurrency, monthKey } from "@/lib/format";
import { activePanelClaims } from "@/lib/panel-accounting";
import { requirePermission } from "@/lib/permissions";
import { BadgeDollarSign, ChartNoAxesCombined, ReceiptText, TrendingUp } from "lucide-react";

export default async function ProfitLossPage() {
  await requirePermission("view_reports");
  const data = await getDashboardData();
  const sales = data.sales.filter(isActiveFinancialRecord);
  const activeExpenses = data.expenses.filter(isActiveFinancialRecord);
  const activePurchases = data.purchases.filter(isActiveFinancialRecord);
  const panelClaims = activePanelClaims(data.panels);
  const directSales = totalBy(sales, (sale) => sale.total_amount - sale.panel_amount);
  const panelClaimsIssued = totalBy(panelClaims, (claim) => claim.amount);
  const revenue = directSales + panelClaimsIssued;
  const expenses = totalBy(activeExpenses, (expense) => expense.amount);
  const purchases = totalBy(activePurchases, (purchase) => purchase.total_amount);
  const profit = revenue - expenses - purchases;

  const months = Array.from(
    new Set([
      ...sales.map((sale) => monthKey(sale.sale_date)),
      ...activeExpenses.map((expense) => monthKey(expense.expense_date)),
      ...activePurchases.map((purchase) => monthKey(purchase.purchase_date)),
      ...panelClaims.map((claim) => monthKey(claim.claim_month))
    ])
  );

  return (
    <>
      <ModuleHeader
        eyebrow="Reporting"
        title="Profit & loss summary"
        description="An accrual summary: direct sales plus panel claims issued, minus operating expenses and supplier purchase costs."
      />

      <section className="dashboard-grid">
        <MetricCard icon={ChartNoAxesCombined} label="Accrual income" value={formatCurrency(revenue)} />
        <MetricCard icon={BadgeDollarSign} label="Panel claims issued" value={formatCurrency(panelClaimsIssued)} tone="blue" />
        <MetricCard icon={ReceiptText} label="Operating expenses" value={formatCurrency(expenses)} tone="blue" />
        <MetricCard icon={BadgeDollarSign} label="Supplier purchases" value={formatCurrency(purchases)} tone="amber" />
        <MetricCard icon={TrendingUp} label="Net profit" value={formatCurrency(profit)} tone={profit >= 0 ? "teal" : "rose"} />
      </section>

      <section className="mt-section">
        <DataTable
          columns={["Month", "Direct sales", "Panel claims issued", "Accrual income", "Operating expenses", "Supplier purchases", "Net profit"]}
          rows={months.map((month) => {
            const monthDirectSales = totalBy(
              sales.filter((sale) => monthKey(sale.sale_date) === month),
              (sale) => sale.total_amount - sale.panel_amount
            );
            const monthPanelClaims = totalBy(
              panelClaims.filter((claim) => monthKey(claim.claim_month) === month),
              (claim) => claim.amount
            );
            const monthExpenses = totalBy(
              activeExpenses.filter((expense) => monthKey(expense.expense_date) === month),
              (expense) => expense.amount
            );
            const monthPurchases = totalBy(
              activePurchases.filter((purchase) => monthKey(purchase.purchase_date) === month),
              (purchase) => purchase.total_amount
            );
            const monthRevenue = monthDirectSales + monthPanelClaims;

            return [
              month,
              formatCurrency(monthDirectSales),
              formatCurrency(monthPanelClaims),
              formatCurrency(monthRevenue),
              formatCurrency(monthExpenses),
              formatCurrency(monthPurchases),
              formatCurrency(monthRevenue - monthExpenses - monthPurchases)
            ];
          })}
        />
      </section>
    </>
  );
}
