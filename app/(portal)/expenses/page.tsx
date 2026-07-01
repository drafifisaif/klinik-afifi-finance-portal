import { createExpense, updateExpense, voidExpense } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { DocumentManager } from "@/components/documents/document-manager";
import { ExportCsvLink } from "@/components/export-csv-link";
import { FinanceRecordDetails } from "@/components/finance-record-details";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { isActiveFinancialRecord, resolveReportRange } from "@/lib/bank-reporting";
import { resolveSelectedBranchIds } from "@/lib/branch-reporting";
import { expenseCategories, paymentTypes } from "@/lib/constants";
import { getExpensesReportingData, totalBy } from "@/lib/data";
import { userDisplayLabel } from "@/lib/display";
import { formatCurrency, formatDate, labelize } from "@/lib/format";
import { canViewAllBranches, hasPermission, normalizeRole, requirePermission } from "@/lib/permissions";
import { getTransactionDocuments } from "@/lib/transaction-documents";
import { getVisibleProfilesById } from "@/lib/users";
import { BadgeDollarSign, Building2, ReceiptText, Stethoscope, Truck, Wrench } from "lucide-react";

type ExpensesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function searchValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function monthYearLabel(date: string) {
  return new Intl.DateTimeFormat("en-MY", { month: "long", timeZone: "UTC", year: "numeric" }).format(new Date(`${date}T00:00:00Z`));
}

function reportRangeLabel(range: ReturnType<typeof resolveReportRange>) {
  if (range.range === "this_month") return `This Month: ${monthYearLabel(range.startDate)}`;
  if (range.range === "last_month") return `Last Month: ${monthYearLabel(range.startDate)}`;
  return `${formatDate(range.startDate)} - ${formatDate(range.endDate)}`;
}

