import { getAuditEvents } from "@/lib/audit";
import {
  bankAccountLabel,
  bankInAmount,
  bankTransactionAmount,
  branchLabel,
  buildCashInHandRows,
  buildPettyCashBalanceRows,
  directBankInflow,
  getBankAccountById,
  getBranchById,
  getMappingByBranch,
  isActiveFinancialRecord,
  isWithinDateRange,
  resolveReportRange,
  pettyCashAmount,
  resolveDateRange
} from "@/lib/bank-reporting";
import { resolveSelectedBranchIds } from "@/lib/branch-reporting";
import { bankTransactionTypes } from "@/lib/constants";
import type { CsvCell } from "@/lib/csv";
import { getBankingData, getBankingDataForScope, getDashboardData, getExpensesReportingData, totalBy } from "@/lib/data";
import { isDailySaleInResolvedRange, resolveDailySalesFilter, sortDailySales } from "@/lib/daily-sales-reporting";
import { labelize } from "@/lib/format";
import { outstandingOpeningBalanceTotal } from "@/lib/opening-balances";
import { activePanelClaims, activePanelPayments, panelClaimOutstandingAmount } from "@/lib/panel-accounting";
import { canViewAllBranches, normalizeRole, requireBankPositionAccess, requirePermission } from "@/lib/permissions";
import type { BankTransactionType, BankingData, Profile } from "@/lib/types";

export type CsvExport = {
  filename: string;
  headers: string[];
  rows: CsvCell[][];
};

export class ExportForbiddenError extends Error {}

function money(value: number | null | undefined) {
  return Number(value ?? 0) || 0;
}

function param(searchParams: URLSearchParams, key: string) {
  return searchParams.get(key) ?? undefined;
}

function paramValues(searchParams: URLSearchParams, key: string) {
  const values = searchParams.getAll(key);
  if (!values.length) return undefined;
  return values.length === 1 ? values[0] : values;
}

function hasOptionalRange(searchParams: URLSearchParams) {
  return Boolean(param(searchParams, "period") || param(searchParams, "start") || param(searchParams, "end"));
}

function matchesOptionalDate(date: string, searchParams: URLSearchParams) {
  if (!hasOptionalRange(searchParams)) return true;
  return isWithinDateRange(date, resolveDateRange({
    end: param(searchParams, "end"),
    period: param(searchParams, "period"),
    start: param(searchParams, "start")
  }));
}

function requireNonStaffExport(profile: Pick<Profile, "role">) {
  if (normalizeRole(profile.role) === "staff") {
    throw new ExportForbiddenError("Staff cannot export this report.");
  }
}

function labelBranches(branchNames: string[]) {
  return branchNames.length ? branchNames.join(", ") : "No branches selected";
}

function branchMatches(branchId: string | null | undefined, selectedBranchIds: Set<string>, includeUnassigned: boolean) {
  return branchId ? selectedBranchIds.has(branchId) : includeUnassigned;
}

function dashboardSelection(profile: Profile, searchParams: URLSearchParams, data: Awaited<ReturnType<typeof getDashboardData>>) {
  const selectedBranchIds = resolveSelectedBranchIds({
    allowedBranches: data.branches,
    branchParam: paramValues(searchParams, "branch"),
    branchesParam: paramValues(searchParams, "branches"),
    canSelectMultiple: canViewAllBranches(profile),
    groupParam: param(searchParams, "group")
  });
  const selectedBranchIdSet = new Set(selectedBranchIds);
  const branches = data.branches.filter((branch) => selectedBranchIdSet.has(branch.id));

  return {
    branches,
    includeUnassigned: branches.length === data.branches.length,
    selectedBranchIdSet
  };
}

function selectedManualType(searchParams: URLSearchParams) {
  const requestedType = param(searchParams, "transaction_type");
  return bankTransactionTypes.some((type) => type.value === requestedType)
    ? requestedType as BankTransactionType
    : "all";
}

