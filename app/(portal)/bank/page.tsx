import {
  createBankAccount,
  createBankTransaction,
  revokeBankAccountPermission,
  updateBankTransaction,
  voidBankTransaction,
  upsertBankAccountPermission
} from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { DocumentManager } from "@/components/documents/document-manager";
import { ExportCsvLink } from "@/components/export-csv-link";
import { FinanceRecordDetails } from "@/components/finance-record-details";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { bankMoneyOutCategories, bankTransactionTypes } from "@/lib/constants";
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
  panelSalesAmount,
  pettyCashAmount,
  resolveDateRange,
  signedBankTransactionAmount
} from "@/lib/bank-reporting";
import { getBankingDataForScope, totalBy } from "@/lib/data";
import { userDisplayLabel } from "@/lib/display";
import { formatCurrency, formatDate } from "@/lib/format";
import { bankOpeningBalanceTotal } from "@/lib/opening-balances";
import { canManageBankPermissions, hasBankAccountPermission, normalizeRole, requireBankPositionAccess } from "@/lib/permissions";
import { getTransactionDocuments } from "@/lib/transaction-documents";
import { getUserManagementData, getVisibleProfilesById } from "@/lib/users";
import type { BankTransaction, BankTransactionType, PettyCashTransaction } from "@/lib/types";
import { Banknote, CreditCard, Landmark, ReceiptText, WalletCards } from "lucide-react";

type BankPageSearchParams = {
  bank_account_id?: string;
  branch_id?: string;
  category?: string;
  end?: string;
  period?: string;
  start?: string;
  transaction_type?: string;
};

type StatementRow = {
  bankAccount: string;
  bankTransferAmount: number;
  branch: string;
  cardAmount: number;
  cashBankInAmount: number;
  date: string;
  manualMoneyInAmount: number;
  moneyOutAmount: number;
  netMovement: number;
  notes: string;
  ownerDrawingAmount: number;
  pettyCashIssuedAmount: number;
  pettyCashReturnedAmount: number;
  qrAmount: number;
  referenceNo: string;
  sourceType:
    | "Cash Bank-In"
    | "Direct Sales Inflow"
    | "Manual Money In"
    | "Money Out"
    | "Interbank Transfer"
    | "Owner Drawing"
    | "Petty Cash Issued"
    | "Petty Cash Returned"
    | "Supplier Payment"
    | "Panel Payment";
  transferInAmount: number;
  transferOutAmount: number;
};

function addToMap(map: Map<string, number>, key: string, amount: number) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function permissionSummary(permission: {
  can_create_transaction: boolean;
  can_edit_transaction: boolean;
  can_manage_account: boolean;
  can_view: boolean;
}) {
  const flags = [
    permission.can_view ? "View" : null,
    permission.can_create_transaction ? "Create transactions" : null,
    permission.can_edit_transaction ? "Edit transactions" : null,
    permission.can_manage_account ? "Manage account" : null
  ].filter(Boolean);

  return flags.length ? flags.join(", ") : "No access";
}

function manualTransactionSourceType(transaction: BankTransaction): StatementRow["sourceType"] {
  if (transaction.transaction_type === "money_in") return "Manual Money In";
  if (transaction.transaction_type === "money_out") return "Money Out";
  if (transaction.transaction_type === "owner_drawing") return "Owner Drawing";
  return "Interbank Transfer";
}

function transactionTypeLabel(type: BankTransactionType) {
  return bankTransactionTypes.find((option) => option.value === type)?.label ?? type;
}

function categoryLabel(category: string | null | undefined) {
  if (!category) return "-";
  return bankMoneyOutCategories.find((option) => option.value === category)?.label ?? category;
}

