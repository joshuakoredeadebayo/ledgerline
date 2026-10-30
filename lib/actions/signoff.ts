"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { finalizeReconciliation } from "@/lib/actions/reconciliation";
import { assertPermission, can, type Role } from "@/lib/permissions";
import { notify } from "@/lib/notifications";

type Membership = NonNullable<Awaited<ReturnType<typeof getCurrentMembership>>>;

const shortName = (email: string) => email.split("@")[0] ?? email;

async function roster(supabase: any, organizationId: string) {
  const { data } = await supabase.rpc("list_org_members", { p_org: organizationId });
  return ((data ?? []) as { user_id: string; email: string; role: Role; joined_at: string | null }[]).filter((m) => m.joined_at);
}

function refresh(accountId: string) {
  revalidatePath(`/reconciliation/${accountId}`);
  revalidatePath("/reconciliation", "layout");
  revalidatePath("/dashboard");
  revalidatePath("/close", "layout");
  revalidatePath("/reports", "layout");
}

async function audit(supabase: any, m: Membership, entityId: string, action: string, reconciliationId: string, after: Record<string, unknown>) {
  await supabase.from("audit_log").insert({
    organization_id: m.organizationId,
    entity_id: entityId,
    actor_id: m.userId,
    action,
    target_table: "reconciliations",
    target_id: reconciliationId,
    after,
  });
}

/** Owners decide whether a second person must approve before a period is finalized or an entry is posted. */
export async function setRequireSignoff(on: boolean): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  if (membership.role !== "owner") return { error: "Only an owner can change the sign-off policy." };

  const supabase = (await createClient()) as any;
  const { data, error } = await supabase.from("organizations").update({ require_signoff: on }).eq("id", membership.organizationId).select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "The policy was not changed. You may not have permission." };

  await supabase.from("audit_log").insert({
    organization_id: membership.organizationId,
    actor_id: membership.userId,
    action: on ? "organization.signoff_required" : "organization.signoff_not_required",
    target_table: "organizations",
    target_id: membership.organizationId,
    after: { require_signoff: on },
  });
  revalidatePath("/settings/organization");
  revalidatePath("/reconciliation", "layout");
  return {};
}

async function loadForReview(supabase: any, reconciliationId: string) {
  const { data } = await supabase
    .from("reconciliations")
    .select("id, entity_id, account_id, status, period_start, submitted_by, reviewer_id, review_status, accounts(name)")
    .eq("id", reconciliationId)
    .maybeSingle();
  return data as any | null;
}

const periodLink = (r: any) => `/reconciliation/${r.account_id}?period=${String(r.period_start).slice(0, 7)}`;
const periodLabel = (r: any) => `${r.accounts?.name ?? "an account"} for ${String(r.period_start).slice(0, 7)}`;

/** The preparer hands a reconciled period to a named reviewer. */
export async function submitForReview(input: { reconciliationId: string; reviewerId: string; note: string }): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "reconciliation.match");

  const supabase = (await createClient()) as any;
  const r = await loadForReview(supabase, input.reconciliationId);
  if (!r) return { error: "Reconciliation period not found." };
  if (r.status !== "reconciled") return { error: "A period can be submitted for review once it is fully reconciled." };
  if (r.review_status === "pending") return { error: "This period is already waiting for review." };

  const people = await roster(supabase, membership.organizationId);
  const reviewer = people.find((m) => m.user_id === input.reviewerId);
  if (!reviewer) return { error: "Choose a reviewer from your team." };
  if (reviewer.user_id === membership.userId) return { error: "The reviewer must be a different person from you." };
  if (!can(reviewer.role, "reconciliation.finalize")) return { error: `${reviewer.email} can't approve reconciliations. Choose a controller or owner.` };

  const { error } = await supabase
    .from("reconciliations")
    .update({
      submitted_by: membership.userId,
      submitted_at: new Date().toISOString(),
      reviewer_id: reviewer.user_id,
      review_status: "pending",
      review_note: input.note.trim() || null,
      reviewed_by: null,
      reviewed_at: null,
    })
    .eq("id", input.reconciliationId);
  if (error) return { error: error.message };

  await audit(supabase, membership, r.entity_id, "reconciliation.submitted_for_review", input.reconciliationId, { reviewer: reviewer.email, note: input.note.trim() || null });
  await notify(supabase, {
    organizationId: membership.organizationId,
    organizationName: membership.organizationName,
    actorId: membership.userId,
    recipientIds: [reviewer.user_id],
    type: "review_requested",
    title: `${shortName(membership.email)} asked you to review ${periodLabel(r)}`,
    body: input.note.trim() || null,
    linkPath: periodLink(r),
  });
  refresh(r.account_id);
  return {};
}