function bankExportScope(data: BankingData, searchParams: URLSearchParams) {
  const range = resolveDateRange({
    end: param(searchParams, "end"),
    period: param(searchParams, "period"),
    start: param(searchParams, "start")
  });
  const mappingByBranch = getMappingByBranch(data);
  const selectedBankAccountId = param(searchParams, "bank_account_id") ?? "all";
  const selectedBranchId = param(searchParams, "branch_id") ?? "all";
  const selectedCategory = param(searchParams, "category") ?? "all";
  const manualType = selectedManualType(searchParams);
  const selectedSales = data.sales.filter((sale) => {
    const mapping = mappingByBranch.get(sale.branch_id);
    return isActiveFinancialRecord(sale)
      && isWithinDateRange(sale.sale_date, range)
      && (selectedBranchId === "all" || sale.branch_id === selectedBranchId)
      && (selectedBankAccountId === "all" || mapping?.bank_account_id === selectedBankAccountId);
  });
  const selectedCashBankIns = data.cashBankIns.filter((bankIn) => {
    return isActiveFinancialRecord(bankIn)
      && isWithinDateRange(bankIn.bank_in_date, range)
      && (selectedBranchId === "all" || bankIn.branch_id === selectedBranchId)
      && (selectedBankAccountId === "all" || bankIn.bank_account_id === selectedBankAccountId);
  });
  const selectedBankTransactions = data.bankTransactions.filter((transaction) => {
    return isActiveFinancialRecord(transaction)
      && isWithinDateRange(transaction.transaction_date, range)
      && (selectedBankAccountId === "all" || transaction.bank_account_id === selectedBankAccountId)
      && (selectedBranchId === "all" || transaction.branch_id === selectedBranchId)
      && (selectedCategory === "all" || transaction.category === selectedCategory)
      && (manualType === "all" || transaction.transaction_type === manualType);
  });
  const selectedBankLinkedPettyCash = data.pettyCashTransactions.filter((transaction) => {
    return isActiveFinancialRecord(transaction)
      && transaction.bank_account_id
      && (transaction.transaction_type === "petty_cash_issued" || transaction.transaction_type === "petty_cash_returned")
      && isWithinDateRange(transaction.transaction_date, range)
      && (selectedBankAccountId === "all" || transaction.bank_account_id === selectedBankAccountId)
      && (selectedBranchId === "all" || transaction.branch_id === selectedBranchId);
  });
  const selectedSupplierPayments = data.supplierPayments.filter((payment) => {
    return isWithinDateRange(payment.payment_date, range)
      && (selectedBankAccountId === "all" || payment.bank_account_id === selectedBankAccountId)
      && (selectedBranchId === "all" || payment.branch_id === selectedBranchId);
  });
  const selectedPanelPayments = data.panelPayments.filter((payment) => {
    return isWithinDateRange(payment.payment_date, range)
      && (selectedBankAccountId === "all" || payment.bank_account_id === selectedBankAccountId)
      && (selectedBranchId === "all" || payment.branch_id === selectedBranchId);
  });

  return {
    mappingByBranch,
    selectedBankLinkedPettyCash,
    selectedBankTransactions,
    selectedCashBankIns,
    selectedSales,
    selectedSupplierPayments,
    selectedPanelPayments
  };
}

