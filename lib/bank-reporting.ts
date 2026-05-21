import type { BankAccount, BankTransaction, BankingData, Branch, CashBankIn, DailySale, PettyCashTransaction } from "@/lib/types";

export type DatePeriod = "today" | "this_month" | "last_month" | "custom";

export type DateRange = {
  endDate: string;
  label: string;
  period: DatePeriod;
  startDate: string;
};

export type CashInHandRow = {
  bankedIn: number;
  branch: Branch;
  cashSales: number;
  remaining: number;
};

export type PettyCashBalanceRow = {
  adjustments: number;
  balance: number;
  branch: Branch;
  issued: number;
  returned: number;
  spent: number;
};

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

export function resolveDateRange(params: { end?: string; period?: string; start?: string }, now = new Date()): DateRange {
  const period = params.period === "today" || params.period === "last_month" || params.period === "custom" ? params.period : "this_month";
  const today = toDateInput(now);

  if (period === "today") {
    return { endDate: today, label: "Today", period, startDate: today };
  }

  if (period === "last_month") {
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return {
      endDate: toDateInput(endOfMonth(lastMonth)),
      label: "Last month",
      period,
      startDate: toDateInput(startOfMonth(lastMonth))
    };
  }

  if (period === "custom") {
    return {
      endDate: params.end || today,
      label: "Custom range",
      period,
      startDate: params.start || toDateInput(startOfMonth(now))
    };
  }

  return {
    endDate: today,
    label: "This month",
    period: "this_month",
    startDate: toDateInput(startOfMonth(now))
  };
}

export function isWithinDateRange(date: string, range: Pick<DateRange, "endDate" | "startDate">) {
  return date >= range.startDate && date <= range.endDate;
}

export function directBankInflow(sale: DailySale) {
  return Number(sale.card_amount ?? 0) + Number(sale.qr_amount ?? 0) + Number(sale.bank_transfer_amount ?? 0);
}

export function cashSalesAmount(sale: DailySale) {
  return Number(sale.cash_amount ?? 0);
}

export function panelSalesAmount(sale: DailySale) {
  return Number(sale.panel_amount ?? 0);
}

export function bankInAmount(bankIn: CashBankIn) {
  return Number(bankIn.amount ?? 0);
}

export function bankTransactionAmount(transaction: BankTransaction) {
  return Number(transaction.amount ?? 0);
}

export function signedBankTransactionAmount(transaction: BankTransaction) {
  const amount = bankTransactionAmount(transaction);
  return transaction.direction === "in" ? amount : -amount;
}

export function pettyCashAmount(transaction: PettyCashTransaction) {
  return Number(transaction.amount ?? 0);
}

export function pettyCashBalanceMovement(transaction: PettyCashTransaction) {
  const amount = pettyCashAmount(transaction);
  if (transaction.transaction_type === "petty_cash_issued") return amount;
  if (transaction.transaction_type === "petty_cash_adjustment") return amount;
  return -amount;
}

export function branchLabel(branch: Pick<Branch, "code" | "name"> | null | undefined) {
  return branch ? branch.name : "-";
}

export function bankAccountLabel(account: Pick<BankAccount, "account_no" | "name"> | null | undefined) {
  if (!account) return "-";
  return account.account_no ? `${account.name} (${account.account_no})` : account.name;
}

export function getMappingByBranch(data: Pick<BankingData, "branchBankMappings">) {
  return new Map(data.branchBankMappings.map((mapping) => [mapping.branch_id, mapping]));
}

export function getBankAccountById(data: Pick<BankingData, "bankAccounts">) {
  return new Map(data.bankAccounts.map((account) => [account.id, account]));
}

export function getBranchById(data: Pick<BankingData, "branches">) {
  return new Map(data.branches.map((branch) => [branch.id, branch]));
}

export function buildCashInHandRows(data: Pick<BankingData, "branches" | "cashBankIns" | "sales">, range: DateRange): CashInHandRow[] {
  return data.branches.map((branch) => {
    const cashSales = data.sales
      .filter((sale) => sale.branch_id === branch.id && isWithinDateRange(sale.sale_date, range))
      .reduce((sum, sale) => sum + cashSalesAmount(sale), 0);
    const bankedIn = data.cashBankIns
      .filter((bankIn) => bankIn.branch_id === branch.id && isWithinDateRange(bankIn.bank_in_date, range))
      .reduce((sum, bankIn) => sum + bankInAmount(bankIn), 0);

    return {
      bankedIn,
      branch,
      cashSales,
      remaining: cashSales - bankedIn
    };
  });
}

export function buildPettyCashBalanceRows(
  data: Pick<BankingData, "branches" | "pettyCashTransactions">,
  range?: DateRange
): PettyCashBalanceRow[] {
  return data.branches.map((branch) => {
    const transactions = data.pettyCashTransactions.filter((transaction) => {
      return transaction.branch_id === branch.id && (!range || isWithinDateRange(transaction.transaction_date, range));
    });
    const issued = transactions.reduce((sum, transaction) => {
      return transaction.transaction_type === "petty_cash_issued" ? sum + pettyCashAmount(transaction) : sum;
    }, 0);
    const spent = transactions.reduce((sum, transaction) => {
      return transaction.transaction_type === "petty_cash_spent" ? sum + pettyCashAmount(transaction) : sum;
    }, 0);
    const returned = transactions.reduce((sum, transaction) => {
      return transaction.transaction_type === "petty_cash_returned" ? sum + pettyCashAmount(transaction) : sum;
    }, 0);
    const adjustments = transactions.reduce((sum, transaction) => {
      return transaction.transaction_type === "petty_cash_adjustment" ? sum + pettyCashAmount(transaction) : sum;
    }, 0);

    return {
      adjustments,
      balance: issued - spent - returned + adjustments,
      branch,
      issued,
      returned,
      spent
    };
  });
}
