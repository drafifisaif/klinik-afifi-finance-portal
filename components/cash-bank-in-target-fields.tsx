"use client";

import { useState } from "react";
import type { BankAccount, Branch, BranchBankMapping } from "@/lib/types";

type CashBankInTargetFieldsProps = {
  bankAccounts: BankAccount[];
  branches: Branch[];
  mappings: BranchBankMapping[];
};

function bankAccountLabel(account: Pick<BankAccount, "account_no" | "name">) {
  return account.account_no ? `${account.name} (${account.account_no})` : account.name;
}

export function CashBankInTargetFields({ bankAccounts, branches, mappings }: CashBankInTargetFieldsProps) {
  const accountIds = new Set(bankAccounts.map((account) => account.id));
  const mappedAccountByBranchId = new Map(
    mappings
      .filter((mapping) => mapping.is_active && accountIds.has(mapping.bank_account_id))
      .map((mapping) => [mapping.branch_id, mapping.bank_account_id])
  );
  const initialBranchId = branches[0]?.id ?? "";
  const initialBankAccountId = mappedAccountByBranchId.get(initialBranchId) ?? bankAccounts[0]?.id ?? "";
  const [branchId, setBranchId] = useState(initialBranchId);
  const [bankAccountId, setBankAccountId] = useState(initialBankAccountId);

  return (
    <>
      <label>
        Branch
        <select
          name="branch_id"
          onChange={(event) => {
            const nextBranchId = event.target.value;
            setBranchId(nextBranchId);
            setBankAccountId(mappedAccountByBranchId.get(nextBranchId) ?? bankAccountId);
          }}
          required
          value={branchId}
        >
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Destination bank account
        <select name="bank_account_id" onChange={(event) => setBankAccountId(event.target.value)} required value={bankAccountId}>
          {bankAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {bankAccountLabel(account)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