export default async function ExpensesPage({ searchParams }: ExpensesPageProps) {
  const profile = await requirePermission("edit_finance");
  const params = searchParams ? await searchParams : {};
  const reportRange = resolveReportRange({
    end: searchValue(params.end) ?? undefined,
    month: searchValue(params.month) ?? undefined,
    range: searchValue(params.range) ?? undefined,
    start: searchValue(params.start) ?? undefined
  });
  const canViewSupplierPayments = hasPermission(profile, "view_supplier_payments");
  const canSelectMultipleBranches = canViewAllBranches(profile);
  const data = await getExpensesReportingData();
  const selectedBranchIds = resolveSelectedBranchIds({
    allowedBranches: data.branches,
    branchParam: params.branch,
    branchesParam: params.branches,
    canSelectMultiple: canSelectMultipleBranches
  });
  const selectedBranchIdSet = new Set(selectedBranchIds);
  const selectedBranches = data.branches.filter((branch) => selectedBranchIdSet.has(branch.id));
  const selectedBranchLabel = selectedBranches.length === data.branches.length
    ? "All Branches"
    : selectedBranches.map((branch) => branch.name).join(", ");
  const expenseDocuments = await getTransactionDocuments("expenses", data.expenses.map((expense) => expense.id));
  const supplierPaymentDocuments = canViewSupplierPayments
    ? await getTransactionDocuments("supplier_payment_entries", data.supplierPayments.map((payment) => payment.id))
    : new Map();
  const visibleUsers = await getVisibleProfilesById(data.expenses.flatMap((expense) => [expense.entered_by, expense.voided_by]));
  const userById = new Map(visibleUsers.map((user) => [user.id, user]));
  const canDeleteDocuments = normalizeRole(profile.role) !== "branch_pic";
  const filteredExpenses = data.expenses.filter((expense) => {
    return selectedBranchIdSet.has(expense.branch_id)
      && expense.expense_date >= reportRange.startDate
      && expense.expense_date <= reportRange.endDate;
  });
  const filteredSupplierPayments = data.supplierPayments.filter((payment) => {
    return selectedBranchIdSet.has(payment.branch_id)
      && payment.payment_date >= reportRange.startDate
      && payment.payment_date <= reportRange.endDate;
  });
  const activeExpenses = filteredExpenses.filter(isActiveFinancialRecord);
  const activeSupplierPayments = filteredSupplierPayments.filter((payment) => !payment.is_void);
  const operatingTotal = totalBy(activeExpenses, (expense) => expense.amount);
  const supplierPaymentTotal = totalBy(activeSupplierPayments, (payment) => payment.amount);
  const salaryTotal = totalBy(
    activeExpenses.filter((expense) => expense.category === "salary"),
    (expense) => expense.amount
  );
  const locumDoctorTotal = totalBy(
    activeExpenses.filter((expense) => expense.category.trim().toLowerCase() === "locum_doctor"),
    (expense) => expense.amount
  );
  const rentalTotal = totalBy(
    activeExpenses.filter((expense) => expense.category === "rental"),
    (expense) => expense.amount
  );
  const otherCategoriesTotal = operatingTotal - salaryTotal - locumDoctorTotal - rentalTotal;
  const selectedBranchValue = selectedBranches.length === data.branches.length ? "all" : (selectedBranches[0]?.id ?? "all");
  const exportParams = {
    branch: selectedBranchValue,
    end: reportRange.endDate,
    range: reportRange.range,
    start: reportRange.startDate
  };

  return (
    <>
      <ModuleHeader
        eyebrow="Cost control"
        title="Expenses entry"
        description="Capture branch operating expenses by the V1 finance categories, separate from supplier purchase cost tracking."
      />

      <section className="dashboard-grid">
        <MetricCard icon={ReceiptText} label="Operating Expenses" value={formatCurrency(operatingTotal)} detail={reportRangeLabel(reportRange)} />
        {canViewSupplierPayments ? (
          <MetricCard icon={Truck} label="Supplier Payments" value={formatCurrency(supplierPaymentTotal)} tone="blue" />
        ) : null}
        {canViewSupplierPayments ? (
          <MetricCard icon={BadgeDollarSign} label="Total Paid Out" value={formatCurrency(operatingTotal + supplierPaymentTotal)} tone="amber" />
        ) : null}
        <MetricCard icon={BadgeDollarSign} label="Salary" value={formatCurrency(salaryTotal)} tone="blue" />
        <MetricCard icon={Stethoscope} label="Locum Doctor" value={formatCurrency(locumDoctorTotal)} tone="amber" />
        <MetricCard icon={Building2} label="Rental" value={formatCurrency(rentalTotal)} tone="rose" />
        <MetricCard icon={Wrench} label="Other categories" value={formatCurrency(otherCategoriesTotal)} tone="rose" />
      </section>

      <section className="table-section mt-section">
        <div className="report-toolbar">
          <h2>Expenses report</h2>
          <ExportCsvLink
            label="Export expenses CSV"
            report="expenses"
            searchParams={exportParams}
          />
        </div>
        <form className="reporting-filter" method="get">
          <label>
            Report range
            <select defaultValue={reportRange.range} name="range">
              <option value="this_month">This month</option>
              <option value="last_month">Last month</option>
              <option value="custom">Custom date range</option>
            </select>
          </label>
          {reportRange.range === "custom" ? (
            <>
              <label>
                Start date
                <input defaultValue={reportRange.startDate} name="start" type="date" />
              </label>
              <label>
                End date
                <input defaultValue={reportRange.endDate} name="end" type="date" />
              </label>
            </>
          ) : (
            <>
              <input name="start" type="hidden" value={reportRange.startDate} />
              <input name="end" type="hidden" value={reportRange.endDate} />
            </>
          )}
          {canSelectMultipleBranches ? (
            <label>
              Branch
              <select defaultValue={selectedBranchValue} name="branch">
                <option value="all">All Branches</option>
                {data.branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <input name="branch" type="hidden" value={profile.branch_id ?? ""} />
          )}
          <button className="primary-button" type="submit">
            Apply
          </button>
          <p className="selected-branches">Showing {reportRangeLabel(reportRange)} for {selectedBranchLabel}</p>
          {reportRange.error ? <p className="form-error">{reportRange.error}</p> : null}
        </form>
      </section>

      <section className="table-section mt-section">
        <h2>Operating Expenses</h2>
        <DataTable
          columns={["Date", "Branch", "Category", "Vendor", "Description", "Payment", "Amount", "Status", "View details", "Edit", "Void", "Documents"]}
          rows={filteredExpenses.map((expense) => [
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

      {canViewSupplierPayments ? (
        <section className="table-section mt-section">
          <h2>Supplier Payments</h2>
          <DataTable
            columns={["Payment Date", "Branch", "Supplier", "Linked Invoice / Purchase", "Payment Method", "Paid From", "Amount", "Reference", "Notes", "Documents", "Status"]}
            rows={filteredSupplierPayments.map((payment) => [
              formatDate(payment.payment_date),
              payment.branches?.name ?? "-",
              payment.suppliers?.name ?? "-",
              payment.supplier_purchase_entries?.invoice_no ?? payment.supplier_purchase_entry_id ?? "General payment",
              labelize(payment.payment_method ?? "bank_transfer"),
              payment.bank_accounts?.name ?? "-",
              formatCurrency(payment.amount),
              payment.reference_no ?? "-",
              payment.notes ?? "-",
              <DocumentManager
                canDelete={canDeleteDocuments}
                documents={supplierPaymentDocuments.get(payment.id) ?? []}
                entityId={payment.id}
                entityName="supplier_payment_entries"
                key={`${payment.id}-payment-documents`}
              />,
              <span className={`status-pill ${payment.is_void ? "status-voided" : "status-paid"}`} key={`${payment.id}-payment-status`}>
                {payment.is_void ? "Voided" : "Active"}
              </span>
            ])}
          />
        </section>
      ) : null}

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
