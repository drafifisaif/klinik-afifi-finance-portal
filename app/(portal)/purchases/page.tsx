import { ModuleHeader } from "@/components/module-header";
import { requirePermission } from "@/lib/permissions";

export default async function PurchasesPage() {
  await requirePermission("view_supplier_records");

  return (
    <>
      <ModuleHeader
        eyebrow="Supplier cost"
        title="Supplier Purchases"
        description="Supplier Purchases module is being rebuilt. Old test purchase data has been disabled."
      />

      <section className="table-section mt-section">
        <p className="void-warning">
          Supplier Purchases module is being rebuilt. Old test purchase data has been disabled.
        </p>
      </section>
    </>
  );
}
