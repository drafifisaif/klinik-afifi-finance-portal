import { updateSupplierPaymentEntry, voidSupplierPaymentEntry } from "@/app/actions";
import { DocumentManager } from "@/components/documents/document-manager";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { SupplierPaymentForm } from "@/components/supplier-payment-form";
import { getBankingDataForScope, getSupplierOutstanding, getSupplierPaymentEntries, getSuppliers, totalBy } from "@/lib/data";
import { formatCurrency, formatDate, formatDateTime, labelize, monthKey } from "@/lib/format";
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

function monthLabel(value: string) {
  return monthKey(`${value}-01`);
}

function purchaseOptionLabel(row: {
  branch_name?: string;
  branches?: { name?: string | null } | null;
  invoice_no?: string | null;
  outstanding_amount: number;
  paid_amount: number;
  supplier_name?: string;
  suppliers?: { name?: string | null } | null;
  total_amount: number;
}) {
  const supplier = row.supplier_name ?? row.suppliers?.name ?? "-";
  const branch = row.branch_name ?? row.branches?.name ?? "-";
  const invoice = row.invoice_no ? `Invoice ${row.invoice_no}` : "Invoice -";
  return `${supplier} • ${branch} • ${invoice} • Total ${formatCurrency(row.total_amount)} • Paid ${formatCurrency(row.paid_amount)} • Balance ${formatCurrency(row.outstanding_amount)}`;
}

