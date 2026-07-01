import { createDailySale, updateDailySale, voidDailySale } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { ExportCsvLink } from "@/components/export-csv-link";
import { FinanceRecordDetails } from "@/components/finance-record-details";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { isActiveFinancialRecord } from "@/lib/bank-reporting";
import { getDashboardData, totalBy } from "@/lib/data";
import { userDisplayLabel } from "@/lib/display";
import { formatCurrency, formatDate } from "@/lib/format";
import { requirePermission } from "@/lib/permissions";
import { getVisibleProfilesById } from "@/lib/users";
import { Banknote, CreditCard, QrCode, ShieldCheck } from "lucide-react";

type SalesSearchParams = {
  error?: string;
};

export default async function SalesPage({ searchParams }: { searchParams: Promise<SalesSearchParams> }) {
  await requirePermission("edit_finance");
  const params = await searchParams;
  const data = await getDashboardData();
  const visibleUsers = await getVisibleProfilesById(data.sales.flatMap((sale) => [sale.entered_by, sale.voided_by]));
  const userById = new Map(visibleUsers.map((user) => [user.id, user]));
  const sales = data.sales.filter(isActiveFinancialRecord);
  const cash = totalBy(sales, (sale) => sale.cash_amount);
  const transfer = totalBy(sales, (sale) => sale.bank_transfer_amount);
  const cards = totalBy(sales, (sale) => sale.card_amount);
  const panel = totalBy(sales, (sale) => sale.panel_amount);

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
        <MetricCard icon={Banknote} label="Cash" value={formatCurrency(cash)} />
        <MetricCard icon={QrCode} label="Bank transfer" value={formatCurrency(transfer)} tone="blue" />
        <MetricCard icon={CreditCard} label="Card" value={formatCurrency(cards)} tone="amber" />
        <MetricCard icon={ShieldCheck} label="Panel sales" value={formatCurrency(panel)} tone="rose" />
      </section>

      <section className="table-section mt-section">
        <div className="report-toolbar">
          <h2>Daily sales report</h2>
          <ExportCsvLink label="Export sales CSV" report="sales" />
        </div>
        <DataTable
          columns={["Date", "Branch", "Cash", "Transfer", "Card", "Panel", "QR", "Total", "Status", "View details", "Edit", "Void"]}
          rows={data.sales.map((sale) => [
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
