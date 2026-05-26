import type { TransactionDocumentEntityName } from "@/lib/types";

export const FINANCE_DOCUMENTS_BUCKET = "finance-documents";
export const FINANCE_RECEIPTS_BUCKET = "finance-receipts";
export const SUPPLIER_INVOICES_BUCKET = "supplier-invoices";
export const PANEL_DOCUMENTS_BUCKET = "panel-documents";

export function documentUploadLabel(entityName: TransactionDocumentEntityName) {
  if (entityName === "supplier_purchases") return "Upload Supplier Invoice";
  if (entityName === "cash_bank_ins") return "Upload Bank-in Receipt";
  if (entityName === "petty_cash_transactions") return "Upload Petty Cash Receipt";
  if (entityName === "panel_claims") return "Upload Panel Invoice";
  return "Upload Document";
}

export function documentBucketForEntity(entityName: TransactionDocumentEntityName) {
  if (entityName === "supplier_purchases") return SUPPLIER_INVOICES_BUCKET;
  if (entityName === "cash_bank_ins" || entityName === "petty_cash_transactions") return FINANCE_RECEIPTS_BUCKET;
  if (entityName === "panel_claims") return PANEL_DOCUMENTS_BUCKET;
  return FINANCE_DOCUMENTS_BUCKET;
}
