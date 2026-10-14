import { NextResponse } from "next/server";
import { buildCashInHandRows, buildPettyCashBalanceRows, type DateRange } from "@/lib/bank-reporting";
import { monthlyOpeningBalanceStartMonth } from "@/lib/opening-balances";
import { createAdminClient } from "@/lib/supabase-admin";
import { authenticateFinanceApiRequest, isFinanceApiUuid } from "@/lib/finance-api-auth";
import type { Branch, CashBankIn, DailySale, Expense, MonthlyOpeningBalance, OpeningBalance, PettyCashTransaction } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 1000;
const MAX_ROWS_PER_QUERY = 50000;
const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

type QueryError = { code?: string | null; message: string };
type PageResult<T> = { data: T[] | null; error: QueryError | null };
type QueryPage<T> = (from: number, to: number) => PromiseLike<PageResult<T>>;

type ApiBranch = Pick<Branch, "id" | "name" | "code">;
type PanelPaymentRow = {
  panel_claim_id: string;
  payment_date: string;
  amount: number;
  is_void?: boolean | null;
  panel_claims?: { branch_id: string } | { branch_id: string }[] | null;
};
type SupplierPurchaseRow = {
  branch_id: string;
  purchase_date: string;
  total_amount: number;
  is_void?: boolean | null;
};
type SupplierPaymentRow = {
  branch_id: string;
  payment_date: string;
  amount: number;
  is_void?: boolean | null;
};
type PanelClaimRow = {
  id: string;
  branch_id: string;
  claim_month: string;
  amount: number;
  is_void?: boolean | null;
};
type DailySalesUpdater = { id: string; full_name: string | null };
type CashBankInRow = Pick<CashBankIn, "branch_id" | "bank_in_date" | "cash_month" | "amount" | "is_void">;
type OpeningBalanceRow = Pick<OpeningBalance, "branch_id" | "balance_date" | "balance_type" | "amount">;
type MonthlyOpeningRow = Pick<MonthlyOpeningBalance, "branch_id" | "balance_month" | "opening_cash" | "opening_petty_cash">;

class FinanceApiQueryError extends Error {
  constructor(readonly table: string, readonly code: string | null, message: string) {
    super(message);
  }
}

async function fetchAllRows<T>(table: string, queryPage: QueryPage<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset <= MAX_ROWS_PER_QUERY; offset += PAGE_SIZE) {
    const { data, error } = await queryPage(offset, offset + PAGE_SIZE - 1);
    if (error) throw new FinanceApiQueryError(table, error.code ?? null, error.message);
    const page = data ?? [];
    if (offset === MAX_ROWS_PER_QUERY && page.length > 0) {
      throw new FinanceApiQueryError(table, null, "Result exceeded the API row safety limit.");
    }
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }

  throw new FinanceApiQueryError(table, null, "Result exceeded the API row safety limit.");
}

function isIsoDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function amount(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function inRange(date: string | null | undefined, startDate: string, endDate: string) {
  return Boolean(date && date >= startDate && date <= endDate);
}

function active(row: { is_void?: boolean | null }) {
  return row.is_void !== true;
}

function total<T>(rows: T[], getAmount: (row: T) => number) {
  return roundMoney(rows.reduce((sum, row) => sum + getAmount(row), 0));
}

function asRecordBranch(branch: PanelPaymentRow["panel_claims"]) {
  return Array.isArray(branch) ? branch[0]?.branch_id ?? null : branch?.branch_id ?? null;
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

export async function GET(request: Request) {
  const auth = authenticateFinanceApiRequest(request);
  if (auth.error === "not_configured" || auth.error === "invalid_config") {
    return json({ error: "Finance API is not configured." }, 503);
  }
  if (!auth.key) return json({ error: "A valid Finance API bearer token is required." }, 401);

  const url = new URL(request.url);
  const startDate = url.searchParams.get("start_date");
  const endDate = url.searchParams.get("end_date");
  const requestedBranchId = url.searchParams.get("branch_id");
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || endDate! < startDate!) {
    return json({ error: "Provide valid start_date and end_date values in YYYY-MM-DD format." }, 400);
  }
  const requestedDays = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / (24 * 60 * 60 * 1000) + 1;
  if (requestedDays > 366) {
    return json({ error: "The requested date range cannot exceed 366 days." }, 400);
  }

  const allBranchAccess = auth.key.branch_ids.includes("*");
  if (requestedBranchId && !isFinanceApiUuid(requestedBranchId)) {
    return json({ error: "branch_id must be a valid branch UUID." }, 400);
  }
  if (requestedBranchId && !allBranchAccess && !auth.key.branch_ids.includes(requestedBranchId)) {
    return json({ error: "This API key is not authorized for the requested branch." }, 403);
  }

  try {
    const supabase = createAdminClient();
    let branchQuery = supabase.from("branches").select("id, name, code, is_active").eq("is_active", true).order("name");
    if (requestedBranchId) branchQuery = branchQuery.eq("id", requestedBranchId);
    else if (!allBranchAccess) branchQuery = branchQuery.in("id", auth.key.branch_ids);

    const { data: branchRows, error: branchError } = await branchQuery;
    if (branchError) throw new FinanceApiQueryError("branches", branchError.code ?? null, branchError.message);
    const branches = (branchRows ?? []) as ApiBranch[];
    if (requestedBranchId && branches.length === 0) return json({ error: "Branch not found." }, 404);
    const branchIds = branches.map((branch) => branch.id);
    if (branchIds.length === 0) {
      return json({ api_version: "v1", period: { start_date: startDate, end_date: endDate }, branches: [], totals: {} });
    }

    const cashHistoryStart = startDate! < monthlyOpeningBalanceStartMonth ? startDate! : monthlyOpeningBalanceStartMonth;
    const [salesRows, expenseRows, purchaseRows, supplierPaymentRows, claimRows, cashBankHistoryRows, cashBankMovementRows,
      unassignedCashBankRows, openingBalanceRows, monthlyOpeningRows, pettyCashRows] = await Promise.all([
      fetchAllRows<DailySale>("daily_sales", (from, to) => supabase.from("daily_sales")
        .select("id, branch_id, sale_date, cash_amount, bank_transfer_amount, card_amount, panel_amount, qr_amount, total_amount, is_void, entered_by, created_at, updated_at")
        .in("branch_id", branchIds).gte("sale_date", cashHistoryStart).lte("sale_date", endDate!).or("is_void.is.null,is_void.eq.false").range(from, to)),
      fetchAllRows<Expense>("expenses", (from, to) => supabase.from("expenses")
        .select("id, branch_id, expense_date, category, description, payment_type, amount, is_void")
        .in("branch_id", branchIds).gte("expense_date", cashHistoryStart).lte("expense_date", endDate!).or("is_void.is.null,is_void.eq.false").range(from, to)),
      fetchAllRows<SupplierPurchaseRow>("supplier_purchase_entries", (from, to) => supabase.from("supplier_purchase_entries")
        .select("id, branch_id, purchase_date, total_amount, is_void")
        .in("branch_id", branchIds).gte("purchase_date", startDate!).lte("purchase_date", endDate!).or("is_void.is.null,is_void.eq.false").range(from, to)),
      fetchAllRows<SupplierPaymentRow>("supplier_payment_entries", (from, to) => supabase.from("supplier_payment_entries")
        .select("id, branch_id, payment_date, amount, is_void")
        .in("branch_id", branchIds).gte("payment_date", startDate!).lte("payment_date", endDate!).or("is_void.is.null,is_void.eq.false").range(from, to)),
      fetchAllRows<PanelClaimRow>("panel_claims", (from, to) => supabase.from("panel_claims")
        .select("id, branch_id, claim_month, amount, is_void")
        .in("branch_id", branchIds).lte("claim_month", endDate!).or("is_void.is.null,is_void.eq.false").range(from, to)),
      fetchAllRows<CashBankInRow>("cash_bank_ins.cash_month", (from, to) => supabase.from("cash_bank_ins")
        .select("branch_id, bank_in_date, cash_month, amount, is_void")
        .in("branch_id", branchIds).gte("cash_month", cashHistoryStart).lte("cash_month", endDate!).or("is_void.is.null,is_void.eq.false").range(from, to)),
      fetchAllRows<CashBankInRow>("cash_bank_ins.bank_in_date", (from, to) => supabase.from("cash_bank_ins")
        .select("branch_id, bank_in_date, cash_month, amount, is_void")
        .in("branch_id", branchIds).gte("bank_in_date", startDate!).lte("bank_in_date", endDate!).or("is_void.is.null,is_void.eq.false").range(from, to)),
      fetchAllRows<Pick<CashBankIn, "branch_id" | "amount" | "is_void">>("cash_bank_ins.unassigned_cash_month", (from, to) => supabase.from("cash_bank_ins")
        .select("branch_id, amount, is_void")
        .in("branch_id", branchIds).is("cash_month", null).or("is_void.is.null,is_void.eq.false").range(from, to)),
      fetchAllRows<OpeningBalanceRow>("opening_balances", (from, to) => supabase.from("opening_balances")
        .select("branch_id, balance_date, balance_type, amount")
        .in("branch_id", branchIds).in("balance_type", ["cash_in_hand", "petty_cash"]).lte("balance_date", endDate!).range(from, to)),
      fetchAllRows<MonthlyOpeningRow>("monthly_opening_balances", (from, to) => supabase.from("monthly_opening_balances")
        .select("branch_id, balance_month, opening_cash, opening_petty_cash")
        .in("branch_id", branchIds).lte("balance_month", endDate!).range(from, to)),
      fetchAllRows<PettyCashTransaction>("petty_cash_transactions", (from, to) => supabase.from("petty_cash_transactions")
        .select("id, branch_id, bank_account_id, transaction_date, transaction_type, direction, amount, is_void")
        .in("branch_id", branchIds).gte("transaction_date", cashHistoryStart).lte("transaction_date", endDate!).or("is_void.is.null,is_void.eq.false").range(from, to))
    ]);

    const claims = claimRows.filter(active);
    const updaterIds = [...new Set(salesRows
      .filter((sale) => active(sale) && inRange(sale.sale_date, startDate!, endDate!) && sale.entered_by)
      .map((sale) => sale.entered_by as string))];
    const updaterLookup = updaterIds.length > 0
      ? await supabase.from("profiles").select("id, full_name").in("id", updaterIds)
      : { data: [], error: null };
    if (updaterLookup.error) {
      console.warn("[finance-api] Daily Sales updater names could not be loaded.", {
        code: updaterLookup.error.code,
        message: updaterLookup.error.message
      });
    }
    const updaterRows = (updaterLookup.data ?? []) as DailySalesUpdater[];
    const updaterNames = new Map(updaterRows.map((profile) => [profile.id, profile.full_name]));
    const paymentRows = await fetchAllRows<PanelPaymentRow>("panel_payments", (from, to) => supabase.from("panel_payments")
      .select("panel_claim_id, payment_date, amount, is_void, panel_claims!inner(branch_id)")
      .in("panel_claims.branch_id", branchIds).lte("payment_date", endDate!).or("is_void.is.null,is_void.eq.false").range(from, to));

    const reportRange: DateRange = { startDate: startDate!, endDate: endDate!, label: "API custom range", period: "custom" };
    const cashInHandRows = buildCashInHandRows({
      branches: branches as Branch[],
      cashBankIns: cashBankHistoryRows.filter(active) as CashBankIn[],
      expenses: expenseRows.filter(active),
      monthlyOpeningBalances: monthlyOpeningRows as MonthlyOpeningBalance[],
      openingBalances: openingBalanceRows as OpeningBalance[],
      sales: salesRows.filter(active)
    }, reportRange);
    const pettyCashBalanceRows = buildPettyCashBalanceRows({
      branches: branches as Branch[],
      monthlyOpeningBalances: monthlyOpeningRows as MonthlyOpeningBalance[],
      openingBalances: openingBalanceRows as OpeningBalance[],
      pettyCashTransactions: pettyCashRows.filter(active)
    }, reportRange);

    const paidByClaimId = new Map<string, number>();
    for (const payment of paymentRows.filter(active)) {
      paidByClaimId.set(payment.panel_claim_id, (paidByClaimId.get(payment.panel_claim_id) ?? 0) + amount(payment.amount));
    }

    const summaries = branches.map((branch) => {
      const branchSales = salesRows.filter((sale) => sale.branch_id === branch.id && active(sale) && inRange(sale.sale_date, startDate!, endDate!));
      const latestSaleUpdate = branchSales.reduce<DailySale | null>((latest, sale) => {
        const savedAt = sale.updated_at ?? sale.created_at ?? `${sale.sale_date}T00:00:00.000Z`;
        const latestSavedAt = latest?.updated_at ?? latest?.created_at ?? (latest ? `${latest.sale_date}T00:00:00.000Z` : "");
        return !latest || savedAt > latestSavedAt ? sale : latest;
      }, null);
      const branchExpenses = expenseRows.filter((expense) => expense.branch_id === branch.id && active(expense) && inRange(expense.expense_date, startDate!, endDate!));
      const categoryTotals: Record<string, number> = {};
      for (const expense of branchExpenses) {
        const category = String(expense.category ?? "uncategorized");
        categoryTotals[category] = (categoryTotals[category] ?? 0) + amount(expense.amount);
      }

      const branchClaims = claims.filter((claim) => claim.branch_id === branch.id);
      const claimsIssued = branchClaims.filter((claim) => inRange(claim.claim_month, startDate!, endDate!));
      const branchPayments = paymentRows.filter((payment) => asRecordBranch(payment.panel_claims) === branch.id && active(payment));
      const cashBankInsByCashMonth = cashBankHistoryRows.filter((row) => row.branch_id === branch.id && active(row) && inRange(row.cash_month, startDate!, endDate!));
      const cashBankInsByBankDate = cashBankMovementRows.filter((row) => row.branch_id === branch.id && active(row) && inRange(row.bank_in_date, startDate!, endDate!));
      const cashRow = cashInHandRows.find((row) => row.branch.id === branch.id);
      const pettyCashRow = pettyCashBalanceRows.find((row) => row.branch.id === branch.id);
      const outstanding = branchClaims.reduce((sum, claim) => sum + Math.max(0, amount(claim.amount) - (paidByClaimId.get(claim.id) ?? 0)), 0);

      return {
        branch_id: branch.id,
        branch_name: branch.name,
        daily_sales_update: latestSaleUpdate ? {
          status: "has_record",
          last_sale_date: latestSaleUpdate.sale_date,
          last_updated_at: latestSaleUpdate.updated_at ?? latestSaleUpdate.created_at ?? null,
          updated_by: latestSaleUpdate.entered_by ? updaterNames.get(latestSaleUpdate.entered_by) ?? null : null
        } : {
          status: "no_record_in_period",
          last_sale_date: null,
          last_updated_at: null,
          updated_by: null
        },
        sales: {
          cash: total(branchSales, (row) => amount(row.cash_amount)),
          bank_transfer: total(branchSales, (row) => amount(row.bank_transfer_amount)),
          card: total(branchSales, (row) => amount(row.card_amount)),
          panel_recorded_in_daily_sales: total(branchSales, (row) => amount(row.panel_amount)),
          qr: total(branchSales, (row) => amount(row.qr_amount)),
          total: total(branchSales, (row) => amount(row.total_amount)),
          direct_sales_excluding_panel: total(branchSales, (row) => amount(row.cash_amount) + amount(row.bank_transfer_amount) + amount(row.card_amount) + amount(row.qr_amount))
        },
        expenses: {
          total: total(branchExpenses, (row) => amount(row.amount)),
          by_category: Object.fromEntries(Object.entries(categoryTotals).map(([category, value]) => [category, roundMoney(value)])),
          cash_paid_locum_doctor: total(branchExpenses.filter((row) => String(row.category).trim().toLowerCase() === "locum_doctor" && String(row.payment_type).trim().toLowerCase() === "cash"), (row) => amount(row.amount))
        },
        supplier: {
          purchases: total(purchaseRows.filter((row) => row.branch_id === branch.id && active(row)), (row) => amount(row.total_amount)),
          payments: total(supplierPaymentRows.filter((row) => row.branch_id === branch.id && active(row)), (row) => amount(row.amount))
        },
        panel: {
          claims_issued: total(claimsIssued, (row) => amount(row.amount)),
          payments_received: total(branchPayments.filter((row) => inRange(row.payment_date, startDate!, endDate!)), (row) => amount(row.amount)),
          claims_outstanding_as_of_end_date: roundMoney(outstanding)
        },
        cash_bank_ins: {
          cash_month_attributed: total(cashBankInsByCashMonth, (row) => amount(row.amount)),
          bank_movement_by_bank_in_date: total(cashBankInsByBankDate, (row) => amount(row.amount)),
          unassigned_cash_month_count: unassignedCashBankRows.filter((row) => row.branch_id === branch.id && active(row)).length,
          unassigned_cash_month_amount: total(unassignedCashBankRows.filter((row) => row.branch_id === branch.id && active(row)), (row) => amount(row.amount))
        },
        cash_position: {
          opening_cash_for_period: roundMoney(cashRow?.openingBalance ?? 0),
          cash_sales: roundMoney(cashRow?.cashSales ?? 0),
          banked_in_by_cash_month: roundMoney(cashRow?.bankedIn ?? 0),
          cash_locum_payments: roundMoney(cashRow?.cashLocumPayments ?? 0),
          closing_cash_estimate: roundMoney(cashRow?.remaining ?? 0)
        },
        petty_cash: {
          opening_balance_for_period: roundMoney(pettyCashRow?.openingBalance ?? 0),
          issued: roundMoney(pettyCashRow?.issued ?? 0),
          spent: roundMoney(pettyCashRow?.spent ?? 0),
          returned: roundMoney(pettyCashRow?.returned ?? 0),
          adjustments: roundMoney(pettyCashRow?.adjustments ?? 0),
          closing_balance_estimate: roundMoney(pettyCashRow?.balance ?? 0)
        }
      };
    });

    const sumPath = (path: string[]) => roundMoney(summaries.reduce((sum, branch) => {
      let value: unknown = branch;
      for (const part of path) value = value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined;
      return sum + (typeof value === "number" ? value : 0);
    }, 0));
    const categoryTotals: Record<string, number> = {};
    for (const branch of summaries) {
      for (const [category, value] of Object.entries(branch.expenses.by_category)) {
        categoryTotals[category] = (categoryTotals[category] ?? 0) + value;
      }
    }

    return json({
      api_version: "v1",
      generated_at: new Date().toISOString(),
      period: { start_date: startDate, end_date: endDate, date_range_inclusive: true },
      scope: { api_key_id: auth.key.id, branch_ids: branchIds, branch_count: branchIds.length },
      accounting_notes: {
        cash_bank_ins: "cash_month_attributed follows the cash period; bank_movement_by_bank_in_date follows the actual deposit date.",
        unassigned_cash_month: "The unassigned count and amount cover all active records with no cash_month, independent of the requested date range.",
        panel_payments: "Reported separately as bank inflow and not added again to income.",
        sales: "direct_sales_excluding_panel excludes panel_amount; panel claims issued are reported separately.",
        cash_position: "Closing cash estimate = opening cash + active cash sales - active cash bank-ins attributed by cash_month - active cash-paid locum expenses.",
        panel_outstanding: "Active linked claims less active linked payments through end_date; legacy opening-balance adjustments are not included."
      },
      branches: summaries,
      totals: {
        sales: {
          cash: sumPath(["sales", "cash"]),
          bank_transfer: sumPath(["sales", "bank_transfer"]),
          card: sumPath(["sales", "card"]),
          panel_recorded_in_daily_sales: sumPath(["sales", "panel_recorded_in_daily_sales"]),
          qr: sumPath(["sales", "qr"]),
          total: sumPath(["sales", "total"]),
          direct_sales_excluding_panel: sumPath(["sales", "direct_sales_excluding_panel"])
        },
        expenses: { total: sumPath(["expenses", "total"]), by_category: Object.fromEntries(Object.entries(categoryTotals).map(([category, value]) => [category, roundMoney(value)])), cash_paid_locum_doctor: sumPath(["expenses", "cash_paid_locum_doctor"]) },
        supplier: { purchases: sumPath(["supplier", "purchases"]), payments: sumPath(["supplier", "payments"]) },
        panel: { claims_issued: sumPath(["panel", "claims_issued"]), payments_received: sumPath(["panel", "payments_received"]), claims_outstanding_as_of_end_date: sumPath(["panel", "claims_outstanding_as_of_end_date"]) },
        cash_bank_ins: {
          cash_month_attributed: sumPath(["cash_bank_ins", "cash_month_attributed"]),
          bank_movement_by_bank_in_date: sumPath(["cash_bank_ins", "bank_movement_by_bank_in_date"]),
          unassigned_cash_month_count: sumPath(["cash_bank_ins", "unassigned_cash_month_count"]),
          unassigned_cash_month_amount: sumPath(["cash_bank_ins", "unassigned_cash_month_amount"])
        },
        cash_position: {
          opening_cash_for_period: sumPath(["cash_position", "opening_cash_for_period"]),
          cash_sales: sumPath(["cash_position", "cash_sales"]),
          banked_in_by_cash_month: sumPath(["cash_position", "banked_in_by_cash_month"]),
          cash_locum_payments: sumPath(["cash_position", "cash_locum_payments"]),
          closing_cash_estimate: sumPath(["cash_position", "closing_cash_estimate"])
        },
        petty_cash: {
          opening_balance_for_period: sumPath(["petty_cash", "opening_balance_for_period"]),
          issued: sumPath(["petty_cash", "issued"]),
          spent: sumPath(["petty_cash", "spent"]),
          returned: sumPath(["petty_cash", "returned"]),
          adjustments: sumPath(["petty_cash", "adjustments"]),
          closing_balance_estimate: sumPath(["petty_cash", "closing_balance_estimate"])
        }
      }
    });
  } catch (error) {
    console.error("[finance-api] summary request failed", {
      apiKeyId: auth.key.id,
      code: error instanceof FinanceApiQueryError ? error.code : null,
      message: error instanceof Error ? error.message : "Unknown error",
      table: error instanceof FinanceApiQueryError ? error.table : null
    });
    return json({ error: "Finance summary could not be loaded." }, 500);
  }
}
