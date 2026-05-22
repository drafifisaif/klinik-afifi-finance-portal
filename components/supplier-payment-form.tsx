"use client";

import { useMemo, useState } from "react";
import { createSupplierPayment } from "@/app/actions";
import { paymentTypes } from "@/lib/constants";
import { formatCurrency, formatDate, labelize } from "@/lib/format";
import type { BankAccount, Branch, PaymentType, Supplier, SupplierPayment, SupplierPurchase } from "@/lib/types";

type OutstandingRow = SupplierPurchase & {
  paid_amount?: number;
  outstanding_amount?: number;
  status?: string;
};

type Props = {
  branches: Branch[];
  suppliers: Supplier[];
  purchases: OutstandingRow[];
  payments: SupplierPayment[];
  bankAccounts: BankAccount[];
  canUseGeneralPayment: boolean;
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

export function SupplierPaymentForm({ branches, suppliers, purchases, payments, bankAccounts, canUseGeneralPayment }: Props) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [purchaseId, setPurchaseId] = useState("");
  const [paymentType, setPaymentType] = useState<PaymentType>("bank_transfer");
  const filteredPurchases = purchases.filter((purchase) => purchase.supplier_id === supplierId);
  const selectedPurchase = filteredPurchases.find((purchase) => purchase.id === purchaseId);
  const fallbackPaidAmount = selectedPurchase
    ? payments.filter((payment) => payment.purchase_id === selectedPurchase.id).reduce((sum, payment) => sum + payment.amount, 0)
    : 0;
  const paidAmount = selectedPurchase?.paid_amount ?? fallbackPaidAmount;
  const invoiceAmount = selectedPurchase?.total_amount ?? 0;
  const outstandingAmount = selectedPurchase ? Math.max(0, selectedPurchase.outstanding_amount ?? (invoiceAmount - paidAmount)) : 0;
  const dueDate = selectedPurchase?.due_date ?? null;
  const agingStatus = useMemo(() => getAgingStatus(dueDate, outstandingAmount), [dueDate, outstandingAmount]);

  return (
    <form action={createSupplierPayment} className="form-card">
      <h2>Record supplier payment</h2>
      <label>
        Supplier
        <select
          name="supplier_id"
          required
          value={supplierId}
          onChange={(event) => {
            setSupplierId(event.target.value);
            setPurchaseId("");
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
        Purchase invoice
        <select name="purchase_id" value={purchaseId} onChange={(event) => setPurchaseId(event.target.value)}>
          <option value="">General supplier payment</option>
          {filteredPurchases.map((purchase) => (
            <option key={purchase.id} value={purchase.id}>
              {purchase.invoice_no ?? purchase.id}
            </option>
          ))}
        </select>
      </label>
      {selectedPurchase ? (
        <div className="import-message">
          <strong>{selectedPurchase.invoice_no ?? selectedPurchase.id}</strong>
          <p>Invoice amount: {formatCurrency(invoiceAmount)}</p>
          <p>Amount paid: {formatCurrency(paidAmount)}</p>
          <p>Outstanding: {formatCurrency(outstandingAmount)}</p>
          <p>Due date: {dueDate ? formatDate(dueDate) : "-"}</p>
          <p>Status: {labelize(selectedPurchase.status ?? "unpaid")} ({agingStatus})</p>
        </div>
      ) : null}
      <label>
        Branch
        <select name="branch_id" defaultValue={selectedPurchase?.branch_id ?? ""}>
          {canUseGeneralPayment ? <option value="">No branch allocation</option> : null}
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
        Payment type
        <select name="payment_type" required value={paymentType} onChange={(event) => setPaymentType(event.target.value as PaymentType)}>
          {paymentTypes.map((type) => (
            <option key={type.value} value={type.value as PaymentType}>
              {type.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Paid from bank account
        <select name="bank_account_id" required={paymentType === "bank_transfer" || paymentType === "card" || paymentType === "qr"}>
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
  );
}
