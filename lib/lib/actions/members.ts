"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { getSiteUrl } from "@/lib/site-url";
import { assertPermission, ROLE_LABELS, type Role } from "@/lib/permissions";
import { sendEmail } from "@/lib/email";
import { invitationEmail } from "@/lib/email-templates";

export type MemberActionState = {
  error?: string;
  success?: string;
  inviteLink?: string;
  /** What happened to the invitation email, so the form can say so plainly. */
  emailStatus?: "sent" | "not_configured" | "failed";
} | null;

const fmtExpiry = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

// Which roles each manager may hand out. The database has the final say
// (see guard_member_changes in migration 0008), this keeps the UI honest.
const CAN_INVITE: Partial<Record<Role, Role[]>> = {
  owner: ["admin", "controller", "accountant", "auditor"],
  admin: ["controller", "accountant", "auditor"],
};
const CAN_ASSIGN: Partial<Record<Role, Role[]>> = {
  owner: ["owner", "admin", "controller", "accountant", "auditor"],
  admin: ["controller", "accountant", "auditor"],
};

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  role: z.enum(["admin", "controller", "accountant", "auditor"]),
});

async function logAudit(
  supabase: any,
  organizationId: string,
  actorId: string,
  action: string,
  targetTable: string,
  targetId: string | null,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
) {
  await supabase.from("audit_log").insert({
    organization_id: organizationId,
    actor_id: actorId,
    action,
    target_table: targetTable,
    target_id: targetId,
    before,
    after,
  });
}

async function loadRoster(supabase: any, organizationId: string) {
  const { data } = await supabase.rpc("list_org_members", { p_org: organizationId });
  return (data ?? []) as { user_id: string; email: string; role: Role; joined_at: string | null }[];
}

export async function inviteMember(_prev: MemberActionState, formData: FormData): Promise<MemberActionState> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "org.manage_members");

  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  const { email, role } = parsed.data;

  if (!(CAN_INVITE[membership.role] ?? []).includes(role)) {
    return { error: `Your role can't invite someone as ${role}.` };
  }

  const supabase = (await createClient()) as any;

  const roster = await loadRoster(supabase, membership.organizationId);
  if (roster.some((m) => m.email.toLowerCase() === email)) {
    return { error: "That person is already a member of this organization." };
  }

  const token = randomBytes(24).toString("hex");
  const { data: invitation, error } = await supabase
    .from("organization_invitations")
    .insert({
      organization_id: membership.organizationId,
      email,
      role,
      token,
      invited_by: membership.userId,
    })
    .select("id, expires_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: "There is already an open invitation for that email. Copy its link below, or revoke it first." };
    }
    return { error: error.message };
  }

  await logAudit(supabase, membership.organizationId, membership.userId, "member.invited", "organization_invitations", invitation.id, null, { email, role });

  revalidatePath("/settings/members");
  const link = `${await getSiteUrl()}/signup?invite=${token}`;

  const message = invitationEmail({
    organizationName: membership.organizationName,
    inviterEmail: membership.email,
    roleLabel: ROLE_LABELS[role],
    link,
    expiresOn: fmtExpiry(invitation.expires_at),
  });
  const result = await sendEmail({ to: email, ...message });

  if (result.sent) {
    return { success: `Invitation emailed to ${email}. You can also share this link yourself:`, inviteLink: link, emailStatus: "sent" };
  }
  if (result.skipped) {
    return { success: `Invitation created for ${email}. Email isn't set up yet, so send them this link:`, inviteLink: link, emailStatus: "not_configured" };
  }
  return {
    success: `Invitation created for ${email}, but the email couldn't be sent (${result.error}). Send them this link instead:`,
    inviteLink: link,
    emailStatus: "failed",
  };
}

/** Sends the invitation email again for an open invitation (same link, same expiry). */
export async function resendInvitation(invitationId: string): Promise<{ error?: string; success?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "org.manage_members");

  const supabase = (await createClient()) as any;
  const { data: invitation } = await supabase
    .from("organization_invitations")
    .select("id, email, role, token, expires_at")
    .eq("id", invitationId)
    .eq("organization_id", membership.organizationId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!invitation) return { error: "That invitation is no longer open." };

  const message = invitationEmail({
    organizationName: membership.organizationName,
    inviterEmail: membership.email,
    roleLabel: ROLE_LABELS[invitation.role as Role],
    link: `${await getSiteUrl()}/signup?invite=${invitation.token}`,
    expiresOn: fmtExpiry(invitation.expires_at),
  });
  const result = await sendEmail({ to: invitation.email, ...message });

  if (!result.sent) {
    return {
      error: result.skipped
        ? "Email isn't set up yet. Copy the link and send it yourself."
        : `The email couldn't be sent: ${result.error}`,
    };
  }

  await logAudit(supabase, membership.organizationId, membership.userId, "invitation.resent", "organization_invitations", invitationId, null, { email: invitation.email });
  return { success: `Sent again to ${invitation.email}.` };
}

