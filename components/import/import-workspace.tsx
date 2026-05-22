"use client";

import { useMemo, useState } from "react";
import { importFinanceRows } from "@/app/actions";
import { parseCsv, normalizeValue } from "@/lib/csv";
import {
  importConfigs,
  importTypeOptions,
  templateCsvFor,
  validExpenseCategories,
  validOpeningBalanceTypes,
  validOpeningBalanceVerificationStatuses,
  validPaymentStatuses,
  validPaymentTypes,
  validPurchaseCategories,
  type ImportType
} from "@/lib/import-config";
import { createClient } from "@/lib/supabase-client";
import type { BankAccount, Branch, PanelCompany, Supplier, SupplierPurchase } from "@/lib/types";
import { CheckCircle2, Download, UploadCloud } from "lucide-react";

type ImportReferenceData = {
  bankAccounts: BankAccount[];
  branches: Branch[];
  suppliers: Supplier[];
  panelCompanies: PanelCompany[];
  purchases: SupplierPurchase[];
};

type ImportPayload = Record<string, string | number | null>;

type ReviewedRow = {
  rowNumber: number;
  source: Record<string, string>;
  payload: ImportPayload | null;
  errors: string[];
};

type ImportWorkspaceProps = {
  allowOpeningBalanceImports: boolean;
  references: ImportReferenceData;
};

type LookupMaps = {
  bankAccounts: Map<string, BankAccount>;
  branches: Map<string, Branch>;
  suppliers: Map<string, Supplier>;
  panels: Map<string, PanelCompany>;
  purchases: Map<string, SupplierPurchase>;
};

