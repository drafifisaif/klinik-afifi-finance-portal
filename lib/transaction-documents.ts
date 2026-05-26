import { getBankingData, getDashboardData } from "@/lib/data";
import { createClient, hasSupabaseEnv } from "@/lib/supabase-server";
import type { Branch, TransactionDocument, TransactionDocumentEntityName } from "@/lib/types";

export const FINANCE_DOCUMENTS_BUCKET = "finance-documents";
export const FINANCE_RECEIPTS_BUCKET = "finance-receipts";
export const SUPPLIER_INVOICES_BUCKET = "supplier-invoices";
export const PANEL_DOCUMENTS_BUCKET = "panel-documents";

export const transactionDocumentEntityLabels: Record<TransactionDocumentEntityName, string> = {
  bank_transactions: "Manual bank transaction",
  cash_bank_ins: "Cash bank-in",
  expenses: "Expense",
  panel_claims: "Panel claim",
  panel_payments: "Panel payment",
  petty_cash_transactions: "Petty cash transaction",
  supplier_payments: "Supplier payment",
  supplier_purchases: "Supplier purchase"
};

export type TransactionDocumentContext = {
  bankAccountId: string | null;
  branchId: string | null;
  entityId: string;
  entityName: TransactionDocumentEntityName;
};

export type DocumentReportRow = {
  amount?: number | null;
  branchId: string | null;
  branchName: string;
  date: string;
  description: string;
  documents: TransactionDocument[];
  entityId: string;
  entityName: TransactionDocumentEntityName;
};

export type DocumentReportFilters = {
  branchId?: string;
  documentType?: string;
  end?: string;
  entityName?: string;
  period?: string;
  start?: string;
  status?: string;
};

type PanelPaymentDocumentReportSource = {
  amount?: number | string | null;
  id: string;
  panel_claims?:
    | { branch_id: string | null; claim_no?: string | null }
    | { branch_id: string | null; claim_no?: string | null }[]
    | null;
  payment_date: string;
  reference_no?: string | null;
};

const supportedEntities = new Set<TransactionDocumentEntityName>(Object.keys(transactionDocumentEntityLabels) as TransactionDocumentEntityName[]);

function normalizeRelation<T>(relation: T | T[] | null | undefined) {
  return Array.isArray(relation) ? relation[0] ?? null : relation ?? null;
}

function groupDocuments(documents: TransactionDocument[]) {
  return documents.reduce<Map<string, TransactionDocument[]>>((grouped, document) => {
    const documentsForEntity = grouped.get(document.entity_id) ?? [];
    documentsForEntity.push(document);
    grouped.set(document.entity_id, documentsForEntity);
    return grouped;
  }, new Map());
}

function reportRange(filters: DocumentReportFilters) {
  const today = new Date();
  const dateInput = (date: Date) => date.toISOString().slice(0, 10);
  const startOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

  if (filters.period === "today") {
    const value = dateInput(today);
    return { end: value, start: value };
  }

  if (filters.period === "last_month") {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
    return { end: dateInput(end), start: dateInput(start) };
  }

  if (filters.period === "custom") {
    return { end: filters.end ?? dateInput(today), start: filters.start ?? dateInput(startOfMonth) };
  }

  return { end: dateInput(today), start: dateInput(startOfMonth) };
}

function pathForEntity(entityName: TransactionDocumentEntityName) {
  if (entityName === "expenses") return "/expenses";
  if (entityName === "supplier_purchases") return "/purchases";
  if (entityName === "supplier_payments") return "/suppliers/payments";
  if (entityName === "panel_claims" || entityName === "panel_payments") return "/panels";
  if (entityName === "cash_bank_ins") return "/cash-bank-ins";
  if (entityName === "petty_cash_transactions") return "/petty-cash";
  return "/bank";
}

export function isTransactionDocumentEntity(value: string | null | undefined): value is TransactionDocumentEntityName {
  return supportedEntities.has(value as TransactionDocumentEntityName);
}

export function documentEntityPath(entityName: TransactionDocumentEntityName) {
  return pathForEntity(entityName);
}

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

export function documentStatusLabel(count: number) {
  if (count <= 0) return "No document";
  if (count === 1) return "Uploaded";
  return `${count} documents`;
}

export async function getTransactionDocuments(entityName: TransactionDocumentEntityName, entityIds: string[]) {
  if (!hasSupabaseEnv() || !entityIds.length) return new Map<string, TransactionDocument[]>();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transaction_documents")
    .select("*, profiles:profiles!transaction_documents_uploaded_by_fkey(full_name)")
    .eq("entity_name", entityName)
    .in("entity_id", entityIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getTransactionDocuments failed", {
      entityIdCount: entityIds.length,
      entityName,
      error: error.message
    });
    return new Map<string, TransactionDocument[]>();
  }
  return groupDocuments((data ?? []) as TransactionDocument[]);
}

