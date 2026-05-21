import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { isActiveFinancialRecord } from "@/lib/bank-reporting";
import { getDashboardData, totalBy } from "@/lib/data";
import { formatCurrency, monthKey } from "@/lib/format";
import { requirePermission } from "@/lib/permissions";
import { BadgeDollarSign, ChartNoAxesCombined, ReceiptText, TrendingUp } from "lucide-react";

export default async function ProfitLossPage() {
  await requirePermission("view_reports");
  const data = await getDashboardData();
  const sales = data.sales.filter(isActiveFinancialRecord);
  const revenue = totalBy(sales, (sale) => sale.total_amount);
  const expenses = totalBy(data.expenses, (expense) => expense.amount);
  const purchases = totalBy(data.purchases, (purchase) => purchase.total_amount);
  const profit = revenue - expenses - purchases;

  const months = Array.from(
    new Set([
      ...sales.map((sale) => monthKey(sale.sale_date)),
      ...data.expenses.map((expense) => monthKey(expense.expense_date)),
      ...data.purchases.map((purchase) => monthKey(purchase.purchase_date))
    ])
  );

  return (
    <>
      <ModuleHeader
        eyebrow="Reporting"
        title="Profit & loss summary"
        description="A practical management summary: sales revenue minus operating expenses and supplier purchase costs."
      />

      <section className="dashboard-grid">
        <MetricCard icon={ChartNoAxesCombined} label="Revenue" value={formatCurrency(revenue)} />
        <MetricCard icon={ReceiptText} label="Operating expenses" value={formatCurrency(expenses)} tone="blue" />
        <MetricCard icon={BadgeDollarSign} label="Purchase cost" value={formatCurrency(purchases)} tone="amber" />
        <MetricCard icon={TrendingUp} label="Net profit" value={formatCurrency(profit)} tone={profit >= 0 ? "teal" : "rose"} />
      </section>

      <section className="mt-section">
        <DataTable
          columns={["Month", "Revenue", "Operating expenses", "Supplier purchases", "Net profit"]}
          rows={months.map((month) => {
            const monthRevenue = totalBy(
              sales.filter((sale) => monthKey(sale.sale_date) === month),
              (sale) => sale.total_amount
            );
            const monthExpenses = totalBy(
              data.expenses.filter((expense) => monthKey(expense.expense_date) === month),
              (expense) => expense.amount
            );
            const monthPurchases = totalBy(
              data.purchases.filter((purchase) => monthKey(purchase.purchase_date) === month),
              (purchase) => purchase.total_amount
            );

            return [
              month,
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
