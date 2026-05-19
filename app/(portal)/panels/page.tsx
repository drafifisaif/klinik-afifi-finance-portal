import { createPanelClaim, createPanelCompany } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { getDashboardData, getPanelCompanies, totalBy } from "@/lib/data";
import { formatCurrency, formatDate, labelize } from "@/lib/format";
import { Building, CalendarClock, FileClock, ShieldCheck } from "lucide-react";

function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill status-${status}`}>{labelize(status)}</span>;
}

export default async function PanelsPage() {
  const data = await getDashboardData();
  const panelCompanies = await getPanelCompanies();
  const totalClaims = totalBy(data.panels, (claim) => claim.amount);
  const outstanding = totalBy(
    data.panels.filter((claim) => claim.status !== "paid"),
    (claim) => claim.amount
  );
  const unpaid = data.panels.filter((claim) => claim.status === "unpaid").length;

  return (
    <>
      <ModuleHeader
        eyebrow="Receivables"
        title="Panel outstanding"
        description="Track panel company claims, payment status, and a simple aging view for clinic finance follow-up."
      />

      <section className="dashboard-grid">
        <MetricCard icon={ShieldCheck} label="Total claims" value={formatCurrency(totalClaims)} />
        <MetricCard icon={FileClock} label="Outstanding" value={formatCurrency(outstanding)} tone="blue" />
        <MetricCard icon={CalendarClock} label="Unpaid claims" value={String(unpaid)} tone="amber" />
        <MetricCard icon={Building} label="Panel companies" value={String(panelCompanies.length)} tone="rose" />
      </section>

      <section className="section-grid">
        <DataTable
          columns={["Claim month", "Panel", "Branch", "Claim no.", "Due", "Status", "Amount"]}
          rows={data.panels.map((claim) => [
            formatDate(claim.claim_month),
            claim.panel_companies?.name ?? "-",
            claim.branches?.name ?? "-",
            claim.claim_no ?? "-",
            formatDate(claim.due_date),
            <StatusPill key={claim.id} status={claim.status} />,
            formatCurrency(claim.amount)
          ])}
        />

        <div className="cards-grid single-column">
          <form action={createPanelClaim} className="form-card">
            <h2>Record panel claim</h2>
            <label>
              Panel company
              <select name="panel_company_id" required>
                {panelCompanies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </label>
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
              Claim no.
              <input name="claim_no" />
            </label>
            <label>
              Claim month
              <input name="claim_month" type="date" required />
            </label>
            <label>
              Submitted date
              <input name="submitted_date" type="date" />
            </label>
            <label>
              Due date
              <input name="due_date" type="date" />
            </label>
            <label>
              Amount
              <input min="0" name="amount" required step="0.01" type="number" />
            </label>
            <label>
              Status
              <select name="status">
                <option value="unpaid">Unpaid</option>
                <option value="partial">Partial</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
              </select>
            </label>
            <label>
              Notes
              <textarea name="notes" />
            </label>
            <button className="primary-button" type="submit">
              Save panel claim
            </button>
          </form>

          <form action={createPanelCompany} className="form-card">
            <h2>New panel company</h2>
            <label>
              Company name
              <input name="name" required />
            </label>
            <label>
              Contact person
              <input name="contact_person" />
            </label>
            <label>
              Phone
              <input name="phone" />
            </label>
            <label>
              Email
              <input name="email" type="email" />
            </label>
            <label>
              Terms days
              <input min="0" name="payment_terms_days" type="number" defaultValue={30} />
            </label>
            <button className="primary-button" type="submit">
              Add panel company
            </button>
          </form>
        </div>
      </section>
    </>
  );
}