function canReview(r: any, membership: Membership): string | null {
  if (r.review_status !== "pending") return "This period isn't waiting for review.";
  if (r.submitted_by === membership.userId) return "You submitted this period, so someone else has to review it.";
  if (r.reviewer_id !== membership.userId && membership.role !== "owner") return "This period was assigned to a different reviewer.";
  return null;
}

/** The reviewer approves and finalizes in one step. If finalizing is refused (for example the balances disagree), the approval is undone. */
export async function approveAndFinalize(input: { reconciliationId: string; note: string }): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "reconciliation.finalize");

  const supabase = (await createClient()) as any;
  const r = await loadForReview(supabase, input.reconciliationId);
  if (!r) return { error: "Reconciliation period not found." };
  const refusal = canReview(r, membership);
  if (refusal) return { error: refusal };

  const { error } = await supabase
    .from("reconciliations")
    .update({ review_status: "approved", reviewed_by: membership.userId, reviewed_at: new Date().toISOString(), review_note: input.note.trim() || null })
    .eq("id", input.reconciliationId);
  if (error) return { error: error.message };

  const finalized = await finalizeReconciliation(input.reconciliationId, r.account_id);
  if (finalized.error) {
    await supabase
      .from("reconciliations")
      .update({ review_status: "pending", reviewed_by: null, reviewed_at: null, review_note: null })
      .eq("id", input.reconciliationId);
    return { error: finalized.error };
  }

  await audit(supabase, membership, r.entity_id, "reconciliation.review_approved", input.reconciliationId, { note: input.note.trim() || null });
  if (r.submitted_by) {
    await notify(supabase, {
      organizationId: membership.organizationId,
      organizationName: membership.organizationName,
      actorId: membership.userId,
      recipientIds: [r.submitted_by],
      type: "review_approved",
      title: `${shortName(membership.email)} approved and finalized ${periodLabel(r)}`,
      body: input.note.trim() || null,
      linkPath: periodLink(r),
    });
  }
  refresh(r.account_id);
  return {};
}

/** The reviewer sends the period back to the preparer, with a reason. */
export async function requestChanges(input: { reconciliationId: string; note: string }): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "reconciliation.finalize");

  if (input.note.trim().length < 5) return { error: "Say what needs to change, so the preparer knows what to fix." };

  const supabase = (await createClient()) as any;
  const r = await loadForReview(supabase, input.reconciliationId);
  if (!r) return { error: "Reconciliation period not found." };
  const refusal = canReview(r, membership);
  if (refusal) return { error: refusal };

  const { error } = await supabase
    .from("reconciliations")
    .update({ review_status: "changes_requested", reviewed_by: membership.userId, reviewed_at: new Date().toISOString(), review_note: input.note.trim() })
    .eq("id", input.reconciliationId);
  if (error) return { error: error.message };

  await audit(supabase, membership, r.entity_id, "reconciliation.changes_requested", input.reconciliationId, { note: input.note.trim() });
  if (r.submitted_by) {
    await notify(supabase, {
      organizationId: membership.organizationId,
      organizationName: membership.organizationName,
      actorId: membership.userId,
      recipientIds: [r.submitted_by],
      type: "review_changes",
      title: `${shortName(membership.email)} asked for changes to ${periodLabel(r)}`,
      body: input.note.trim(),
      linkPath: periodLink(r),
    });
  }
  refresh(r.account_id);
  return {};
}

/** The preparer takes a submission back, for example to fix something before the reviewer looks. */
export async function withdrawReview(reconciliationId: string): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  const supabase = (await createClient()) as any;
  const r = await loadForReview(supabase, reconciliationId);
  if (!r) return { error: "Reconciliation period not found." };
  if (r.review_status !== "pending") return { error: "This period isn't waiting for review." };
  if (r.submitted_by !== membership.userId) return { error: "Only the person who submitted it can withdraw it." };

  const { error } = await supabase
    .from("reconciliations")
    .update({ review_status: null, submitted_by: null, submitted_at: null, reviewer_id: null, review_note: null })
    .eq("id", reconciliationId);
  if (error) return { error: error.message };

  await audit(supabase, membership, r.entity_id, "reconciliation.review_withdrawn", reconciliationId, {});
  refresh(r.account_id);
  return {};
}
