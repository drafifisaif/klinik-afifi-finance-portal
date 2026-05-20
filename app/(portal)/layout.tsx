import { AppShell } from "@/components/app-shell";
import { requirePermission } from "@/lib/permissions";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  await requirePermission("view_dashboard");
  return <AppShell>{children}</AppShell>;
}
