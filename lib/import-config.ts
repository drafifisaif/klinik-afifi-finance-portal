import type { ExpenseCategory, PaymentStatus, PaymentType, PurchaseCategory } from "@/lib/types";

export type ImportType =
  | "daily_sales"
  | "expenses"
  | "supplier_purchases"
  | "supplier_payments"
  | "panel_claims";

export type ImportConfig = {
  label: string;
  table: ImportType;
  description: string;
  requiredColumns: string[];
  optionalColumns: string[];
  templateRows: Record<string, string>[];
};

export const importConfigs: Record<ImportType, ImportConfig> = {
  daily_sales: {
    label: "Daily Sales",
    table: "daily_sales",
    description: "Daily branch sales summary by payment type.",
    requiredColumns: [
      "branch",
      "sale_date",
      "cash_amount",
      "bank_transfer_amount",
      "card_amount",
      "panel_amount",
      "qr_amount"
    ],
    optionalColumns: ["notes"],
    templateRows: [
      {
        branch: "Putatan",
        sale_date: "2026-05-20",
        cash_amount: "1200",
        bank_transfer_amount: "800",
        card_amount: "600",
        panel_amount: "450",
        qr_amount: "300",
        notes: "Example sales import"
      }
    ]
  },
  expenses: {
    label: "Expenses",
    table: "expenses",
    description: "Operating expenses by branch and category.",
    requiredColumns: ["branch", "expense_date", "category", "description", "payment_type", "amount"],
    optionalColumns: ["vendor_name"],
    templateRows: [
      {
        branch: "Papar",
        expense_date: "2026-05-20",
        category: "utilities",
        description: "Electric bill",
        payment_type: "bank_transfer",
        amount: "350",
        vendor_name: "SESB"
      }
    ]
  },
  supplier_purchases: {
    label: "Supplier Purchases",
    table: "supplier_purchases",
    description: "Supplier invoice costs for medicine, consumables, and other purchase cost.",
    requiredColumns: [
      "supplier",
      "branch",
      "invoice_no",
      "purchase_date",
      "category",
      "medicine_cost",
      "consumables_cost",
      "other_cost"
    ],
    optionalColumns: ["due_date", "notes"],
    templateRows: [
      {
        supplier: "Medisupply Sabah",
        branch: "Putatan",
        invoice_no: "MS-2605-020",
        purchase_date: "2026-05-20",
        category: "medicine",
        medicine_cost: "1800",
        consumables_cost: "0",
        other_cost: "0",
        due_date: "2026-06-19",
        notes: "Example purchase import"
      }
    ]
  },
  supplier_payments: {
    label: "Supplier Payments",
    table: "supplier_payments",
    description: "Payments made to suppliers, optionally linked to a purchase invoice.",
    requiredColumns: ["supplier", "payment_date", "payment_type", "amount"],
    optionalColumns: ["branch", "purchase_invoice_no", "reference_no", "notes"],
    templateRows: [
      {
        supplier: "ClinicCare Consumables",
        payment_date: "2026-05-20",
        payment_type: "bank_transfer",
        amount: "700",
        branch: "Papar",
        purchase_invoice_no: "CC-2605-041",
        reference_no: "BT-10001",
        notes: "Example supplier payment"
      }
    ]
  },
  panel_claims: {
    label: "Panel Claims",
    table: "panel_claims",
    description: "Panel company claim records and outstanding status.",
    requiredColumns: ["panel_company", "branch", "claim_no", "claim_month", "amount", "status"],
    optionalColumns: ["submitted_date", "due_date", "notes"],
    templateRows: [
      {
        panel_company: "SabahCare Panel",
        branch: "Ranau",
        claim_no: "SC-MAY-001",
        claim_month: "2026-05-01",
        amount: "1200",
        status: "unpaid",
        submitted_date: "2026-05-31",
        due_date: "2026-06-30",
        notes: "Example panel claim"
      }
    ]
  }
};

export const importTypeOptions = Object.entries(importConfigs).map(([value, config]) => ({
  value: value as ImportType,
  label: config.label
}));

export const validPaymentTypes: PaymentType[] = ["cash", "bank_transfer", "card", "panel", "qr"];

export const validExpenseCategories: ExpenseCategory[] = [
  "salary",
  "locum_doctor",
  "rental",
  "utilities",
  "supplier",
  "medicine",
  "consumables",
  "maintenance",
  "marketing",
  "loan_financing",
  "other"
];

export const validPurchaseCategories: PurchaseCategory[] = ["medicine", "consumables", "other"];

export const validPaymentStatuses: PaymentStatus[] = ["unpaid", "partial", "paid", "overdue"];

export function templateCsvFor(type: ImportType) {
  const config = importConfigs[type];
  const headers = [...config.requiredColumns, ...config.optionalColumns];
  const rows = config.templateRows.map((row) => headers.map((header) => escapeCsvCell(row[header] ?? "")).join(","));
  return [headers.join(","), ...rows].join("\n");
}

function escapeCsvCell(value: string) {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}
