import type { ExpenseCategory, OpeningBalanceType, OpeningBalanceVerificationStatus, PaymentStatus, PaymentType, PurchaseCategory } from "@/lib/types";

export type ImportType =
  | "daily_sales"
  | "expenses"
  | "opening_balances"
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
  opening_balances: {
    label: "Opening Balances",
    table: "opening_balances",
    description: "Owner-only starting bank, cash, petty cash, supplier, and panel positions.",
    requiredColumns: [
      "balance_date",
      "balance_type",
      "branch",
      "bank_account",
      "supplier",
      "panel_company",
      "amount",
      "verification_status",
      "source_reference",
      "source_notes",
      "notes"
    ],
    optionalColumns: [],
    templateRows: [
      {
        balance_date: "2026-01-01",
        balance_type: "bank_account",
        branch: "",
        bank_account: "CIMB Ranau Operation",
        supplier: "",
        panel_company: "",
        amount: "15000",
        verification_status: "confirmed",
        source_reference: "bank_statement",
        source_notes: "Statement as of 1 Jan 2026",
        notes: "Opening bank balance"
      },
      {
        balance_date: "2026-01-01",
        balance_type: "cash_in_hand",
        branch: "Ranau",
        bank_account: "",
        supplier: "",
        panel_company: "",
        amount: "1200",
        verification_status: "estimated",
        source_reference: "staff_estimate",
        source_notes: "Estimated by branch PIC",
        notes: "Opening branch cash"
      },
      {
        balance_date: "2026-01-01",
        balance_type: "petty_cash",
        branch: "Ranau",
        bank_account: "",
        supplier: "",
        panel_company: "",
        amount: "500",
        verification_status: "pending_review",
        source_reference: "staff_estimate",
        source_notes: "To verify later",
        notes: "Opening petty cash"
      },
      {
        balance_date: "2026-01-01",
        balance_type: "supplier_outstanding",
        branch: "Ranau",
        bank_account: "",
        supplier: "ABC Supplier",
        panel_company: "",
        amount: "3200",
        verification_status: "confirmed",
        source_reference: "invoice_record",
        source_notes: "Invoice outstanding before 2026",
        notes: "Opening supplier outstanding"
      },
      {
        balance_date: "2026-01-01",
        balance_type: "panel_outstanding",
        branch: "Ranau",
        bank_account: "",
        supplier: "",
        panel_company: "Panel A",
        amount: "4500",
        verification_status: "pending_review",
        source_reference: "panel_statement",
        source_notes: "Need panel confirmation",
        notes: "Opening panel outstanding"
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

export const validOpeningBalanceTypes: OpeningBalanceType[] = [
  "bank_account",
  "cash_in_hand",
  "petty_cash",
  "supplier_outstanding",
  "panel_outstanding"
];

export const validOpeningBalanceVerificationStatuses: OpeningBalanceVerificationStatus[] = [
  "confirmed",
  "estimated",
  "pending_review"
];

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
