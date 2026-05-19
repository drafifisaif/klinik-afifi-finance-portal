import { createSupplier, createSupplierPurchase } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { purchaseCategories } from "@/lib/constants";
import { getDashboardData, getSuppliers, totalBy } from "@/lib/data";
import { formatCurrency, formatDate, labelize } from "@/lib/format";
import { ClipboardList, PackagePlus, Pill, TestTube2 } from "lucide-react";

export default async function PurchasesPage() {
  const data = await getDashboardData();
  const suppliers = await getSuppliers();
  const totalPurchases = totalBy(data.purchases, (purchase) => purchase.total_amount);
  const medicine = totalBy(data.purchases, (purchase) => purchase.medicine_cost);
  const consumables = totalBy(data.purchases, (purchase) => purchase.consumables_cost);

  return (
    <>
      <ModuleHeader
        eyebrow="Supplier cost"
        title="Supplier purchases"
        description="Track supplier invoices and monthly medicine or consumables purchase cost without creating inventory stock records."
      />

      <section className="dashboard-grid">
        <MetricCard icon={ClipboardList} label="Total purchases" value={formatCurrency(totalPurchases)} />
        <MetricCard icon={Pill} label="Medicine cost" value={formatCurrency(medicine)} tone="blue" />
        <MetricCard icon={TestTube2} label="Consumables cost" value={formatCurrency(consumables)} tone="amber" />
        <MetricCard icon={PackagePlus} label="Other purchase cost" value={formatCurrency(totalPurchases - medicine - consumables)} tone="rose" />
      </section>

      <section className="section-grid">
        <DataTable
          columns={["Date", "Branch", "Supplier", "Invoice", "Category", "Medicine", "Consumables", "Other", "Total"]}
          rows={data.purchases.map((purchase) => [
            formatDate(purchase.purchase_date),
            purchase.branches?.name ?? "-",
            purchase.suppliers?.name ?? "-",
            purchase.invoice_no ?? "-",
            labelize(purchase.category),
            formatCurrency(purchase.medicine_cost),
            formatCurrency(purchase.consumables_cost),
            formatCurrency(purchase.other_cost),
            formatCurrency(purchase.total_amount)
          ])}
        />

        <div className="cards-grid single-column">
          <form action={createSupplierPurchase} className="form-card">
            <h2>Record purchase</h2>
            <label>
              Supplier
              <select name="supplier_id" required>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
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
              Invoice no.
              <input name="invoice_no" placeholder="Supplier invoice" />
            </label>
            <label>
              Purchase date
              <input name="purchase_date" type="date" required />
            </label>
            <label>
              Due date
              <input name="due_date" type="date" />
            </label>
            <label>
              Category
              <select name="category" required>
                {purchaseCategories.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              <label>
                Medicine cost
                <input min="0" name="medicine_cost" step="0.01" type="number" />
              </label>
              <label>
                Consumables cost
                <input min="0" name="consumables_cost" step="0.01" type="number" />
              </label>
              <label className="full-span">
                Other cost
                <input min="0" name="other_cost" step="0.01" type="number" />
              </label>
            </div>
            <label>
              Notes
              <textarea name="notes" />
            </label>
            <button className="primary-button" type="submit">
              Save purchase
            </button>
          </form>

          <form action={createSupplier} className="form-card">
            <h2>New supplier</h2>
            <label>
              Supplier name
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
              Add supplier
            </button>
          </form>
        </div>
      </section>
    </>
  );
}
