import { createExpense, updateExpense, voidExpense } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { DocumentManager } from "@/components/documents/document-manager";
import { ExportCsvLink } from "@/components/export-csv-link";
import { FinanceRecordDetails } from "@/components/finance-record-details";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { isActiveFinancialRecord } from "@/lib/bank-reporting";
import { expenseCategories, paymentTypes } from "@/lib/constants";
import { getDashboardData, totalBy } from "@/lib/data";
import { userDisplayLabel } from "@/lib/display";
import { formatCurrency, formatDate, labelize } from "@/lib/format";
import { normalizeRole, requirePermission } from "@/lib/permissions";
import { getTransactionDocuments } from "@/lib/transaction-documents";
import { getVisibleProfilesById } from "@/lib/users";
import { BadgeDollarSign, Building2, ReceiptText, Wrench } from "lucide-react";

export default async function ExpensesPage() {
  const profile = await requirePermission("edit_finance");
  const data = await getDashboardData();
  const expenseDocuments = await getTransactionDocuments("expenses", data.expenses.map((expense) => expense.id));
  const visibleUsers = await getVisibleProfilesById(data.expenses.flatMap((expense) => [expense.entered_by, expense.voided_by]));
  const userById = new Map(visibleUsers.map((user) => [user.id, user]));
  const canDeleteDocuments = normalizeRole(profile.role) !== "branch_pic";
  const activeExpenses = data.expenses.filter(isActiveFinancialRecord);
  const operatingTotal = totalBy(activeExpenses, (expense) => expense.amount);
  const salaryTotal = totalBy(
    activeExpenses.filter((expense) => expense.category === "salary"),
    (expense) => expense.amount
  );
  const rentalTotal = totalBy(
    activeExpenses.filter((expense) => expense.category === "rental"),
    (expense) => expense.amount
  );

  return (
    <>
      <ModuleHeader
        eyebrow="Cost control"
        title="Expenses entry"
        description="Capture branch operating expenses by the V1 finance categories, separate from supplier purchase cost tracking."
      />

      <section className="dashboard-grid">
        <MetricCard icon={ReceiptText} label="Total expenses" value={formatCurrency(operatingTotal)} />
        <MetricCard icon={BadgeDollarSign} label="Salary" value={formatCurrency(salaryTotal)} tone="blue" />
        <MetricCard icon={Building2} label="Rental" value={formatCurrency(rentalTotal)} tone="amber" />
        <MetricCard icon={Wrench} label="Other categories" value={formatCurrency(operatingTotal - salaryTotal - rentalTotal)} tone="rose" />
      </section>

      <section className="table-section mt-section">
        <div className="report-toolbar">
          <h2>Expenses report</h2>
          <ExportCsvLink label="Export expenses CSV" report="expenses" />
        </div>
        <DataTable
          columns={["Date", "Branch", "Category", "Vendor", "Description", "Payment", "Amount", "Status", "View details", "Edit", "Void", "Documents"]}
          rows={data.expenses.map((expense) => [
            formatDate(expense.expense_date),
            expense.branches?.name ?? "-",
            labelize(expense.category),
            expense.vendor_name ?? "-",
            expense.description,
            labelize(expense.payment_type),
            formatCurrency(expense.amount),
            <span className={`status-pill ${expense.is_void ? "status-voided" : "status-paid"}`} key={`${expense.id}-status`}>
              {expense.is_void ? "VOIDED" : "Active"}
            </span>,
            <FinanceRecordDetails
              enteredBy={userDisplayLabel(userById.get(expense.entered_by ?? ""), expense.entered_by)}
              key={`${expense.id}-details`}
              originalSummary={`Expense • ${expense.branches?.name ?? "-"} • ${formatDate(expense.expense_date)} • ${formatCurrency(expense.amount)}`}
              recordId={expense.id}
              status={expense.is_void ? "Voided" : "Active"}
              voidReason={expense.void_reason}
              voidedAt={expense.voided_at}
              voidedBy={userDisplayLabel(userById.get(expense.voided_by ?? ""), expense.voided_by)}
            />,
            !expense.is_void ? (
              <details className="manual-bank-editor" key={`${expense.id}-edit`}>
                <summary>Edit</summary>
                <form action={updateExpense} className="manual-bank-edit-form">
                  <input name="expense_id" type="hidden" value={expense.id} />
                  <label>
                    Date
                    <input defaultValue={expense.expense_date} name="expense_date" required type="date" />
                  </label>
                  <label>
                    Branch
                    <select defaultValue={expense.branch_id} name="branch_id" required>
                      {data.branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Category
                    <select defaultValue={expense.category} name="category" required>
                      {expenseCategories.map((category) => (
                        <option key={category.value} value={category.value}>
                          {category.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Payment type
                    <select defaultValue={expense.payment_type} name="payment_type" required>
                      {paymentTypes.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Vendor
                    <input defaultValue={expense.vendor_name ?? ""} name="vendor_name" />
                  </label>
                  <label>
                    Amount
                    <input defaultValue={expense.amount} min="0" name="amount" required step="0.01" type="number" />
                  </label>
                  <label>
                    Description
                    <textarea defaultValue={expense.description} name="description" required />
                  </label>
                  <button className="primary-button compact-button" type="submit">
                    Save
                  </button>
                </form>
              </details>
            ) : (
              "-"
            ),
            !expense.is_void ? (
              <details className="manual-bank-editor" key={`${expense.id}-void`}>
                <summary>Void</summary>
                <form action={voidExpense} className="manual-bank-edit-form void-record-form">
                  <input name="expense_id" type="hidden" value={expense.id} />
                  <p className="void-warning">Voided records stay in history and are excluded from reports.</p>
                  <label>
                    Void reason
                    <textarea name="void_reason" required />
                  </label>
                  <button className="primary-button compact-button" type="submit">
                    Confirm void
                  </button>
                </form>
              </details>
            ) : (
              "-"
            ),
            <DocumentManager
              canDelete={canDeleteDocuments}
              documents={expenseDocuments.get(expense.id) ?? []}
              entityId={expense.id}
              entityName="expenses"
              key={`${expense.id}-documents`}
            />
          ])}
        />
      </section>

      <section className="section-grid mt-section">
        <form action={createExpense} className="form-card">
          <h2>Record expense</h2>
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
            Date
            <input name="expense_date" type="date" required />
          </label>
          <label>
            Category
            <select name="category" required>
              {expenseCategories.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Payment type
            <select name="payment_type" required>
              {paymentTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Vendor
            <input name="vendor_name" placeholder="Vendor or payee" />
          </label>
          <label>
            Amount
            <input min="0" name="amount" required step="0.01" type="number" />
          </label>
          <label>
            Description
            <textarea name="description" required />
          </label>
          <button className="primary-button" type="submit">
            Save expense
          </button>
        </form>
      </section>
    </>
  );
}
