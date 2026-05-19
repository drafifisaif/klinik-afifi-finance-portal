import { createDailySale } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { getDashboardData, totalBy } from "@/lib/data";
import { formatCurrency, formatDate } from "@/lib/format";
import { Banknote, CreditCard, QrCode, ShieldCheck } from "lucide-react";

export default async function SalesPage() {
  const data = await getDashboardData();
  const cash = totalBy(data.sales, (sale) => sale.cash_amount);
  const transfer = totalBy(data.sales, (sale) => sale.bank_transfer_amount);
  const cards = totalBy(data.sales, (sale) => sale.card_amount);
  const panel = totalBy(data.sales, (sale) => sale.panel_amount);

  return (
    <>
      <ModuleHeader
        eyebrow="Revenue capture"
        title="Daily sales entry"
        description="Enter one daily branch sales summary by payment type: cash, bank transfer, card, panel, and QR."
      />

      <section className="dashboard-grid">
        <MetricCard icon={Banknote} label="Cash" value={formatCurrency(cash)} />
        <MetricCard icon={QrCode} label="Bank transfer" value={formatCurrency(transfer)} tone="blue" />
        <MetricCard icon={CreditCard} label="Card" value={formatCurrency(cards)} tone="amber" />
        <MetricCard icon={ShieldCheck} label="Panel sales" value={formatCurrency(panel)} tone="rose" />
      </section>

      <section className="section-grid">
        <DataTable
          columns={["Date", "Branch", "Cash", "Transfer", "Card", "Panel", "QR", "Total"]}
          rows={data.sales.map((sale) => [
            formatDate(sale.sale_date),
            sale.branches?.name ?? "-",
            formatCurrency(sale.cash_amount),
            formatCurrency(sale.bank_transfer_amount),
            formatCurrency(sale.card_amount),
            formatCurrency(sale.panel_amount),
            formatCurrency(sale.qr_amount),
            formatCurrency(sale.total_amount)
          ])}
        />

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