export async function dashboardSummaryCsv(searchParams: URLSearchParams): Promise<CsvExport> {
  const profile = await requirePermission("view_dashboard");
  if (!profile) throw new ExportForbiddenError("Dashboard export requires an active profile.");
  requireNonStaffExport(profile);

  const [dashboardData, bankingData] = await Promise.all([getDashboardData(), getBankingData()]);
  const range = resolveDateRange({
    end: param(searchParams, "end"),
    period: param(searchParams, "period"),
    start: param(searchParams, "start")
  });
  const { branches, includeUnassigned, selectedBranchIdSet } = dashboardSelection(profile, searchParams, dashboardData);
  const branchIds = new Set(branches.map((branch) => branch.id));
  const sales = dashboardData.sales.filter((sale) => {
    return isActiveFinancialRecord(sale) && branchIds.has(sale.branch_id) && isWithinDateRange(sale.sale_date, range);
  });
  const expenses = dashboardData.expenses.filter((expense) => {
    return isActiveFinancialRecord(expense) && branchIds.has(expense.branch_id) && isWithinDateRange(expense.expense_date, range);
  });
  const purchases = dashboardData.purchases.filter((purchase) => branchIds.has(purchase.branch_id) && isWithinDateRange(purchase.purchase_date, range));
  const supplierPayments = dashboardData.supplierPayments.filter((payment) => {
    return branchMatches(payment.branch_id, selectedBranchIdSet, includeUnassigned) && isWithinDateRange(payment.payment_date, range);
  });
  const panels = activePanelClaims(
    dashboardData.panels.filter((panel) => branchIds.has(panel.branch_id) && isWithinDateRange(panel.claim_month, range))
  );
  const panelClaimsForOutstanding = activePanelClaims(
    dashboardData.panels.filter((panel) => branchIds.has(panel.branch_id) && panel.claim_month <= range.endDate)
  );
  const bankBranches = bankingData.branches.filter((branch) => branchIds.has(branch.id));
  const bankBranchIds = new Set(bankBranches.map((branch) => branch.id));
  const bankSales = bankingData.sales.filter((sale) => {
    return isActiveFinancialRecord(sale) && bankBranchIds.has(sale.branch_id) && isWithinDateRange(sale.sale_date, range);
  });
  const cashBankIns = bankingData.cashBankIns.filter((bankIn) => {
    return isActiveFinancialRecord(bankIn) && bankBranchIds.has(bankIn.branch_id) && isWithinDateRange(bankIn.bank_in_date, range);
  });
  const bankTransactions = bankingData.bankTransactions.filter((transaction) => {
    return isActiveFinancialRecord(transaction)
      && branchMatches(transaction.branch_id, branchIds, includeUnassigned)
      && isWithinDateRange(transaction.transaction_date, range);
  });
  const pettyCashTransactions = bankingData.pettyCashTransactions.filter((transaction) => {
    return isActiveFinancialRecord(transaction)
      && bankBranchIds.has(transaction.branch_id)
      && isWithinDateRange(transaction.transaction_date, range);
  });
  const bankExpenses = bankingData.expenses.filter((expense) => {
    return isActiveFinancialRecord(expense) && bankBranchIds.has(expense.branch_id) && isWithinDateRange(expense.expense_date, range);
  });
  const cashInHandRows = buildCashInHandRows({ branches: bankBranches, cashBankIns, expenses: bankExpenses, openingBalances: bankingData.openingBalances, sales: bankSales }, range);
  const pettyCashRows = buildPettyCashBalanceRows({ branches: bankBranches, openingBalances: bankingData.openingBalances, pettyCashTransactions }, range);
  const mappedBankIds = new Set(bankingData.bankAccounts.map((account) => account.id));
  const mappingByBranch = getMappingByBranch(bankingData);
  const directSalesInflow = totalBy(bankSales, (sale) => {
    const bankAccountId = mappingByBranch.get(sale.branch_id)?.bank_account_id;
    return bankAccountId && mappedBankIds.has(bankAccountId) ? directBankInflow(sale) : 0;
  });
  const totalCashBankIn = totalBy(cashBankIns, bankInAmount);
  const manualMoneyIn = totalBy(bankTransactions, (transaction) => transaction.transaction_type === "money_in" ? bankTransactionAmount(transaction) : 0);
  const manualMoneyOut = totalBy(bankTransactions, (transaction) => transaction.transaction_type === "money_out" ? bankTransactionAmount(transaction) : 0);
  const transferIn = totalBy(bankTransactions, (transaction) => transaction.transaction_type === "interbank_transfer" && transaction.direction === "in" ? bankTransactionAmount(transaction) : 0);
  const transferOut = totalBy(bankTransactions, (transaction) => transaction.transaction_type === "interbank_transfer" && transaction.direction === "out" ? bankTransactionAmount(transaction) : 0);
  const ownerDrawing = totalBy(bankTransactions, (transaction) => transaction.transaction_type === "owner_drawing" ? bankTransactionAmount(transaction) : 0);
  const pettyCashIssued = totalBy(pettyCashTransactions, (transaction) => transaction.bank_account_id && transaction.transaction_type === "petty_cash_issued" ? pettyCashAmount(transaction) : 0);
  const pettyCashReturned = totalBy(pettyCashTransactions, (transaction) => transaction.bank_account_id && transaction.transaction_type === "petty_cash_returned" ? pettyCashAmount(transaction) : 0);
  const supplierPaymentOutflow = totalBy(
    bankingData.supplierPayments.filter((payment) => branchMatches(payment.branch_id, selectedBranchIdSet, includeUnassigned) && isWithinDateRange(payment.payment_date, range)),
    (payment) => money(payment.amount)
  );
  const panelPayments = activePanelPayments(
    bankingData.panelPayments.filter((payment) => branchMatches(payment.branch_id, selectedBranchIdSet, includeUnassigned) && isWithinDateRange(payment.payment_date, range))
  );
  const panelOutstandingPayments = activePanelPayments(
    bankingData.panelPayments.filter((payment) => branchMatches(payment.branch_id, selectedBranchIdSet, includeUnassigned) && payment.payment_date <= range.endDate)
  );
  const panelPaymentInflow = totalBy(panelPayments, (payment) => money(payment.amount));
  const totalSales = totalBy(sales, (sale) => money(sale.total_amount));
  const directSales = totalSales - totalBy(sales, (sale) => money(sale.panel_amount));
  const panelClaimsIssued = totalBy(panels, (panel) => money(panel.amount));
  const accrualIncome = directSales + panelClaimsIssued;
  const operatingExpenses = totalBy(expenses, (expense) => money(expense.amount));
  const supplierPurchases = totalBy(purchases, (purchase) => money(purchase.total_amount));
  const accrualExpenses = operatingExpenses + supplierPurchases;
  const totalCashInHand = totalBy(cashInHandRows, (row) => row.remaining);
  const totalPettyCash = totalBy(pettyCashRows, (row) => row.balance);
  const supplierOutstanding = Math.max(
    0,
    outstandingOpeningBalanceTotal(dashboardData.openingBalances, "supplier_outstanding", selectedBranchIdSet, range.endDate, includeUnassigned)
      + totalBy(purchases, (purchase) => money(purchase.total_amount))
      - totalBy(supplierPayments, (payment) => money(payment.amount))
  );
  const panelOutstanding = outstandingOpeningBalanceTotal(dashboardData.openingBalances, "panel_outstanding", selectedBranchIdSet, range.endDate, includeUnassigned)
    + totalBy(panelClaimsForOutstanding, (panel) => money(panelClaimOutstandingAmount(panel, panelOutstandingPayments)));
  const cashInflow = directSales + panelPaymentInflow;
  const cashOutflow = operatingExpenses + supplierPaymentOutflow;
  const bankInflow = directSalesInflow + totalCashBankIn + manualMoneyIn + transferIn + pettyCashReturned + panelPaymentInflow;
  const bankOutflow = manualMoneyOut + ownerDrawing + transferOut + pettyCashIssued + supplierPaymentOutflow;
  const metadata = [range.label, range.startDate, range.endDate, labelBranches(branches.map((branch) => branch.name))];

  return {
    filename: "owner-dashboard-summary.csv",
    headers: ["Metric", "Amount", "Date Range", "Start Date", "End Date", "Branches"],
    rows: [
      ["Direct Sales", directSales, ...metadata],
      ["Panel Claims Issued", panelClaimsIssued, ...metadata],
      ["Accrual Income", accrualIncome, ...metadata],
      ["Operating Expenses", operatingExpenses, ...metadata],
      ["Supplier Purchases", supplierPurchases, ...metadata],
      ["Accrual Expenses", accrualExpenses, ...metadata],
      ["Accrual Net Profit", accrualIncome - accrualExpenses, ...metadata],
      ["Panel Payments Received", panelPaymentInflow, ...metadata],
      ["Cash Inflow", cashInflow, ...metadata],
      ["Supplier Payments", supplierPaymentOutflow, ...metadata],
      ["Cash Outflow", cashOutflow, ...metadata],
      ["Net Cashflow", cashInflow - cashOutflow, ...metadata],
      ["Bank Movement Inflow", bankInflow, ...metadata],
      ["Bank Movement Outflow", bankOutflow, ...metadata],
      ["Cash in Hand", totalCashInHand, ...metadata],
      ["Petty Cash", totalPettyCash, ...metadata],
      ["Total Physical Cash", totalCashInHand + totalPettyCash, ...metadata],
      ["Panel Outstanding", panelOutstanding, ...metadata],
      ["Supplier Outstanding", supplierOutstanding, ...metadata],
      ["Owner Drawing", ownerDrawing, ...metadata]
    ]
  };
}

