import { createDailySale, updateDailySale, voidDailySale } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { ExportCsvLink } from "@/components/export-csv-link";
import { FinanceRecordDetails } from "@/components/finance-record-details";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { isActiveFinancialRecord } from "@/lib/bank-reporting";
import { resolveSelectedBranchIds } from "@/lib/branch-reporting";
import { getDashboardData, totalBy } from "@/lib/data";
import {
  currentMonth,
  isDailySaleInResolvedRange,
  previousMonth,
  resolveDailySalesFilter,
  sortDailySales
} from "@/lib/daily-sales-reporting";
import { userDisplayLabel } from "@/lib/display";
import { formatCurrency, formatDate } from "@/lib/format";
import { canViewAllBranches, requirePermission } from "@/lib/permissions";
import { getVisibleProfilesById } from "@/lib/users";
import { Banknote, CreditCard, QrCode, ReceiptText, ShieldCheck } from "lucide-react";

type SalesSearchParams = {
  branch?: string | string[];
  branch_id?: string | string[];
  end?: string;
  error?: string;
  filter?: string;
  month?: string;
  period?: string;
  range?: string;
  sort?: string;
  start?: string;
};

export default async function SalesPage({ searchParams }: { searchParams: Promise<SalesSearchParams> }) {
  const profile = await requirePermission("edit_finance");
  const params = await searchParams;
  const data = await getDashboardData();
  const canSelectBranches = canViewAllBranches(profile);
  const selectedBranchIds = resolveSelectedBranchIds({
    allowedBranches: data.branches,
    branchParam: params.branch ?? params.branch_id,
    canSelectMultiple: canSelectBranches
  });
  const selectedBranchIdSet = new Set(selectedBranchIds);
  const selectedBranches = data.branches.filter((branch) => selectedBranchIdSet.has(branch.id));
  const selectedBranchLabel = canSelectBranches && selectedBranches.length === data.branches.length
    ? "All Branches"
    : selectedBranches.map((branch) => branch.name).join(", ");
  const selectedBranchValue = canSelectBranches && selectedBranches.length === data.branches.length
    ? "all"
    : selectedBranches[0]?.id ?? "all";
  const reportFilter = resolveDailySalesFilter({
    end: params.end,
    filter: params.filter,
    month: params.month,
    range: params.range ?? params.period,
    sort: params.sort,
    start: params.start
  });
  const filteredSales = reportFilter.error
    ? []
    : sortDailySales(
        data.sales.filter((sale) => selectedBranchIdSet.has(sale.branch_id) && isDailySaleInResolvedRange(sale, reportFilter)),
        reportFilter.sort
      );
  const activeSales = filteredSales.filter(isActiveFinancialRecord);
  const visibleUsers = await getVisibleProfilesById(filteredSales.flatMap((sale) => [sale.entered_by, sale.voided_by]));
  const userById = new Map(visibleUsers.map((user) => [user.id, user]));
  const cash = totalBy(activeSales, (sale) => sale.cash_amount);
  const transfer = totalBy(activeSales, (sale) => sale.bank_transfer_amount);
  const cards = totalBy(activeSales, (sale) => sale.card_amount);
  const panel = totalBy(activeSales, (sale) => sale.panel_amount);
  const qr = totalBy(activeSales, (sale) => sale.qr_amount);
  const totalSales = totalBy(activeSales, (sale) => sale.total_amount);
  const exportParams = {
    branch: selectedBranchValue,
    filter: reportFilter.filterMode,
    month: reportFilter.month,
    sort: reportFilter.sort,
    ...(reportFilter.filterMode === "custom" ? { end: reportFilter.endDate, start: reportFilter.startDate } : {})
  };

  return (
    <>
      <ModuleHeader
        eyebrow="Revenue capture"
        title="Daily sales entry"
        description="Enter one daily branch sales summary by payment type: cash, bank transfer, card, panel, and QR."
      />

      {params.error ? (
        <section className="report-panel mt-section" role="alert">
          <p className="selected-branches">{params.error}</p>
        </section>
      ) : null}

      <section className="dashboard-grid">
        <MetricCard icon={ReceiptText} label="Total Sales" value={formatCurrency(totalSales)} detail={selectedBranchLabel} />
        <MetricCard icon={Banknote} label="Cash" value={formatCurrency(cash)} detail={reportFilter.label} />
        <MetricCard icon={QrCode} label="Bank transfer + QR" value={formatCurrency(transfer + qr)} tone="blue" />
        <MetricCard icon={CreditCard} label="Card" value={formatCurrency(cards)} tone="amber" />
        <MetricCard icon={ShieldCheck} label="Panel sales" value={formatCurrency(panel)} tone="rose" />
      </section>

      <section className="table-section mt-section">
        <div className="report-toolbar">
          <h2>Daily sales report</h2>
          <ExportCsvLink label="Export sales CSV" report="sales" searchParams={exportParams} />
        </div>
        <form className="reporting-filter daily-sales-filter" method="get">
          <label>
            Filter by
            <select defaultValue={reportFilter.filterMode} name="filter">
              <option value="month">Month</option>
              <option value="custom">Custom date range</option>
            </select>
          </label>
          <label>
            Month
            <input defaultValue={reportFilter.month} name="month" type="month" />
          </label>
          <label>
            Start date
            <input defaultValue={reportFilter.startDate} name="start" type="date" />
          </label>
          <label>
            End date
            <input defaultValue={reportFilter.endDate} name="end" type="date" />
          </label>
          {canSelectBranches ? (
            <label>
              Branch
              <select defaultValue={selectedBranchValue} name="branch">
                <option value="all">All Branches</option>
                {data.branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <input name="branch" type="hidden" value={selectedBranchValue} />
          )}
          <label>
            Sort
            <select defaultValue={reportFilter.sort} name="sort">
              <option value="desc">Latest first</option>
              <option value="asc">Oldest first</option>
            </select>
          </label>
          <button className="primary-button" type="submit">
            Apply
          </button>
          <p className="selected-branches">
            Showing {selectedBranchLabel || "No branch"} · {reportFilter.label}
          </p>
          {reportFilter.error ? <p className="form-error">{reportFilter.error}</p> : null}
          <div className="quick-filter-row">
            <a className="ghost-button compact-button" href={`/sales?filter=month&month=${currentMonth()}&branch=${selectedBranchValue}&sort=${reportFilter.sort}`}>
              This month
            </a>
            <a className="ghost-button compact-button" href={`/sales?filter=month&month=${previousMonth()}&branch=${selectedBranchValue}&sort=${reportFilter.sort}`}>
              Last month
            </a>
          </div>
        </form>
        <DataTable
          columns={["Date", "Branch", "Cash", "Transfer", "Card", "Panel", "QR", "Total", "Status", "View details", "Edit", "Void"]}
          emptyMessage="No Daily Sales records found for the selected period."
          rowKeys={filteredSales.map((sale) => sale.id)}
          rows={filteredSales.map((sale) => [
            formatDate(sale.sale_date),
            sale.branches?.name ?? "-",
            formatCurrency(sale.cash_amount),
            formatCurrency(sale.bank_transfer_amount),
            formatCurrency(sale.card_amount),
            formatCurrency(sale.panel_amount),
            formatCurrency(sale.qr_amount),
            formatCurrency(sale.total_amount),
            <span className={`status-pill ${sale.is_void ? "status-voided" : "status-paid"}`} key={`${sale.id}-status`}>
              {sale.is_void ? "VOIDED" : "Active"}
            </span>,
            <FinanceRecordDetails
              enteredBy={userDisplayLabel(userById.get(sale.entered_by ?? ""), sale.entered_by)}
              key={`${sale.id}-details`}
              originalSummary={`Daily Sales • ${sale.branches?.name ?? "-"} • ${formatDate(sale.sale_date)} • ${formatCurrency(sale.total_amount)}`}
              recordId={sale.id}
              status={sale.is_void ? "Voided" : "Active"}
              voidReason={sale.void_reason}
              voidedAt={sale.voided_at}
              voidedBy={userDisplayLabel(userById.get(sale.voided_by ?? ""), sale.voided_by)}
            />,
            !sale.is_void ? (
              <details className="manual-bank-editor" key={`${sale.id}-edit`}>
                <summary>Edit</summary>
                <form action={updateDailySale} className="manual-bank-edit-form">
                  <input name="sale_id" type="hidden" value={sale.id} />
                  <label>
                    Cash
                    <input min="0" name="cash_amount" step="0.01" type="number" defaultValue={sale.cash_amount} />
                  </label>
                  <label>
                    Bank transfer
                    <input min="0" name="bank_transfer_amount" step="0.01" type="number" defaultValue={sale.bank_transfer_amount} />
                  </label>
                  <label>
                    Card
                    <input min="0" name="card_amount" step="0.01" type="number" defaultValue={sale.card_amount} />
                  </label>
                  <label>
                    Panel
                    <input min="0" name="panel_amount" step="0.01" type="number" defaultValue={sale.panel_amount} />
                  </label>
                  <label>
                    QR
                    <input min="0" name="qr_amount" step="0.01" type="number" defaultValue={sale.qr_amount} />
                  </label>
                  <label>
                    Notes
                    <textarea name="notes" defaultValue={sale.notes ?? ""} />
                  </label>
                  <button className="primary-button compact-button" type="submit">
                    Save
                  </button>
                </form>
              </details>
            ) : (
              "-"
            ),
            !sale.is_void ? (
              <details className="manual-bank-editor" key={`${sale.id}-void`}>
                <summary>Void</summary>
                <form action={voidDailySale} className="manual-bank-edit-form void-record-form">
                  <input name="sale_id" type="hidden" value={sale.id} />
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
          ])}
        />
      </section>

      <section className="section-grid mt-section">
        <form action={createDailySale} className="form-card">
          <h2>Record sales</h2>
          <label>
            Branch
            <select name="branch_id" required>
              {data.branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input name="sale_date" type="date" required />
          </label>
          <div className="form-grid">
            <label>
              Cash
              <input min="0" name="cash_amount" step="0.01" type="number" />
            </label>
            <label>
              Bank transfer
              <input min="0" name="bank_transfer_amount" step="0.01" type="number" />
            </label>
            <label>
              Card
              <input min="0" name="card_amount" step="0.01" type="number" />
            </label>
            <label>
              Panel
              <input min="0" name="panel_amount" step="0.01" type="number" />
            </label>
            <label className="full-span">
              QR
              <input min="0" name="qr_amount" step="0.01" type="number" />
            </label>
          </div>
          <label>
            Notes
            <textarea name="notes" placeholder="Optional daily notes" />
          </label>
          <button className="primary-button" type="submit">
            Save daily sales
          </button>
        </form>
      </section>
    </>
  );
}