export function ImportWorkspace({ allowOpeningBalanceImports, references }: ImportWorkspaceProps) {
  const [importType, setImportType] = useState<ImportType>("daily_sales");
  const [fileName, setFileName] = useState("");
  const [rawCsv, setRawCsv] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ReviewedRow[]>([]);
  const [message, setMessage] = useState("");
  const [isWorking, setIsWorking] = useState(false);

  const config = importConfigs[importType];
  const allowedImportTypeOptions = importTypeOptions.filter((option) => allowOpeningBalanceImports || option.value !== "opening_balances");
  const validRows = rows.filter((row) => row.payload && row.errors.length === 0);
  const invalidRows = rows.length - validRows.length;

  const lookups = useMemo<LookupMaps>(() => {
    const branchMap = new Map<string, Branch>();
    references.branches.forEach((branch) => {
      [branch.id, branch.name, branch.code].forEach((value) => branchMap.set(normalizeValue(value), branch));
    });

    const bankAccountMap = new Map<string, BankAccount>();
    references.bankAccounts.forEach((account) => {
      [account.id, account.name].forEach((value) => bankAccountMap.set(normalizeValue(value), account));
    });

    const supplierMap = new Map<string, Supplier>();
    references.suppliers.forEach((supplier) => {
      [supplier.id, supplier.name].forEach((value) => supplierMap.set(normalizeValue(value), supplier));
    });

    const panelMap = new Map<string, PanelCompany>();
    references.panelCompanies.forEach((panel) => {
      [panel.id, panel.name].forEach((value) => panelMap.set(normalizeValue(value), panel));
    });

    const purchaseMap = new Map<string, SupplierPurchase>();
    references.purchases.forEach((purchase) => {
      if (purchase.invoice_no) {
        purchaseMap.set(normalizeValue(purchase.invoice_no), purchase);
        purchaseMap.set(`${purchase.supplier_id}:${normalizeValue(purchase.invoice_no)}`, purchase);
      }
    });

    return {
      branches: branchMap,
      bankAccounts: bankAccountMap,
      suppliers: supplierMap,
      panels: panelMap,
      purchases: purchaseMap
    };
  }, [references]);

  async function handleFile(file: File | null) {
    setMessage("");
    setRows([]);
    setHeaders([]);

    if (!file) {
      setFileName("");
      setRawCsv("");
      return;
    }

    const text = await file.text();
    setFileName(file.name);
    setRawCsv(text);
    await analyzeCsv(text, importType);
  }

  async function handleTypeChange(nextType: ImportType) {
    setImportType(nextType);
    setMessage("");
    setRows([]);
    setHeaders([]);
    if (rawCsv) await analyzeCsv(rawCsv, nextType);
  }

  async function analyzeCsv(csv: string, type: ImportType) {
    setIsWorking(true);
    try {
      const parsed = parseCsv(csv);
      const missingColumns = importConfigs[type].requiredColumns.filter((column) => !parsed.headers.includes(column));
      const reviewed = parsed.rows
        .map((row, index) => validateRow(type, row, index + 2, lookups))
        .map((row) => missingColumns.length
          ? { ...row, errors: [...row.errors, `Missing CSV columns: ${missingColumns.join(", ")}`] }
          : row);
      const withCsvDuplicates = markCsvDuplicates(type, reviewed);
      const withDatabaseDuplicates = await markDatabaseDuplicates(type, withCsvDuplicates);

      setHeaders(parsed.headers);
      setRows(withDatabaseDuplicates);
      setMessage(
        missingColumns.length
          ? `Missing required columns: ${missingColumns.join(", ")}`
          : `Parsed ${parsed.rows.length} rows from ${fileName || "CSV"}.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not parse this CSV file.");
      setRows([]);
    } finally {
      setIsWorking(false);
    }
  }

  async function handleImport() {
    if (!validRows.length) return;
    const confirmed = window.confirm(`Import ${validRows.length} valid ${config.label} rows? Existing records will not be overwritten.`);
    if (!confirmed) return;

    setIsWorking(true);
    setMessage("");
    try {
      const payloads = validRows.map((row) => row.payload as ImportPayload);
      await importFinanceRows(importType, payloads);
      setMessage(`Imported ${payloads.length} ${config.label} rows successfully.`);
      setRows((currentRows) =>
        currentRows.map((row) =>
          row.payload && row.errors.length === 0 ? { ...row, errors: ["Imported in this session."] } : row
        )
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setIsWorking(false);
    }
  }

  function downloadTemplate(type: ImportType) {
    const blob = new Blob([templateCsvFor(type)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${type}_template.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="import-workspace">
      <section className="report-panel import-control-panel">
        <div>
          <h2>Upload CSV</h2>
          <p>{config.description}</p>
        </div>

        <div className="form-grid">
          <label>
            Import type
            <select value={importType} onChange={(event) => handleTypeChange(event.target.value as ImportType)}>
              {allowedImportTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            CSV file
            <input accept=".csv,text/csv" type="file" onChange={(event) => handleFile(event.target.files?.[0] ?? null)} />
          </label>
        </div>

        <div className="import-template-grid">
          {allowedImportTypeOptions.map((option) => (
            <button className="ghost-button" key={option.value} onClick={() => downloadTemplate(option.value)} type="button">
              <Download size={16} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>

        <dl className="import-stats">
          <div>
            <dt>File</dt>
            <dd>{fileName || "No file selected"}</dd>
          </div>
          <div>
            <dt>Required columns</dt>
            <dd>{config.requiredColumns.join(", ")}</dd>
          </div>
          <div>
            <dt>Valid rows</dt>
            <dd>{validRows.length}</dd>
          </div>
          <div>
            <dt>Invalid rows</dt>
            <dd>{invalidRows}</dd>
          </div>
        </dl>

        {message ? <p className="import-message">{message}</p> : null}

        <button className="primary-button" disabled={isWorking || !validRows.length} onClick={handleImport} type="button">
          <UploadCloud size={17} />
          <span>{isWorking ? "Working..." : `Import ${validRows.length} valid rows`}</span>
        </button>
      </section>

      <section className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Row</th>
              <th>Status</th>
              <th>Errors</th>
              {previewHeaders(headers, config.requiredColumns).map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.rowNumber}>
                  <td>{row.rowNumber}</td>
                  <td>
                    <span className={`status-pill ${row.errors.length ? "status-overdue" : "status-paid"}`}>
                      {row.errors.length ? "Invalid" : "Valid"}
                    </span>
                  </td>
                  <td>{row.errors.length ? row.errors.join("; ") : <CheckCircle2 aria-label="Valid row" size={16} />}</td>
                  {previewHeaders(headers, config.requiredColumns).map((header) => (
                    <td key={`${row.rowNumber}-${header}`}>{row.source[header] || "-"}</td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3 + previewHeaders(headers, config.requiredColumns).length}>
                  Select an import type, download a template if needed, then upload a CSV to preview rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function previewHeaders(headers: string[], fallback: string[]) {
  return (headers.length ? headers : fallback).slice(0, 8);
}

function validateRow(type: ImportType, source: Record<string, string>, rowNumber: number, lookups: LookupMaps): ReviewedRow {
  const errors: string[] = [];
  const required = type === "opening_balances"
    ? ["balance_date", "balance_type", "amount"]
    : importConfigs[type].requiredColumns;

  required.forEach((column) => {
    if (!source[column]?.trim()) errors.push(`Missing ${column}`);
  });

  const branch = source.branch ? lookups.branches.get(normalizeValue(source.branch)) : undefined;
  const bankAccount = source.bank_account ? lookups.bankAccounts.get(normalizeValue(source.bank_account)) : undefined;
  const supplier = source.supplier ? lookups.suppliers.get(normalizeValue(source.supplier)) : undefined;
  const panel = source.panel_company ? lookups.panels.get(normalizeValue(source.panel_company)) : undefined;

  if (source.branch && !branch) errors.push(`Unknown branch: ${source.branch}`);
  if (source.bank_account && !bankAccount) errors.push(`Unknown bank account: ${source.bank_account}`);
  if (source.supplier && !supplier) errors.push(`Unknown supplier: ${source.supplier}`);
  if (source.panel_company && !panel) errors.push(`Unknown panel company: ${source.panel_company}`);

  const common = {
    errors,
    rowNumber,
    source
  };

  if (type === "daily_sales") {
    const saleDate = readDate(source.sale_date, "sale_date", errors);
    const payload = branch && saleDate ? {
      branch_id: branch.id,
      sale_date: saleDate,
      cash_amount: readMoney(source.cash_amount, "cash_amount", errors),
      bank_transfer_amount: readMoney(source.bank_transfer_amount, "bank_transfer_amount", errors),
      card_amount: readMoney(source.card_amount, "card_amount", errors),
      panel_amount: readMoney(source.panel_amount, "panel_amount", errors),
      qr_amount: readMoney(source.qr_amount, "qr_amount", errors),
      notes: emptyToNull(source.notes)
    } : null;
    return { ...common, payload };
  }

  if (type === "expenses") {
    const expenseDate = readDate(source.expense_date, "expense_date", errors);
    const category = enumValue(source.category, validExpenseCategories, "category", errors);
    const paymentType = enumValue(source.payment_type, validPaymentTypes, "payment_type", errors);
    const payload = branch && expenseDate && category && paymentType ? {
      branch_id: branch.id,
      expense_date: expenseDate,
      category,
      vendor_name: emptyToNull(source.vendor_name),
      description: source.description?.trim() ?? "",
      payment_type: paymentType,
      amount: readMoney(source.amount, "amount", errors)
    } : null;
    return { ...common, payload };
  }

  if (type === "opening_balances") {
    const balanceDate = readDate(source.balance_date, "balance_date", errors);
    const balanceType = enumValue(source.balance_type, validOpeningBalanceTypes, "balance_type", errors);
    const verificationStatus = source.verification_status?.trim()
      ? enumValue(source.verification_status, validOpeningBalanceVerificationStatuses, "verification_status", errors)
      : "pending_review";

    if (balanceType === "bank_account" && !source.bank_account?.trim()) errors.push("Missing bank_account for bank_account balance");
    if ((balanceType === "cash_in_hand" || balanceType === "petty_cash") && !source.branch?.trim()) {
      errors.push(`Missing branch for ${balanceType} balance`);
    }
    if (balanceType === "supplier_outstanding" && !source.supplier?.trim()) {
      errors.push("Missing supplier for supplier_outstanding balance");
    }
    if (balanceType === "panel_outstanding" && !source.panel_company?.trim()) {
      errors.push("Missing panel_company for panel_outstanding balance");
    }

    const hasTarget = Boolean(
      (balanceType === "bank_account" && bankAccount)
      || ((balanceType === "cash_in_hand" || balanceType === "petty_cash") && branch)
      || (balanceType === "supplier_outstanding" && supplier)
      || (balanceType === "panel_outstanding" && panel)
    );
    const payload = balanceDate && balanceType && verificationStatus && hasTarget ? {
      amount: readMoney(source.amount, "amount", errors),
      balance_date: balanceDate,
      balance_type: balanceType,
      bank_account_id: balanceType === "bank_account" ? bankAccount?.id ?? null : null,
      branch_id: balanceType === "cash_in_hand" || balanceType === "petty_cash" || balanceType === "supplier_outstanding" || balanceType === "panel_outstanding"
        ? branch?.id ?? null
        : null,
      notes: emptyToNull(source.notes),
      panel_company_id: balanceType === "panel_outstanding" ? panel?.id ?? null : null,
      source_notes: emptyToNull(source.source_notes),
      source_reference: emptyToNull(source.source_reference),
      supplier_id: balanceType === "supplier_outstanding" ? supplier?.id ?? null : null,
      verification_status: verificationStatus
    } : null;
    return { ...common, payload };
  }

  if (type === "supplier_purchases") {
    const purchaseDate = readDate(source.purchase_date, "purchase_date", errors);
    const category = enumValue(source.category, validPurchaseCategories, "category", errors);
    const payload = branch && supplier && purchaseDate && category ? {
      supplier_id: supplier.id,
      branch_id: branch.id,
      invoice_no: source.invoice_no?.trim() ?? "",
      purchase_date: purchaseDate,
      due_date: readOptionalDate(source.due_date, "due_date", errors),
      category,
      medicine_cost: readMoney(source.medicine_cost, "medicine_cost", errors),
      consumables_cost: readMoney(source.consumables_cost, "consumables_cost", errors),
      other_cost: readMoney(source.other_cost, "other_cost", errors),
      notes: emptyToNull(source.notes)
    } : null;
    return { ...common, payload };
  }

  if (type === "supplier_payments") {
    const paymentDate = readDate(source.payment_date, "payment_date", errors);
    const paymentType = enumValue(source.payment_type, validPaymentTypes, "payment_type", errors);
    const linkedPurchase = supplier && source.purchase_invoice_no
      ? lookups.purchases.get(`${supplier.id}:${normalizeValue(source.purchase_invoice_no)}`) ?? lookups.purchases.get(normalizeValue(source.purchase_invoice_no))
      : null;
    if (source.purchase_invoice_no && !linkedPurchase) errors.push(`Unknown purchase invoice: ${source.purchase_invoice_no}`);

    const payload = supplier && paymentDate && paymentType ? {
      supplier_id: supplier.id,
      purchase_id: linkedPurchase?.id ?? null,
      branch_id: branch?.id ?? linkedPurchase?.branch_id ?? null,
      payment_date: paymentDate,
      payment_type: paymentType,
      amount: readMoney(source.amount, "amount", errors),
      reference_no: emptyToNull(source.reference_no),
      notes: emptyToNull(source.notes)
    } : null;
    return { ...common, payload };
  }

  const claimMonth = readDate(source.claim_month, "claim_month", errors);
  const status = enumValue(source.status, validPaymentStatuses, "status", errors);
  const payload = branch && panel && claimMonth && status ? {
    panel_company_id: panel.id,
    branch_id: branch.id,
    claim_no: source.claim_no?.trim() ?? "",
    claim_month: claimMonth,
    submitted_date: readOptionalDate(source.submitted_date, "submitted_date", errors),
    due_date: readOptionalDate(source.due_date, "due_date", errors),
    amount: readMoney(source.amount, "amount", errors),
    status,
    notes: emptyToNull(source.notes)
  } : null;
  return { ...common, payload };
}

function readMoney(value: string | undefined, label: string, errors: string[]) {
  const normalized = Number((value ?? "").replaceAll(",", ""));
  if (!Number.isFinite(normalized) || normalized < 0) {
    errors.push(`Invalid ${label}`);
    return 0;
  }
  return normalized;
}

function readDate(value: string | undefined, label: string, errors: string[]) {
  const normalized = normalizeDate(value);
  if (!normalized) errors.push(`Invalid ${label}`);
  return normalized;
}

function readOptionalDate(value: string | undefined, label: string, errors: string[]) {
  if (!value?.trim()) return null;
  return readDate(value, label, errors);
}

function normalizeDate(value: string | undefined) {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && !Number.isNaN(Date.parse(trimmed))) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function enumValue<T extends string>(value: string | undefined, allowed: T[], label: string, errors: string[]) {
  const normalized = normalizeValue(value ?? "") as T;
  if (!allowed.includes(normalized)) {
    errors.push(`Invalid ${label}: ${value || ""}`);
    return null;
  }
  return normalized;
}

function emptyToNull(value: string | undefined) {
  return value?.trim() ? value.trim() : null;
}

function markCsvDuplicates(type: ImportType, rows: ReviewedRow[]) {
  const keyCounts = new Map<string, number>();
  rows.forEach((row) => {
    const key = duplicateKey(type, row.payload);
    if (key) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  });

  return rows.map((row) => {
    const key = duplicateKey(type, row.payload);
    if (key && (keyCounts.get(key) ?? 0) > 1) {
      return {
        ...row,
        errors: [...row.errors, "Duplicate inside CSV"]
      };
    }
    return row;
  });
}

async function markDatabaseDuplicates(type: ImportType, rows: ReviewedRow[]) {
  if (type === "supplier_payments") return rows;

  const validPayloads = rows.map((row) => row.payload).filter(Boolean) as ImportPayload[];
  if (!validPayloads.length) return rows;

  const supabase = createClient();
  const duplicateKeys = new Set<string>();

  if (type === "daily_sales") {
    const branchIds = uniqueStrings(validPayloads.map((payload) => payload.branch_id));
    const dates = uniqueStrings(validPayloads.map((payload) => payload.sale_date));
    const { data, error } = await supabase.from("daily_sales").select("branch_id, sale_date").in("branch_id", branchIds).in("sale_date", dates);
    if (error) throw error;
    data?.forEach((row) => duplicateKeys.add(`${row.branch_id}|${row.sale_date}`));
  }

  if (type === "expenses") {
    const branchIds = uniqueStrings(validPayloads.map((payload) => payload.branch_id));
    const dates = uniqueStrings(validPayloads.map((payload) => payload.expense_date));
    const { data, error } = await supabase.from("expenses").select("branch_id, expense_date, amount, description").in("branch_id", branchIds).in("expense_date", dates);
    if (error) throw error;
    data?.forEach((row) => duplicateKeys.add(`${row.branch_id}|${row.expense_date}|${Number(row.amount)}|${normalizeValue(row.description)}`));
  }

  if (type === "supplier_purchases") {
    const supplierIds = uniqueStrings(validPayloads.map((payload) => payload.supplier_id));
    const dates = uniqueStrings(validPayloads.map((payload) => payload.purchase_date));
    const { data, error } = await supabase.from("supplier_purchases").select("supplier_id, invoice_no, purchase_date").in("supplier_id", supplierIds).in("purchase_date", dates);
    if (error) throw error;
    data?.forEach((row) => duplicateKeys.add(`${row.supplier_id}|${normalizeValue(row.invoice_no ?? "")}|${row.purchase_date}`));
  }

  if (type === "panel_claims") {
    const panelIds = uniqueStrings(validPayloads.map((payload) => payload.panel_company_id));
    const months = uniqueStrings(validPayloads.map((payload) => payload.claim_month));
    const { data, error } = await supabase.from("panel_claims").select("panel_company_id, claim_no, claim_month").in("panel_company_id", panelIds).in("claim_month", months);
    if (error) throw error;
    data?.forEach((row) => duplicateKeys.add(`${row.panel_company_id}|${normalizeValue(row.claim_no ?? "")}|${row.claim_month}`));
  }

  if (type === "opening_balances") {
    const dates = uniqueStrings(validPayloads.map((payload) => payload.balance_date));
    const { data, error } = await supabase
      .from("opening_balances")
      .select("balance_date, balance_type, bank_account_id, branch_id, supplier_id, panel_company_id")
      .in("balance_date", dates);
    if (error) throw error;
    data?.forEach((row) => duplicateKeys.add(openingBalanceDuplicateKey(row)));
  }

  return rows.map((row) => {
    const key = duplicateKey(type, row.payload);
    if (key && duplicateKeys.has(key)) {
      return {
        ...row,
        errors: [...row.errors, "Duplicate already exists in Supabase"]
      };
    }
    return row;
  });
}

function duplicateKey(type: ImportType, payload: ImportPayload | null) {
  if (!payload) return null;
  if (type === "daily_sales") return `${payload.branch_id}|${payload.sale_date}`;
  if (type === "expenses") {
    return `${payload.branch_id}|${payload.expense_date}|${Number(payload.amount)}|${normalizeValue(String(payload.description ?? ""))}`;
  }
  if (type === "supplier_purchases") {
    return `${payload.supplier_id}|${normalizeValue(String(payload.invoice_no ?? ""))}|${payload.purchase_date}`;
  }
  if (type === "panel_claims") {
    return `${payload.panel_company_id}|${normalizeValue(String(payload.claim_no ?? ""))}|${payload.claim_month}`;
  }
  if (type === "opening_balances") return openingBalanceDuplicateKey(payload);
  return null;
}

function openingBalanceDuplicateKey(payload: {
  balance_date?: unknown;
  balance_type?: unknown;
  bank_account_id?: unknown;
  branch_id?: unknown;
  panel_company_id?: unknown;
  supplier_id?: unknown;
}) {
  const targetId = payload.balance_type === "bank_account"
    ? payload.bank_account_id
    : payload.balance_type === "cash_in_hand" || payload.balance_type === "petty_cash"
      ? payload.branch_id
      : payload.balance_type === "supplier_outstanding"
        ? `${payload.supplier_id}|${payload.branch_id ?? ""}`
        : `${payload.panel_company_id}|${payload.branch_id ?? ""}`;
  return `${payload.balance_type}|${payload.balance_date}|${targetId ?? ""}`;
}

function uniqueStrings(values: unknown[]) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0)));
}