export async function bankMovementCsv(searchParams: URLSearchParams): Promise<CsvExport> {
  await requireBankPositionAccess();
  const data = await getBankingDataForScope({ bankAccessOnly: true });
  const bankAccountById = getBankAccountById(data);
  const branchById = getBranchById(data);
  const {
    mappingByBranch,
    selectedBankLinkedPettyCash,
    selectedBankTransactions,
    selectedCashBankIns,
    selectedSales,
    selectedSupplierPayments,
    selectedPanelPayments
  } = bankExportScope(data, searchParams);
  const rows: CsvCell[][] = [];

  selectedSales.forEach((sale) => {
    const mapping = mappingByBranch.get(sale.branch_id);
    const amount = directBankInflow(sale);
    if (!mapping || amount <= 0) return;
    rows.push([
      sale.sale_date,
      branchLabel(sale.branches ?? branchById.get(sale.branch_id)),
      bankAccountLabel(bankAccountById.get(mapping.bank_account_id)),
      "Direct Sales Inflow",
      "in",
      "",
      amount,
      sale.id,
      sale.notes ?? "",
      ""
    ]);
  });
  selectedCashBankIns.forEach((bankIn) => {
    rows.push([
      bankIn.bank_in_date,
      branchLabel(bankIn.branches ?? branchById.get(bankIn.branch_id)),
      bankAccountLabel(bankIn.bank_accounts ?? bankAccountById.get(bankIn.bank_account_id)),
      "Cash Bank-In",
      "in",
      "",
      bankInAmount(bankIn),
      bankIn.reference_no ?? "",
      bankIn.notes ?? "",
      bankIn.entered_by ?? ""
    ]);
  });
  selectedBankTransactions.forEach((transaction) => {
    rows.push([
      transaction.transaction_date,
      branchLabel(transaction.branches ?? (transaction.branch_id ? branchById.get(transaction.branch_id) : null)),
      bankAccountLabel(transaction.bank_accounts ?? bankAccountById.get(transaction.bank_account_id)),
      transaction.transaction_type,
      transaction.direction,
      transaction.category ?? "",
      transaction.direction === "in" ? bankTransactionAmount(transaction) : -bankTransactionAmount(transaction),
      transaction.reference_no ?? "",
      transaction.description ?? "",
      transaction.entered_by ?? ""
    ]);
  });
  selectedBankLinkedPettyCash.forEach((transaction) => {
    if (!transaction.bank_account_id) return;
    const isIssued = transaction.transaction_type === "petty_cash_issued";
    rows.push([
      transaction.transaction_date,
      branchLabel(transaction.branches ?? branchById.get(transaction.branch_id)),
      bankAccountLabel(transaction.bank_accounts ?? bankAccountById.get(transaction.bank_account_id)),
      transaction.transaction_type,
      isIssued ? "out" : "in",
      transaction.category ?? "",
      isIssued ? -pettyCashAmount(transaction) : pettyCashAmount(transaction),
      transaction.reference_no ?? "",
      transaction.description ?? "",
      transaction.profiles?.full_name ?? transaction.entered_by ?? ""
    ]);
  });
  selectedSupplierPayments.forEach((payment) => {
    if (!payment.bank_account_id) return;
    rows.push([
      payment.payment_date,
      branchLabel(payment.branches ?? (payment.branch_id ? branchById.get(payment.branch_id) : null)),
      bankAccountLabel(payment.bank_accounts ?? bankAccountById.get(payment.bank_account_id)),
      "Supplier Payment",
      "out",
      "",
      -Number(payment.amount ?? 0),
      payment.reference_no ?? "",
      payment.notes ?? "",
      payment.created_by ?? ""
    ]);
  });
  selectedPanelPayments.forEach((payment) => {
    if (!payment.bank_account_id) return;
    rows.push([
      payment.payment_date,
      branchLabel(payment.branches ?? (payment.branch_id ? branchById.get(payment.branch_id) : null)),
      bankAccountLabel(payment.bank_accounts ?? bankAccountById.get(payment.bank_account_id)),
      "Panel Payment",
      "in",
      "",
      Number(payment.amount ?? 0),
      payment.reference_no ?? "",
      payment.notes ?? "",
      payment.entered_by ?? ""
    ]);
  });
  rows.sort((first, second) => String(second[0]).localeCompare(String(first[0])) || String(first[3]).localeCompare(String(second[3])));

  return {
    filename: "bank-movement-report.csv",
    headers: ["Date", "Branch", "Bank Account", "Type", "Direction", "Category", "Amount", "Reference", "Description", "Entered By"],
    rows
  };
}

