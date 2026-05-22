import { createSupplierPayment } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { DocumentManager } from "@/components/documents/document-manager";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { paymentTypes } from "@/lib/constants";
import { getDashboardData, getSuppliers, totalBy } from "@/lib/data";
import { formatCurrency, formatDate, labelize } from "@/lib/format";
import { outstandingOpeningBalanceTotal } from "@/lib/opening-balances";
import { canViewAllBranches, normalizeRole, requirePermission } from "@/lib/permissions";
import { getTransactionDocuments } from "@/lib/transaction-documents";
import { BadgeCheck, Banknote, CircleDollarSign, Truck } from "lucide-react";

export default async function SupplierPaymentsPage() {
  const profile = await requirePermission("view_supplier_records");
  const data = await getDashboardData();
  const suppliers = await getSuppliers();
  const paymentDocuments = await getTransactionDocuments("supplier_payments", data.supplierPayments.map((payment) => payment.id));
  const canUseGeneralPayment = canViewAllBranches(profile);
  const canDeleteDocuments = normalizeRole(profile.role) !== "branch_pic";
  const purchased = totalBy(data.purchases, (purchase) => purchase.total_amount);
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
          columns={["Date", "Supplier", "Branch", "Method", "Reference", "Amount", "Documents"]}
          rows={data.supplierPayments.map((payment) => [
            formatDate(payment.payment_date),
            payment.suppliers?.name ?? "-",
            payment.branches?.name ?? "-",
            labelize(payment.payment_type),
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

        <form action={createSupplierPayment} className="form-card">
          <h2>Record supplier payment</h2>
          <label>
            Supplier
            <select name="supplier_id" required>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Purchase invoice
            <select name="purchase_id">
              <option value="">General supplier payment</option>
              {data.purchases.map((purchase) => (
                <option key={purchase.id} value={purchase.id}>
                  {purchase.invoice_no ?? purchase.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Branch
            <select name="branch_id">
              {canUseGeneralPayment ? <option value="">No branch allocation</option> : null}
              {data.branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Payment date
            <input name="payment_date" type="date" required />
          </label>
          <label>
            Payment type
            <select name="payment_type" required>
              {paymentTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Amount
            <input min="0" name="amount" required step="0.01" type="number" />
          </label>
          <label>
            Reference
            <input name="reference_no" />
          </label>
          <label>
            Notes
            <textarea name="notes" />
          </label>
          <button className="primary-button" type="submit">
            Save payment
          </button>
        </form>
      </section>
    </>
  );
}
