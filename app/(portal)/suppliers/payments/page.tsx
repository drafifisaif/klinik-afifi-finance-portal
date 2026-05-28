import { DataTable } from "@/components/data-table";
import { DocumentManager } from "@/components/documents/document-manager";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { SupplierPaymentForm } from "@/components/supplier-payment-form";
import { isActiveFinancialRecord } from "@/lib/bank-reporting";
import { getBankingDataForScope, getDashboardData, getSupplierOutstanding, getSuppliers, totalBy } from "@/lib/data";
import { formatCurrency, formatDate, labelize } from "@/lib/format";
import { outstandingOpeningBalanceTotal } from "@/lib/opening-balances";
import { canViewAllBranches, normalizeRole, requirePermission } from "@/lib/permissions";
import { getTransactionDocuments } from "@/lib/transaction-documents";
import { BadgeCheck, Banknote, CircleDollarSign, Truck } from "lucide-react";

export default async function SupplierPaymentsPage() {
  const profile = await requirePermission("view_supplier_payments");
  const data = await getDashboardData();
  const bankingData = await getBankingDataForScope({ bankAccessOnly: true });
  const outstandingRows = await getSupplierOutstanding();
  const suppliers = await getSuppliers();
  const paymentDocuments = await getTransactionDocuments("supplier_payments", data.supplierPayments.map((payment) => payment.id));
  const canUseGeneralPayment = canViewAllBranches(profile);
  const canDeleteDocuments = normalizeRole(profile.role) !== "branch_pic";
  const activePurchases = data.purchases.filter(isActiveFinancialRecord);
  const purchased = totalBy(activePurchases, (purchase) => purchase.total_amount);
  const paid = totalBy(data.supplierPayments, (payment) => payment.amount);
  const openingOutstanding = outstandingOpeningBalanceTotal(data.openingBalances, "supplier_outstanding");
  const outstanding = openingOutstanding + purchased - paid;

  return (
    <>
      <ModuleHeader
        eyebrow="Payables"
        title="Supplier payments"
        description="Track supplier payment activity and the remaining payable position for medicine and consumable purchase invoices."
      />

      <section className="dashboard-grid">
        <MetricCard icon={Truck} label="Purchase invoices" value={formatCurrency(purchased)} />
        <MetricCard icon={BadgeCheck} label="Supplier paid" value={formatCurrency(paid)} tone="blue" />
        <MetricCard icon={CircleDollarSign} label="Outstanding" value={formatCurrency(outstanding)} detail="Opening balance plus purchases less payments" tone="amber" />
        <MetricCard icon={Banknote} label="Payment records" value={String(data.supplierPayments.length)} tone="rose" />
      </section>

      <section className="section-grid">
        <DataTable
          columns={["Date", "Supplier", "Branch", "Method", "Paid From", "Reference", "Amount", "Documents"]}
          rows={data.supplierPayments.map((payment) => [
            formatDate(payment.payment_date),
            payment.suppliers?.name ?? "-",
            payment.branches?.name ?? "-",
            labelize(payment.payment_type),
            payment.bank_accounts?.name ?? "-",
            payment.reference_no ?? "-",
            formatCurrency(payment.amount),
            <DocumentManager
              canDelete={canDeleteDocuments}
              documents={paymentDocuments.get(payment.id) ?? []}
              entityId={payment.id}
              entityName="supplier_payments"
              key={`${payment.id}-documents`}
            />
          ])}
        />

        <SupplierPaymentForm
          branches={data.branches}
          suppliers={suppliers}
          purchases={outstandingRows}
          payments={data.supplierPayments}
          bankAccounts={bankingData.bankAccounts}
          canUseGeneralPayment={canUseGeneralPayment}
        />
      </section>

      <section className="table-section mt-section">
        <h2>Supplier aging report</h2>
        <DataTable
          columns={["Supplier", "Invoice", "Branch", "Invoice Date", "Due Date", "Term", "Invoice Amount", "Amount Paid", "Outstanding", "Bucket", "Days Overdue"]}
          rows={outstandingRows
            .filter((row) => row.outstanding_amount > 0)
            .map((row) => [
              row.supplier_name ?? row.suppliers?.name ?? "-",
              row.invoice_no ?? row.id,
              row.branch_name ?? row.branches?.name ?? "-",
              formatDate(row.invoice_date ?? row.purchase_date),
              row.due_date ? formatDate(row.due_date) : "-",
              `${row.credit_term_days ?? 0} days`,
              formatCurrency(row.total_amount),
              formatCurrency(row.paid_amount),
              formatCurrency(row.outstanding_amount),
              row.aging_bucket ?? "-",
              String(row.days_overdue ?? 0)
            ])}
        />
      </section>
    </>
  );
}
