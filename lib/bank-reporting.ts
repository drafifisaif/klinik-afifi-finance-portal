import { branchOpeningBalanceTotal } from "@/lib/opening-balances";
import type { BankAccount, BankTransaction, BankingData, Branch, CashBankIn, DailySale, Expense, PettyCashTransaction } from "@/lib/types";

export type DatePeriod = "today" | "this_month" | "last_month" | "custom";
export type ReportRangeOption = "this_month" | "last_month" | "custom";

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
  cashLocumPayments: number;
  openingBalance: number;
  remaining: number;
};

export type PettyCashBalanceRow = {
  adjustments: number;
  balance: number;
  branch: Branch;
  issued: number;
  openingBalance: number;
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

export function monthStart(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  return `${month}-01`;
}

export function monthEnd(month: string) {
  const start = monthStart(month);
  if (!start) return null;
  const date = new Date(`${start}T00:00:00Z`);
  return toDateInput(endOfMonth(date));
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

export function resolveReportRange(
  params: { end?: string; month?: string; range?: string; start?: string },
  now = new Date()
): DateRange & { error: string | null; range: ReportRangeOption } {
  if (params.range === "custom") {
    const startDate = params.start || toDateInput(startOfMonth(now));
    const endDate = params.end || toDateInput(now);
    const error = !params.start || !params.end || endDate < startDate ? "Please select a valid date range." : null;
    return {
      endDate,
      error,
      label: "Custom range",
      period: "custom",
      range: "custom",
      startDate
    };
  }

  if (params.range === "last_month") {
    const range = resolveDateRange({ period: "last_month" }, now);
    return { ...range, error: null, range: "last_month" };
  }

  if (params.month) {
    const startDate = monthStart(params.month);
    const endDate = monthEnd(params.month);
    if (startDate && endDate) {
      return {
        endDate,
        error: null,
        label: "Custom range",
        period: "custom",
        range: "custom",
        startDate
      };
    }
  }

  const range = resolveDateRange({ period: "this_month" }, now);
  return { ...range, error: null, range: "this_month" };
}

export function isWithinDateRange(date: string, range: Pick<DateRange, "endDate" | "startDate">) {
  return date >= range.startDate && date <= range.endDate;
}

export function isActiveFinancialRecord(record: { is_void?: boolean | null }) {
  return record.is_void !== true;
}

export function directBankInflow(sale: DailySale) {
  return Number(sale.card_amount ?? 0) + Number(sale.qr_amount ?? 0) + Number(sale.bank_transfer_amount ?? 0);
}

export function cashSalesAmount(sale: DailySale) {
  return Number(sale.cash_amount ?? 0);
}

function isCashPaymentType(paymentType: string | null | undefined) {
  return String(paymentType ?? "").trim().toLowerCase() === "cash";
}

export function cashLocumExpenseAmount(expense: Expense) {
  return Number(expense.amount ?? 0);
}

export function isCashLocumExpense(expense: Expense) {
  return (
    isActiveFinancialRecord(expense) &&
    String(expense.category ?? "").trim().toLowerCase() === "locum_doctor" &&
    isCashPaymentType(expense.payment_type)
  );
}

export function panelSalesAmount(sale: DailySale) {
  return Number(sale.panel_amount ?? 0);
}

export function bankInAmount(bankIn: CashBankIn) {
  return Number(bankIn.amount ?? 0);
}

export function cashBankInSourceDate(bankIn: CashBankIn) {
  return bankIn.cash_source_date || bankIn.bank_in_date;
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

export function buildCashInHandRows(
  data: Pick<BankingData, "branches" | "cashBankIns" | "expenses" | "openingBalances" | "sales">,
  range: DateRange
): CashInHandRow[] {
  return data.branches.map((branch) => {
    const openingBalance = branchOpeningBalanceTotal(data.openingBalances, "cash_in_hand", branch.id, range.endDate);
    const cashSales = data.sales
      .filter((sale) => isActiveFinancialRecord(sale) && sale.branch_id === branch.id && isWithinDateRange(sale.sale_date, range))
      .reduce((sum, sale) => sum + cashSalesAmount(sale), 0);
    const bankedIn = data.cashBankIns
      .filter((bankIn) => isActiveFinancialRecord(bankIn) && bankIn.branch_id === branch.id && isWithinDateRange(cashBankInSourceDate(bankIn), range))
      .reduce((sum, bankIn) => sum + bankInAmount(bankIn), 0);
    const cashLocumPayments = data.expenses
      .filter((expense) => isCashLocumExpense(expense) && expense.branch_id === branch.id && isWithinDateRange(expense.expense_date, range))
      .reduce((sum, expense) => sum + cashLocumExpenseAmount(expense), 0);

    return {
      bankedIn,
      branch,
      cashLocumPayments,
      cashSales,
      openingBalance,
      remaining: openingBalance + cashSales - bankedIn - cashLocumPayments
    };
  });
}

export function buildPettyCashBalanceRows(
  data: Pick<BankingData, "branches" | "openingBalances" | "pettyCashTransactions">,
  range?: DateRange
): PettyCashBalanceRow[] {
  return data.branches.map((branch) => {
    const openingBalance = branchOpeningBalanceTotal(data.openingBalances, "petty_cash", branch.id, range?.endDate);
    const transactions = data.pettyCashTransactions.filter((transaction) => {
      return isActiveFinancialRecord(transaction)
        && transaction.branch_id === branch.id
        && (!range || isWithinDateRange(transaction.transaction_date, range));
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
      balance: openingBalance + issued - spent - returned + adjustments,
      branch,
      issued,
      openingBalance,
      returned,
      spent
    };
  });
}
