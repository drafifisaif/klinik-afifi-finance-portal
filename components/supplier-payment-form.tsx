"use client";

import { useMemo, useState } from "react";
import { createSupplierPaymentEntry } from "@/app/actions";
import { paymentTypes } from "@/lib/constants";
import { formatCurrency, formatDate } from "@/lib/format";
import type { BankAccount, PaymentType, Supplier } from "@/lib/types";

type PurchaseOption = {
  id: string;
  supplier_id: string;
  branch_id: string;
  invoice_no?: string | null;
  invoice_date?: string | null;
  purchase_date: string;
  due_date?: string | null;
  total_amount: number;
  paid_amount: number;
  outstanding_amount: number;
  supplier_name?: string;
  branch_name?: string;
  status: string;
  is_void: boolean;
};

type Props = {
  bankAccounts: BankAccount[];
  initialBranchId: string;
  initialPurchaseMonth: string;
  purchases: PurchaseOption[];
  suppliers: Supplier[];
};

function purchaseMonth(purchase: PurchaseOption) {
  return (purchase.invoice_date ?? purchase.purchase_date).slice(0, 7);
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric" }).format(new Date(`${value}-01T00:00:00`));
}

export function SupplierPaymentForm({ bankAccounts, initialBranchId, initialPurchaseMonth, purchases, suppliers }: Props) {
  const [branchId, setBranchId] = useState(initialBranchId);
  const [purchaseMonthFilter, setPurchaseMonthFilter] = useState(initialPurchaseMonth);
  const branchOptions = [...new Map(purchases.map((purchase) => [purchase.branch_id, purchase.branch_name ?? purchase.branch_id])).entries()];
  const filteredByBranch = purchases.filter((purchase) => branchId === "all" || purchase.branch_id === branchId);
  const availableMonths = [...new Set(filteredByBranch.map(purchaseMonth))].sort().reverse();
  const filteredByMonth = filteredByBranch.filter((purchase) => purchaseMonthFilter === "all" || purchaseMonth(purchase) === purchaseMonthFilter);
  const availableSuppliers = suppliers.filter((supplier) => filteredByMonth.some((purchase) => purchase.supplier_id === supplier.id));
  const [supplierId, setSupplierId] = useState(availableSuppliers[0]?.id ?? "");
  const [purchaseEntryId, setPurchaseEntryId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentType>("bank_transfer");

  const filteredPurchases = filteredByMonth.filter((purchase) => purchase.supplier_id === supplierId && !purchase.is_void && purchase.outstanding_amount > 0);
  const selectedPurchase = filteredPurchases.find((purchase) => purchase.id === purchaseEntryId);
  const dueDate = selectedPurchase?.due_date ?? null;
  const monthTotal = useMemo(() => totalOutstanding(filteredPurchases), [filteredPurchases]);

  return (
    <form action={createSupplierPaymentEntry} className="form-card">
      <h3>One payment per invoice</h3>
      <p className="supplier-form-intro">Pilih cawangan, bulan bil dan pembekal. Bayaran dipautkan terus kepada satu bil supaya baki bulan itu dikemas kini dengan tepat.</p>
      <div className="supplier-payment-form-filters">
        <label>
          Branch
          <select value={branchId} onChange={(event) => { setBranchId(event.target.value); setSupplierId(""); setPurchaseEntryId(""); }}>
            <option value="all">All branches</option>
            {branchOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label>
          Purchase month
          <select value={purchaseMonthFilter} onChange={(event) => { setPurchaseMonthFilter(event.target.value); setSupplierId(""); setPurchaseEntryId(""); }}>
            <option value="all">All months</option>
            {availableMonths.map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}
          </select>
        </label>
      </div>
      <label>
        Supplier
        <select
          name="supplier_id"
          required
          value={supplierId}
          onChange={(event) => {
            setSupplierId(event.target.value);
            setPurchaseEntryId("");
          }}
        >
          <option value="">Select supplier</option>
          {availableSuppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Linked supplier purchase
        <select name="supplier_purchase_entry_id" required value={purchaseEntryId} onChange={(event) => setPurchaseEntryId(event.target.value)}>
          <option value="">Select supplier purchase / invoice</option>
          {filteredPurchases.map((purchase) => (
            <option key={purchase.id} value={purchase.id}>
              {purchase.invoice_no ? `Invoice ${purchase.invoice_no}` : "Invoice not numbered"} · {formatDate(purchase.invoice_date ?? purchase.purchase_date)} · Balance {formatCurrency(purchase.outstanding_amount)}
            </option>
          ))}
        </select>
      </label>
      <input name="branch_id" type="hidden" value={selectedPurchase?.branch_id ?? ""} />
      {selectedPurchase ? (
        <div className="import-message">
          <strong>{selectedPurchase.invoice_no ?? selectedPurchase.id}</strong>
          <p>Supplier: {selectedPurchase.supplier_name ?? "-"}</p>
          <p>Branch: {selectedPurchase.branch_name ?? "-"}</p>
          <p>Invoice amount: {formatCurrency(selectedPurchase.total_amount)}</p>
          <p>Amount paid: {formatCurrency(selectedPurchase.paid_amount)}</p>
          <p>Remaining balance: {formatCurrency(selectedPurchase.outstanding_amount)}</p>
          <p>Invoice date: {formatDate(selectedPurchase.invoice_date ?? selectedPurchase.purchase_date)}</p>
          {dueDate ? <p>Due date: {formatDate(dueDate)}</p> : null}
        </div>
      ) : null}
      {supplierId && filteredPurchases.length ? <p className="supplier-selected-balance">Unpaid balance for this supplier in the selected view: <strong>{formatCurrency(monthTotal)}</strong></p> : null}
      <label>
        Branch
        <input value={selectedPurchase?.branch_name ?? "-"} disabled />
      </label>
      <label>
        Payment date
        <input name="payment_date" type="date" required />
      </label>
      <label>
        Payment method
        <select name="payment_method" required value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentType)}>
          {paymentTypes.map((type) => (
            <option key={type.value} value={type.value as PaymentType}>
              {type.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Paid from bank account
        <select name="bank_account_id" required={paymentMethod === "bank_transfer" || paymentMethod === "card" || paymentMethod === "qr"}>
          <option value="">Select bank account</option>
          {bankAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Amount
        <input min="0.01" name="amount" required step="0.01" type="number" />
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
  );
}

function totalOutstanding(rows: PurchaseOption[]) {
  return rows.reduce((sum, row) => sum + Number(row.outstanding_amount ?? 0), 0);
}
