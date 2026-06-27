"use client";

import { useEffect, useMemo, useState } from "react";
import { createPanelPayment } from "@/app/actions";
import { paymentTypes } from "@/lib/constants";
import { formatCurrency, formatDate, labelize } from "@/lib/format";
import { panelReceivingBankAccounts, panelReceivingBankError } from "@/lib/panel-accounting";
import type { BankAccount, PanelClaim, PanelCompany, PanelPayment, PaymentType } from "@/lib/types";

type Props = {
  claims: PanelClaim[];
  panelCompanies: PanelCompany[];
  panelPayments: PanelPayment[];
  bankAccounts: BankAccount[];
};

export function PanelPaymentForm({ claims, panelCompanies, panelPayments, bankAccounts }: Props) {
  const [panelClaimId, setPanelClaimId] = useState(claims[0]?.id ?? "");
  const [bankAccountId, setBankAccountId] = useState("");
  const [paymentType, setPaymentType] = useState<PaymentType>("bank_transfer");
  const claimById = useMemo(() => new Map(claims.map((claim) => [claim.id, claim])), [claims]);
  const companyById = useMemo(() => new Map(panelCompanies.map((company) => [company.id, company])), [panelCompanies]);
  const selectedClaim = claimById.get(panelClaimId);
  const paidAmount = panelPayments
    .filter((payment) => payment.panel_claim_id === panelClaimId)
    .reduce((sum, payment) => sum + payment.amount, 0);
  const outstanding = Math.max(0, (selectedClaim?.amount ?? 0) - paidAmount);
  const panelName = selectedClaim ? (companyById.get(selectedClaim.panel_company_id)?.name ?? selectedClaim.panel_companies?.name ?? "-") : "-";
  const sortedBankAccounts = useMemo(() => {
    return panelReceivingBankAccounts(selectedClaim?.branches, bankAccounts);
  }, [bankAccounts, selectedClaim?.branches]);

  useEffect(() => {
    if (sortedBankAccounts.length === 1) {
      setBankAccountId(sortedBankAccounts[0].id);
      return;
    }
    if (sortedBankAccounts.some((account) => account.id === bankAccountId)) return;
    setBankAccountId("");
  }, [bankAccountId, sortedBankAccounts]);

  return (
    <form action={createPanelPayment} className="form-card">
      <h2>Record panel payment</h2>
      <label>
        Panel claim
        <select name="panel_claim_id" required value={panelClaimId} onChange={(event) => setPanelClaimId(event.target.value)}>
          {claims.map((claim) => (
            <option key={claim.id} value={claim.id}>
              {(claim.claim_no ?? claim.id)} · {claim.panel_companies?.name ?? companyById.get(claim.panel_company_id)?.name ?? "Panel company"}
            </option>
          ))}
        </select>
      </label>
      {selectedClaim ? (
        <div className="import-message">
          <p>Panel company: {panelName}</p>
          <p>Claim amount: {formatCurrency(selectedClaim.amount)}</p>
          <p>Amount received: {formatCurrency(paidAmount)}</p>
          <p>Outstanding: {formatCurrency(outstanding)}</p>
          <p>Claim status: {labelize(selectedClaim.status)}</p>
          <p>Due date: {selectedClaim.due_date ? formatDate(selectedClaim.due_date) : "-"}</p>
        </div>
      ) : null}
      <label>
        Payment date
        <input name="payment_date" type="date" required />
      </label>
      <label>
        Payment type
        <select name="payment_type" required value={paymentType} onChange={(event) => setPaymentType(event.target.value as PaymentType)}>
          {paymentTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Received into bank account
        <select
          name="bank_account_id"
          required={paymentType === "bank_transfer" || paymentType === "card" || paymentType === "qr"}
          value={bankAccountId}
          onChange={(event) => setBankAccountId(event.target.value)}
        >
          <option value="">Select bank account</option>
          {sortedBankAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
        {!sortedBankAccounts.length && selectedClaim?.branches ? (
          <small className="void-warning">
            {panelReceivingBankError(selectedClaim.branches)}
          </small>
        ) : null}
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
        Save panel payment
      </button>
    </form>
  );
}