export async function pettyCashLedgerCsv(searchParams: URLSearchParams): Promise<CsvExport> {
  await requirePermission("record_petty_cash");
  const data = await getBankingData();
  const bankAccountById = getBankAccountById(data);
  const selectedBranchId = param(searchParams, "branch_id") ?? "all";
  const selectedBankAccountId = param(searchParams, "bank_account_id") ?? "all";
  const selectedType = param(searchParams, "transaction_type") ?? "all";
  const rows = data.pettyCashTransactions.filter((transaction) => {
    return isActiveFinancialRecord(transaction)
      && matchesOptionalDate(transaction.transaction_date, searchParams)
      && (selectedBranchId === "all" || transaction.branch_id === selectedBranchId)
      && (selectedBankAccountId === "all" || transaction.bank_account_id === selectedBankAccountId)
      && (selectedType === "all" || transaction.transaction_type === selectedType);
  }).map((transaction) => [
    transaction.transaction_date,
    branchLabel(transaction.branches),
    bankAccountLabel(transaction.bank_accounts ?? (transaction.bank_account_id ? bankAccountById.get(transaction.bank_account_id) : null)),
    transaction.transaction_type,
    transaction.direction,
    transaction.category ?? "",
    pettyCashAmount(transaction),
    transaction.reference_no ?? "",
    transaction.description ?? "",
    transaction.profiles?.full_name ?? transaction.entered_by ?? ""
  ]);

  return {
    filename: "petty-cash-ledger.csv",
    headers: ["Date", "Branch", "Bank Account", "Transaction Type", "Direction", "Category", "Amount", "Reference", "Description", "Entered By"],
    rows
  };
}

