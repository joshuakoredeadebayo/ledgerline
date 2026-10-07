import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/permissions";
import { SignupForm, type InvitationInfo } from "@/components/auth/signup-form";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;

  let invitation: InvitationInfo | null = null;
  let invalidInvite = false;

  if (invite) {
    const supabase = (await createClient()) as any;
    const { data } = await supabase.rpc("lookup_invitation", { p_token: invite });
    const row = (data ?? [])[0] as { invited_email: string; invited_role: string; organization_name: string } | undefined;
    if (row) {
      invitation = {
        token: invite,
        email: row.invited_email,
        role: row.invited_role as Role,
        organizationName: row.organization_name,
      };
    } else {
      invalidInvite = true;
    }
  }

  return (
    <>
      {invalidInvite && (
        <p role="alert" className="mb-4 rounded-md border border-status-exception/20 bg-status-exceptionBg px-3 py-2 text-sm text-status-exception">
          This invitation link is invalid, already used, or has expired. Ask the person who invited you for a new one,
          or create a new organization below.
        </p>
      )}
      <SignupForm invitation={invitation} />
    </>
  );
}
