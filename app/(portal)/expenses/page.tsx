import { createExpense } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { DocumentManager } from "@/components/documents/document-manager";
import { ExportCsvLink } from "@/components/export-csv-link";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { expenseCategories, paymentTypes } from "@/lib/constants";
import { getDashboardData, totalBy } from "@/lib/data";
import { formatCurrency, formatDate, labelize } from "@/lib/format";
import { normalizeRole, requirePermission } from "@/lib/permissions";
import { getTransactionDocuments } from "@/lib/transaction-documents";
import { BadgeDollarSign, Building2, ReceiptText, Wrench } from "lucide-react";

export default async function ExpensesPage() {
  const profile = await requirePermission("edit_finance");
  const data = await getDashboardData();
  const expenseDocuments = await getTransactionDocuments("expenses", data.expenses.map((expense) => expense.id));
  const canDeleteDocuments = normalizeRole(profile.role) !== "branch_pic";
  const operatingTotal = totalBy(data.expenses, (expense) => expense.amount);
  const salaryTotal = totalBy(
    data.expenses.filter((expense) => expense.category === "salary"),
    (expense) => expense.amount
  );
  const rentalTotal = totalBy(
    data.expenses.filter((expense) => expense.category === "rental"),
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

      <section className="section-grid">
        <div className="table-section">
          <div className="report-toolbar">
            <h2>Expenses report</h2>
            <ExportCsvLink label="Export expenses CSV" report="expenses" />
          </div>
          <DataTable
            columns={["Date", "Branch", "Category", "Vendor", "Description", "Payment", "Amount", "Documents"]}
            rows={data.expenses.map((expense) => [
              formatDate(expense.expense_date),
              expense.branches?.name ?? "-",
              labelize(expense.category),
              expense.vendor_name ?? "-",
              expense.description,
              labelize(expense.payment_type),
              formatCurrency(expense.amount),
              <DocumentManager
                canDelete={canDeleteDocuments}
                documents={expenseDocuments.get(expense.id) ?? []}
                entityId={expense.id}
                entityName="expenses"
                key={`${expense.id}-documents`}
              />
            ])}
          />
        </div>

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
