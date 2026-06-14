import { createSupplier, updateSupplier } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { getSuppliers, totalBy } from "@/lib/data";
import { requirePermission } from "@/lib/permissions";
import { Building2, ClipboardList, ShieldCheck, Truck } from "lucide-react";

export default async function SuppliersPage() {
  await requirePermission("manage_suppliers");
  const suppliers = await getSuppliers({ includeInactive: true });
  const activeSuppliers = suppliers.filter((supplier) => supplier.is_active);

  return (
    <>
      <ModuleHeader
        eyebrow="Master data"
        title="Suppliers"
        description="Register suppliers, keep payment terms current, and deactivate old suppliers without removing history."
      />

      <section className="dashboard-grid">
        <MetricCard icon={Building2} label="Total Suppliers" value={String(suppliers.length)} />
        <MetricCard icon={ShieldCheck} label="Active Suppliers" value={String(activeSuppliers.length)} tone="blue" />
        <MetricCard
          icon={Truck}
          label="Inactive Suppliers"
          value={String(suppliers.length - activeSuppliers.length)}
          tone="rose"
        />
        <MetricCard
          icon={ClipboardList}
          label="Average Credit Term"
          value={`${Math.round(totalBy(activeSuppliers, (supplier) => supplier.default_credit_term_days ?? supplier.payment_terms_days ?? 0) / Math.max(activeSuppliers.length, 1))} days`}
          tone="amber"
        />
      </section>

      <section className="table-section mt-section">
        <h2>Supplier registry</h2>
        <DataTable
          columns={["Supplier", "Code", "Phone", "Email", "Credit term", "Status", "Notes", "Edit"]}
          rows={suppliers.map((supplier) => [
            supplier.name,
            supplier.code ?? "-",
            supplier.phone ?? "-",
            supplier.email ?? "-",
            `${supplier.default_credit_term_days ?? supplier.payment_terms_days ?? 30} days`,
            supplier.is_active ? "Active" : "Inactive",
            supplier.notes ?? "-",
            <details className="manual-bank-editor" key={`${supplier.id}-edit`}>
              <summary>Edit</summary>
              <form action={updateSupplier} className="manual-bank-edit-form">
                <input name="supplier_id" type="hidden" value={supplier.id} />
                <label>
                  Supplier name
                  <input defaultValue={supplier.name} name="name" required />
                </label>
                <label>
                  Supplier code
                  <input defaultValue={supplier.code ?? ""} name="code" />
                </label>
                <label>
                  Contact person
                  <input defaultValue={supplier.contact_person ?? ""} name="contact_person" />
                </label>
                <label>
                  Phone
                  <input defaultValue={supplier.phone ?? ""} name="phone" />
                </label>
                <label>
                  Email
                  <input defaultValue={supplier.email ?? ""} name="email" type="email" />
                </label>
                <label>
                  Default credit term (days)
                  <input defaultValue={supplier.default_credit_term_days ?? supplier.payment_terms_days ?? 30} min="0" name="default_credit_term_days" required type="number" />
                </label>
                <label>
                  Address
                  <textarea defaultValue={supplier.address ?? ""} name="address" />
                </label>
                <label>
                  Notes
                  <textarea defaultValue={supplier.notes ?? ""} name="notes" />
                </label>
                <label>
                  Status
                  <select defaultValue={supplier.is_active ? "true" : "false"} name="is_active">
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </label>
                <button className="primary-button compact-button" type="submit">
                  Save
                </button>
              </form>
            </details>
          ])}
        />
      </section>

      <section className="section-grid mt-section">
        <form action={createSupplier} className="form-card">
          <h2>Register supplier</h2>
          <label>
            Supplier name
            <input name="name" required />
          </label>
          <label>
            Supplier code
            <input name="code" />
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
            Default credit term (days)
            <input defaultValue="30" min="0" name="default_credit_term_days" required type="number" />
          </label>
          <label>
            Address
            <textarea name="address" />
          </label>
          <label>
            Notes
            <textarea name="notes" />
          </label>
          <label>
            Status
            <select defaultValue="true" name="is_active">
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>
          <button className="primary-button" type="submit">
            Save supplier
          </button>
        </form>
      </section>
    </>
  );
}
