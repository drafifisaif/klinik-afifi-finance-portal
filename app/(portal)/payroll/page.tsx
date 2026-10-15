import { createPayrollExpense } from "@/app/actions";
import { DocumentManager } from "@/components/documents/document-manager";
import { MetricCard } from "@/components/metric-card";
import { ModuleHeader } from "@/components/module-header";
import { expenseCategories, paymentTypes } from "@/lib/constants";
import { getExpensesReportingData } from "@/lib/data";
import { userDisplayLabel } from "@/lib/display";
import { formatCurrency, formatDate, labelize } from "@/lib/format";
import { normalizeRole, requirePermission } from "@/lib/permissions";
import { getTransactionDocuments } from "@/lib/transaction-documents";
import { getVisibleProfilesById } from "@/lib/users";
import { BadgeDollarSign, Building2, CalendarDays, ReceiptText } from "lucide-react";

type PayrollPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const payrollCategories = new Set(["salary", "kwsp", "socso", "eis", "other_payroll"]);

function searchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function currentMalaysiaMonth() {
  return new Intl.DateTimeFormat("en-CA", { month: "2-digit", timeZone: "Asia/Kuching", year: "numeric" }).format(new Date());
}

function currentMalaysiaDate() {
  return new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone: "Asia/Kuching", year: "numeric" }).format(new Date());
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}-01T00:00:00Z`));
}

export default async function PayrollPage({ searchParams }: PayrollPageProps) {
  const profile = await requirePermission("view_payroll");
  const params = searchParams ? await searchParams : {};
  const data = await getExpensesReportingData();
  const selectedMonth = /^\d{4}-\d{2}$/.test(searchValue(params.month) ?? "") ? searchValue(params.month)! : currentMalaysiaMonth();
  const selectedBranch = searchValue(params.branch) ?? "all";
  const expenses = data.expenses.filter((expense) => {
    return payrollCategories.has(String(expense.category))
      && (expense.payroll_month ?? "").slice(0, 7) === selectedMonth
      && (selectedBranch === "all" || expense.branch_id === selectedBranch);
  }).sort((a, b) => b.expense_date.localeCompare(a.expense_date));
  const activeExpenses = expenses.filter((expense) => !expense.is_void);
  const salaryTotal = activeExpenses.filter((expense) => expense.category === "salary").reduce((sum, expense) => sum + Number(expense.amount), 0);
  const contributionTotal = activeExpenses.filter((expense) => ["kwsp", "socso", "eis"].includes(expense.category)).reduce((sum, expense) => sum + Number(expense.amount), 0);
  const total = activeExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
  const documents = await getTransactionDocuments("expenses", activeExpenses.map((expense) => expense.id));
  const users = await getVisibleProfilesById(activeExpenses.map((expense) => expense.entered_by));
  const usersById = new Map(users.map((user) => [user.id, user]));
  const categoryLabels = new Map(expenseCategories.map(({ value, label }) => [value, label]));
  const role = normalizeRole(profile.role);

  return (
    <>
      <ModuleHeader
        eyebrow="PAYROLL & STATUTORY"
        title="Gaji & Caruman"
        description="Rekod bayaran gaji dan caruman majikan mengikut bulan payroll dan cawangan."
      />

      <section className="dashboard-grid">
        <MetricCard icon={BadgeDollarSign} label="Jumlah gaji" value={formatCurrency(salaryTotal)} detail={monthLabel(selectedMonth)} />
        <MetricCard icon={Building2} label="Caruman majikan" value={formatCurrency(contributionTotal)} detail="KWSP, SOCSO dan EIS" tone="blue" />
        <MetricCard icon={ReceiptText} label="Jumlah direkodkan" value={formatCurrency(total)} detail={`${activeExpenses.length} rekod aktif`} tone="amber" />
        <MetricCard icon={CalendarDays} label="Bulan payroll" value={monthLabel(selectedMonth)} detail="Ikut bulan gaji, bukan tarikh bayaran" tone="rose" />
      </section>

      <section className="table-section mt-section">
        <form className="payroll-filters" method="get">
          <label>
            Bulan payroll
            <input type="month" name="month" defaultValue={selectedMonth} />
          </label>
          <label>
            Cawangan
            <select name="branch" defaultValue={selectedBranch}>
              <option value="all">Semua cawangan</option>
              {data.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <button className="primary-button" type="submit">Tapis</button>
        </form>
      </section>

      <section className="form-card mt-section">
        <div>
          <h2>Tambah bayaran payroll</h2>
          <p className="payroll-guidance">Masukkan gaji kasar serta bahagian caruman majikan sahaja. Potongan pekerja seperti KWSP pekerja atau PCB ialah liabiliti, bukan belanja tambahan.</p>
        </div>
        <form action={createPayrollExpense} className="form-grid payroll-entry-form">
          <label>
            Bulan payroll
            <input type="month" name="payroll_month" defaultValue={selectedMonth} required />
          </label>
          <label>
            Tarikh bayaran
            <input type="date" name="expense_date" defaultValue={currentMalaysiaDate()} required />
          </label>
          <label>
            Cawangan
            <select name="branch_id" required defaultValue={selectedBranch === "all" ? "" : selectedBranch}>
              <option value="" disabled>Pilih cawangan</option>
              {data.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <label>
            Jenis bayaran
            <select name="category" required defaultValue="salary">
              {expenseCategories.filter((category) => payrollCategories.has(category.value)).map((category) => (
                <option key={category.value} value={category.value}>{category.label}</option>
              ))}
            </select>
          </label>
          <label>
            Penerima / agensi
            <input name="vendor_name" placeholder="Contoh: Gaji staf / KWSP" />
          </label>
          <label>
            Kaedah bayaran
            <select name="payment_type" required defaultValue="bank_transfer">
              {paymentTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </label>
          <label>
            Jumlah (RM)
            <input type="number" name="amount" min="0.01" step="0.01" required />
          </label>
          <label className="payroll-description">
            Catatan
            <textarea name="description" placeholder="Contoh: Gaji Oktober atau caruman majikan untuk bulan Oktober" rows={3} />
          </label>
          <button className="primary-button" type="submit">Simpan bayaran</button>
        </form>
      </section>

      <section className="table-section mt-section">
        <div className="payroll-list-heading">
          <div>
            <h2>Rekod {monthLabel(selectedMonth)}</h2>
            <p>{selectedBranch === "all" ? "Semua cawangan" : data.branches.find((branch) => branch.id === selectedBranch)?.name ?? "Cawangan"}</p>
          </div>
          <strong>{formatCurrency(total)}</strong>
        </div>
        {expenses.length ? (
          <div className="payroll-record-list">
            {expenses.map((expense) => (
              <article className={`payroll-record${expense.is_void ? " is-void" : ""}`} key={expense.id}>
                <div className="payroll-record-main">
                  <div>
                    <strong>{categoryLabels.get(expense.category) ?? labelize(expense.category)}</strong>
                    <p>{expense.vendor_name || expense.description}</p>
                  </div>
                  <div className="payroll-record-amount">
                    <strong>{formatCurrency(expense.amount)}</strong>
                    <span>{expense.is_void ? "Dibatalkan" : labelize(expense.payment_type)}</span>
                  </div>
                </div>
                <div className="payroll-record-meta">
                  <span>{expense.branches?.name ?? data.branches.find((branch) => branch.id === expense.branch_id)?.name ?? "-"}</span>
                  <span>Bayar {formatDate(expense.expense_date)}</span>
                  <span>Direkod oleh {usersById.has(expense.entered_by ?? "") ? userDisplayLabel(usersById.get(expense.entered_by!)!) : "Finance"}</span>
                </div>
                {expense.description && expense.vendor_name ? <p className="payroll-record-note">{expense.description}</p> : null}
                {!expense.is_void ? (
                  <details className="payroll-documents">
                    <summary>Bukti bayaran ({documents.get(expense.id)?.length ?? 0})</summary>
                    <DocumentManager
                      canDelete={role === "owner" || role === "finance"}
                      documents={documents.get(expense.id) ?? []}
                      entityId={expense.id}
                      entityName="expenses"
                    />
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">Belum ada bayaran payroll untuk pilihan ini.</p>
        )}
      </section>

      <p className="payroll-footnote">Rekod ini menggunakan tarikh bayaran sebenar untuk aliran tunai dan laporan belanja. Bulan payroll hanya untuk penapisan gaji. Cawangan PIC tidak dapat melihat butiran payroll.</p>
    </>
  );
}
