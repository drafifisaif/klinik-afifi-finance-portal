"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { signOut } from "@/app/actions";
import type { Branch } from "@/lib/types";
import {
  Banknote,
  BarChart3,
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Coins,
  CreditCard,
  FileUp,
  Files,
  History,
  Landmark,
  LayoutDashboard,
  type LucideIcon,
  LogOut,
  ReceiptText,
  Search,
  ShieldCheck,
  Stethoscope,
  Truck,
  Users,
  WalletCards
} from "lucide-react";

const SIDEBAR_STORAGE_KEY = "finance-sidebar-collapsed";

type NavigationItem = {
  href: string;
  label: string;
  icon: string;
};

const iconMap: Record<string, LucideIcon> = {
  Banknote,
  BarChart3,
  Building2,
  ClipboardList,
  Coins,
  CreditCard,
  FileUp,
  Files,
  History,
  Landmark,
  LayoutDashboard,
  ReceiptText,
  Search,
  ShieldCheck,
  Truck,
  Users,
  WalletCards
};

type AppShellClientProps = {
  appName: string;
  branches: Branch[];
  children: React.ReactNode;
  navigation: NavigationItem[];
};

function isActiveRoute(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShellClient({ appName, branches, children, navigation }: AppShellClientProps) {
  const pathname = usePathname();
  const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(false);
  const [hasLoadedPreference, setHasLoadedPreference] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    setIsDesktopCollapsed(stored === "true");
    setHasLoadedPreference(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedPreference) return;
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(isDesktopCollapsed));
  }, [hasLoadedPreference, isDesktopCollapsed]);

  const shellClassName = useMemo(() => {
    return `shell${isDesktopCollapsed ? " shell-collapsed" : ""}${hasLoadedPreference ? " shell-ready" : ""}`;
  }, [hasLoadedPreference, isDesktopCollapsed]);

  return (
    <div className={shellClassName}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <Link className="brand" href="/dashboard" aria-label={appName} title={isDesktopCollapsed ? appName : undefined}>
            <span className="brand-mark">
              <Stethoscope size={22} />
            </span>
            <span className="brand-copy">
              <strong>Klinik Afifi</strong>
              <small>Finance Portal</small>
            </span>
          </Link>

          <button
            aria-label={isDesktopCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="sidebar-toggle"
            type="button"
            onClick={() => setIsDesktopCollapsed((current) => !current)}
          >
            {isDesktopCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        <div className="sidebar-menu">
          <nav className="nav-list" aria-label="Main navigation">
            {navigation.map((item) => {
              const Icon = iconMap[item.icon] ?? Stethoscope;
              const active = isActiveRoute(pathname, item.href);
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`nav-item${active ? " nav-item-active" : ""}`}
                  href={item.href}
                  key={item.href}
                  title={isDesktopCollapsed ? item.label : undefined}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <nav className="branch-nav" aria-label="Branch navigation">
            <span>Branches</span>
            {branches.map((branch) => {
              const href = `/dashboard?branch=${branch.id}`;
              const active = pathname === "/dashboard";
              return (
                <Link
                  className={`branch-nav-item${active ? " branch-nav-item-active" : ""}`}
                  href={href}
                  key={branch.id}
                  title={isDesktopCollapsed ? branch.name : undefined}
                >
                  <Building2 size={15} />
                  <span>{branch.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <form action={signOut} className="sidebar-footer">
          <button className="ghost-button" title={isDesktopCollapsed ? "Sign out" : undefined} type="submit">
            <LogOut size={17} />
            <span>Sign out</span>
          </button>
        </form>
      </aside>

      <main className="main-panel">{children}</main>
    </div>
  );
}
