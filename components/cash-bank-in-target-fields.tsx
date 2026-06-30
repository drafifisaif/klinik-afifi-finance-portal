"use client";

import { useMemo, useState } from "react";
import type { BankAccount, Branch, BranchBankMapping } from "@/lib/types";

type CashBankInTargetFieldsProps = {
  bankAccounts: BankAccount[];
  branches: Branch[];
  initialBranchId?: string | null;
  mappings: BranchBankMapping[];
};

function bankAccountLabel(account: Pick<BankAccount, "account_no" | "name">) {
  return account.account_no ? `${account.name} (${account.account_no})` : account.name;
}

function isPanelBankAccount(account: Pick<BankAccount, "name" | "bank_name">) {
  const haystack = `${account.name ?? ""} ${account.bank_name ?? ""}`.trim().toLowerCase();
  return haystack.includes("panel");
}

export function CashBankInTargetFields({ bankAccounts, branches, initialBranchId, mappings }: CashBankInTargetFieldsProps) {
  const allowedBankAccounts = useMemo(
    () => {
      const accountIds = new Set(bankAccounts.map((account) => account.id));
      return bankAccounts.filter((account) => accountIds.has(account.id) && !isPanelBankAccount(account));
    },
    [bankAccounts]
  );
  const branchOptions = useMemo(() => {
    const allowedById = new Map(allowedBankAccounts.map((account) => [account.id, account]));
    return new Map(
      branches.map((branch) => {
        const accounts = mappings
          .filter((mapping) => mapping.is_active && mapping.branch_id === branch.id)
          .map((mapping) => allowedById.get(mapping.bank_account_id) ?? null)
          .filter((account): account is BankAccount => Boolean(account));
        return [branch.id, accounts];
      })
    );
  }, [allowedBankAccounts, branches, mappings]);
  const selectableBranches = branches.filter((branch) => (branchOptions.get(branch.id)?.length ?? 0) > 0);
  const resolvedInitialBranchId = initialBranchId && branchOptions.get(initialBranchId)?.length
    ? initialBranchId
    : "";
  const [branchId, setBranchId] = useState(resolvedInitialBranchId);
  const currentOptions = branchId ? (branchOptions.get(branchId) ?? []) : [];
  const [bankAccountId, setBankAccountId] = useState(currentOptions[0]?.id ?? "");

  return (
    <>
      <label>
        Branch
        <select
          name="branch_id"
          onChange={(event) => {
            const nextBranchId = event.target.value;
            const nextOptions = branchOptions.get(nextBranchId) ?? [];
            setBranchId(nextBranchId);
            setBankAccountId(nextOptions[0]?.id ?? "");
          }}
          required
          value={branchId}
        >
          <option value="">Select branch</option>
          {selectableBranches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Destination bank account
        <select name="bank_account_id" onChange={(event) => setBankAccountId(event.target.value)} required value={bankAccountId}>
          <option value="" disabled>
            {branchId ? "Select destination bank account" : "Select branch first"}
          </option>
          {currentOptions.map((account) => (
            <option key={account.id} value={account.id}>
              {bankAccountLabel(account)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
