"use client";

import { useEffect, useMemo, useState } from "react";
import { createPanelPayment } from "@/app/actions";
import { paymentTypes } from "@/lib/constants";
import { formatCurrency } from "@/lib/format";
import { panelReceivingBankAccounts, panelReceivingBankError } from "@/lib/panel-accounting";
import type { BankAccount, PanelClaim } from "@/lib/types";

type Props = {
  claim: PanelClaim;
  outstanding: number;
  bankAccounts: BankAccount[];
};

export function PanelQuickPayment({ claim, outstanding, bankAccounts }: Props) {
  const [bankAccountId, setBankAccountId] = useState("");
  const [paymentType, setPaymentType] = useState("bank_transfer");
  const receivingAccounts = useMemo(() => panelReceivingBankAccounts(claim.branches, bankAccounts), [claim.branches, bankAccounts]);

  useEffect(() => {
    if (receivingAccounts.length === 1) {
      setBankAccountId(receivingAccounts[0].id);
      return;
    }
    if (!receivingAccounts.some((account) => account.id === bankAccountId)) setBankAccountId("");
  }, [bankAccountId, receivingAccounts]);

  return (
    <details className="supplier-quick-payment panel-quick-payment">
      <summary>Record payment</summary>
      <form action={createPanelPayment} className="manual-bank-edit-form">
        <input name="panel_claim_id" type="hidden" value={claim.id} />
        <label>Payment date<input defaultValue={new Date().toISOString().slice(0, 10)} name="payment_date" required type="date" /></label>
        <label>Payment type<select name="payment_type" onChange={(event) => setPaymentType(event.target.value)} value={paymentType}>{paymentTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
        <label>Received into bank account<select name="bank_account_id" onChange={(event) => setBankAccountId(event.target.value)} required={paymentType === "bank_transfer" || paymentType === "card" || paymentType === "qr"} value={bankAccountId}><option value="">Select bank account</option>{receivingAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        {!receivingAccounts.length ? <small className="void-warning">{panelReceivingBankError(claim.branches)}</small> : null}
        <label>Amount<input defaultValue={outstanding} max={outstanding} min="0.01" name="amount" required step="0.01" type="number" /></label>
        <label>Reference<input name="reference_no" /></label>
        <label>Notes<textarea name="notes" /></label>
        <button className="primary-button compact-button" type="submit">Save payment · {formatCurrency(outstanding)}</button>
      </form>
    </details>
  );
}
