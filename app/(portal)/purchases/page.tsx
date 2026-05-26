import { createSupplier, updateSupplier, updateSupplierPurchase } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { DocumentManager } from "@/components/documents/document-manager";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { SupplierPurchaseForm } from "@/components/supplier-purchase-form";
import { getDashboardData, getSuppliers, totalBy } from "@/lib/data";
import { formatCurrency, formatDate, labelize } from "@/lib/format";
import { canEditBranch, hasPermission, normalizeRole, requirePermission } from "@/lib/permissions";
import { getTransactionDocuments } from "@/lib/transaction-documents";
import { ClipboardList, PackagePlus, Pill, TestTube2 } from "lucide-react";

export default async function PurchasesPage() {
  const profile = await requirePermission("view_supplier_records");
  const data = await getDashboardData();
  const suppliers = await getSuppliers();
  const activeSuppliers = suppliers.filter((supplier) => supplier.is_active);
  const purchaseDocuments = await getTransactionDocuments("supplier_purchases", data.purchases.map((purchase) => purchase.id));
  const role = normalizeRole(profile.role);
  const canManageMasterData = hasPermission(profile, "edit_finance") && role !== "branch_pic";
  const canDeleteDocuments = role !== "branch_pic";
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
          columns={["Invoice Date", "Due Date", "Credit Term", "Branch", "Supplier", "Invoice", "Category", "Medicine", "Consumables", "Other", "Total", "Edit", "Documents"]}
          rows={data.purchases.map((purchase) => [
            formatDate(purchase.invoice_date ?? purchase.purchase_date),
            purchase.due_date ? formatDate(purchase.due_date) : "-",
            `${purchase.credit_term_days ?? 0} days`,
            purchase.branches?.name ?? "-",
            purchase.suppliers?.name ?? "-",
            purchase.invoice_no ?? "-",
            labelize(purchase.category),
            formatCurrency(purchase.medicine_cost),
            formatCurrency(purchase.consumables_cost),
            formatCurrency(purchase.other_cost),
            formatCurrency(purchase.total_amount),
            canEditBranch(profile, purchase.branch_id) ? (
              <details className="manual-bank-editor" key={`${purchase.id}-edit`}>
                <summary>Edit</summary>
                <form action={updateSupplierPurchase} className="manual-bank-edit-form">
                  <input name="purchase_id" type="hidden" value={purchase.id} />
                  <input name="purchase_date" type="hidden" value={purchase.purchase_date} />
                  <label>
                    Supplier
                    <select defaultValue={purchase.supplier_id} name="supplier_id" required>
                      {activeSuppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Branch
                    <select defaultValue={purchase.branch_id} name="branch_id" required>
                      {data.branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Invoice no.
                    <input defaultValue={purchase.invoice_no ?? ""} name="invoice_no" />
                  </label>
                  <label>
                    Invoice date
                    <input defaultValue={purchase.invoice_date ?? purchase.purchase_date} name="invoice_date" required type="date" />
                  </label>
                  <label>
                    Credit term days
                    <input defaultValue={purchase.credit_term_days ?? 0} min="0" name="credit_term_days" required step="1" type="number" />
                  </label>
                  <label>
                    Due date
                    <input defaultValue={purchase.due_date ?? ""} name="due_date" type="date" />
                  </label>
                  <label>
                    Category
                    <select defaultValue={purchase.category} name="category" required>
                      <option value="medicine">Medicine</option>
                      <option value="consumables">Consumables</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label>
                    Medicine cost
                    <input defaultValue={purchase.medicine_cost} min="0" name="medicine_cost" step="0.01" type="number" />
                  </label>
                  <label>
                    Consumables cost
                    <input defaultValue={purchase.consumables_cost} min="0" name="consumables_cost" step="0.01" type="number" />
                  </label>
                  <label>
                    Other cost
                    <input defaultValue={purchase.other_cost} min="0" name="other_cost" step="0.01" type="number" />
                  </label>
                  <label>
                    Notes
                    <textarea defaultValue={purchase.notes ?? ""} name="notes" />
                  </label>
                  <button className="primary-button compact-button" type="submit">
                    Save
                  </button>
                </form>
              </details>
            ) : (
              "-"
            ),
            <DocumentManager
              canDelete={canDeleteDocuments}
              documents={purchaseDocuments.get(purchase.id) ?? []}
              entityId={purchase.id}
              entityName="supplier_purchases"
              key={`${purchase.id}-documents`}
            />
          ])}
        />

        <div className="cards-grid single-column">
          <SupplierPurchaseForm branches={data.branches} suppliers={activeSuppliers} />

          {canManageMasterData ? (
          <form action={createSupplier} className="form-card">
            <h2>Supplier management</h2>
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
              Address
              <textarea name="address" />
            </label>
            <label>
              Notes
              <textarea name="notes" />
            </label>
            <label>
              Status
              <select name="is_active" defaultValue="true">
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
            <button className="primary-button" type="submit">
              Add Supplier
            </button>
          </form>
          ) : null}

          <div className="table-section">
            <div className="report-toolbar">
              <h2>Supplier directory</h2>
            </div>
            <DataTable
              columns={["Supplier", "Contact", "Phone", "Email", "Status", "Edit"]}
              rows={suppliers.map((supplier) => [
                supplier.name,
                supplier.contact_person ?? "-",
                supplier.phone ?? "-",
                supplier.email ?? "-",
                <span className={`status-pill ${supplier.is_active ? "status-paid" : "status-overdue"}`} key={`${supplier.id}-status`}>
                  {supplier.is_active ? "Active" : "Inactive"}
                </span>,
                canManageMasterData ? (
                  <details className="manual-bank-editor" key={`${supplier.id}-edit`}>
                    <summary>Edit</summary>
                    <form action={updateSupplier} className="manual-bank-edit-form">
                      <input name="supplier_id" type="hidden" value={supplier.id} />
                      <label>
                        Supplier name
                        <input defaultValue={supplier.name} name="name" required />
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
                ) : (
                  "-"
                )
              ])}
            />
          </div>
        </div>
      </section>
    </>
  );
}
