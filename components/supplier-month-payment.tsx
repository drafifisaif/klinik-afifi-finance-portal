"use client";

import { useState } from "react";
import { createSupplierMonthPayment } from "@/app/actions";
import { formatCurrency } from "@/lib/format";
import type { BankAccount } from "@/lib/types";

type Props = {
  amount: number;
  bankAccounts: BankAccount[];
  branchId: string;
  month: string;
  supplierId: string;
  canRecordPayments: boolean;
};

export function SupplierMonthPayment({ amount, bankAccounts, branchId, month, supplierId, canRecordPayments }: Props) {
  const [method, setMethod] = useState("bank_transfer");

  return (
    <details className="supplier-month-payment">
      <summary>{amount > 0 ? "Rekod bayaran" : "Selesai dibayar"}</summary>
      {amount > 0 ? (
        canRecordPayments ? <form action={createSupplierMonthPayment} className="manual-bank-edit-form">
          <input name="branch_id" type="hidden" value={branchId} />
          <input name="supplier_id" type="hidden" value={supplierId} />
          <input name="purchase_month" type="hidden" value={month} />
          <label>Tarikh bayaran<input defaultValue={new Date().toISOString().slice(0, 10)} name="payment_date" required type="date" /></label>
          <label>Cara bayaran<select name="payment_method" onChange={(event) => setMethod(event.target.value)} value={method}><option value="bank_transfer">Bank transfer</option><option value="cash">Tunai</option><option value="card">Kad</option><option value="qr">QR</option></select></label>
          <label>Bayar dari akaun<select name="bank_account_id" required={method !== "cash"}><option value="">Pilih akaun bank</option>{bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          <label>Jumlah bayaran<input defaultValue={amount.toFixed(2)} max={amount} min="0.01" name="amount" required step="0.01" type="number" /></label>
          <label>No. rujukan<input name="reference_no" /></label>
          <label>Catatan<textarea name="notes" /></label>
          <button className="primary-button compact-button" type="submit">Simpan · {formatCurrency(amount)} baki</button>
        </form> : <p className="preview-readonly-note">Preview sahaja. Rekod bayaran tersedia selepas portal disambungkan.</p>
      ) : null}
    </details>
  );
}