export async function getTransactionDocumentById(documentId: string) {
  if (!hasSupabaseEnv()) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transaction_documents")
    .select("*, profiles:profiles!transaction_documents_uploaded_by_fkey(full_name)")
    .eq("id", documentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("getTransactionDocumentById failed", {
      documentId,
      error: error.message
    });
    return null;
  }
  if (!data) return null;
  return data as TransactionDocument;
}

export async function getTransactionDocumentContext(entityName: TransactionDocumentEntityName, entityId: string): Promise<TransactionDocumentContext | null> {
  if (!hasSupabaseEnv()) return null;

  const supabase = await createClient();
  if (entityName === "cash_bank_ins") {
    const { data } = await supabase.from("cash_bank_ins").select("id, branch_id, bank_account_id").eq("id", entityId).maybeSingle();
    return data ? { bankAccountId: data.bank_account_id, branchId: data.branch_id, entityId: data.id, entityName } : null;
  }
  if (entityName === "bank_transactions") {
    const { data } = await supabase.from("bank_transactions").select("id, branch_id, bank_account_id").eq("id", entityId).maybeSingle();
    return data ? { bankAccountId: data.bank_account_id, branchId: data.branch_id, entityId: data.id, entityName } : null;
  }
  if (entityName === "petty_cash_transactions") {
    const { data } = await supabase.from("petty_cash_transactions").select("id, branch_id, bank_account_id").eq("id", entityId).maybeSingle();
    return data ? { bankAccountId: data.bank_account_id, branchId: data.branch_id, entityId: data.id, entityName } : null;
  }
  if (entityName === "supplier_payments") {
    const { data } = await supabase.from("supplier_payments").select("id, branch_id, bank_account_id").eq("id", entityId).maybeSingle();
    return data ? { bankAccountId: data.bank_account_id ?? null, branchId: data.branch_id, entityId: data.id, entityName } : null;
  }
  if (entityName === "expenses" || entityName === "supplier_purchases" || entityName === "panel_claims") {
    const { data } = await supabase.from(entityName).select("id, branch_id").eq("id", entityId).maybeSingle();
    return data ? { bankAccountId: null, branchId: data.branch_id, entityId: data.id, entityName } : null;
  }

  const { data } = await supabase
    .from("panel_payments")
    .select("id, bank_account_id, panel_claims(branch_id)")
    .eq("id", entityId)
    .maybeSingle();
  const claim = normalizeRelation(data?.panel_claims as { branch_id: string | null } | { branch_id: string | null }[] | null | undefined);
  return data ? { bankAccountId: data.bank_account_id ?? null, branchId: claim?.branch_id ?? null, entityId: data.id, entityName } : null;
}

async function getPanelPaymentReportRows(branches: Branch[]): Promise<DocumentReportRow[]> {
  if (!hasSupabaseEnv()) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("panel_payments")
    .select("id, payment_date, amount, reference_no, panel_claims(branch_id, claim_no)")
    .order("payment_date", { ascending: false })
    .limit(500);

  if (error) return [];
  const branchById = new Map(branches.map((branch) => [branch.id, branch]));
  return ((data ?? []) as PanelPaymentDocumentReportSource[]).map((payment) => {
    const claim = normalizeRelation(payment.panel_claims as { branch_id: string | null; claim_no?: string | null } | { branch_id: string | null; claim_no?: string | null }[] | null);
    const branch = claim?.branch_id ? branchById.get(claim.branch_id) : null;
    return {
      amount: Number(payment.amount ?? 0),
      branchId: claim?.branch_id ?? null,
      branchName: branch?.name ?? "-",
      date: payment.payment_date,
      description: claim?.claim_no ? `Claim ${claim.claim_no}` : payment.reference_no ?? "Panel payment",
      documents: [],
      entityId: payment.id,
      entityName: "panel_payments"
    };
  });
}

