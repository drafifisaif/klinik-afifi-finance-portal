import Link from "next/link";
import { signOut } from "@/app/actions";
import { APP_NAME } from "@/lib/constants";
import { getBranches } from "@/lib/data";
import {
  Banknote,
  BarChart3,
  Building2,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  ShieldCheck,
  Stethoscope,
  Truck
} from "lucide-react";

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/branches", label: "Branches", icon: Building2 },
  { href: "/sales", label: "Daily Sales", icon: CreditCard },
  { href: "/expenses", label: "Expenses", icon: ReceiptText },
  { href: "/purchases", label: "Purchases", icon: ClipboardList },
  { href: "/suppliers/payments", label: "Supplier Payments", icon: Truck },
  { href: "/panels", label: "Panel Outstanding", icon: ShieldCheck },
  { href: "/reports/profit-loss", label: "Profit & Loss", icon: BarChart3 },
  { href: "/reports/cashflow", label: "Cashflow", icon: Banknote }
];

export async function AppShell({ children }: { children: React.ReactNode }) {
  const branches = await getBranches();

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
          {navigation.map((item) => {
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
