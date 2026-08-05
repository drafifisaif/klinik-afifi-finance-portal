import type { DailySale } from "@/lib/types";

export type DailySalesFilterMode = "custom" | "month";
export type DailySalesSort = "asc" | "desc";

export type DailySalesFilterInput = {
  end?: string | null;
  filter?: string | null;
  month?: string | null;
  range?: string | null;
  sort?: string | null;
  start?: string | null;
};

export type DailySalesResolvedFilter = {
  endDate: string;
  endExclusive: string;
  error: string | null;
  filterMode: DailySalesFilterMode;
  label: string;
  month: string;
  sort: DailySalesSort;
  startDate: string;
};

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthInput(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(month: string, count: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  return monthInput(new Date(Date.UTC(year, monthNumber - 1 + count, 1)));
}

function addOneDay(dateString: string) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return toDateInput(date);
}

function subtractOneDay(dateString: string) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return toDateInput(date);
}

function isValidMonth(month: string | null | undefined) {
  return Boolean(month && /^\d{4}-\d{2}$/.test(month));
}

function isValidDate(date: string | null | undefined) {
  return Boolean(date && /^\d{4}-\d{2}-\d{2}$/.test(date));
}

export function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${monthNames[monthNumber - 1] ?? month} ${year}`;
}

export function dateRangeLabel(startDate: string, endDate: string) {
  return `${formatShortDate(startDate)} - ${formatShortDate(endDate)}`;
}

function formatShortDate(dateString: string) {
  const [year, month, day] = dateString.split("-").map(Number);
  return `${String(day).padStart(2, "0")} ${monthNames[month - 1]?.slice(0, 3) ?? ""} ${year}`;
}

export function currentMonth(now = new Date()) {
  return monthInput(startOfMonth(now));
}

export function previousMonth(now = new Date()) {
  return monthInput(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
}

export function resolveDailySalesFilter(input: DailySalesFilterInput, now = new Date()): DailySalesResolvedFilter {
  const sort: DailySalesSort = input.sort === "asc" ? "asc" : "desc";
  const currentMonthValue = currentMonth(now);
  const today = toDateInput(now);
  const defaultStartDate = `${currentMonthValue}-01`;
  const filterMode: DailySalesFilterMode = input.filter === "custom" || input.range === "custom" ? "custom" : "month";

  if (filterMode === "custom") {
    const startDate = isValidDate(input.start) ? input.start! : defaultStartDate;
    const endDate = isValidDate(input.end) ? input.end! : today;
    const error = !isValidDate(input.start) || !isValidDate(input.end) || endDate < startDate
      ? "Please select a valid date range."
      : null;

    return {
      endDate,
      endExclusive: addOneDay(endDate),
      error,
      filterMode,
      label: dateRangeLabel(startDate, endDate),
      month: currentMonthValue,
      sort,
      startDate
    };
  }

  const month = input.range === "last_month"
    ? previousMonth(now)
    : input.range === "this_month"
      ? currentMonthValue
      : isValidMonth(input.month)
        ? input.month!
        : currentMonthValue;

  const endExclusive = `${addMonths(month, 1)}-01`;

  return {
    endDate: subtractOneDay(endExclusive),
    endExclusive,
    error: null,
    filterMode,
    label: input.range === "this_month" ? "This month" : input.range === "last_month" ? "Last month" : monthLabel(month),
    month,
    sort,
    startDate: `${month}-01`
  };
}

export function isDailySaleInResolvedRange(sale: DailySale, filter: Pick<DailySalesResolvedFilter, "endExclusive" | "startDate">) {
  return sale.sale_date >= filter.startDate && sale.sale_date < filter.endExclusive;
}

export function sortDailySales(sales: DailySale[], sort: DailySalesSort) {
  return [...sales].sort((left, right) => {
    const dateComparison = left.sale_date.localeCompare(right.sale_date);
    if (dateComparison !== 0) return sort === "asc" ? dateComparison : -dateComparison;

    const branchComparison = (left.branches?.name ?? "").localeCompare(right.branches?.name ?? "");
    if (branchComparison !== 0) return branchComparison;

    if (Boolean(left.is_void) !== Boolean(right.is_void)) return left.is_void ? 1 : -1;

    const leftTimestamp = left.updated_at ?? left.created_at ?? "";
    const rightTimestamp = right.updated_at ?? right.created_at ?? "";
    return rightTimestamp.localeCompare(leftTimestamp);
  });
}
