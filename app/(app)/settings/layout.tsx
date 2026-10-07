import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { SettingsNav } from "@/components/settings/settings-nav";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const membership = await getCurrentMembership();
  const showAuditLog = membership ? can(membership.role, "audit_log.view") : false;

  return (
    <div>
      <SettingsNav showAuditLog={showAuditLog} />
      {children}
    </div>
  );
}
