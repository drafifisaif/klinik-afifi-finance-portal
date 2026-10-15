import { upsertMonthlyOpeningBalance } from "@/app/actions";
import { ModuleHeader } from "@/components/module-header";
import { bankInAmount, buildCashInHandRows, buildPettyCashBalanceRows, isActiveFinancialRecord, type DateRange } from "@/lib/bank-reporting";
import { getDashboardOperationalCashData } from "@/lib/data";
import { formatCurrency, formatDate, labelize } from "@/lib/format";
import {
  addMonths,
  getOpeningBalanceSetupReferences,
  monthlyRowForBranch,
  monthlyOpeningBalanceStartMonth
} from "@/lib/opening-balances";
import { requirePermission } from "@/lib/permissions";
import { getCurrentProfile, normalizeRole } from "@/lib/permissions";
import type { Branch, MonthlyOpeningBalance } from "@/lib/types";

type OpeningBalancesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const monthlyOpeningSources = [
  { label: "Legacy system", value: "legacy_system" },
  { label: "Manual verified", value: "manual_verified" },
  { label: "Carry-forward", value: "carry_forward" },
  { label: "Adjustment", value: "adjustment" }
];

const monthlyOpeningReviewStatuses = [
  { label: "Pending Review", value: "pending_review" },
  { label: "Reviewed", value: "reviewed" },
  { label: "Reconciled", value: "reconciled" },
  { label: "Needs Investigation", value: "needs_investigation" }
];

function searchValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function monthEnd(balanceMonth: string) {
  const nextMonth = new Date(`${addMonths(balanceMonth, 1)}T00:00:00Z`);
  nextMonth.setUTCDate(nextMonth.getUTCDate() - 1);
  return nextMonth.toISOString().slice(0, 10);
}

