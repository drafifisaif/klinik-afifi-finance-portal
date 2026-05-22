import { ImportWorkspace } from "@/components/import/import-workspace";
import { ModuleHeader } from "@/components/module-header";
import { getImportReferenceData } from "@/lib/data";
import { normalizeRole, requirePermission } from "@/lib/permissions";

export default async function ImportPage() {
  const profile = await requirePermission("import_data");
  const references = await getImportReferenceData();

  return (
    <>
      <ModuleHeader
        eyebrow="Bulk operations"
        title="Import finance data"
        description="Upload CSV files, validate rows, detect duplicates, preview issues, and import only clean finance records into Supabase."
      />

      <ImportWorkspace allowOpeningBalanceImports={normalizeRole(profile.role) === "owner"} references={references} />
    </>
  );
}
