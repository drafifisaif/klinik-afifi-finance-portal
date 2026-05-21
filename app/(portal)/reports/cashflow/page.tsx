import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { isActiveFinancialRecord } from "@/lib/bank-reporting";
import { getDashboardData, totalBy } from "@/lib/data";
import { formatCurrency, monthKey } from "@/lib/format";
import { requirePermission } from "@/lib/permissions";
import { Banknote, CircleDollarSign, Receipt, WalletCards } from "lucide-react";

export default async function CashflowPage() {
  await requirePermission("view_reports");
  const data = await getDashboardData();
  const sales = data.sales.filter(isActiveFinancialRecord);
  const cashIn = totalBy(sales, (sale) => sale.cash_amount + sale.bank_transfer_amount + sale.card_amount + sale.qr_amount);
  const panelExpected = totalBy(
    data.panels.filter((claim) => claim.status !== "paid"),
    (claim) => claim.amount
  );
  const supplierPaid = totalBy(data.supplierPayments, (payment) => payment.amount);
  const expenseOut = totalBy(data.expenses, (expense) => expense.amount) + supplierPaid;
  const netCash = cashIn - expenseOut;

  const months = Array.from(
    new Set([
      ...sales.map((sale) => monthKey(sale.sale_date)),
      ...data.expenses.map((expense) => monthKey(expense.expense_date)),
      ...data.supplierPayments.map((payment) => monthKey(payment.payment_date))
    ])
  );

  return (
    <>
      <ModuleHeader
        eyebrow="Reporting"
        title="Cashflow summary"
        description="A lightweight cash movement view using cash-like sales inflow, expenses, supplier payments, and panel receivables."
      />

      <section className="dashboard-grid">
        <MetricCard icon={Banknote} label="Cash inflow" value={formatCurrency(cashIn)} />
        <MetricCard icon={Receipt} label="Cash outflow" value={formatCurrency(expenseOut)} tone="amber" />
        <MetricCard icon={CircleDollarSign} label="Net cash" value={formatCurrency(netCash)} tone={netCash >= 0 ? "teal" : "rose"} />
        <MetricCard icon={WalletCards} label="Panel expected" value={formatCurrency(panelExpected)} tone="blue" />
      </section>

      <section className="mt-section">
        <DataTable
          columns={["Month", "Cash sales inflow", "Expenses paid", "Supplier paid", "Net cash movement"]}
          rows={months.map((month) => {
            const monthCashIn = totalBy(
              sales.filter((sale) => monthKey(sale.sale_date) === month),
              (sale) => sale.cash_amount + sale.bank_transfer_amount + sale.card_amount + sale.qr_amount
            );
            const monthExpenses = totalBy(
              data.expenses.filter((expense) => monthKey(expense.expense_date) === month),
              (expense) => expense.amount
            );
            const monthSupplierPaid = totalBy(
              data.supplierPayments.filter((payment) => monthKey(payment.payment_date) === month),
              (payment) => payment.amount
            );

            return [
              month,
              formatCurrency(monthCashIn),
              formatCurrency(monthExpenses),
              formatCurrency(monthSupplierPaid),
              formatCurrency(monthCashIn - monthExpenses - monthSupplierPaid)
            ];
          })}
        />
      </section>
    </>
  );
}
