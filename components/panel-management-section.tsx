import { createPanelCompany, updatePanelCompany } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import type { PanelCompany, Profile } from "@/lib/types";

type PanelManagementSectionProps = {
  canManageMasterData: boolean;
  panelCompanies: PanelCompany[];
  profile: Pick<Profile, "role" | "is_active"> | null;
};

export function PanelManagementSection({ canManageMasterData, panelCompanies }: PanelManagementSectionProps) {
  return (
    <section className="panel-management-layout mt-section">
      <div className="panel-management-stack">
        {canManageMasterData ? (
          <form action={createPanelCompany} className="form-card panel-management-form">
            <h2>Panel company management</h2>
            <div className="panel-management-form-grid">
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
              <label className="panel-management-field-full">
                Address
                <textarea name="address" />
              </label>
              <label className="panel-management-field-full">
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
            </div>
            <div className="panel-management-actions">
              <button className="primary-button" type="submit">
                Add Panel Company
              </button>
            </div>
          </form>
        ) : null}

        <div className="table-section panel-management-directory">
          <div className="report-toolbar">
            <h2>Panel company directory</h2>
          </div>
          <DataTable
            columns={["Company", "Contact", "Phone", "Email", "Status", "Edit"]}
            rowKeys={panelCompanies.map((company) => company.id)}
            rows={panelCompanies.map((company) => [
              company.name,
              company.contact_person ?? "-",
              company.phone ?? "-",
              company.email ?? "-",
              <span className={`status-pill ${company.is_active ? "status-paid" : "status-overdue"}`} key={`${company.id}-status`}>
                {company.is_active ? "Active" : "Inactive"}
              </span>,
              canManageMasterData ? (
                <details className="manual-bank-editor" key={`${company.id}-edit`}>
                  <summary>Edit</summary>
                  <form action={updatePanelCompany} className="manual-bank-edit-form">
                    <input name="panel_company_id" type="hidden" value={company.id} />
                    <label>
                      Company name
                      <input defaultValue={company.name} name="name" required />
                    </label>
                    <label>
                      Contact person
                      <input defaultValue={company.contact_person ?? ""} name="contact_person" />
                    </label>
                    <label>
                      Phone
                      <input defaultValue={company.phone ?? ""} name="phone" />
                    </label>
                    <label>
                      Email
                      <input defaultValue={company.email ?? ""} name="email" type="email" />
                    </label>
                    <label>
                      Address
                      <textarea defaultValue={company.address ?? ""} name="address" />
                    </label>
                    <label>
                      Notes
                      <textarea defaultValue={company.notes ?? ""} name="notes" />
                    </label>
                    <label>
                      Status
                      <select defaultValue={company.is_active ? "true" : "false"} name="is_active">
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
  );
}
