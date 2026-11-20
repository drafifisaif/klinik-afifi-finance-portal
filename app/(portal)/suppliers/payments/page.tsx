import Link from "next/link";
import { updateSupplierPaymentEntry, voidSupplierPaymentEntry } from "@/app/actions";
import { DocumentManager } from "@/components/documents/document-manager";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { SupplierMonthPayment } from "@/components/supplier-month-payment";
import { getBankingDataForScope, getBranches, getSupplierOutstanding, getSupplierPaymentEntries, getSuppliers, totalBy } from "@/lib/data";
import { hasSupabaseAdminEnv } from "@/lib/supabase-admin";
import { formatCurrency, formatDate, formatDateTime, labelize, monthKey } from "@/lib/format";
import { canEditBranch, normalizeRole, requirePermission } from "@/lib/permissions";
import { getTransactionDocuments } from "@/lib/transaction-documents";
import { ArrowLeft, Building2, CalendarDays, CircleDollarSign, ReceiptText, Truck } from "lucide-react";

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

const months2026 = Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, "0")}`);

export default async function SupplierPaymentsPage({ searchParams }: SupplierPaymentsPageProps) {
  const profile = await requirePermission("view_supplier_payments");
  const [payments, outstandingRows, suppliers, bankingData, branches] = await Promise.all([
    getSupplierPaymentEntries(),
    getSupplierOutstanding(),
    getSuppliers(),
    getBankingDataForScope({ bankAccessOnly: true }),
    getBranches()
  ]);
  const params = searchParams ? await searchParams : {};
  const errorMessage = searchValue(params.error);
  const requestedBranch = searchValue(params.branch);
  const selectedBranch = requestedBranch === "all" ? null : requestedBranch;
  const requestedMonth = searchValue(params.purchase_month);
  const selectedPurchaseMonth = requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth) ? requestedMonth : null;
  const activePurchases = outstandingRows.filter((row) => !row.is_void);
  const branchById = new Map<string, string>();
  const branchIdByName = new Map<string, string>();
  branches.forEach((branch) => branchById.set(branch.id, branch.name));
  branches.forEach((branch) => branchIdByName.set(branch.name.trim().toLocaleLowerCase(), branch.id));
  const canonicalBranchId = (row: { branch_id?: string | null; branches?: { name?: string | null } | null; branch_name?: string | null }) => {
    if (!row.branch_id) return null;
    if (branchById.has(row.branch_id)) return row.branch_id;
    const name = (row.branches?.name ?? row.branch_name ?? "").trim().toLocaleLowerCase();
    return branchIdByName.get(name) ?? row.branch_id;
  };
  [...payments, ...outstandingRows].forEach((row) => {
    const name = row.branches?.name ?? ("branch_name" in row ? row.branch_name : null) ?? row.branch_id;
    if (row.branch_id && !branchById.has(row.branch_id) && !branchIdByName.has(String(name).trim().toLocaleLowerCase())) {
      branchById.set(row.branch_id, name ?? row.branch_id);
    }
  });
  const branchOptions = [...branchById].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const currentBranch = branchOptions.find((branch) => branch.id === selectedBranch);
  const branchRows = activePurchases.filter((row) => !selectedBranch || canonicalBranchId(row) === selectedBranch);
  const monthKeys = [...new Set(branchRows.map((row) => (row.invoice_date ?? row.purchase_date).slice(0, 7)))];
  const earlierMonths = monthKeys.filter((month) => !months2026.includes(month)).sort();
  const displayMonths = selectedBranch ? [...months2026, ...earlierMonths] : [];
  const selectedMonthRows = branchRows.filter((row) => !selectedPurchaseMonth || (row.invoice_date ?? row.purchase_date).slice(0, 7) === selectedPurchaseMonth);
  const supplierGroups = new Map<string, typeof selectedMonthRows>();
  selectedMonthRows.forEach((row) => {
    supplierGroups.set(row.supplier_id, [...(supplierGroups.get(row.supplier_id) ?? []), row]);
  });
  const groupedSuppliers = [...supplierGroups.entries()].map(([supplierId, rows]) => {
    const total = totalBy(rows, (row) => row.total_amount);
    const paid = totalBy(rows, (row) => row.paid_amount);
    const outstanding = totalBy(rows, (row) => row.outstanding_amount);
    const purchaseIds = new Set(rows.map((row) => row.id));
    const groupPayments = payments
      .filter((payment) => !payment.is_void && payment.supplier_purchase_entry_id && purchaseIds.has(payment.supplier_purchase_entry_id))
      .sort((a, b) => b.payment_date.localeCompare(a.payment_date));
    return {
      supplierId,
      supplierName: rows[0]?.supplier_name ?? rows[0]?.suppliers?.name ?? "Pembekal",
      rows: rows.sort((a, b) => (a.invoice_date ?? a.purchase_date).localeCompare(b.invoice_date ?? b.purchase_date)),
      total,
      paid,
      outstanding,
      latestPayment: groupPayments[0] ?? null,
      paymentCount: groupPayments.length
    };
  }).sort((a, b) => a.supplierName.localeCompare(b.supplierName));
  const selectedMonthTotal = totalBy(groupedSuppliers, (group) => group.total);
  const selectedMonthPaid = totalBy(groupedSuppliers, (group) => group.paid);
  const selectedMonthOutstanding = totalBy(groupedSuppliers, (group) => group.outstanding);
  const selectedMonthUnpaidSuppliers = groupedSuppliers.filter((group) => group.outstanding > 0).length;
  const paymentPurchaseIds = new Set(selectedMonthRows.map((row) => row.id));
  const visiblePayments = payments
    .filter((payment) => payment.supplier_purchase_entry_id && paymentPurchaseIds.has(payment.supplier_purchase_entry_id))
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date));
  const paymentDocuments = await getTransactionDocuments("supplier_payment_entries", visiblePayments.map((payment) => payment.id));
  const canDeleteDocuments = normalizeRole(profile.role) !== "branch_pic";

  return (
    <>
      <ModuleHeader
        eyebrow="Payables"
        title="Supplier payments"
        description="Semak jumlah mengikut cawangan dan bulan invois. Rekod satu bayaran untuk setiap pembekal-bulan."
      />

      {!selectedBranch ? (
        <>
          <section className="supplier-step-heading">
            <span>Langkah 1</span>
            <h2>Pilih cawangan</h2>
            <p>Baki belum bayar keseluruhan mengikut cawangan.</p>
          </section>
          <section className="supplier-branch-grid">
            {branchOptions.map((branch) => {
              const rows = activePurchases.filter((row) => canonicalBranchId(row) === branch.id);
              const balance = totalBy(rows, (row) => row.outstanding_amount);
              const paid = totalBy(rows, (row) => row.paid_amount);
              return (
                <Link className="supplier-branch-card" href={`/suppliers/payments?branch=${branch.id}`} key={branch.id}>
                  <span className="supplier-branch-icon"><Building2 size={22} /></span>
                  <span className="supplier-branch-copy"><strong>{branch.name}</strong><small>{rows.length} invois · {formatCurrency(paid)} telah dibayar</small></span>
                  <span className="supplier-branch-balance"><small>Belum dibayar</small><strong>{formatCurrency(balance)}</strong></span>
                </Link>
              );
            })}
          </section>
        </>
      ) : !currentBranch ? (
        <section className="table-section mt-section"><p className="empty-state">Cawangan tidak ditemui.</p></section>
      ) : !selectedPurchaseMonth ? (
        <>
          <div className="supplier-selection-bar">
            <Link className="supplier-back-link" href="/suppliers/payments"><ArrowLeft size={17} /> Semua cawangan</Link>
            <div><span>Langkah 2</span><h2>{currentBranch.name} · pilih bulan invois</h2></div>
          </div>
          {errorMessage ? <section className="table-section mt-section"><p className="void-warning">{errorMessage}</p></section> : null}
          <section className="supplier-month-grid">
            {displayMonths.map((month) => {
              const rows = branchRows.filter((row) => (row.invoice_date ?? row.purchase_date).slice(0, 7) === month);
              const outstanding = totalBy(rows, (row) => row.outstanding_amount);
              const paid = totalBy(rows, (row) => row.paid_amount);
              const suppliersInMonth = new Set(rows.map((row) => row.supplier_id)).size;
              return (
                <Link className={`supplier-month-card${rows.length ? "" : " is-empty"}`} href={`/suppliers/payments?branch=${selectedBranch}&purchase_month=${month}`} key={month}>
                  <span className="supplier-month-icon"><CalendarDays size={20} /></span>
                  <span className="supplier-month-copy"><strong>{monthLabel(month)}</strong><small>{rows.length ? `${suppliersInMonth} pembekal · ${rows.length} invois` : "Tiada invois direkodkan"}</small></span>
                  <span className="supplier-month-total"><small>Belum bayar</small><strong>{formatCurrency(outstanding)}</strong><em>{paid > 0 && outstanding === 0 ? "Selesai" : outstanding > 0 && paid > 0 ? "Ada bayaran separa" : outstanding > 0 ? "Perlu dibayar" : ""}</em></span>
                </Link>
              );
            })}
          </section>
        </>
      ) : (
        <>
          <div className="supplier-selection-bar supplier-selection-bar-month">
            <Link className="supplier-back-link" href={`/suppliers/payments?branch=${selectedBranch}`}><ArrowLeft size={17} /> {currentBranch.name} · semua bulan</Link>
            <div><span>Langkah 3</span><h2>{monthLabel(selectedPurchaseMonth)}</h2><p>{currentBranch.name} · ringkasan pembekal mengikut bulan invois</p></div>
          </div>
          {errorMessage ? <section className="table-section mt-section"><p className="void-warning">{errorMessage}</p></section> : null}
          <section className="dashboard-grid supplier-month-metrics">
            <MetricCard icon={ReceiptText} label="Jumlah invois" value={formatCurrency(selectedMonthTotal)} detail={`${groupedSuppliers.reduce((sum, group) => sum + group.rows.length, 0)} invois`} />
            <MetricCard icon={Truck} label="Jumlah dibayar" value={formatCurrency(selectedMonthPaid)} detail={`${groupedSuppliers.filter((group) => group.paid > 0 && group.outstanding === 0).length} pembekal selesai`} tone="blue" />
            <MetricCard icon={CircleDollarSign} label="Baki belum bayar" value={formatCurrency(selectedMonthOutstanding)} detail={`${selectedMonthUnpaidSuppliers} pembekal belum selesai`} tone="amber" />
          </section>

          <section className="supplier-month-groups">
            {groupedSuppliers.length ? groupedSuppliers.map((group) => {
              const status = group.outstanding <= 0 ? "paid" : group.paid > 0 ? "partial" : "unpaid";
              const statusLabel = status === "paid" ? "Paid" : status === "partial" ? "Partial" : "Unpaid";
              return (
                <article className="supplier-month-group" key={group.supplierId}>
                  <div className="supplier-month-group-main">
                    <div className="supplier-month-supplier"><h3>{group.supplierName}</h3><span>{group.rows.length} invois</span></div>
                    <div className="supplier-month-status"><span className={`status-pill status-${status}`}>{statusLabel}</span>{group.latestPayment ? <small>Bayaran terakhir {formatDate(group.latestPayment.payment_date)}{group.paymentCount > 1 ? ` · ${group.paymentCount} rekod` : ""}</small> : <small>Belum ada bayaran direkodkan</small>}</div>
                    <div className="supplier-month-amounts"><span><small>Jumlah</small><strong>{formatCurrency(group.total)}</strong></span><span><small>Dibayar</small><strong>{formatCurrency(group.paid)}</strong></span><span className={group.outstanding > 0 ? "has-balance" : ""}><small>Baki</small><strong>{formatCurrency(group.outstanding)}</strong></span></div>
                    <SupplierMonthPayment amount={group.outstanding} bankAccounts={bankingData.bankAccounts} branchId={selectedBranch} canRecordPayments={hasSupabaseAdminEnv()} month={selectedPurchaseMonth} supplierId={group.supplierId} />
                  </div>
                  <details className="supplier-invoice-details">
                    <summary>Details · lihat invois {group.rows.length}</summary>
                    <div className="supplier-invoice-list">
                      {group.rows.map((row) => (
                        <div className="supplier-invoice-row" key={row.id}>
                          <div><strong>{row.invoice_no ? `Invois ${row.invoice_no}` : "Invois tanpa nombor"}</strong><small>{formatDate(row.invoice_date ?? row.purchase_date)}</small></div>
                          <span className={`status-pill ${row.outstanding_amount <= 0 ? "status-paid" : row.paid_amount > 0 ? "status-partial" : "status-unpaid"}`}>{row.outstanding_amount <= 0 ? "Paid" : row.paid_amount > 0 ? "Partial" : "Unpaid"}</span>
                          <span><small>Jumlah</small><strong>{formatCurrency(row.total_amount)}</strong></span>
                          <span><small>Baki</small><strong>{formatCurrency(row.outstanding_amount)}</strong></span>
                        </div>
                      ))}
                    </div>
                  </details>
                </article>
              );
            }) : <p className="empty-state">Tiada invois direkodkan untuk cawangan dan bulan ini.</p>}
          </section>

          <details className="supplier-history-disclosure">
            <summary>Sejarah bayaran untuk invois bulan ini <span>{visiblePayments.length} rekod</span></summary>
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
                        <div><span className="supplier-payment-date">{formatDate(payment.payment_date)}</span><h3>{payment.suppliers?.name ?? "Supplier"}</h3><p>{payment.branches?.name ?? "-"} · {payment.supplier_purchase_entry_id ? `Invois ${linkedPurchaseLabel}` : "General payment"}</p></div>
                        <div className="supplier-payment-amount"><strong>{formatCurrency(payment.amount)}</strong><span className={`status-pill ${payment.is_void ? "status-voided" : "status-paid"}`}>{payment.is_void ? "Voided" : "Active"}</span></div>
                      </div>
                      <div className="supplier-payment-meta"><span>{labelize(payment.payment_method ?? "bank_transfer")}</span><span>{payment.bank_accounts?.name ?? "Tiada akaun bank"}</span>{payment.reference_no ? <span>Ref: {payment.reference_no}</span> : null}</div>
                      {payment.notes ? <p className="supplier-payment-notes">{payment.notes}</p> : null}
                      <div className="supplier-payment-actions">
                        <details className="manual-bank-editor"><summary>Documents</summary><DocumentManager canDelete={canDeleteDocuments} documents={documents} entityId={payment.id} entityName="supplier_payment_entries" /></details>
                        {!payment.is_void && canManage ? (
                          <details className="manual-bank-editor"><summary>Edit payment</summary>
                            <form action={updateSupplierPaymentEntry} className="manual-bank-edit-form">
                              <input name="payment_entry_id" type="hidden" value={payment.id} />
                              <label>Supplier<select defaultValue={payment.supplier_id} name="supplier_id" required>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
                              <label>Linked purchase<select defaultValue={payment.supplier_purchase_entry_id ?? ""} name="supplier_purchase_entry_id" required><option value="">Select supplier purchase / invoice</option>{linkedPurchaseOptions.map((row) => <option key={row.id} value={row.id}>{row.supplier_name ?? row.suppliers?.name} · {row.invoice_no ?? "Invoice -"} · {formatCurrency(row.outstanding_amount)}</option>)}</select></label>
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
            ) : <p className="empty-state">Belum ada bayaran direkodkan untuk invois bulan ini.</p>}
          </details>
        </>
      )}
    </>
  );
}
