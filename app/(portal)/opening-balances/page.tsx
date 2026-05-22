import { createOpeningBalance, updateOpeningBalance } from "@/app/actions";
import { DataTable } from "@/components/data-table";
import { ModuleHeader } from "@/components/module-header";
import { bankAccountLabel, branchLabel } from "@/lib/bank-reporting";
import { formatCurrency, formatDate, labelize } from "@/lib/format";
import {
  getOpeningBalanceSetupReferences,
  needsOpeningBalanceCaution,
  openingBalanceSourceReferences,
  openingBalanceTypeLabel,
  openingBalanceTypes,
  openingBalanceVerificationLabel,
  openingBalanceVerificationStatuses,
  type OpeningBalanceSetupReferences
} from "@/lib/opening-balances";
import { requirePermission } from "@/lib/permissions";
import type { OpeningBalance, OpeningBalanceType } from "@/lib/types";

type BalanceGroup = {
  label: string;
  type: OpeningBalanceType;
};

const balanceGroups: BalanceGroup[] = [
  { label: "Bank Accounts", type: "bank_account" },
  { label: "Cash in Hand by Branch", type: "cash_in_hand" },
  { label: "Petty Cash by Branch", type: "petty_cash" },
  { label: "Supplier Outstanding", type: "supplier_outstanding" },
  { label: "Panel Outstanding", type: "panel_outstanding" }
];

function targetLabel(balance: OpeningBalance) {
  if (balance.balance_type === "bank_account") return bankAccountLabel(balance.bank_accounts);
  if (balance.balance_type === "cash_in_hand" || balance.balance_type === "petty_cash") return branchLabel(balance.branches);
  if (balance.balance_type === "supplier_outstanding") return balance.suppliers?.name ?? "-";
  return balance.panel_companies?.name ?? "-";
}

function branchAllocationLabel(balance: OpeningBalance) {
  if (balance.balance_type === "cash_in_hand" || balance.balance_type === "petty_cash") return "-";
  return branchLabel(balance.branches);
}

function verificationTone(balance: OpeningBalance) {
  if (balance.verification_status === "confirmed") return "status-paid";
  if (balance.verification_status === "estimated") return "status-unpaid";
  return "status-partial";
}

function VerificationStatus({ balance }: { balance: OpeningBalance }) {
  return (
    <span className={`status-pill ${verificationTone(balance)}`}>
      {openingBalanceVerificationLabel(balance.verification_status)}
    </span>
  );
}

