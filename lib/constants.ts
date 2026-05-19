import type { ExpenseCategory, PaymentType, PurchaseCategory, UserRole } from "@/lib/types";

export const APP_NAME = "Klinik Afifi Finance Portal";

export const branchesSeed = ["Putatan", "Papar", "Ranau", "Kinabatangan"];

export const userRoles: { value: UserRole; label: string }[] = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "finance", label: "Finance" },
  { value: "branch_pic", label: "Branch PIC" },
  { value: "staff", label: "Staff" }
];

export const paymentTypes: { value: PaymentType; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "card", label: "Card" },
  { value: "panel", label: "Panel" },
  { value: "qr", label: "QR" }
];

export const expenseCategories: { value: ExpenseCategory; label: string }[] = [
  { value: "salary", label: "Salary" },
  { value: "locum_doctor", label: "Locum Doctor" },
  { value: "rental", label: "Rental" },
  { value: "utilities", label: "Utilities" },
  { value: "supplier", label: "Supplier" },
  { value: "medicine", label: "Medicine" },
  { value: "consumables", label: "Consumables" },
  { value: "maintenance", label: "Maintenance" },
  { value: "marketing", label: "Marketing" },
  { value: "loan_financing", label: "Loan/Financing" },
  { value: "other", label: "Other" }
];

export const purchaseCategories: { value: PurchaseCategory; label: string }[] = [
  { value: "medicine", label: "Medicine" },
  { value: "consumables", label: "Consumables" },
  { value: "other", label: "Other" }
];