export async function cashInHandCsv(searchParams: URLSearchParams): Promise<CsvExport> {
  await requirePermission("record_cash_bank_in");
  const data = await getBankingData();
  const range = resolveDateRange({
    end: param(searchParams, "end"),
    period: param(searchParams, "period"),
    start: param(searchParams, "start")
  });

  return {
    filename: "cash-in-hand-report.csv",
    headers: ["Start Date", "End Date", "Branch", "Opening Balance", "Cash Sales", "Cash Banked In By Cash Date", "Cash Locum Payments", "Cash In Hand"],
    rows: buildCashInHandRows(data, range).map((row) => [
      range.startDate,
      range.endDate,
      row.branch.name,
      row.openingBalance,
      row.cashSales,
      row.bankedIn,
      row.cashLocumPayments,
      row.remaining
    ])
  };
}

export async function cashBankInsCsv(searchParams: URLSearchParams): Promise<CsvExport> {
  await requirePermission("record_cash_bank_in");
  const data = await getBankingData();
  const bankAccountById = getBankAccountById(data);
  const selectedBranchId = param(searchParams, "branch_id") ?? param(searchParams, "branch") ?? "all";

  const rows = data.cashBankIns.filter((bankIn) => {
    return isActiveFinancialRecord(bankIn)
      && matchesOptionalDate(bankIn.bank_in_date, searchParams)
      && (selectedBranchId === "all" || bankIn.branch_id === selectedBranchId);
  }).map((bankIn) => [
    bankIn.cash_month ?? bankIn.cash_source_date?.slice(0, 7).concat("-01") ?? `${bankIn.bank_in_date.slice(0, 7)}-01`,
    bankIn.cash_sales_from ?? bankIn.cash_source_date ?? bankIn.bank_in_date,
    bankIn.cash_sales_to ?? bankIn.cash_source_date ?? bankIn.bank_in_date,
    bankIn.bank_in_date,
    branchLabel(bankIn.branches),
    bankAccountLabel(bankIn.bank_accounts ?? bankAccountById.get(bankIn.bank_account_id)),
    bankIn.amount,
    bankIn.reference_no ?? "",
    bankIn.notes ?? "",
    bankIn.entered_by ?? "",
    bankIn.is_void ? "Voided" : "Active"
  ]);

  return {
    filename: "cash-bank-ins.csv",
    headers: ["Cash Month", "Cash Sales From", "Cash Sales To", "Bank-In Date", "Branch", "Bank Account", "Amount", "Reference", "Notes", "Entered By", "Status"],
    rows
  };
}