function VerificationFields({ balance }: { balance?: OpeningBalance }) {
  return (
    <>
      <label>
        Verification status
        <select name="verification_status" defaultValue={balance?.verification_status ?? "pending_review"}>
          {openingBalanceVerificationStatuses.map((status) => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Source reference
        <input
          name="source_reference"
          defaultValue={balance?.source_reference ?? ""}
          list="opening-balance-sources"
          placeholder="bank_statement or other source"
        />
      </label>
      <label className="full-span">
        Source notes
        <textarea name="source_notes" defaultValue={balance?.source_notes ?? ""} placeholder="Statement date, estimate owner, or follow-up note" />
      </label>
    </>
  );
}

function sourceLabel(balance: OpeningBalance) {
  if (!balance.source_reference && !balance.source_notes) return "-";
  return (
    <span>
      {balance.source_reference ? labelize(balance.source_reference) : "-"}
      {balance.source_notes ? <span className="table-subtext">{balance.source_notes}</span> : null}
    </span>
  );
}

function TargetEditFields({
  balance,
  references
}: {
  balance: OpeningBalance;
  references: OpeningBalanceSetupReferences;
}) {
  if (balance.balance_type === "bank_account") {
    return (
      <label>
        Bank account
        <select name="bank_account_id" defaultValue={balance.bank_account_id ?? ""} required>
          {references.bankAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {bankAccountLabel(account)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (balance.balance_type === "cash_in_hand" || balance.balance_type === "petty_cash") {
    return (
      <label>
        Branch
        <select name="branch_id" defaultValue={balance.branch_id ?? ""} required>
          {references.branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (balance.balance_type === "supplier_outstanding") {
    return (
      <>
        <label>
          Supplier
          <select name="supplier_id" defaultValue={balance.supplier_id ?? ""} required>
            {references.suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Branch allocation
          <select name="branch_id" defaultValue={balance.branch_id ?? ""}>
            <option value="">No branch allocation</option>
            {references.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
      </>
    );
  }

  return (
    <>
      <label>
        Panel company
        <select name="panel_company_id" defaultValue={balance.panel_company_id ?? ""} required>
          {references.panelCompanies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Branch allocation
        <select name="branch_id" defaultValue={balance.branch_id ?? ""}>
          <option value="">No branch allocation</option>
          {references.branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function OpeningBalanceEdit({ balance, references }: { balance: OpeningBalance; references: OpeningBalanceSetupReferences }) {
  return (
    <details className="manual-bank-editor">
      <summary>Edit</summary>
      <form action={updateOpeningBalance} className="manual-bank-edit-form">
        <input name="balance_id" type="hidden" value={balance.id} />
        <input name="balance_type" type="hidden" value={balance.balance_type} />
        <label>
          Balance date
          <input name="balance_date" type="date" defaultValue={balance.balance_date} required />
        </label>
        <TargetEditFields balance={balance} references={references} />
        <label>
          Amount
          <input min="0" name="amount" step="0.01" type="number" defaultValue={balance.amount} required />
        </label>
        <VerificationFields balance={balance} />
        <label>
          Notes
          <textarea name="notes" defaultValue={balance.notes ?? ""} />
        </label>
        <button className="primary-button compact-button" type="submit">
          Save
        </button>
      </form>
    </details>
  );
}

export default async function OpeningBalancesPage() {
  await requirePermission("view_settings");
  const references = await getOpeningBalanceSetupReferences();
  const hasUnverifiedBalances = references.balances.some(needsOpeningBalanceCaution);

  return (
    <>
      <ModuleHeader
        eyebrow="Owner setup"
        title="Opening Balances"
        description="Set the starting finance position before real 2026 portal records begin."
      />

      <datalist id="opening-balance-sources">
        {openingBalanceSourceReferences.map((source) => <option key={source} value={source} />)}
      </datalist>

      {hasUnverifiedBalances ? (
        <p className="import-message opening-balance-warning">
          Some opening balances are estimated or pending review. Reports will still calculate using these values, but results should be interpreted with caution.
        </p>
      ) : null}

      <section className="section-grid">
        <form action={createOpeningBalance} className="form-card">
          <h2>Add opening balance</h2>
          <p className="muted-copy">Opening balances seed positions only. They do not create sales, expenses, income, or bank transactions.</p>
          <div className="form-grid">
            <label>
              Balance date
              <input name="balance_date" type="date" defaultValue="2026-01-01" required />
            </label>
            <label>
              Balance type
              <select name="balance_type" required>
                {openingBalanceTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Branch
              <select name="branch_id" defaultValue="">
                <option value="">No branch allocation</option>
                {references.branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Bank account
              <select name="bank_account_id" defaultValue="">
                <option value="">Not a bank balance</option>
                {references.bankAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {bankAccountLabel(account)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Supplier
              <select name="supplier_id" defaultValue="">
                <option value="">Not supplier outstanding</option>
                {references.suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Panel company
              <select name="panel_company_id" defaultValue="">
                <option value="">Not panel outstanding</option>
                {references.panelCompanies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount
              <input min="0" name="amount" step="0.01" type="number" required />
            </label>
            <VerificationFields />
            <label className="full-span">
              Notes
              <textarea name="notes" />
            </label>
          </div>
          <button className="primary-button" type="submit">
            Save opening balance
          </button>
        </form>

        <aside className="report-panel">
          <h2>Target rules</h2>
          <dl className="summary-list">
            <div>
              <dt>Bank account</dt>
              <dd>Select one bank account.</dd>
            </div>
            <div>
              <dt>Cash or petty cash</dt>
              <dd>Select one branch.</dd>
            </div>
            <div>
              <dt>Supplier outstanding</dt>
              <dd>Select the supplier and optionally allocate a branch.</dd>
            </div>
            <div>
              <dt>Panel outstanding</dt>
              <dd>Select the panel company and optionally allocate a branch.</dd>
            </div>
            <div>
              <dt>Confirmed</dt>
              <dd>Verified from a reliable record.</dd>
            </div>
            <div>
              <dt>Estimated</dt>
              <dd>Best estimate available for the starting position.</dd>
            </div>
            <div>
              <dt>Pending Review</dt>
              <dd>Needs follow-up before it can be confirmed.</dd>
            </div>
          </dl>
        </aside>
      </section>

      {balanceGroups.map((group) => {
        const rows = references.balances.filter((balance) => balance.balance_type === group.type);

        return (
          <section className="table-section mt-section" key={group.type}>
            <h2>{group.label}</h2>
            <DataTable
              columns={["Date", "Type", "Target", "Branch allocation", "Amount", "Verification", "Source", "Notes", "Updated", "Edit"]}
              rows={rows.map((balance) => [
                formatDate(balance.balance_date),
                openingBalanceTypeLabel(balance.balance_type),
                targetLabel(balance),
                branchAllocationLabel(balance),
                formatCurrency(balance.amount),
                <VerificationStatus balance={balance} key={`${balance.id}-verification`} />,
                <span key={`${balance.id}-source`}>{sourceLabel(balance)}</span>,
                balance.notes ?? "-",
                formatDate(balance.updated_at),
                <OpeningBalanceEdit balance={balance} key={`${balance.id}-edit`} references={references} />
              ])}
            />
          </section>
        );
      })}
    </>
  );
}
