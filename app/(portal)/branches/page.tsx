import { createBranch } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { ModuleHeader } from "@/components/module-header";
import { getDashboardData } from "@/lib/data";

export default async function BranchesPage() {
  const data = await getDashboardData();

  return (
    <>
      <ModuleHeader
        eyebrow="Clinic network"
        title="Branch management"
        description="Maintain Klinik Afifi branch records for finance entry, reporting, and branch-scoped access."
      />

      <section className="section-grid">
        <DataTable
          columns={["Branch", "Code", "Phone", "Status"]}
          rows={data.branches.map((branch) => [
            branch.name,
            branch.code,
            branch.phone ?? "-",
            branch.is_active ? "Active" : "Inactive"
          ])}
        />

        <form action={createBranch} className="form-card">
          <h2>New branch</h2>
          <label>
            Branch name
            <input name="name" placeholder="Kota Belud" required />
          </label>
          <label>
            Code
            <input name="code" placeholder="KBD" required />
          </label>
          <label>
            Phone
            <input name="phone" placeholder="088-000 000" />
          </label>
          <label>
            Address
            <textarea name="address" placeholder="Branch address" />
          </label>
          <button className="primary-button" type="submit">
            Add branch
          </button>
        </form>
      </section>
    </>
  );
}
