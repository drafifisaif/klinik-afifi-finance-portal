import { AppShellClient } from "@/components/app-shell-client";
import { APP_NAME } from "@/lib/constants";
import { getBranches } from "@/lib/data";
import { getCurrentBankAccountPermissions, getCurrentProfile, hasAnyBankAccountAccess, hasPermission, type PermissionKey } from "@/lib/permissions";
const navigation: { href: string; label: string; icon: string; permission: PermissionKey }[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", permission: "view_dashboard" },
  { href: "/branches", label: "Branches", icon: "Building2", permission: "view_branches" },
  { href: "/sales", label: "Daily Sales", icon: "CreditCard", permission: "edit_finance" },
  { href: "/expenses", label: "Expenses", icon: "ReceiptText", permission: "edit_finance" },
  { href: "/purchases", label: "Purchases", icon: "ClipboardList", permission: "view_supplier_records" },
  { href: "/suppliers", label: "Suppliers", icon: "Users", permission: "manage_suppliers" },
  { href: "/suppliers/payments", label: "Supplier Payments", icon: "Truck", permission: "view_supplier_payments" },
  { href: "/panels", label: "Panel Outstanding", icon: "ShieldCheck", permission: "view_panel_records" },
  { href: "/cash-bank-ins", label: "Cash Bank-In", icon: "Banknote", permission: "record_cash_bank_in" },
  { href: "/petty-cash", label: "Petty Cash", icon: "Coins", permission: "record_petty_cash" },
  { href: "/bank", label: "Bank Position", icon: "Landmark", permission: "view_bank_position" },
  { href: "/opening-balances", label: "Opening Balances", icon: "WalletCards", permission: "view_settings" },
  { href: "/documents", label: "Documents", icon: "Files", permission: "edit_finance" },
  { href: "/import", label: "Import Data", icon: "FileUp", permission: "import_data" },
  { href: "/users", label: "Users", icon: "Users", permission: "manage_users" },
  { href: "/audit", label: "Audit Trail", icon: "History", permission: "view_audit_trail" },
  { href: "/reports/profit-loss", label: "Profit & Loss", icon: "BarChart3", permission: "view_reports" },
  { href: "/reports/cashflow", label: "Cashflow", icon: "Banknote", permission: "view_reports" }
];

export async function AppShell({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  const branches = await getBranches();
  const bankAccountPermissions = await getCurrentBankAccountPermissions(profile);
  const allowedNavigation = navigation.filter((item) => {
    if (item.href === "/bank") return hasAnyBankAccountAccess(profile, bankAccountPermissions);
    return hasPermission(profile, item.permission);
  });

  return (
    <AppShellClient appName={APP_NAME} branches={branches} navigation={allowedNavigation}>
      {children}
    </AppShellClient>
  );
}
