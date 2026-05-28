"use client";

import { useMemo, useState } from "react";
import { createSupplierPaymentEntry } from "@/app/actions";
import { paymentTypes } from "@/lib/constants";
import { formatCurrency, formatDate, labelize } from "@/lib/format";
import type { BankAccount, Branch, PaymentType, Supplier } from "@/lib/types";

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
  branches: Branch[];
  purchases: PurchaseOption[];
  suppliers: Supplier[];
};

function getAgingStatus(dueDate?: string | null, outstandingAmount?: number) {
  if (!dueDate || (outstandingAmount ?? 0) <= 0) return "Current";
  const today = new Date();
  const due = new Date(`${dueDate}T00:00:00`);
  const diffDays = Math.floor((today.getTime() - due.getTime()) / 86400000);
  if (diffDays <= 0) return "Not due";
  if (diffDays <= 30) return "1-30 days overdue";
  if (diffDays <= 60) return "31-60 days overdue";
  if (diffDays <= 90) return "61-90 days overdue";
  return "Over 90 days overdue";
}

export function SupplierPaymentForm({ bankAccounts, branches, purchases, suppliers }: Props) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [purchaseEntryId, setPurchaseEntryId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentType>("bank_transfer");

  const filteredPurchases = purchases.filter((purchase) => purchase.supplier_id === supplierId && !purchase.is_void && purchase.outstanding_amount > 0);
  const selectedPurchase = filteredPurchases.find((purchase) => purchase.id === purchaseEntryId);
  const dueDate = selectedPurchase?.due_date ?? null;
  const agingStatus = useMemo(
    () => getAgingStatus(dueDate, selectedPurchase?.outstanding_amount ?? 0),
    [dueDate, selectedPurchase?.outstanding_amount]
  );

  return (
    <form action={createSupplierPaymentEntry} className="form-card">
      <h2>Record supplier payment</h2>
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
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Linked supplier purchase
        <select name="supplier_purchase_entry_id" value={purchaseEntryId} onChange={(event) => setPurchaseEntryId(event.target.value)}>
          <option value="">General supplier payment</option>
          {filteredPurchases.map((purchase) => (
            <option key={purchase.id} value={purchase.id}>
              {(purchase.invoice_no ?? purchase.id)} | {purchase.branch_name ?? "-"} | {formatCurrency(purchase.outstanding_amount)}
            </option>
          ))}
        </select>
      </label>
      {selectedPurchase ? (
        <div className="import-message">
          <strong>{selectedPurchase.invoice_no ?? selectedPurchase.id}</strong>
          <p>Supplier: {selectedPurchase.supplier_name ?? "-"}</p>
          <p>Branch: {selectedPurchase.branch_name ?? "-"}</p>
          <p>Invoice amount: {formatCurrency(selectedPurchase.total_amount)}</p>
          <p>Amount paid: {formatCurrency(selectedPurchase.paid_amount)}</p>
          <p>Remaining balance: {formatCurrency(selectedPurchase.outstanding_amount)}</p>
          <p>Invoice date: {formatDate(selectedPurchase.invoice_date ?? selectedPurchase.purchase_date)}</p>
          <p>Due date: {dueDate ? formatDate(dueDate) : "-"}</p>
          <p>Status: {labelize(selectedPurchase.status)} ({agingStatus})</p>
        </div>
      ) : null}
      <label>
        Branch
        <select name="branch_id" defaultValue={selectedPurchase?.branch_id ?? branches[0]?.id ?? ""} key={selectedPurchase?.id ?? supplierId}>
          {branches.map((branch) => (
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