export async function revokeInvitation(invitationId: string): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "org.manage_members");

  const supabase = (await createClient()) as any;
  const { data: invitation } = await supabase
    .from("organization_invitations")
    .select("id, email, role")
    .eq("id", invitationId)
    .eq("organization_id", membership.organizationId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .maybeSingle();
  if (!invitation) return { error: "That invitation is no longer open." };

  const { error } = await supabase
    .from("organization_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", invitationId);
  if (error) return { error: error.message };

  await logAudit(supabase, membership.organizationId, membership.userId, "invitation.revoked", "organization_invitations", invitationId, { email: invitation.email, role: invitation.role }, null);
  revalidatePath("/settings/members");
  return {};
}

export async function changeMemberRole(userId: string, newRole: Role): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "org.manage_members");

  if (userId === membership.userId) return { error: "You can't change your own role." };
  if (!(CAN_ASSIGN[membership.role] ?? []).includes(newRole)) {
    return { error: `Your role can't assign ${newRole}.` };
  }

  const supabase = (await createClient()) as any;
  const roster = await loadRoster(supabase, membership.organizationId);
  const target = roster.find((m) => m.user_id === userId);
  if (!target) return { error: "That member wasn't found." };
  if (target.role === newRole) return {};
  if (membership.role === "admin" && (target.role === "owner" || target.role === "admin")) {
    return { error: "Admins can't change the role of an owner or another admin." };
  }

  const { data: updated, error } = await supabase
    .from("organization_members")
    .update({ role: newRole })
    .eq("organization_id", membership.organizationId)
    .eq("user_id", userId)
    .select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) return { error: "The role was not changed. You may not have permission." };

  await logAudit(supabase, membership.organizationId, membership.userId, "member.role_changed", "organization_members", updated[0].id, { email: target.email, role: target.role }, { email: target.email, role: newRole });
  revalidatePath("/settings/members");
  return {};
}

export async function removeMember(userId: string): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "org.manage_members");

  if (userId === membership.userId) return { error: "You can't remove yourself." };

  const supabase = (await createClient()) as any;
  const roster = await loadRoster(supabase, membership.organizationId);
  const target = roster.find((m) => m.user_id === userId);
  if (!target) return { error: "That member wasn't found." };
  if (membership.role === "admin" && (target.role === "owner" || target.role === "admin")) {
    return { error: "Admins can't remove an owner or another admin." };
  }

  const { data: removed, error } = await supabase
    .from("organization_members")
    .delete()
    .eq("organization_id", membership.organizationId)
    .eq("user_id", userId)
    .select("id");
  if (error) return { error: error.message };
  if (!removed || removed.length === 0) return { error: "The member was not removed. You may not have permission." };

  await logAudit(supabase, membership.organizationId, membership.userId, "member.removed", "organization_members", removed[0].id, { email: target.email, role: target.role }, null);
  revalidatePath("/settings/members");
  return {};
}

const orgNameSchema = z.object({
  name: z.string().trim().min(1, "Enter an organization name.").max(80, "Keep the name under 80 characters."),
});

export async function updateOrganizationName(_prev: MemberActionState, formData: FormData): Promise<MemberActionState> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  if (membership.role !== "owner") return { error: "Only an owner can rename the organization." };

  const parsed = orgNameSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the name and try again." };
  if (parsed.data.name === membership.organizationName) return { success: "No changes to save." };

  const supabase = (await createClient()) as any;
  const { data: updated, error } = await supabase
    .from("organizations")
    .update({ name: parsed.data.name })
    .eq("id", membership.organizationId)
    .select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) return { error: "The name was not changed. You may not have permission." };

  await logAudit(supabase, membership.organizationId, membership.userId, "organization.renamed", "organizations", membership.organizationId, { name: membership.organizationName }, { name: parsed.data.name });
  revalidatePath("/", "layout");
  return { success: "Organization name updated." };
}