export default async function SupplierPaymentsPage({ searchParams }: SupplierPaymentsPageProps) {
  const profile = await requirePermission("view_supplier_payments");
  const [payments, outstandingRows, suppliers, bankingData] = await Promise.all([
    getSupplierPaymentEntries(),
    getSupplierOutstanding(),
    getSuppliers(),
    getBankingDataForScope({ bankAccessOnly: true })
  ]);
  const params = searchParams ? await searchParams : {};
  const errorMessage = searchValue(params.error);
  const selectedMonth = searchValue(params.month) ?? new Date().toISOString().slice(0, 7);
  const selectedBranch = searchValue(params.branch) ?? "all";
  const selectedPurchaseMonth = searchValue(params.purchase_month) ?? "all";
  const branchById = new Map<string, string>();
  [...payments, ...outstandingRows].forEach((row) => {
    if (row.branch_id) branchById.set(row.branch_id, row.branches?.name ?? ("branch_name" in row ? row.branch_name : null) ?? row.branch_id);
  });
  const branchOptions = [...branchById].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const branchFilteredPayments = payments.filter((payment) => selectedBranch === "all" || payment.branch_id === selectedBranch);
  const visiblePayments = branchFilteredPayments.filter((payment) => payment.payment_date.slice(0, 7) === selectedMonth);
  const visibleActivePayments = visiblePayments.filter((payment) => !payment.is_void);
  const visibleVoidedPayments = visiblePayments.filter((payment) => payment.is_void);
  const allOutstanding = outstandingRows.filter((row) => row.outstanding_amount > 0 && !row.is_void);
  const branchOutstanding = allOutstanding.filter((row) => selectedBranch === "all" || row.branch_id === selectedBranch);
  const availablePurchaseMonths = [...new Set(branchOutstanding.map((row) => (row.invoice_date ?? row.purchase_date).slice(0, 7)))].sort().reverse();
  const visibleOutstanding = branchOutstanding.filter((row) => selectedPurchaseMonth === "all" || (row.invoice_date ?? row.purchase_date).slice(0, 7) === selectedPurchaseMonth);
  const outstandingTotal = totalBy(visibleOutstanding, (row) => row.outstanding_amount);
  const outstandingGroups = new Map<string, typeof visibleOutstanding>();
  visibleOutstanding.forEach((row) => {
    const key = `${row.branch_id}|${(row.invoice_date ?? row.purchase_date).slice(0, 7)}`;
    outstandingGroups.set(key, [...(outstandingGroups.get(key) ?? []), row]);
  });
  const groupedRows = [...outstandingGroups.entries()].sort(([a], [b]) => a.localeCompare(b));
  const paymentDocuments = await getTransactionDocuments("supplier_payment_entries", visiblePayments.map((payment) => payment.id));
  const canDeleteDocuments = normalizeRole(profile.role) !== "branch_pic";

  return (
    <>
      <ModuleHeader
        eyebrow="Payables"
        title="Supplier payments"
        description="Cari baki ikut cawangan dan bulan bil, kemudian rekod bayaran dengan lebih mudah."
      />

      <section className="dashboard-grid">
        <MetricCard icon={Truck} label="Payments in selected month" value={formatCurrency(totalBy(visibleActivePayments, (payment) => payment.amount))} detail={selectedMonth} />
        <MetricCard icon={BadgeCheck} label="Active payment records" value={String(visibleActivePayments.length)} tone="blue" />
        <MetricCard icon={CircleDollarSign} label="Outstanding in selected view" value={formatCurrency(outstandingTotal)} detail="By branch and purchase month" tone="amber" />
        <MetricCard icon={Banknote} label="Voided payments" value={String(visibleVoidedPayments.length)} tone="rose" />
      </section>

      {errorMessage ? <section className="table-section mt-section"><p className="void-warning">{errorMessage}</p></section> : null}

      <section className="table-section mt-section">
        <form className="supplier-payment-filters" method="get">
          <label>
            Branch
            <select defaultValue={selectedBranch} name="branch">
              <option value="all">All branches</option>
              {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <label>
            Unpaid purchase month
            <select defaultValue={selectedPurchaseMonth} name="purchase_month">
              <option value="all">All months</option>
              {availablePurchaseMonths.map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}
            </select>
          </label>
          <label>
            Payment history month
            <input defaultValue={selectedMonth} name="month" type="month" />
          </label>
          <button className="primary-button" type="submit">Apply filters</button>
        </form>
        <p className="supplier-filter-caption">
          Baki bil: {selectedBranch === "all" ? "All branches" : branchById.get(selectedBranch) ?? "Selected branch"} · {selectedPurchaseMonth === "all" ? "All purchase months" : monthLabel(selectedPurchaseMonth)}
          <span> Bayaran: {selectedMonth}</span>
        </p>
      </section>

      <section className="table-section mt-section">
        <div className="report-toolbar">
          <h2>Unpaid purchases by branch and month</h2>
          <strong>{formatCurrency(outstandingTotal)} outstanding</strong>
        </div>
        {groupedRows.length ? (
          <div className="supplier-balance-groups">
            {groupedRows.map(([key, rows]) => {
              const [branchId, month] = key.split("|");
              const groupTotal = totalBy(rows, (row) => row.outstanding_amount);
              return (
                <details className="supplier-balance-group" key={key} open>
                  <summary>
                    <span><strong>{branchById.get(branchId) ?? rows[0]?.branch_name ?? "Branch"}</strong><small>{monthLabel(month)} · {rows.length} unpaid bills</small></span>
                    <strong>{formatCurrency(groupTotal)}</strong>
                  </summary>
                  <div className="supplier-balance-list">
                    {rows.map((row) => (
                      <div className="supplier-balance-row" key={row.id}>
                        <div><strong>{row.supplier_name ?? row.suppliers?.name ?? "Supplier"}</strong><span>{row.invoice_no ? `Invoice ${row.invoice_no}` : "Invoice not numbered"} · {formatDate(row.invoice_date ?? row.purchase_date)}</span></div>
                        <div><small>Original {formatCurrency(row.total_amount)} · Paid {formatCurrency(row.paid_amount)}</small><strong>{formatCurrency(row.outstanding_amount)}</strong></div>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        ) : <p className="empty-state">No unpaid purchases match these filters.</p>}
      </section>

      <section className="table-section mt-section">
        <h2>Record a supplier payment</h2>
        <SupplierPaymentForm
          bankAccounts={bankingData.bankAccounts}
          initialBranchId={selectedBranch}
          initialPurchaseMonth={selectedPurchaseMonth}
          purchases={allOutstanding}
          suppliers={suppliers}
        />
      </section>

      <section className="table-section mt-section">
        <h2>Payment history · {selectedMonth}</h2>
        {visiblePayments.length ? (
          <div className="supplier-payment-list">
            {visiblePayments.map((payment) => {
              const canManage = canEditBranch(profile, payment.branch_id);
              const documents = paymentDocuments.get(payment.id) ?? [];
              const linkedPurchaseLabel = payment.supplier_purchase_entries?.invoice_no ?? payment.supplier_purchase_entry_id ?? "General payment";
              const linkedPurchaseOptions = outstandingRows.filter((row) => !row.is_void && row.supplier_id === payment.supplier_id && (row.outstanding_amount > 0 || row.id === payment.supplier_purchase_entry_id));
              return (
                <article className="supplier-payment-entry" key={payment.id}>
                  <div className="supplier-payment-entry-main">
                    <div><span className="supplier-payment-date">{formatDate(payment.payment_date)}</span><h3>{payment.suppliers?.name ?? "Supplier"}</h3><p>{payment.branches?.name ?? "-"} · {payment.supplier_purchase_entry_id ? `Invoice ${linkedPurchaseLabel}` : "General payment"}</p></div>
                    <div className="supplier-payment-amount"><strong>{formatCurrency(payment.amount)}</strong><span className={`status-pill ${payment.is_void ? "status-voided" : "status-paid"}`}>{payment.is_void ? "Voided" : "Active"}</span></div>
                  </div>
                  <div className="supplier-payment-meta"><span>{labelize(payment.payment_method ?? "bank_transfer")}</span><span>{payment.bank_accounts?.name ?? "No bank account"}</span>{payment.reference_no ? <span>Ref: {payment.reference_no}</span> : null}</div>
                  {payment.notes ? <p className="supplier-payment-notes">{payment.notes}</p> : null}
                  {!payment.supplier_purchase_entry_id ? <p className="supplier-payment-notes">General payment is not allocated to a purchase.</p> : null}
                  <div className="supplier-payment-actions">
                    <details className="manual-bank-editor"><summary>Documents</summary><DocumentManager canDelete={canDeleteDocuments} documents={documents} entityId={payment.id} entityName="supplier_payment_entries" /></details>
                    {!payment.is_void && canManage ? (
                      <details className="manual-bank-editor"><summary>Edit payment</summary>
                        <form action={updateSupplierPaymentEntry} className="manual-bank-edit-form">
                          <input name="payment_entry_id" type="hidden" value={payment.id} />
                          <label>Supplier<select defaultValue={payment.supplier_id} name="supplier_id" required>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
                          <label>Linked purchase<select defaultValue={payment.supplier_purchase_entry_id ?? ""} name="supplier_purchase_entry_id" required><option value="">Select supplier purchase / invoice</option>{linkedPurchaseOptions.map((row) => <option key={row.id} value={row.id}>{purchaseOptionLabel(row)}</option>)}</select></label>
                          <label>Branch<input value={payment.branches?.name ?? "-"} disabled /></label><input name="branch_id" type="hidden" value={payment.branch_id} />
                          <label>Payment date<input defaultValue={payment.payment_date} name="payment_date" required type="date" /></label>
                          <label>Payment method<select defaultValue={payment.payment_method ?? "bank_transfer"} name="payment_method" required><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="qr">QR</option><option value="panel">Panel</option></select></label>
                          <label>Paid from bank account<select defaultValue={payment.bank_account_id ?? ""} name="bank_account_id"><option value="">Select bank account</option>{bankingData.bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
                          <label>Amount<input defaultValue={payment.amount} min="0.01" name="amount" required step="0.01" type="number" /></label>
                          <label>Reference<input defaultValue={payment.reference_no ?? ""} name="reference_no" /></label>
                          <label>Notes<textarea defaultValue={payment.notes ?? ""} name="notes" /></label>
                          <button className="primary-button compact-button" type="submit">Save changes</button>
                        </form>
                      </details>
                    ) : null}
                    {!payment.is_void && canManage ? (
                      <details className="manual-bank-editor"><summary>Void payment</summary>
                        <form action={voidSupplierPaymentEntry} className="manual-bank-edit-form void-record-form"><input name="payment_entry_id" type="hidden" value={payment.id} /><p className="void-warning">Voided payments remain in history and are excluded from supplier balances.</p><label>Void reason<textarea name="void_reason" required /></label><button className="primary-button compact-button" type="submit">Confirm void</button></form>
                      </details>
                    ) : payment.is_void ? <span className="void-detail">{payment.void_reason ?? "Voided"}{payment.voided_at ? ` · ${formatDateTime(payment.voided_at)}` : ""}</span> : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : <p className="empty-state">No payments recorded for this branch and month.</p>}
      </section>
    </>
  );
}
