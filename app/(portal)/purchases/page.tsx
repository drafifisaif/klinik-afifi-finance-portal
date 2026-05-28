import { createSupplier, updateSupplier, voidSupplierPurchase } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { DocumentManager } from "@/components/documents/document-manager";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { SupplierPurchaseForm } from "@/components/supplier-purchase-form";
import { isActiveFinancialRecord } from "@/lib/bank-reporting";
import { getDashboardData, getSuppliers, totalBy } from "@/lib/data";
import { formatCurrency, formatDate, formatDateTime, labelize } from "@/lib/format";
import { canEditBranch, hasPermission, normalizeRole, requirePermission } from "@/lib/permissions";
import { getTransactionDocuments } from "@/lib/transaction-documents";
import { ClipboardList, PackagePlus, Pill, TestTube2 } from "lucide-react";

type PurchasesSearchParams = {
  error?: string;
};

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<PurchasesSearchParams> }) {
  const profile = await requirePermission("view_supplier_records");
  const params = await searchParams;
  const data = await getDashboardData();
  const suppliers = await getSuppliers();
  const activeSuppliers = suppliers.filter((supplier) => supplier.is_active);
  const purchaseDocuments = await getTransactionDocuments("supplier_purchases", data.purchases.map((purchase) => purchase.id));
  const role = normalizeRole(profile.role);
  const canManageMasterData = hasPermission(profile, "edit_finance") && role !== "branch_pic";
  const canDeleteDocuments = role !== "branch_pic";
  const activePurchases = data.purchases.filter(isActiveFinancialRecord);
  const totalPurchases = totalBy(activePurchases, (purchase) => purchase.total_amount);
  const medicine = totalBy(activePurchases, (purchase) => purchase.medicine_cost);
  const consumables = totalBy(activePurchases, (purchase) => purchase.consumables_cost);

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

      {params.error ? (
        <section className="table-section mt-section">
          <p className="void-warning">{params.error}</p>
        </section>
      ) : null}

      <section className="table-section mt-section">
        <DataTable
          columns={["Invoice Date", "Due Date", "Credit Term", "Branch", "Supplier", "Invoice", "Category", "Medicine", "Consumables", "Other", "Total", "Status", "Void", "Documents"]}
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
            purchase.is_void ? (
              <details className="manual-bank-editor" key={`${purchase.id}-status`}>
                <summary>
                  <span className="status-pill status-overdue">Voided</span>
                </summary>
                <div className="record-detail-card">
                  <p><strong>Reason:</strong> {purchase.void_reason ?? "-"}</p>
                  <p><strong>Voided at:</strong> {purchase.voided_at ? formatDateTime(purchase.voided_at) : "-"}</p>
                </div>
              </details>
            ) : (
              <span className="status-pill status-paid" key={`${purchase.id}-active`}>Active</span>
            ),
            !purchase.is_void && canEditBranch(profile, purchase.branch_id) ? (
              <details className="manual-bank-editor" key={`${purchase.id}-edit`}>
                <summary>Void</summary>
                <form action={voidSupplierPurchase} className="manual-bank-edit-form">
                  <input name="purchase_id" type="hidden" value={purchase.id} />
                  <label>
                    Void this supplier purchase
                    <textarea name="void_reason" placeholder="Explain why this supplier purchase is incorrect." required />
                  </label>
                  <button className="primary-button compact-button" type="submit">
                    Confirm Void
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
      </section>

      <section className="section-grid mt-section">
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