export async function getDocumentReportRows(filters: DocumentReportFilters = {}) {
  const [dashboardData, bankingData] = await Promise.all([getDashboardData(), getBankingData()]);
  const branches = Array.from(new Map([...dashboardData.branches, ...bankingData.branches].map((branch) => [branch.id, branch])).values());
  const branchById = new Map(branches.map((branch) => [branch.id, branch]));
  const rows: DocumentReportRow[] = [
    ...dashboardData.expenses.map((expense) => ({
      amount: Number(expense.amount ?? 0),
      branchId: expense.branch_id,
      branchName: expense.branches?.name ?? branchById.get(expense.branch_id)?.name ?? "-",
      date: expense.expense_date,
      description: expense.description,
      documents: [],
      entityId: expense.id,
      entityName: "expenses" as const
    })),
    ...dashboardData.purchases.map((purchase) => ({
      amount: Number(purchase.total_amount ?? 0),
      branchId: purchase.branch_id,
      branchName: purchase.branches?.name ?? branchById.get(purchase.branch_id)?.name ?? "-",
      date: purchase.purchase_date,
      description: purchase.invoice_no ?? purchase.suppliers?.name ?? "Supplier purchase",
      documents: [],
      entityId: purchase.id,
      entityName: "supplier_purchases" as const
    })),
    ...dashboardData.supplierPayments.map((payment) => ({
      amount: Number(payment.amount ?? 0),
      branchId: payment.branch_id ?? null,
      branchName: payment.branches?.name ?? (payment.branch_id ? branchById.get(payment.branch_id)?.name : null) ?? "-",
      date: payment.payment_date,
      description: payment.reference_no ?? payment.suppliers?.name ?? "Supplier payment",
      documents: [],
      entityId: payment.id,
      entityName: "supplier_payments" as const
    })),
    ...dashboardData.panels.map((claim) => ({
      amount: Number(claim.amount ?? 0),
      branchId: claim.branch_id,
      branchName: claim.branches?.name ?? branchById.get(claim.branch_id)?.name ?? "-",
      date: claim.claim_month,
      description: claim.claim_no ?? claim.panel_companies?.name ?? "Panel claim",
      documents: [],
      entityId: claim.id,
      entityName: "panel_claims" as const
    })),
    ...bankingData.cashBankIns.map((bankIn) => ({
      amount: Number(bankIn.amount ?? 0),
      branchId: bankIn.branch_id,
      branchName: bankIn.branches?.name ?? branchById.get(bankIn.branch_id)?.name ?? "-",
      date: bankIn.bank_in_date,
      description: bankIn.reference_no ?? bankIn.notes ?? "Cash bank-in",
      documents: [],
      entityId: bankIn.id,
      entityName: "cash_bank_ins" as const
    })),
    ...bankingData.bankTransactions.map((transaction) => ({
      amount: Number(transaction.amount ?? 0),
      branchId: transaction.branch_id ?? null,
      branchName: transaction.branches?.name ?? (transaction.branch_id ? branchById.get(transaction.branch_id)?.name : null) ?? "-",
      date: transaction.transaction_date,
      description: transaction.reference_no ?? transaction.description ?? transaction.transaction_type,
      documents: [],
      entityId: transaction.id,
      entityName: "bank_transactions" as const
    })),
    ...bankingData.pettyCashTransactions.map((transaction) => ({
      amount: Number(transaction.amount ?? 0),
      branchId: transaction.branch_id,
      branchName: transaction.branches?.name ?? branchById.get(transaction.branch_id)?.name ?? "-",
      date: transaction.transaction_date,
      description: transaction.reference_no ?? transaction.description ?? transaction.transaction_type,
      documents: [],
      entityId: transaction.id,
      entityName: "petty_cash_transactions" as const
    })),
    ...(await getPanelPaymentReportRows(branches))
  ];

  const documentMaps = await Promise.all(
    (Object.keys(transactionDocumentEntityLabels) as TransactionDocumentEntityName[]).map(async (entityName) => {
      const entityIds = rows.filter((row) => row.entityName === entityName).map((row) => row.entityId);
      return [entityName, await getTransactionDocuments(entityName, entityIds)] as const;
    })
  );
  const documentsByEntity = new Map(documentMaps);
  const range = reportRange(filters);
  const selectedEntityName = isTransactionDocumentEntity(filters.entityName) ? filters.entityName : "all";
  const selectedBranchId = filters.branchId ?? "all";
  const selectedStatus = filters.status === "uploaded" || filters.status === "missing" ? filters.status : "all";
  const selectedDocumentType = filters.documentType?.trim() || "all";

  return {
    branches,
    filters: {
      branchId: selectedBranchId,
      documentType: selectedDocumentType,
      end: range.end,
      entityName: selectedEntityName,
      period: filters.period === "today" || filters.period === "last_month" || filters.period === "custom" ? filters.period : "this_month",
      start: range.start,
      status: selectedStatus
    },
    rows: rows.map((row) => ({
      ...row,
      documents: documentsByEntity.get(row.entityName)?.get(row.entityId) ?? []
    })).filter((row) => {
      const uploaded = row.documents.length > 0;
      return row.date >= range.start
        && row.date <= range.end
        && (selectedEntityName === "all" || row.entityName === selectedEntityName)
        && (selectedBranchId === "all" || row.branchId === selectedBranchId)
        && (selectedStatus === "all" || (selectedStatus === "uploaded" ? uploaded : !uploaded))
        && (selectedDocumentType === "all" || row.documents.some((document) => document.document_type === selectedDocumentType));
    }).sort((first, second) => second.date.localeCompare(first.date))
  };
}