export async function auditTrailCsv(searchParams: URLSearchParams): Promise<CsvExport> {
  const profile = await requirePermission("view_audit_trail");
  if (!profile) throw new ExportForbiddenError("Audit trail export requires an active profile.");
  if (normalizeRole(profile.role) !== "owner") {
    throw new ExportForbiddenError("Only Owner can export audit trail data.");
  }

  const events = await getAuditEvents({
    action: param(searchParams, "action"),
    actorId: param(searchParams, "actor_id"),
    bankAccountId: param(searchParams, "bank_account_id"),
    branchId: param(searchParams, "branch_id"),
    endDate: param(searchParams, "end"),
    entityName: param(searchParams, "entity_name"),
    keyword: param(searchParams, "q"),
    startDate: param(searchParams, "start")
  });

  return {
    filename: "audit-trail.csv",
    headers: ["Date", "Actor", "Actor Email", "Action", "Entity", "Entity ID", "Branch", "Bank Account", "Description"],
    rows: events.map((event) => [
      event.created_at,
      event.profiles?.full_name ?? event.actor_id ?? "",
      event.actor_email ?? "",
      event.action,
      event.entity_name,
      event.entity_id ?? "",
      branchLabel(event.branches),
      bankAccountLabel(event.bank_accounts),
      event.description ?? ""
    ])
  };
}

