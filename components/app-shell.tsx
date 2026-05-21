import Link from "next/link";
import { signOut } from "@/app/actions";
import { APP_NAME } from "@/lib/constants";
import { getBranches } from "@/lib/data";
import { getCurrentBankAccountPermissions, getCurrentProfile, hasAnyBankAccountAccess, hasPermission, type PermissionKey } from "@/lib/permissions";
import {
  Banknote,
  BarChart3,
  Building2,
  ClipboardList,
  CreditCard,
  FileUp,
  Landmark,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  Coins,
  ShieldCheck,
  Stethoscope,
  Truck,
  Users,
  type LucideIcon
} from "lucide-react";

const navigation: { href: string; label: string; icon: LucideIcon; permission: PermissionKey }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "view_dashboard" },
  { href: "/branches", label: "Branches", icon: Building2, permission: "view_branches" },
  { href: "/sales", label: "Daily Sales", icon: CreditCard, permission: "edit_finance" },
  { href: "/expenses", label: "Expenses", icon: ReceiptText, permission: "edit_finance" },
  { href: "/purchases", label: "Purchases", icon: ClipboardList, permission: "view_supplier_records" },
  { href: "/suppliers/payments", label: "Supplier Payments", icon: Truck, permission: "view_supplier_records" },
  { href: "/panels", label: "Panel Outstanding", icon: ShieldCheck, permission: "view_panel_records" },
  { href: "/cash-bank-ins", label: "Cash Bank-In", icon: Banknote, permission: "record_cash_bank_in" },
  { href: "/petty-cash", label: "Petty Cash", icon: Coins, permission: "record_petty_cash" },
  { href: "/bank", label: "Bank Position", icon: Landmark, permission: "view_bank_position" },
  { href: "/import", label: "Import Data", icon: FileUp, permission: "import_data" },
  { href: "/users", label: "Users", icon: Users, permission: "manage_users" },
  { href: "/reports/profit-loss", label: "Profit & Loss", icon: BarChart3, permission: "view_reports" },
  { href: "/reports/cashflow", label: "Cashflow", icon: Banknote, permission: "view_reports" }
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
    <div className="shell">
      <aside className="sidebar">
        <Link className="brand" href="/dashboard" aria-label={APP_NAME}>
          <span className="brand-mark">
            <Stethoscope size={22} />
          </span>
          <span>
            <strong>Klinik Afifi</strong>
            <small>Finance Portal</small>
          </span>
        </Link>

        <nav className="nav-list" aria-label="Main navigation">
          {allowedNavigation.map((item) => {
            const Icon = item.icon;
            return (
              <Link className="nav-item" href={item.href} key={item.href}>
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <nav className="branch-nav" aria-label="Branch navigation">
          <span>Branches</span>
          {branches.map((branch) => (
            <Link className="branch-nav-item" href={`/dashboard?branch=${branch.id}`} key={branch.id}>
              <Building2 size={15} />
              <span>{branch.name}</span>
            </Link>
          ))}
        </nav>

        <form action={signOut} className="sidebar-footer">
          <button className="ghost-button" type="submit">
            <LogOut size={17} />
            <span>Sign out</span>
          </button>
        </form>
      </aside>

      <main className="main-panel">{children}</main>
    </div>
  );
}
