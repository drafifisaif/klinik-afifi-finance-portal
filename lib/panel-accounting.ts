import type { BankAccount, PanelClaim, PanelPayment } from "@/lib/types";

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function branchFamily(branch: { code?: string | null; name?: string | null } | null | undefined) {
  const code = normalize(branch?.code);
  const name = normalize(branch?.name);

  if (code === "put" || name === "putatan") return "putatan";
  if (code === "pap" || name === "papar") return "ranau_panel";
  if (code === "kin" || name === "kinabatangan") return "ranau_panel";
  if (code === "ran" || name === "ranau") return "ranau_panel";
  return null;
}

function matchesAll(value: string, tokens: string[]) {
  const haystack = normalize(value);
  return tokens.every((token) => haystack.includes(token));
}

export function panelReceivingBankRequirement(branch: { code?: string | null; name?: string | null } | null | undefined) {
  const family = branchFamily(branch);
  if (family === "putatan") {
    return {
      errorLabel: "CIMB Putatan Panel",
      matches(account: BankAccount) {
        return matchesAll(account.name, ["cimb", "putatan", "panel"])
          || matchesAll(account.bank_name ?? "", ["cimb"]) && matchesAll(account.name, ["putatan", "panel"]);
      }
    };
  }

  return {
    errorLabel: "CIMB Panel Ranau",
    matches(account: BankAccount) {
      return matchesAll(account.name, ["cimb", "ranau", "panel"])
        || matchesAll(account.bank_name ?? "", ["cimb"]) && matchesAll(account.name, ["ranau", "panel"]);
    }
  };
}

export function panelReceivingBankAccounts(
  branch: { code?: string | null; name?: string | null } | null | undefined,
  bankAccounts: BankAccount[],
  currentBankAccountId?: string | null
) {
  const requirement = panelReceivingBankRequirement(branch);
  const matched = bankAccounts.filter((account) => account.is_active && requirement.matches(account));
  if (!currentBankAccountId) return matched;

  const current = bankAccounts.find((account) => account.id === currentBankAccountId && account.is_active);
  if (!current || matched.some((account) => account.id === current.id)) return matched;
  return [current, ...matched];
}

export function panelReceivingBankError(branch: { code?: string | null; name?: string | null } | null | undefined) {
  const requirement = panelReceivingBankRequirement(branch);
  return `${requirement.errorLabel} is not active or not found. Please add/activate it first.`;
}

export function activePanelClaims(claims: PanelClaim[]) {
  return claims.filter((claim) => claim.is_void !== true);
}

export function activePanelPayments(payments: PanelPayment[]) {
  return payments.filter((payment) => payment.is_void !== true);
}

export function panelPaymentsByClaimId(payments: PanelPayment[]) {
  return activePanelPayments(payments).reduce<Map<string, number>>((totals, payment) => {
    totals.set(payment.panel_claim_id, (totals.get(payment.panel_claim_id) ?? 0) + Number(payment.amount ?? 0));
    return totals;
  }, new Map());
}

export function panelClaimPaidAmount(claimId: string, payments: PanelPayment[]) {
  return panelPaymentsByClaimId(payments).get(claimId) ?? 0;
}

export function panelClaimOutstandingAmount(claim: PanelClaim, payments: PanelPayment[]) {
  if (claim.is_void) return 0;
  return Math.max(0, Number(claim.amount ?? 0) - panelClaimPaidAmount(claim.id, payments));
}

export function panelClaimDisplayStatus(claim: PanelClaim, payments: PanelPayment[]) {
  if (claim.is_void) return "voided";
  const paidAmount = panelClaimPaidAmount(claim.id, payments);
  const outstandingAmount = Math.max(0, Number(claim.amount ?? 0) - paidAmount);
  if (outstandingAmount <= 0) return "paid";
  if (paidAmount > 0) return "partial";
  return "unpaid";
}