export async function dailySalesCsv(searchParams: URLSearchParams): Promise<CsvExport> {
  const profile = await requirePermission("edit_finance");
  const data = await getDashboardData();
  const reportFilter = resolveDailySalesFilter({
    end: param(searchParams, "end"),
    filter: param(searchParams, "filter"),
    month: param(searchParams, "month"),
    range: param(searchParams, "range") ?? param(searchParams, "period"),
    sort: param(searchParams, "sort"),
    start: param(searchParams, "start")
  });
  const selectedBranchIds = resolveSelectedBranchIds({
    allowedBranches: data.branches,
    branchParam: paramValues(searchParams, "branch") ?? paramValues(searchParams, "branch_id"),
    canSelectMultiple: canViewAllBranches(profile)
  });
  const selectedBranchIdSet = new Set(selectedBranchIds);
  const sales = reportFilter.error
    ? []
    : sortDailySales(
        data.sales.filter((sale) => selectedBranchIdSet.has(sale.branch_id) && isDailySaleInResolvedRange(sale, reportFilter)),
        reportFilter.sort
      );

  return {
    filename: "daily-sales-report.csv",
    headers: ["Date", "Branch", "Cash", "Bank Transfer", "Card", "Panel", "QR", "Total", "Status", "Is Void", "Notes", "Created At", "Updated At"],
    rows: sales.map((sale) => [
      sale.sale_date,
      sale.branches?.name ?? "",
      sale.cash_amount,
      sale.bank_transfer_amount,
      sale.card_amount,
      sale.panel_amount,
      sale.qr_amount,
      sale.total_amount,
      sale.is_void ? "Voided" : "Active",
      sale.is_void ? "true" : "false",
      sale.notes ?? "",
      sale.created_at ?? "",
      sale.updated_at ?? ""
    ])
  };
}

export async function expensesCsv(searchParams: URLSearchParams): Promise<CsvExport> {
  const profile = await requirePermission("edit_finance");
  const data = await getExpensesReportingData();
  const canViewSupplierPayments = ["owner", "admin", "finance"].includes(normalizeRole(profile.role));
  const reportRange = resolveReportRange({
    end: param(searchParams, "end"),
    month: param(searchParams, "month"),
    range: param(searchParams, "range"),
    start: param(searchParams, "start")
  });
  const selectedBranchIds = resolveSelectedBranchIds({
    allowedBranches: data.branches,
    branchParam: paramValues(searchParams, "branch"),
    branchesParam: paramValues(searchParams, "branches"),
    canSelectMultiple: canViewAllBranches(profile)
  });
  const selectedBranchIdSet = new Set(selectedBranchIds);

  const expenseRows: CsvCell[][] = data.expenses.filter((expense) => {
    return expense.expense_date >= reportRange.startDate
      && expense.expense_date <= reportRange.endDate
      && selectedBranchIdSet.has(expense.branch_id);
  }).map((expense) => [
    "Operating Expense",
    expense.expense_date,
    expense.branches?.name ?? "",
    expense.category,
    expense.vendor_name ?? "",
    expense.description,
    expense.payment_type,
    "",
    expense.amount,
    "",
    expense.is_void ? "Voided" : "Active",
    expense.is_void ? "true" : "false",
    expense.created_at ?? ""
  ]);

  const supplierPaymentRows: CsvCell[][] = canViewSupplierPayments
    ? data.supplierPayments.filter((payment) => {
        return payment.payment_date >= reportRange.startDate
          && payment.payment_date <= reportRange.endDate
          && selectedBranchIdSet.has(payment.branch_id);
      }).map((payment) => [
        "Supplier Payment",
        payment.payment_date,
        payment.branches?.name ?? "",
        labelize(payment.payment_method ?? "bank_transfer"),
        payment.suppliers?.name ?? "",
        payment.supplier_purchase_entries?.invoice_no ?? payment.supplier_purchase_entry_id ?? "General payment",
        labelize(payment.payment_method ?? "bank_transfer"),
        payment.bank_accounts?.name ?? "",
        payment.amount,
        payment.reference_no ?? "",
        payment.is_void ? "Voided" : "Active",
        payment.is_void ? "true" : "false",
        payment.created_at ?? ""
      ])
    : [];

  return {
    filename: "expenses-report.csv",
    headers: ["Source", "Date", "Branch", "Category / Type", "Vendor / Supplier", "Description / Invoice", "Payment Method", "Paid From / Bank Account", "Amount", "Reference", "Status", "Is Voided", "Created At"],
    rows: [...expenseRows, ...supplierPaymentRows].sort((first, second) => String(second[1]).localeCompare(String(first[1])))
  };
}
