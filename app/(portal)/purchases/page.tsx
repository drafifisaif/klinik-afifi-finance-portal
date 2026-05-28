import { ModuleHeader } from "@/components/module-header";
import { requirePermission } from "@/lib/permissions";

export default async function PurchasesPage() {
  await requirePermission("view_dashboard");

  return (
    <>
      <ModuleHeader
        eyebrow="Supplier cost"
        title="Supplier purchases"
        description="Supplier Purchases module is temporarily disabled while the new version is being prepared."
      />

      <section className="table-section mt-section">
        <p className="void-warning">
          Supplier Purchases module is temporarily disabled while the new version is being prepared.
        </p>
      </section>
    </>
  );
}
