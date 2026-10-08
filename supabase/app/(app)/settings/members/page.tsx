import { getCurrentMembership } from "@/lib/actions/membership";
import { createClient } from "@/lib/supabase/server";
import { can, ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from "@/lib/permissions";
import { getSiteUrl } from "@/lib/site-url";
import { isEmailConfigured } from "@/lib/email";
import { cn } from "@/lib/utils";
import { InviteMemberForm } from "@/components/settings/invite-member-form";
import { MemberRowActions, RevokeInvitationButton, ResendInvitationButton } from "@/components/settings/member-actions";
import { CopyLinkButton } from "@/components/settings/copy-link-button";

// Mirrors CAN_INVITE / CAN_ASSIGN in lib/actions/members.ts (the server enforces them).
const INVITE_ROLES: Partial<Record<Role, Role[]>> = {
  owner: ["admin", "controller", "accountant", "auditor"],
  admin: ["controller", "accountant", "auditor"],
};
const ASSIGN_ROLES: Partial<Record<Role, Role[]>> = {
  owner: ["owner", "admin", "controller", "accountant", "auditor"],
  admin: ["controller", "accountant", "auditor"],
};

const ROLE_STYLE: Record<Role, string> = {
  owner: "bg-accent-50 text-accent-700",
  admin: "bg-status-infoBg text-status-info",
  controller: "bg-status-matchedBg text-status-matched",
  accountant: "bg-ink-100 text-ink-700",
  auditor: "bg-status-pendingBg text-status-pending",
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

export default async function MembersPage() {
  const membership = await getCurrentMembership();
  if (!membership) return null;

  const canManage = can(membership.role, "org.manage_members");
  const supabase = (await createClient()) as any;

  const { data: rosterData } = await supabase.rpc("list_org_members", { p_org: membership.organizationId });
  const roster = ((rosterData ?? []) as { user_id: string; email: string; role: Role; joined_at: string | null }[])
    .filter((m) => m.joined_at)
    .sort((a, b) => a.email.localeCompare(b.email));

  let invitations: { id: string; email: string; role: Role; token: string; created_at: string; expires_at: string }[] = [];
  if (canManage) {
    const { data } = await supabase
      .from("organization_invitations")
      .select("id, email, role, token, created_at, expires_at")
      .eq("organization_id", membership.organizationId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    invitations = data ?? [];
  }

  const siteUrl = await getSiteUrl();
  const assignable = ASSIGN_ROLES[membership.role] ?? [];
  const inviteRoles = INVITE_ROLES[membership.role] ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Members</h1>
        <p className="mt-1 text-sm text-ink-500">
          {roster.length} {roster.length === 1 ? "person" : "people"} in {membership.organizationName}.
        </p>
      </div>

      {canManage && (
        <section className="rounded-xl border border-ink-100 bg-white p-5 shadow-subtle">
          <h2 className="text-[15px] font-semibold text-ink-900">Invite someone</h2>
          <p className="mb-4 mt-0.5 text-xs text-ink-500">
            They receive an email with a link to sign up and join this organization with the role you choose.
          </p>
          <InviteMemberForm roles={inviteRoles} emailConfigured={isEmailConfigured()} />
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-ink-100 bg-white shadow-subtle">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-100 bg-ink-50 text-left text-xs font-medium text-ink-500">
              <th className="px-5 py-2.5 font-medium">Member</th>
              <th className="px-3 py-2.5 font-medium">Role</th>
              <th className="px-3 py-2.5 font-medium">Joined</th>
              {canManage && <th className="px-5 py-2.5" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {roster.map((m) => {
              const isSelf = m.user_id === membership.userId;
              // Admins can't touch owners or other admins; nobody edits their own row.
              const locked = isSelf || (membership.role === "admin" && (m.role === "owner" || m.role === "admin"));
              return (
                <tr key={m.user_id}>
                  <td className="px-5 py-3">
                    <span className="font-medium text-ink-900">{m.email}</span>
                    {isSelf && <span className="ml-2 text-xs text-ink-500">(you)</span>}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      title={ROLE_DESCRIPTIONS[m.role]}
                      className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", ROLE_STYLE[m.role])}
                    >
                      {ROLE_LABELS[m.role]}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-ink-600">{fmtDate(m.joined_at)}</td>
                  {canManage && (
                    <td className="px-5 py-3 text-right">
                      {locked ? (
                        <span className="text-xs text-ink-400">{isSelf ? "—" : "Protected"}</span>
                      ) : (
                        <MemberRowActions userId={m.user_id} email={m.email} currentRole={m.role} assignableRoles={assignable} />
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {canManage && invitations.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-ink-100 bg-white shadow-subtle">
          <div className="border-b border-ink-100 px-5 py-3">
            <h2 className="text-[15px] font-semibold text-ink-900">Pending invitations</h2>
          </div>
          <ul className="divide-y divide-ink-100">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <div>
                  <p className="font-medium text-ink-900">{inv.email}</p>
                  <p className="text-xs text-ink-500">
                    {ROLE_LABELS[inv.role]} · expires {fmtDate(inv.expires_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isEmailConfigured() && <ResendInvitationButton invitationId={inv.id} />}
                  <CopyLinkButton text={`${siteUrl}/signup?invite=${inv.token}`} />
                  <RevokeInvitationButton invitationId={inv.id} email={inv.email} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-ink-100 bg-white p-5 shadow-subtle">
        <h2 className="text-[15px] font-semibold text-ink-900">What each role can do</h2>
        <dl className="mt-3 divide-y divide-ink-100 text-sm">
          {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
            <div key={r} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:gap-6">
              <dt className="w-28 shrink-0 font-medium text-ink-900">{ROLE_LABELS[r]}</dt>
              <dd className="text-ink-600">{ROLE_DESCRIPTIONS[r]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
