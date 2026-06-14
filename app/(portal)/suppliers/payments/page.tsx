import { updateSupplierPaymentEntry, voidSupplierPaymentEntry } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { DocumentManager } from "@/components/documents/document-manager";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { SupplierPaymentForm } from "@/components/supplier-payment-form";
import { getBankingDataForScope, getSupplierOutstanding, getSupplierPaymentEntries, getSuppliers, totalBy } from "@/lib/data";
import { formatCurrency, formatDate, formatDateTime, labelize } from "@/lib/format";
import { canEditBranch, normalizeRole, requirePermission } from "@/lib/permissions";
import { getTransactionDocuments } from "@/lib/transaction-documents";
import { BadgeCheck, Banknote, CircleDollarSign, Truck } from "lucide-react";

type SupplierPaymentsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function searchValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function purchaseOptionLabel(row: {
  branch_name?: string;
  branches?: { name?: string | null } | null;
  due_date?: string | null;
  invoice_no?: string | null;
  outstanding_amount: number;
  paid_amount: number;
  supplier_name?: string;
  suppliers?: { name?: string | null } | null;
  total_amount: number;
}) {
  const supplier = row.supplier_name ?? row.suppliers?.name ?? "-";
  const branch = row.branch_name ?? row.branches?.name ?? "-";
  const invoicePart = row.invoice_no ? `Invoice ${row.invoice_no}` : "Invoice -";
  const duePart = `Due ${row.due_date ? formatDate(row.due_date) : "-"}`;
  return `${supplier} • ${branch} • ${invoicePart} • ${duePart} • Total ${formatCurrency(row.total_amount)} • Paid ${formatCurrency(row.paid_amount)} • Balance ${formatCurrency(row.outstanding_amount)}`;
}

