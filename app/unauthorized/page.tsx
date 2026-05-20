import Link from "next/link";
import { ModuleHeader } from "@/components/module-header";
import { ShieldAlert } from "lucide-react";

export default function UnauthorizedPage() {
  return (
    <main className="login-page">
      <section className="empty-state">
        <div className="empty-state-icon">
          <ShieldAlert size={28} />
        </div>
        <ModuleHeader
          eyebrow="Access restricted"
          title="You do not have permission to view this page"
          description="Your current role does not include access to this finance portal module. Please contact an Owner or Admin if this looks incorrect."
        />
        <Link className="primary-button" href="/dashboard">
          Back to dashboard
        </Link>
      </section>
    </main>
  );
}
