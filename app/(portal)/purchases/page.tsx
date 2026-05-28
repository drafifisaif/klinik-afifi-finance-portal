import { updateSupplierPurchaseEntry, voidSupplierPurchaseEntry } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { DocumentManager } from "@/components/documents/document-manager";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { SupplierPurchaseForm } from "@/components/supplier-purchase-form";
import { purchaseCategories } from "@/lib/constants";
import { getBranches, getSupplierOutstanding, getSupplierPurchaseEntries, getSuppliers, totalBy } from "@/lib/data";
import { formatCurrency, formatDate, formatDateTime, labelize } from "@/lib/format";
import { canEditBranch, normalizeRole, requirePermission } from "@/lib/permissions";
import { getTransactionDocuments } from "@/lib/transaction-documents";
import { BadgeDollarSign, ClipboardList, Package2, Pill } from "lucide-react";

type PurchasesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function searchValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function PurchasesPage({ searchParams }: PurchasesPageProps) {
  const profile = await requirePermission("view_supplier_records");
  const [branches, suppliers, purchases] = await Promise.all([
    getBranches(),
    getSuppliers(),
    getSupplierPurchaseEntries()
  ]);
  const outstandingRows = await getSupplierOutstanding();
  const documentMap = await getTransactionDocuments("supplier_purchase_entries", purchases.map((purchase) => purchase.id));
  const canDeleteDocuments = normalizeRole(profile.role) !== "branch_pic";
  const activePurchases = purchases.filter((purchase) => !purchase.is_void);
  const params = searchParams ? await searchParams : {};
  const errorMessage = searchValue(params.error);
  const outstandingByPurchaseId = new Map(outstandingRows.map((row) => [row.id, row]));

  return (
    <>
      <ModuleHeader
        eyebrow="Supplier cost"
        title="Supplier purchases"
        description="Track supplier invoice costs with the new supplier purchase ledger. Voided entries stay visible for audit and are excluded from active totals."
      />

      <section className="dashboard-grid">
        <MetricCard icon={ClipboardList} label="Total purchases" value={formatCurrency(totalBy(activePurchases, (purchase) => purchase.total_amount))} />
        <MetricCard icon={Pill} label="Medicine cost" tone="blue" value={formatCurrency(totalBy(activePurchases, (purchase) => purchase.medicine_cost))} />
        <MetricCard icon={Package2} label="Consumables cost" tone="amber" value={formatCurrency(totalBy(activePurchases, (purchase) => purchase.consumables_cost))} />
        <MetricCard
          icon={BadgeDollarSign}
          label="Other purchase cost"
          tone="rose"
          value={formatCurrency(totalBy(activePurchases, (purchase) => purchase.other_cost))}
        />
      </section>

      {errorMessage ? (
        <section className="table-section mt-section">
          <p className="void-warning">{errorMessage}</p>
        </section>
      ) : null}

      <section className="table-section mt-section">
        <h2>Supplier purchase ledger</h2>
        <DataTable
          columns={[
            "Invoice date",
            "Due date",
            "Credit term",
            "Branch",
            "Supplier",
            "Invoice no",
            "Category",
            "Medicine",
            "Consumables",
            "Other",
            "Total",
            "Paid",
            "Balance",
            "Payment",
            "Notes",
            "Documents",
            "Status",
            "Edit",
            "Void / details"
          ]}
          rows={purchases.map((purchase) => {
            const canManage = canEditBranch(profile, purchase.branch_id);
            const documents = documentMap.get(purchase.id) ?? [];
            const outstanding = outstandingByPurchaseId.get(purchase.id);
            const paidAmount = outstanding?.paid_amount ?? 0;
            const balanceAmount = outstanding?.outstanding_amount ?? (purchase.is_void ? 0 : purchase.total_amount);
            const paymentStatus = purchase.is_void
              ? "Voided"
              : balanceAmount <= 0
                ? "Paid"
                : paidAmount > 0
                  ? "Partial"
                  : "Unpaid";

            return [
              formatDate(purchase.invoice_date ?? purchase.purchase_date),
              formatDate(purchase.due_date),
              `${purchase.credit_term_days ?? 0} days`,
              purchase.branches?.name ?? "-",
              purchase.suppliers?.name ?? "-",
              purchase.invoice_no ?? "-",
              purchase.category ? labelize(purchase.category) : "-",
              formatCurrency(purchase.medicine_cost),
              formatCurrency(purchase.consumables_cost),
              formatCurrency(purchase.other_cost),
              formatCurrency(purchase.total_amount),
              formatCurrency(paidAmount),
              formatCurrency(balanceAmount),
              paymentStatus,
              purchase.notes ?? "-",
              <DocumentManager
                canDelete={canDeleteDocuments}
                documents={documents}
                entityId={purchase.id}
                entityName="supplier_purchase_entries"
                key={`${purchase.id}-documents`}
              />,
              <span className={`status-pill ${purchase.is_void ? "status-voided" : "status-paid"}`} key={`${purchase.id}-status`}>
                {purchase.is_void ? "Voided" : "Active"}
              </span>,
              !purchase.is_void && canManage ? (
                <details className="manual-bank-editor" key={`${purchase.id}-edit`}>
                  <summary>Edit</summary>
                  <form action={updateSupplierPurchaseEntry} className="manual-bank-edit-form">
                    <input name="purchase_entry_id" type="hidden" value={purchase.id} />
                    <label>
                      Supplier
                      <select defaultValue={purchase.supplier_id} name="supplier_id" required>
                        {suppliers.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Branch
                      <select defaultValue={purchase.branch_id} name="branch_id" required>
                        {branches.map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {branch.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Purchase date
                      <input defaultValue={purchase.purchase_date} name="purchase_date" required type="date" />
                    </label>
                    <label>
                      Invoice date
                      <input defaultValue={purchase.invoice_date ?? ""} name="invoice_date" type="date" />
                    </label>
                    <label>
                      Invoice no.
                      <input defaultValue={purchase.invoice_no ?? ""} name="invoice_no" />
                    </label>
                    <label>
                      Credit term
                      <input defaultValue={purchase.credit_term_days ?? 0} min="0" name="credit_term_days" required type="number" />
                    </label>
                    <label>
                      Due date
                      <input defaultValue={purchase.due_date ?? ""} name="due_date" type="date" />
                    </label>
                    <label>
                      Category
                      <select defaultValue={purchase.category ?? "medicine"} name="category">
                        {purchaseCategories.map((category) => (
                          <option key={category.value} value={category.value}>
                            {category.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Medicine cost
                      <input defaultValue={purchase.medicine_cost} min="0" name="medicine_cost" required step="0.01" type="number" />
                    </label>
                    <label>
                      Consumables cost
                      <input defaultValue={purchase.consumables_cost} min="0" name="consumables_cost" required step="0.01" type="number" />
                    </label>
                    <label>
                      Other cost
                      <input defaultValue={purchase.other_cost} min="0" name="other_cost" required step="0.01" type="number" />
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
              !purchase.is_void && canManage ? (
                <details className="manual-bank-editor" key={`${purchase.id}-void`}>
                  <summary>Void</summary>
                  <form action={voidSupplierPurchaseEntry} className="manual-bank-edit-form void-record-form">
                    <input name="purchase_entry_id" type="hidden" value={purchase.id} />
                    <p className="void-warning">Voided records stay in history and are excluded from active totals.</p>
                    <label>
                      Void reason
                      <textarea name="void_reason" required />
                    </label>
                    <button className="primary-button compact-button" type="submit">
                      Void this supplier purchase
                    </button>
                  </form>
                </details>
              ) : purchase.is_void ? (
                <div key={`${purchase.id}-voided-details`}>
                  <strong>Voided</strong>
                  <div>{purchase.void_reason ?? "-"}</div>
                  <small>{purchase.voided_at ? formatDateTime(purchase.voided_at) : "-"}</small>
                </div>
              ) : (
                "-"
              )
            ];
          })}
        />
      </section>

      <section className="section-grid mt-section">
        <SupplierPurchaseForm branches={branches} suppliers={suppliers} />
      </section>
    </>
  );
}