export default async function SupplierPaymentsPage({ searchParams }: SupplierPaymentsPageProps) {
  const profile = await requirePermission("view_supplier_payments");
  const [payments, outstandingRows, suppliers, bankingData] = await Promise.all([
    getSupplierPaymentEntries(),
    getSupplierOutstanding(),
    getSuppliers(),
    getBankingDataForScope({ bankAccessOnly: true })
  ]);
  const paymentDocuments = await getTransactionDocuments("supplier_payment_entries", payments.map((payment) => payment.id));
  const canDeleteDocuments = normalizeRole(profile.role) !== "branch_pic";
  const outstandingLinkedPurchases = totalBy(outstandingRows.filter((row) => row.outstanding_amount > 0), (row) => row.outstanding_amount);
  const params = searchParams ? await searchParams : {};
  const errorMessage = searchValue(params.error);
  const selectedMonth = searchValue(params.month) ?? new Date().toISOString().slice(0, 7);
  const visiblePayments = payments.filter((payment) => payment.payment_date.slice(0, 7) === selectedMonth);
  const visibleActivePayments = visiblePayments.filter((payment) => !payment.is_void);
  const visibleVoidedPayments = visiblePayments.filter((payment) => payment.is_void);
  const paymentsInMonth = visibleActivePayments;

  return (
    <>
      <ModuleHeader
        eyebrow="Payables"
        title="Supplier payments"
        description="Track V2 supplier payments, link them to supplier purchases, and keep proof of payment attached for audit."
      />

      <section className="dashboard-grid">
        <MetricCard icon={Truck} label="Total Payments" value={formatCurrency(totalBy(visibleActivePayments, (payment) => payment.amount))} detail={selectedMonth} />
        <MetricCard icon={BadgeCheck} label="Payments In Selected Month" value={formatCurrency(totalBy(paymentsInMonth, (payment) => payment.amount))} tone="blue" />
        <MetricCard icon={CircleDollarSign} label="Outstanding Linked Purchases" value={formatCurrency(outstandingLinkedPurchases)} detail="Purchases less supplier payments" tone="amber" />
        <MetricCard icon={Banknote} label="Voided Payments" value={String(visibleVoidedPayments.length)} tone="rose" />
      </section>

      {errorMessage ? (
        <section className="table-section mt-section">
          <p className="void-warning">{errorMessage}</p>
        </section>
      ) : null}

      <section className="table-section mt-section">
        <form className="reporting-filter" method="get">
          <label>
            Payment month
            <input defaultValue={selectedMonth} name="month" type="month" />
          </label>
          <button className="primary-button" type="submit">
            Apply
          </button>
        </form>
      </section>

      <section className="table-section mt-section">
        <h2>Supplier payment ledger</h2>
        <DataTable
          columns={["Date", "Branch", "Supplier", "Linked purchase", "Method", "Paid from", "Amount", "Reference", "Notes", "Documents", "Status", "Edit", "Void / details"]}
          rows={visiblePayments.map((payment) => {
            const canManage = canEditBranch(profile, payment.branch_id);
            const documents = paymentDocuments.get(payment.id) ?? [];
            const linkedPurchaseLabel = payment.supplier_purchase_entries?.invoice_no ?? payment.supplier_purchase_entry_id ?? "General payment";
            const linkedPurchaseOptions = outstandingRows
              .filter((row) => !row.is_void && row.supplier_id === payment.supplier_id && (row.outstanding_amount > 0 || row.id === payment.supplier_purchase_entry_id));

            return [
              formatDate(payment.payment_date),
              payment.branches?.name ?? "-",
              payment.suppliers?.name ?? "-",
              payment.supplier_purchase_entry_id ? linkedPurchaseLabel : "General payment",
              labelize(payment.payment_method ?? "bank_transfer"),
              payment.bank_accounts?.name ?? "-",
              formatCurrency(payment.amount),
              payment.reference_no ?? "-",
              payment.supplier_purchase_entry_id
                ? (payment.notes ?? "-")
                : `${payment.notes ?? "-"}${payment.notes ? " " : ""}(General payment is not allocated to a purchase.)`,
              <DocumentManager
                canDelete={canDeleteDocuments}
                documents={documents}
                entityId={payment.id}
                entityName="supplier_payment_entries"
                key={`${payment.id}-documents`}
              />,
              <span className={`status-pill ${payment.is_void ? "status-voided" : "status-paid"}`} key={`${payment.id}-status`}>
                {payment.is_void ? "Voided" : "Active"}
              </span>,
              !payment.is_void && canManage ? (
                <details className="manual-bank-editor" key={`${payment.id}-edit`}>
                  <summary>Edit</summary>
                  <form action={updateSupplierPaymentEntry} className="manual-bank-edit-form">
                    <input name="payment_entry_id" type="hidden" value={payment.id} />
                    <label>
                      Supplier
                      <select defaultValue={payment.supplier_id} name="supplier_id" required>
                        {suppliers.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Linked purchase
                      <select defaultValue={payment.supplier_purchase_entry_id ?? ""} name="supplier_purchase_entry_id" required>
                        <option value="">Select supplier purchase / invoice</option>
                        {linkedPurchaseOptions.map((row) => (
                          <option key={row.id} value={row.id}>
                            {purchaseOptionLabel(row)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Branch
                      <input value={payment.branches?.name ?? "-"} disabled />
                    </label>
                    <input name="branch_id" type="hidden" value={payment.branch_id} />
                    <label>
                      Payment date
                      <input defaultValue={payment.payment_date} name="payment_date" required type="date" />
                    </label>
                    <label>
                      Payment method
                      <select defaultValue={payment.payment_method ?? "bank_transfer"} name="payment_method" required>
                        <option value="cash">Cash</option>
                        <option value="bank_transfer">Bank transfer</option>
                        <option value="card">Card</option>
                        <option value="qr">QR</option>
                        <option value="panel">Panel</option>
                      </select>
                    </label>
                    <label>
                      Paid from bank account
                      <select defaultValue={payment.bank_account_id ?? ""} name="bank_account_id">
                        <option value="">Select bank account</option>
                        {bankingData.bankAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Amount
                      <input defaultValue={payment.amount} min="0.01" name="amount" required step="0.01" type="number" />
                    </label>
                    <label>
                      Reference
                      <input defaultValue={payment.reference_no ?? ""} name="reference_no" />
                    </label>
                    <label>
                      Notes
                      <textarea defaultValue={payment.notes ?? ""} name="notes" />
                    </label>
                    <button className="primary-button compact-button" type="submit">
                      Save
                    </button>
                  </form>
                </details>
              ) : (
                "-"
              ),
              !payment.is_void && canManage ? (
                <details className="manual-bank-editor" key={`${payment.id}-void`}>
                  <summary>Void</summary>
                  <form action={voidSupplierPaymentEntry} className="manual-bank-edit-form void-record-form">
                    <input name="payment_entry_id" type="hidden" value={payment.id} />
                    <p className="void-warning">Voided payments stay in history and are excluded from supplier outstanding balances.</p>
                    <label>
                      Void reason
                      <textarea name="void_reason" required />
                    </label>
                    <button className="primary-button compact-button" type="submit">
                      Void this supplier payment
                    </button>
                  </form>
                </details>
              ) : payment.is_void ? (
                <div key={`${payment.id}-voided-details`}>
                  <strong>Voided</strong>
                  <div>{payment.void_reason ?? "-"}</div>
                  <small>{payment.voided_at ? formatDateTime(payment.voided_at) : "-"}</small>
                </div>
              ) : (
                "-"
              )
            ];
          })}
        />
      </section>

      <section className="section-grid mt-section">
        <SupplierPaymentForm
          bankAccounts={bankingData.bankAccounts}
          purchases={outstandingRows.filter((row) => row.outstanding_amount > 0)}
          suppliers={suppliers}
        />
      </section>

      <section className="table-section mt-section">
        <h2>Supplier aging report</h2>
        <DataTable
          columns={["Supplier", "Invoice", "Branch", "Invoice Date", "Due Date", "Term", "Invoice Amount", "Amount Paid", "Outstanding", "Status", "Bucket", "Days Overdue"]}
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
              labelize(row.status),
              row.aging_bucket ?? "-",
              String(row.days_overdue ?? 0)
            ])}
        />
      </section>
    </>
  );
}