function yearMonths(year: number) {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}-01`);
}

function varianceText(value: number) {
  if (Math.abs(value) < 0.005) return formatCurrency(0);
  return `${value > 0 ? "+" : ""}${formatCurrency(value)}`;
}

function MonthlyOpeningEdit({
  balance,
  branches
}: {
  balance: MonthlyOpeningBalance;
  branches: Branch[];
}) {
  return (
    <details className="manual-bank-editor">
      <summary>Edit / Review</summary>
      <form action={upsertMonthlyOpeningBalance} className="manual-bank-edit-form">
        <label>
          Branch
          <select name="branch_id" defaultValue={balance.branch_id} required>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Balance month
          <input min="2026-01" name="balance_month" type="month" defaultValue={balance.balance_month.slice(0, 7)} required />
        </label>
        <label>
          Opening cash
          <input min="0" name="opening_cash" step="0.01" type="number" defaultValue={balance.opening_cash} required />
        </label>
        <label>
          Opening petty cash
          <input min="0" name="opening_petty_cash" step="0.01" type="number" defaultValue={balance.opening_petty_cash} required />
        </label>
        <label>
          Source
          <select name="source" defaultValue={balance.source ?? "manual_verified"}>
            {monthlyOpeningSources.map((source) => (
              <option key={source.value} value={source.value}>
                {source.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Review status
          <select name="review_status" defaultValue={balance.review_status ?? "pending_review"}>
            {monthlyOpeningReviewStatuses.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Notes
          <textarea name="notes" defaultValue={balance.notes ?? ""} />
        </label>
        <button className="primary-button compact-button" type="submit">
          Save
        </button>
      </form>
    </details>
  );
}

export default async function OpeningBalancesPage({ searchParams }: OpeningBalancesPageProps) {
  await requirePermission("view_bank_position");
  const profile = await getCurrentProfile();
  const role = normalizeRole(profile?.role);
  const canManageOpeningBalances = role === "owner" || role === "finance";
  const params = await searchParams;
  const requestedYear = Number(searchValue(params?.year) ?? 2026);
  const selectedYear = Number.isFinite(requestedYear) && requestedYear >= 2026 ? requestedYear : 2026;
  const reportEndDate = `${selectedYear}-12-31`;
  const [references, operationalCashData] = await Promise.all([
    getOpeningBalanceSetupReferences(),
    getDashboardOperationalCashData({ startDate: monthlyOpeningBalanceStartMonth, endDate: reportEndDate })
  ]);
  const selectedBranchId = searchValue(params?.branch) ?? "all";
  const selectedBranches = selectedBranchId === "all"
    ? references.branches
    : references.branches.filter((branch) => branch.id === selectedBranchId);
  console.info("[opening-balances] reconciliation source rows", {
    branchCount: selectedBranches.length,
    cashBankInRows: operationalCashData.cashBankIns.length,
    cashLocumExpenseRows: operationalCashData.expenses.length,
    dailySalesRows: operationalCashData.sales.length,
    monthlyOpeningRows: operationalCashData.monthlyOpeningBalances.length,
    selectedBranchId,
    selectedYear
  });
  const selectedBranchIds = new Set(selectedBranches.map((branch) => branch.id));
  const unassignedCashMonthBankIns = operationalCashData.cashBankIns.filter((bankIn) => {
    return isActiveFinancialRecord(bankIn) && !bankIn.cash_month && selectedBranchIds.has(bankIn.branch_id);
  });
  const unassignedCashMonthTotal = unassignedCashMonthBankIns.reduce((sum, bankIn) => sum + bankInAmount(bankIn), 0);
  const unassignedHrefParams = new URLSearchParams({
    cash_month_status: "unassigned",
    ...(selectedBranchId !== "all" ? { branch: selectedBranchId } : { branch: "all" })
  });
  const reconciliationRows = selectedBranches.flatMap((branch) => {
    return yearMonths(selectedYear)
      .filter((balanceMonth) => balanceMonth >= "2026-01-01")
      .map((balanceMonth) => {
        const range: DateRange = {
          endDate: monthEnd(balanceMonth),
          label: "Monthly reconciliation",
          period: "custom",
          startDate: balanceMonth
        };
        const historical = monthlyRowForBranch(references.monthlyBalances, branch.id, balanceMonth);
        const nextHistorical = monthlyRowForBranch(references.monthlyBalances, branch.id, addMonths(balanceMonth, 1));
        const cashRow = buildCashInHandRows({
          branches: [branch],
          cashBankIns: operationalCashData.cashBankIns,
          expenses: operationalCashData.expenses,
          monthlyOpeningBalances: operationalCashData.monthlyOpeningBalances,
          openingBalances: operationalCashData.openingBalances,
          sales: operationalCashData.sales
        }, range)[0];
        const pettyRow = buildPettyCashBalanceRows({
          branches: [branch],
          monthlyOpeningBalances: operationalCashData.monthlyOpeningBalances,
          openingBalances: operationalCashData.openingBalances,
          pettyCashTransactions: operationalCashData.pettyCashTransactions
        }, range)[0];
        const historicalCash = Number(historical?.opening_cash ?? 0);
        const historicalPetty = Number(historical?.opening_petty_cash ?? 0);
        return {
          balanceMonth,
          branch,
          cashBankIn: cashRow?.bankedIn ?? 0,
          cashLocum: cashRow?.cashLocumPayments ?? 0,
          cashSales: cashRow?.cashSales ?? 0,
          cashVariance: historical ? historicalCash - (cashRow?.openingBalance ?? 0) : null,
          historical,
          historicalCash,
          historicalPetty,
          nextCashVariance: nextHistorical ? Number(nextHistorical.opening_cash ?? 0) - (cashRow?.remaining ?? 0) : null,
          nextHistorical,
          pettyVariance: historical ? historicalPetty - (pettyRow?.openingBalance ?? 0) : null,
          systemClosingCash: cashRow?.remaining ?? 0,
          systemOpeningCash: cashRow?.openingBalance ?? 0,
          systemOpeningPetty: pettyRow?.openingBalance ?? 0
        };
      });
  });

  return (
    <>
      <ModuleHeader
        eyebrow="Owner setup"
        title="Opening Balances"
        description="Set the starting finance position before real 2026 portal records begin."
      />

      <section className="table-section">
        <div className="section-heading-row">
          <div>
            <h2>Monthly historical reconciliation</h2>
            <p className="muted-copy">
              January 2026 is the first historical month. January historical opening seeds system cash; later historical openings stay separate so Finance can compare legacy figures against portal carry-forward.
            </p>
          </div>
        </div>

        {references.monthlyBalancesConfigError ? (
          <p className="import-message opening-balance-warning">
            Opening Balance configuration is incomplete. Run <code>supabase/2026-01-01-monthly-opening-reconciliation.sql</code> in Supabase SQL Editor, then refresh this page.
          </p>
        ) : null}

        {unassignedCashMonthBankIns.length ? (
          <p className="import-message opening-balance-warning">
            Unassigned Cash Bank-Ins: {unassignedCashMonthBankIns.length} active records · {formatCurrency(unassignedCashMonthTotal)} are excluded from monthly reconciliation totals until Finance assigns Cash Month.{" "}
            <a href={`/cash-bank-ins?${unassignedHrefParams.toString()}`}>Review unassigned records</a>
          </p>
        ) : null}

        {canManageOpeningBalances ? (
          <form action={upsertMonthlyOpeningBalance} className="form-card mt-section">
            <h3>Enter historical opening balance</h3>
            <div className="form-grid">
              <label>
                Branch
                <select name="branch_id" required>
                  {references.branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Balance month
                <input min="2026-01" name="balance_month" type="month" defaultValue="2026-01" required />
              </label>
              <label>
                Opening cash
                <input min="0" name="opening_cash" step="0.01" type="number" required />
              </label>
              <label>
                Opening petty cash
                <input min="0" name="opening_petty_cash" step="0.01" type="number" required />
              </label>
              <label>
                Source
                <select name="source" defaultValue="legacy_system">
                  {monthlyOpeningSources.map((source) => (
                    <option key={source.value} value={source.value}>
                      {source.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Review status
                <select name="review_status" defaultValue="pending_review">
                  {monthlyOpeningReviewStatuses.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="full-span">
                Notes
                <textarea name="notes" placeholder="Opening balance from legacy finance system" />
              </label>
            </div>
            <button className="primary-button" type="submit">
              Save historical opening
            </button>
          </form>
        ) : (
          <p className="import-message mt-section">
            Opening balances are view-only for your role. Owner or Finance will maintain the controlled monthly starting balances.
          </p>
        )}

        <form className="filter-form mt-section">
          <label>
            Year
            <select name="year" defaultValue={String(selectedYear)}>
              {[2026, 2027, 2028].map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label>
            Branch
            <select name="branch" defaultValue={selectedBranchId}>
              <option value="all">All Branches</option>
              {references.branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button compact-button" type="submit">
            Apply
          </button>
        </form>

        <div className="opening-reconciliation-list">
          {reconciliationRows.map((row) => (
            <article className="opening-reconciliation-item" key={`${row.branch.id}-${row.balanceMonth}`}>
              <header className="opening-reconciliation-header">
                <div>
                  <p className="opening-reconciliation-month">{formatDate(row.balanceMonth)}</p>
                  <h3>{row.branch.name}</h3>
                </div>
                <div className="opening-reconciliation-primary">
                  <span>System closing cash</span>
                  <strong>{formatCurrency(row.systemClosingCash)}</strong>
                </div>
                <div className="opening-reconciliation-primary">
                  <span>Opening variance</span>
                  <strong>{row.cashVariance === null ? "-" : varianceText(row.cashVariance)}</strong>
                </div>
                <div className="opening-reconciliation-actions">
                  <span className={`status-pill ${!row.historical ? "status-unpaid" : ["reviewed", "reconciled"].includes(row.historical.review_status ?? (row.historical.reviewed_at ? "reviewed" : "pending_review")) ? "status-paid" : "status-partial"}`}>
                    {row.historical ? labelize(row.historical.review_status ?? (row.historical.reviewed_at ? "reviewed" : "pending_review")) : "No historical balance"}
                  </span>
                  {canManageOpeningBalances && row.historical
                    ? <MonthlyOpeningEdit balance={row.historical} branches={references.branches} key={`${row.historical.id}-monthly-edit`} />
                    : null}
                </div>
              </header>
              <details className="opening-reconciliation-details">
                <summary>View full reconciliation</summary>
                <dl>
                  <div><dt>Historical opening cash</dt><dd>{row.historical ? formatCurrency(row.historicalCash) : "-"}</dd></div>
                  <div><dt>System carry-forward opening</dt><dd>{formatCurrency(row.systemOpeningCash)}</dd></div>
                  <div><dt>Cash sales</dt><dd>{formatCurrency(row.cashSales)}</dd></div>
                  <div><dt>Cash bank-in</dt><dd>{formatCurrency(row.cashBankIn)}</dd></div>
                  <div><dt>Cash locum</dt><dd>{formatCurrency(row.cashLocum)}</dd></div>
                  <div><dt>Next historical opening</dt><dd>{row.nextHistorical ? formatCurrency(row.nextHistorical.opening_cash) : "-"}</dd></div>
                  <div><dt>Carry-forward variance</dt><dd>{row.nextCashVariance === null ? "-" : varianceText(row.nextCashVariance)}</dd></div>
                  <div><dt>Historical opening petty cash</dt><dd>{row.historical ? formatCurrency(row.historicalPetty) : "-"}</dd></div>
                  <div><dt>System petty cash opening</dt><dd>{formatCurrency(row.systemOpeningPetty)}</dd></div>
                  <div><dt>Source</dt><dd>{row.historical ? labelize(row.historical.source ?? "manual_verified") : "-"}</dd></div>
                  <div className="opening-reconciliation-note"><dt>Notes</dt><dd>{row.historical?.notes || "-"}</dd></div>
                </dl>
              </details>
            </article>
          ))}
        </div>
      </section>

    </>
  );
}
