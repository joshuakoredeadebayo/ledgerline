import { redirect } from "next/navigation";
import { getCurrentMembership } from "@/lib/actions/membership";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const membership = await getCurrentMembership();

  // Signed in but no org yet (e.g. mid-signup, or an invite not yet joined) -> onboarding.
  if (!membership) {
    redirect("/onboarding");
  }

  return (
    <div className="flex h-screen bg-ink-50">
      <Sidebar role={membership.role} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar
          organizationName={membership.organizationName}
          email={membership.email}
          role={membership.role}
        />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