export default async function BankPage({ searchParams }: { searchParams: Promise<BankPageSearchParams> }) {
  const profile = await requireBankPositionAccess();
  const canManageBankAccounts = canManageBankPermissions(profile);
  const showPettyCashManagement = ["owner", "admin", "finance"].includes(normalizeRole(profile.role));
  const params = await searchParams;
  const range = resolveDateRange(params);
  const todayRange = resolveDateRange({ period: "today" });
  const monthRange = resolveDateRange({ period: "this_month" });
  const data = await getBankingDataForScope({ bankAccessOnly: true });
  const accessManagementData = canManageBankAccounts ? await getUserManagementData() : null;
  const bankAccessUsers = accessManagementData?.users.filter((user) => user.is_active && ["admin", "finance", "branch_pic"].includes(user.role)) ?? [];
  const bankAccessAccounts = accessManagementData?.bankAccounts ?? [];
  const bankAccessPermissions = accessManagementData?.bankAccountPermissions ?? [];
  const accessUserById = new Map(bankAccessUsers.map((user) => [user.id, user]));
  const accessAccountById = new Map(bankAccessAccounts.map((account) => [account.id, account]));
  const mappingByBranch = getMappingByBranch(data);
  const bankAccountById = getBankAccountById(data);
  const branchById = getBranchById(data);
  const selectedBankAccountId = params.bank_account_id ?? "all";
  const selectedBranchId = params.branch_id ?? "all";
  const selectedCategory = params.category ?? "all";
  const selectedManualTransactionType = bankTransactionTypes.some((option) => option.value === params.transaction_type)
    ? params.transaction_type as BankTransactionType
    : "all";
  const saleMatchesScope = (sale: (typeof data.sales)[number]) => {
    const mapping = mappingByBranch.get(sale.branch_id);
    return (selectedBranchId === "all" || sale.branch_id === selectedBranchId)
      && (selectedBankAccountId === "all" || mapping?.bank_account_id === selectedBankAccountId);
  };
  const bankInMatchesScope = (bankIn: (typeof data.cashBankIns)[number]) => {
    return (selectedBranchId === "all" || bankIn.branch_id === selectedBranchId)
      && (selectedBankAccountId === "all" || bankIn.bank_account_id === selectedBankAccountId);
  };
  const transactionMatchesScope = (transaction: BankTransaction) => {
    return (selectedBankAccountId === "all" || transaction.bank_account_id === selectedBankAccountId)
      && (selectedBranchId === "all" || transaction.branch_id === selectedBranchId)
      && (selectedCategory === "all" || transaction.category === selectedCategory)
      && (selectedManualTransactionType === "all" || transaction.transaction_type === selectedManualTransactionType);
  };
  const selectedSales = data.sales.filter((sale) => {
    return isActiveFinancialRecord(sale) && isWithinDateRange(sale.sale_date, range) && saleMatchesScope(sale);
  });
  const selectedCashBankIns = data.cashBankIns.filter((bankIn) => {
    return isActiveFinancialRecord(bankIn) && isWithinDateRange(bankIn.bank_in_date, range) && bankInMatchesScope(bankIn);
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
  const bankTransactionHistory = data.bankTransactions.filter((transaction) => {
    return isWithinDateRange(transaction.transaction_date, range) && transactionMatchesScope(transaction);
  });
  const visibleUsers = await getVisibleProfilesById(bankTransactionHistory.flatMap((transaction) => [transaction.entered_by, transaction.voided_by]));
  const userById = new Map(visibleUsers.map((user) => [user.id, user]));
  const bankTransactionDocuments = await getTransactionDocuments("bank_transactions", bankTransactionHistory.map((transaction) => transaction.id));
  const selectedBankTransactions = bankTransactionHistory.filter(isActiveFinancialRecord);
  const pettyCashMatchesScope = (transaction: PettyCashTransaction) => {
    return (selectedBankAccountId === "all" || transaction.bank_account_id === selectedBankAccountId)
      && (selectedBranchId === "all" || transaction.branch_id === selectedBranchId);
  };
  const selectedBankLinkedPettyCash = data.pettyCashTransactions.filter((transaction) => {
    return isActiveFinancialRecord(transaction)
      && transaction.bank_account_id
      && (transaction.transaction_type === "petty_cash_issued" || transaction.transaction_type === "petty_cash_returned")
      && isWithinDateRange(transaction.transaction_date, range)
      && pettyCashMatchesScope(transaction);
  });
  const todaySales = data.sales.filter((sale) => isActiveFinancialRecord(sale) && isWithinDateRange(sale.sale_date, todayRange));
  const monthSales = data.sales.filter((sale) => isActiveFinancialRecord(sale) && isWithinDateRange(sale.sale_date, monthRange));
  const todayCashBankIns = data.cashBankIns.filter((bankIn) => isActiveFinancialRecord(bankIn) && isWithinDateRange(bankIn.bank_in_date, todayRange));
  const monthCashBankIns = data.cashBankIns.filter((bankIn) => isActiveFinancialRecord(bankIn) && isWithinDateRange(bankIn.bank_in_date, monthRange));
  const monthBankLinkedPettyCash = data.pettyCashTransactions.filter((transaction) => {
    return isActiveFinancialRecord(transaction)
      && transaction.bank_account_id
      && (transaction.transaction_type === "petty_cash_issued" || transaction.transaction_type === "petty_cash_returned")
      && isWithinDateRange(transaction.transaction_date, monthRange);
  });

  const selectedDirectBankInflow = totalBy(selectedSales, directBankInflow);
  const selectedCashBankIn = totalBy(selectedCashBankIns, bankInAmount);
  const selectedCashSales = totalBy(selectedSales, (sale) => Number(sale.cash_amount ?? 0));
  const selectedPanelSales = totalBy(selectedSales, panelSalesAmount);
  const selectedManualMoneyIn = totalBy(selectedBankTransactions, (transaction) => {
    return transaction.transaction_type === "money_in" ? bankTransactionAmount(transaction) : 0;
  });
  const selectedMoneyOut = totalBy(selectedBankTransactions, (transaction) => {
    return transaction.transaction_type === "money_out" ? bankTransactionAmount(transaction) : 0;
  });
  const selectedSupplierPaymentOut = totalBy(selectedSupplierPayments, (payment) => Number(payment.amount ?? 0));
  const selectedPanelPaymentIn = totalBy(selectedPanelPayments, (payment) => Number(payment.amount ?? 0));
  const selectedOwnerDrawing = totalBy(selectedBankTransactions, (transaction) => {
    return transaction.transaction_type === "owner_drawing" ? bankTransactionAmount(transaction) : 0;
  });
  const selectedTransferIn = totalBy(selectedBankTransactions, (transaction) => {
    return transaction.transaction_type === "interbank_transfer" && transaction.direction === "in" ? bankTransactionAmount(transaction) : 0;
  });
  const selectedTransferOut = totalBy(selectedBankTransactions, (transaction) => {
    return transaction.transaction_type === "interbank_transfer" && transaction.direction === "out" ? bankTransactionAmount(transaction) : 0;
  });
  const selectedPettyCashIssued = totalBy(selectedBankLinkedPettyCash, (transaction) => {
    return transaction.transaction_type === "petty_cash_issued" ? pettyCashAmount(transaction) : 0;
  });
  const selectedPettyCashReturned = totalBy(selectedBankLinkedPettyCash, (transaction) => {
    return transaction.transaction_type === "petty_cash_returned" ? pettyCashAmount(transaction) : 0;
  });
  const monthPettyCashIssued = totalBy(monthBankLinkedPettyCash, (transaction) => {
    return transaction.transaction_type === "petty_cash_issued" ? pettyCashAmount(transaction) : 0;
  });
  const monthPettyCashReturned = totalBy(monthBankLinkedPettyCash, (transaction) => {
    return transaction.transaction_type === "petty_cash_returned" ? pettyCashAmount(transaction) : 0;
  });
  const selectedNetBankMovement = selectedDirectBankInflow + selectedCashBankIn + selectedManualMoneyIn + selectedPanelPaymentIn
    - selectedMoneyOut - selectedSupplierPaymentOut - selectedOwnerDrawing + selectedTransferIn - selectedTransferOut
    - selectedPettyCashIssued + selectedPettyCashReturned;
  const cashInHandRows = buildCashInHandRows(data, range);
  const pettyCashBalanceRows = buildPettyCashBalanceRows(data);
  const cashInHandByBranchId = new Map(cashInHandRows.map((row) => [row.branch.id, row]));
  const pettyCashBalanceByBranchId = new Map(pettyCashBalanceRows.map((row) => [row.branch.id, row]));
  const creatableBankAccounts = data.bankAccounts.filter((account) => {
    return hasBankAccountPermission(profile, data.bankAccountPermissions, account.id, "create_transaction");
  });

  const bankMovements = new Map(data.bankAccounts.map((account) => [account.id, 0]));
  const bankOpeningBalances = new Map(data.bankAccounts.map((account) => [
    account.id,
    bankOpeningBalanceTotal(data.openingBalances, account.id, range.endDate)
  ]));
  const branchMovements = new Map(data.branches.map((branch) => [branch.id, 0]));
  const statementRows: StatementRow[] = [];

  selectedSales.forEach((sale) => {
    const mapping = mappingByBranch.get(sale.branch_id);
    const account = mapping ? bankAccountById.get(mapping.bank_account_id) : undefined;
    const directAmount = directBankInflow(sale);
    addToMap(branchMovements, sale.branch_id, directAmount);
    if (mapping) addToMap(bankMovements, mapping.bank_account_id, directAmount);

    if (directAmount > 0) {
      statementRows.push({
        bankAccount: bankAccountLabel(account),
        bankTransferAmount: Number(sale.bank_transfer_amount ?? 0),
        branch: branchLabel(sale.branches ?? branchById.get(sale.branch_id)),
        cardAmount: Number(sale.card_amount ?? 0),
        cashBankInAmount: 0,
        date: sale.sale_date,
        manualMoneyInAmount: 0,
        moneyOutAmount: 0,
        netMovement: directAmount,
        notes: sale.notes ?? "",
        ownerDrawingAmount: 0,
        pettyCashIssuedAmount: 0,
        pettyCashReturnedAmount: 0,
        qrAmount: Number(sale.qr_amount ?? 0),
        referenceNo: sale.id,
        sourceType: "Direct Sales Inflow",
        transferInAmount: 0,
        transferOutAmount: 0
      });
    }
  });

  selectedCashBankIns.forEach((bankIn) => {
    const account = bankAccountById.get(bankIn.bank_account_id);
    const amount = bankInAmount(bankIn);
    addToMap(bankMovements, bankIn.bank_account_id, amount);
    addToMap(branchMovements, bankIn.branch_id, amount);
    statementRows.push({
      bankAccount: bankAccountLabel(bankIn.bank_accounts ?? account),
      bankTransferAmount: 0,
      branch: branchLabel(bankIn.branches ?? branchById.get(bankIn.branch_id)),
      cardAmount: 0,
      cashBankInAmount: amount,
      date: bankIn.bank_in_date,
      manualMoneyInAmount: 0,
      moneyOutAmount: 0,
      netMovement: amount,
      notes: bankIn.notes ?? "",
      ownerDrawingAmount: 0,
      pettyCashIssuedAmount: 0,
      pettyCashReturnedAmount: 0,
      qrAmount: 0,
      referenceNo: bankIn.reference_no ?? "-",
      sourceType: "Cash Bank-In",
      transferInAmount: 0,
      transferOutAmount: 0
    });
  });

  selectedBankTransactions.forEach((transaction) => {
    const account = bankAccountById.get(transaction.bank_account_id);
    const amount = bankTransactionAmount(transaction);
    const signedAmount = signedBankTransactionAmount(transaction);
    addToMap(bankMovements, transaction.bank_account_id, signedAmount);
    if (transaction.branch_id && branchById.has(transaction.branch_id)) {
      addToMap(branchMovements, transaction.branch_id, signedAmount);
    }

    statementRows.push({
      bankAccount: bankAccountLabel(transaction.bank_accounts ?? account),
      bankTransferAmount: 0,
      branch: branchLabel(transaction.branches ?? (transaction.branch_id ? branchById.get(transaction.branch_id) : null)),
      cardAmount: 0,
      cashBankInAmount: 0,
      date: transaction.transaction_date,
      manualMoneyInAmount: transaction.transaction_type === "money_in" ? amount : 0,
      moneyOutAmount: transaction.transaction_type === "money_out" ? amount : 0,
      netMovement: signedAmount,
      notes: transaction.description ?? "",
      ownerDrawingAmount: transaction.transaction_type === "owner_drawing" ? amount : 0,
      pettyCashIssuedAmount: 0,
      pettyCashReturnedAmount: 0,
      qrAmount: 0,
      referenceNo: transaction.reference_no ?? "-",
      sourceType: manualTransactionSourceType(transaction),
      transferInAmount: transaction.transaction_type === "interbank_transfer" && transaction.direction === "in" ? amount : 0,
      transferOutAmount: transaction.transaction_type === "interbank_transfer" && transaction.direction === "out" ? amount : 0
    });
  });

  selectedBankLinkedPettyCash.forEach((transaction) => {
    if (!transaction.bank_account_id) return;
    const amount = pettyCashAmount(transaction);
    const isIssued = transaction.transaction_type === "petty_cash_issued";
    const netMovement = isIssued ? -amount : amount;
    addToMap(bankMovements, transaction.bank_account_id, netMovement);
    addToMap(branchMovements, transaction.branch_id, netMovement);

    statementRows.push({
      bankAccount: bankAccountLabel(transaction.bank_accounts ?? bankAccountById.get(transaction.bank_account_id)),
      bankTransferAmount: 0,
      branch: branchLabel(transaction.branches ?? branchById.get(transaction.branch_id)),
      cardAmount: 0,
      cashBankInAmount: 0,
      date: transaction.transaction_date,
      manualMoneyInAmount: 0,
      moneyOutAmount: 0,
      netMovement,
      notes: transaction.description ?? "",
      ownerDrawingAmount: 0,
      pettyCashIssuedAmount: isIssued ? amount : 0,
      pettyCashReturnedAmount: isIssued ? 0 : amount,
      qrAmount: 0,
      referenceNo: transaction.reference_no ?? "-",
      sourceType: isIssued ? "Petty Cash Issued" : "Petty Cash Returned",
      transferInAmount: 0,
      transferOutAmount: 0
    });
  });

  selectedSupplierPayments.forEach((payment) => {
    if (!payment.bank_account_id) return;
    const amount = Number(payment.amount ?? 0);
    addToMap(bankMovements, payment.bank_account_id, -amount);
    if (payment.branch_id && branchById.has(payment.branch_id)) addToMap(branchMovements, payment.branch_id, -amount);

    statementRows.push({
      bankAccount: bankAccountLabel(payment.bank_accounts ?? bankAccountById.get(payment.bank_account_id)),
      bankTransferAmount: 0,
      branch: branchLabel(payment.branches ?? (payment.branch_id ? branchById.get(payment.branch_id) : null)),
      cardAmount: 0,
      cashBankInAmount: 0,
      date: payment.payment_date,
      manualMoneyInAmount: 0,
      moneyOutAmount: amount,
      netMovement: -amount,
      notes: payment.notes ?? "",
      ownerDrawingAmount: 0,
      pettyCashIssuedAmount: 0,
      pettyCashReturnedAmount: 0,
      qrAmount: 0,
      referenceNo: payment.reference_no ?? "-",
      sourceType: "Supplier Payment",
      transferInAmount: 0,
      transferOutAmount: 0
    });
  });

  selectedPanelPayments.forEach((payment) => {
    if (!payment.bank_account_id) return;
    const amount = Number(payment.amount ?? 0);
    addToMap(bankMovements, payment.bank_account_id, amount);
    if (payment.branch_id && branchById.has(payment.branch_id)) addToMap(branchMovements, payment.branch_id, amount);

    statementRows.push({
      bankAccount: bankAccountLabel(payment.bank_accounts ?? bankAccountById.get(payment.bank_account_id)),
      bankTransferAmount: amount,
      branch: branchLabel(payment.branches ?? (payment.branch_id ? branchById.get(payment.branch_id) : null)),
      cardAmount: 0,
      cashBankInAmount: 0,
      date: payment.payment_date,
      manualMoneyInAmount: 0,
      moneyOutAmount: 0,
      netMovement: amount,
      notes: payment.notes ?? "",
      ownerDrawingAmount: 0,
      pettyCashIssuedAmount: 0,
      pettyCashReturnedAmount: 0,
      qrAmount: 0,
      referenceNo: payment.reference_no ?? "-",
      sourceType: "Panel Payment",
      transferInAmount: 0,
      transferOutAmount: 0
    });
  });

  statementRows.sort((first, second) => second.date.localeCompare(first.date) || second.sourceType.localeCompare(first.sourceType));

  return (
    <>
      <ModuleHeader
        eyebrow="Banking"
        title="Bank Position"
        description="View assigned bank account movements from direct inflow, panel collections, supplier settlements, cash bank-ins, and manual bank transactions."
      />

      <form className="reporting-filter bank-filter" method="get">
        <label>
          Date filter
          <select name="period" defaultValue={range.period}>
            <option value="today">Today</option>
            <option value="this_month">This month</option>
            <option value="last_month">Last month</option>
            <option value="custom">Custom date range</option>
          </select>
        </label>
        <label>
          Start date
          <input name="start" type="date" defaultValue={range.startDate} />
        </label>
        <label>
          End date
          <input name="end" type="date" defaultValue={range.endDate} />
        </label>
        <label>
          Bank account
          <select name="bank_account_id" defaultValue={selectedBankAccountId}>
            <option value="all">All assigned bank accounts</option>
            {data.bankAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {bankAccountLabel(account)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Manual transaction type
          <select name="transaction_type" defaultValue={selectedManualTransactionType}>
            <option value="all">All manual types</option>
            {bankTransactionTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select name="category" defaultValue={selectedCategory}>
            <option value="all">All categories</option>
            {bankMoneyOutCategories.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Branch
          <select name="branch_id" defaultValue={selectedBranchId}>
            <option value="all">All branches</option>
            {data.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        <button className="primary-button" type="submit">
          Apply
        </button>
        <ExportCsvLink label="Export bank CSV" report="bank" searchParams={params} />
        <p className="selected-branches">
          Showing {range.label}: {formatDate(range.startDate)} to {formatDate(range.endDate)}
        </p>
      </form>

      <section className="dashboard-grid" aria-label="Bank position metrics">
        <MetricCard icon={CreditCard} label="Direct bank inflow today" value={formatCurrency(totalBy(todaySales, directBankInflow))} detail="Card, QR, transfer" />
        <MetricCard icon={Landmark} label="Direct bank inflow this month" value={formatCurrency(totalBy(monthSales, directBankInflow))} detail="Existing daily sales" tone="blue" />
        <MetricCard icon={Banknote} label="Cash bank-in today" value={formatCurrency(totalBy(todayCashBankIns, bankInAmount))} detail="Cash moved to bank" tone="amber" />
        <MetricCard icon={WalletCards} label="Cash bank-in this month" value={formatCurrency(totalBy(monthCashBankIns, bankInAmount))} detail="Not new sales" tone="teal" />
        <MetricCard icon={Landmark} label="Manual money in" value={formatCurrency(selectedManualMoneyIn)} detail={range.label} tone="teal" />
        <MetricCard icon={ReceiptText} label="Money out" value={formatCurrency(selectedMoneyOut)} detail="Manual outgoing payment" tone="rose" />
        <MetricCard icon={ReceiptText} label="Supplier payments" value={formatCurrency(selectedSupplierPaymentOut)} detail="Bank settlement outflow" tone="rose" />
        <MetricCard icon={Landmark} label="Panel payments" value={formatCurrency(selectedPanelPaymentIn)} detail="Panel collection inflow" tone="blue" />
        <MetricCard icon={WalletCards} label="Owner drawing" value={formatCurrency(selectedOwnerDrawing)} detail="Not clinic operating expense" tone="amber" />
        <MetricCard icon={Landmark} label="Interbank transfer in" value={formatCurrency(selectedTransferIn)} detail="Transfer movement only" tone="blue" />
        <MetricCard icon={Landmark} label="Interbank transfer out" value={formatCurrency(selectedTransferOut)} detail="Transfer movement only" tone="blue" />
        {showPettyCashManagement ? (
          <>
            <MetricCard icon={WalletCards} label="Petty cash issued this month" value={formatCurrency(monthPettyCashIssued)} detail="Bank to branch cash float" tone="amber" />
            <MetricCard icon={Banknote} label="Petty cash returned this month" value={formatCurrency(monthPettyCashReturned)} detail="Float returned to bank" tone="teal" />
          </>
        ) : null}
        <MetricCard icon={Landmark} label="Net bank movement" value={formatCurrency(selectedNetBankMovement)} detail="Transfers are not income or expense" tone="blue" />
        <MetricCard icon={ReceiptText} label="Cash sales" value={formatCurrency(selectedCashSales)} detail="Held by branch until banked in" tone="amber" />
        <MetricCard icon={WalletCards} label="Panel sales" value={formatCurrency(selectedPanelSales)} detail="Outstanding, not bank inflow" tone="rose" />
      </section>

      {showPettyCashManagement ? (
        <section className="section-grid mt-section">
          <div className="table-section">
            <h2>Petty cash balance by branch</h2>
            <DataTable
              columns={["Branch", "Opening balance", "Total issued", "Total spent", "Total returned", "Adjustments", "Current petty cash balance"]}
              rows={pettyCashBalanceRows.map((row) => [
                row.branch.name,
                formatCurrency(row.openingBalance),
                formatCurrency(row.issued),
                formatCurrency(row.spent),
                formatCurrency(row.returned),
                formatCurrency(row.adjustments),
                formatCurrency(row.balance)
              ])}
            />
          </div>

          <div className="table-section">
            <h2>Total physical cash by branch</h2>
            <DataTable
              columns={["Branch", "Cash in hand", "Petty cash", "Total physical cash"]}
              rows={data.branches.map((branch) => {
                const cashInHand = cashInHandByBranchId.get(branch.id)?.remaining ?? 0;
                const pettyCash = pettyCashBalanceByBranchId.get(branch.id)?.balance ?? 0;
                return [
                  branch.name,
                  formatCurrency(cashInHand),
                  formatCurrency(pettyCash),
                  formatCurrency(cashInHand + pettyCash)
                ];
              })}
            />
          </div>
        </section>
      ) : null}

      <section className="section-grid">
        <form action={createBankTransaction} className="form-card manual-bank-form">
          <h2>Record manual bank transaction</h2>
          <div className="form-grid">
            <label>
              Transaction type
              <select name="transaction_type" defaultValue="money_in" required>
                {bankTransactionTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Transaction date
              <input name="transaction_date" type="date" defaultValue={range.endDate} required />
            </label>
            <label>
              Bank account
              <select name="bank_account_id" required>
                {creatableBankAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {bankAccountLabel(account)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Transfer destination
              <select name="related_bank_account_id" defaultValue="">
                <option value="">Not a transfer</option>
                {creatableBankAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {bankAccountLabel(account)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Money out category
              <select name="category" defaultValue="">
                <option value="">No category</option>
                {bankMoneyOutCategories.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Branch
              <select name="branch_id" defaultValue="">
                <option value="">No branch</option>
                {data.branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount
              <input min="0.01" name="amount" step="0.01" type="number" required />
            </label>
            <label>
              Reference number
              <input name="reference_no" />
            </label>
            <label className="full-span">
              Description
              <textarea name="description" />
            </label>
          </div>
          <button className="primary-button" disabled={!creatableBankAccounts.length} type="submit">
            Save bank transaction
          </button>
          {!creatableBankAccounts.length ? <p className="muted-copy">No creatable bank accounts are assigned to your user.</p> : null}
        </form>

        <aside className="report-panel">
          <h2>Manual movement summary</h2>
          <dl className="summary-list">
            <div>
              <dt>Money in</dt>
              <dd>{formatCurrency(selectedManualMoneyIn)}</dd>
            </div>
            <div>
              <dt>Money out</dt>
              <dd>{formatCurrency(selectedMoneyOut)}</dd>
            </div>
            <div>
              <dt>Supplier payments</dt>
              <dd>{formatCurrency(selectedSupplierPaymentOut)}</dd>
            </div>
            <div>
              <dt>Panel payments</dt>
              <dd>{formatCurrency(selectedPanelPaymentIn)}</dd>
            </div>
            <div>
              <dt>Owner drawing</dt>
              <dd>{formatCurrency(selectedOwnerDrawing)}</dd>
            </div>
            <div>
              <dt>Transfers in / out</dt>
              <dd>{formatCurrency(selectedTransferIn)} / {formatCurrency(selectedTransferOut)}</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="section-grid">
        <div className="table-section">
          <h2>Cash in hand by branch</h2>
          <DataTable
            columns={["Branch", "Opening balance", "Total cash sales", "Total cash banked in", "Cash locum payments", "Remaining cash in hand"]}
            rows={cashInHandRows.map((row) => [
              row.branch.name,
              formatCurrency(row.openingBalance),
              formatCurrency(row.cashSales),
              formatCurrency(row.bankedIn),
              formatCurrency(row.cashLocumPayments),
              formatCurrency(row.remaining)
            ])}
          />
        </div>

        <aside className="report-panel">
          <h2>Bank accounts</h2>
          <dl className="summary-list">
            {data.bankAccounts.map((account) => (
              <div key={account.id}>
                <dt>{bankAccountLabel(account)}</dt>
                <dd>{formatCurrency((bankOpeningBalances.get(account.id) ?? 0) + (bankMovements.get(account.id) ?? 0))}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </section>

      <section className="section-grid">
        <div className="table-section">
          <h2>Bank position by bank account</h2>
          <DataTable
            columns={["Bank account", "Opening balance", "Selected net movement", "Opening plus selected movement"]}
            rows={data.bankAccounts.map((account) => {
              const openingBalance = bankOpeningBalances.get(account.id) ?? 0;
              const movement = bankMovements.get(account.id) ?? 0;
              return [
                bankAccountLabel(account),
                formatCurrency(openingBalance),
                formatCurrency(movement),
                formatCurrency(openingBalance + movement)
              ];
            })}
          />
        </div>

        <div className="table-section">
          <h2>Net bank movement by branch</h2>
          <DataTable
            columns={["Branch", "Net movement with branch tag"]}
            rows={data.branches.map((branch) => [branch.name, formatCurrency(branchMovements.get(branch.id) ?? 0)])}
          />
        </div>
      </section>

      <section className="table-section mt-section">
        <h2>Bank statement-style report</h2>
        <DataTable
          columns={["Date", "Bank account", "Source type", "Branch", "Card", "QR", "Bank transfer", "Cash bank-in", "Manual money in", "Money out", "Transfer in", "Transfer out", "Owner drawing", "Petty cash issued", "Petty cash returned", "Net movement", "Reference", "Notes"]}
          rows={statementRows.map((row) => [
            formatDate(row.date),
            row.bankAccount,
            row.sourceType,
            row.branch,
            formatCurrency(row.cardAmount),
            formatCurrency(row.qrAmount),
            formatCurrency(row.bankTransferAmount),
            formatCurrency(row.cashBankInAmount),
            formatCurrency(row.manualMoneyInAmount),
            formatCurrency(row.moneyOutAmount),
            formatCurrency(row.transferInAmount),
            formatCurrency(row.transferOutAmount),
            formatCurrency(row.ownerDrawingAmount),
            formatCurrency(row.pettyCashIssuedAmount),
            formatCurrency(row.pettyCashReturnedAmount),
            formatCurrency(row.netMovement),
            row.referenceNo,
            row.notes || "-"
          ])}
        />
      </section>

      <section className="table-section mt-section">
        <h2>Manual bank transactions</h2>
        <DataTable
          columns={["Date", "Bank account", "Type", "Direction", "Related bank", "Category", "Branch", "Amount", "Description", "Reference", "Documents", "Status", "View details", "Edit", "Void"]}
          rows={bankTransactionHistory.map((transaction) => {
            const branchPicOwnBranch = normalizeRole(profile.role) !== "branch_pic" || transaction.branch_id === profile.branch_id;
            const canCorrectTransaction = branchPicOwnBranch
              && !transaction.is_void
              && hasBankAccountPermission(profile, data.bankAccountPermissions, transaction.bank_account_id, "edit_transaction");

            return [
              formatDate(transaction.transaction_date),
              bankAccountLabel(transaction.bank_accounts ?? bankAccountById.get(transaction.bank_account_id)),
              transactionTypeLabel(transaction.transaction_type),
              transaction.direction === "in" ? "In" : "Out",
              bankAccountLabel(transaction.related_bank_account_id ? bankAccountById.get(transaction.related_bank_account_id) : null),
              categoryLabel(transaction.category),
              branchLabel(transaction.branches ?? (transaction.branch_id ? branchById.get(transaction.branch_id) : null)),
              formatCurrency(bankTransactionAmount(transaction)),
              transaction.description ?? "-",
              transaction.reference_no ?? "-",
              <DocumentManager
                canDelete={normalizeRole(profile.role) !== "branch_pic"}
                documents={bankTransactionDocuments.get(transaction.id) ?? []}
                entityId={transaction.id}
                entityName="bank_transactions"
                key={`${transaction.id}-documents`}
              />,
              <span className={`status-pill ${transaction.is_void ? "status-voided" : "status-paid"}`} key={`${transaction.id}-status`}>
                {transaction.is_void ? "VOIDED" : "Active"}
              </span>,
              <FinanceRecordDetails
                enteredBy={userDisplayLabel(userById.get(transaction.entered_by ?? ""), transaction.entered_by)}
                key={`${transaction.id}-details`}
                originalSummary={`Bank Transaction • ${bankAccountLabel(transaction.bank_accounts ?? bankAccountById.get(transaction.bank_account_id))} • ${branchLabel(transaction.branches ?? (transaction.branch_id ? branchById.get(transaction.branch_id) : null))} • ${formatDate(transaction.transaction_date)} • ${formatCurrency(bankTransactionAmount(transaction))}`}
                recordId={transaction.id}
                status={transaction.is_void ? "Voided" : "Active"}
                voidReason={transaction.void_reason}
                voidedAt={transaction.voided_at}
                voidedBy={userDisplayLabel(userById.get(transaction.voided_by ?? ""), transaction.voided_by)}
              />,
              canCorrectTransaction ? (
                <details className="manual-bank-editor" key={`${transaction.id}-edit`}>
                  <summary>Edit</summary>
                  <form action={updateBankTransaction} className="manual-bank-edit-form">
                    <input name="transaction_id" type="hidden" value={transaction.id} />
                    <label>
                      Date
                      <input name="transaction_date" type="date" defaultValue={transaction.transaction_date} required />
                    </label>
                    <label>
                      Amount
                      <input name="amount" min="0.01" step="0.01" type="number" defaultValue={transaction.amount} required />
                    </label>
                    {transaction.transaction_type === "money_out" ? (
                      <label>
                        Category
                        <select name="category" defaultValue={transaction.category ?? ""}>
                          <option value="">No category</option>
                          {bankMoneyOutCategories.map((category) => (
                            <option key={category.value} value={category.value}>
                              {category.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <label>
                      Branch
                      <select name="branch_id" defaultValue={transaction.branch_id ?? ""}>
                        <option value="">No branch</option>
                        {data.branches.map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {branch.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Reference
                      <input name="reference_no" defaultValue={transaction.reference_no ?? ""} />
                    </label>
                    <label>
                      Description
                      <textarea name="description" defaultValue={transaction.description ?? ""} />
                    </label>
                    <button className="primary-button compact-button" type="submit">
                      Save
                    </button>
                  </form>
                </details>
              ) : (
                "-"
              ),
              canCorrectTransaction ? (
                <details className="manual-bank-editor" key={`${transaction.id}-void`}>
                  <summary>Void</summary>
                  <form action={voidBankTransaction} className="manual-bank-edit-form void-record-form">
                    <input name="transaction_id" type="hidden" value={transaction.id} />
                    <p className="void-warning">Voided records stay in history and are excluded from reports.</p>
                    <label>
                      Void reason
                      <textarea name="void_reason" required />
                    </label>
                    <button className="primary-button compact-button" type="submit">
                      Confirm void
                    </button>
                  </form>
                </details>
              ) : (
                "-"
              )
            ];
          })}
        />
      </section>

      <section className="section-grid">
        <div className="table-section">
          <h2>Branch bank mapping</h2>
          <DataTable
            columns={["Branch", "Default direct inflow bank"]}
            rows={data.branchBankMappings.map((mapping) => [
              branchLabel(mapping.branches ?? branchById.get(mapping.branch_id)),
              bankAccountLabel(mapping.bank_accounts ?? bankAccountById.get(mapping.bank_account_id))
            ])}
          />
        </div>

        {canManageBankAccounts ? (
          <form action={createBankAccount} className="form-card">
            <h2>Add bank account</h2>
            <label>
              Account name
              <input name="name" placeholder="Example: CIMB Inanam" required />
            </label>
            <label>
              Bank name
              <input name="bank_name" placeholder="Example: CIMB" />
            </label>
            <label>
              Account number
              <input name="account_no" />
            </label>
            <button className="primary-button" type="submit">
              Add account
            </button>
          </form>
        ) : null}
      </section>

      {canManageBankAccounts ? (
        <section className="section-grid mt-section">
          <form action={upsertBankAccountPermission} className="form-card">
            <h2>Bank access management</h2>
            <label>
              User
              <select name="user_id" required>
                {bankAccessUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name} ({user.role})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Bank account
              <select name="bank_account_id" required>
                {bankAccessAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {bankAccountLabel(account)}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="permission-checklist">
              <legend>Access level</legend>
              <label>
                <input name="can_view" type="checkbox" value="true" defaultChecked />
                View
              </label>
              <label>
                <input name="can_create_transaction" type="checkbox" value="true" />
                Create transactions
              </label>
              <label>
                <input name="can_edit_transaction" type="checkbox" value="true" />
                Edit transactions
              </label>
              <label>
                <input name="can_manage_account" type="checkbox" value="true" />
                Manage account
              </label>
            </fieldset>
            <button className="primary-button" disabled={!bankAccessUsers.length || !bankAccessAccounts.length} type="submit">
              Grant or update access
            </button>
          </form>

          <div className="table-section">
            <h2>Current bank access</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Bank account</th>
                    <th>Permissions</th>
                    <th>Revoke</th>
                  </tr>
                </thead>
                <tbody>
                  {bankAccessPermissions.length ? (
                    bankAccessPermissions.map((permission) => (
                      <tr key={permission.id}>
                        <td>{accessUserById.get(permission.user_id)?.full_name ?? permission.user_id}</td>
                        <td>{bankAccountLabel(accessAccountById.get(permission.bank_account_id))}</td>
                        <td>{permissionSummary(permission)}</td>
                        <td>
                          <form action={revokeBankAccountPermission}>
                            <input name="permission_id" type="hidden" value={permission.id} />
                            <button className="ghost-button compact-button" type="submit">
                              Revoke
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4}>No bank account permissions have been granted yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
