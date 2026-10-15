"use client";

import { useState } from "react";
import { createSupplierPaymentEntry } from "@/app/actions";
import { formatCurrency } from "@/lib/format";
import type { BankAccount } from "@/lib/types";

type Props = {
  amount: number;
  bankAccounts: BankAccount[];
  branchId: string;
  purchaseId: string;
  supplierId: string;
};

export function SupplierQuickPayment({ amount, bankAccounts, branchId, purchaseId, supplierId }: Props) {
  const [method, setMethod] = useState("bank_transfer");

  return (
    <details className="supplier-quick-payment">
      <summary>{amount > 0 ? "Record payment" : "Payment recorded"}</summary>
      {amount > 0 ? (
        <form action={createSupplierPaymentEntry} className="manual-bank-edit-form">
          <input name="supplier_purchase_entry_id" type="hidden" value={purchaseId} />
          <input name="supplier_id" type="hidden" value={supplierId} />
          <input name="branch_id" type="hidden" value={branchId} />
          <label>Payment date<input defaultValue={new Date().toISOString().slice(0, 10)} name="payment_date" required type="date" /></label>
          <label>Payment method<select name="payment_method" onChange={(event) => setMethod(event.target.value)} value={method}><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="qr">QR</option></select></label>
          <label>Paid from bank account<select name="bank_account_id" required={method !== "cash"}><option value="">Select bank account</option>{bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          <label>Amount<input defaultValue={amount} max={amount} min="0.01" name="amount" required step="0.01" type="number" /></label>
          <label>Reference<input name="reference_no" /></label>
          <label>Notes<textarea name="notes" /></label>
          <button className="primary-button compact-button" type="submit">Save payment · {formatCurrency(amount)}</button>
        </form>
      ) : null}
    </details>
  );
}
