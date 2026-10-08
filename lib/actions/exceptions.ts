"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { assertPermission } from "@/lib/permissions";
import { recomputeReconciliationStatus } from "@/lib/reconciliation-status";
import { DISMISS_REASONS, RESOLVE_REASONS } from "@/lib/exception-reasons";

export type ExceptionOutcome = "resolved" | "dismissed";

function refresh() {
  revalidatePath("/reconciliation", "layout");
  revalidatePath("/dashboard");
  revalidatePath("/close");
}

/**
 * Closes an open exception with a recorded reason. "Resolved" means the item is understood
 * and accounted for (it counts as explained in the period's difference). "Dismissed" means
 * it isn't a real issue. Either way the transaction stays as it is; only the exception closes.
 */
export async function closeException(
  exceptionId: string,
  outcome: ExceptionOutcome,
  reason: string,
  note: string
): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "reconciliation.match");

  const allowed: readonly string[] = outcome === "resolved" ? RESOLVE_REASONS : DISMISS_REASONS;
  if (!allowed.includes(reason)) return { error: "Choose a reason." };
  const trimmedNote = note.trim();
  if (reason === "Other" && trimmedNote.length < 5) return { error: "Add a short note explaining why." };
  if (trimmedNote.length > 500) return { error: "Keep the note under 500 characters." };

  const supabase = (await createClient()) as any;
  const { data: exception } = await supabase
    .from("exceptions")
    .select("id, entity_id, status, reconciliation_id, transaction_id")
    .eq("id", exceptionId)
    .maybeSingle();
  if (!exception) return { error: "Exception not found." };
  if (exception.status !== "open") return { error: "This exception is already closed." };

  if (exception.reconciliation_id) {
    const { data: recon } = await supabase.from("reconciliations").select("status").eq("id", exception.reconciliation_id).maybeSingle();
    if (recon?.status === "finalized") return { error: "This period is finalized. Reopen it before changing its exceptions." };
  }

  const { data: updated, error } = await supabase
    .from("exceptions")
    .update({
      status: outcome,
      resolved_by: membership.userId,
      resolved_at: new Date().toISOString(),
      resolution_reason: reason,
      resolution_note: trimmedNote || null,
    })
    .eq("id", exceptionId)
    .select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) return { error: "Nothing was changed. You may not have permission." };

  await supabase.from("audit_log").insert({
    organization_id: membership.organizationId,
    entity_id: exception.entity_id,
    actor_id: membership.userId,
    action: outcome === "resolved" ? "exception.resolved" : "exception.dismissed",
    target_table: "exceptions",
    target_id: exceptionId,
    after: { reason, note: trimmedNote || null },
  });

  if (exception.reconciliation_id) await recomputeReconciliationStatus(exception.reconciliation_id);
  refresh();
  return {};
}

/** Puts a closed exception back to open, e.g. when an explanation turns out to be wrong. */
export async function reopenException(exceptionId: string): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "reconciliation.match");

  const supabase = (await createClient()) as any;
  const { data: exception } = await supabase
    .from("exceptions")
    .select("id, entity_id, status, reconciliation_id")
    .eq("id", exceptionId)
    .maybeSingle();
  if (!exception) return { error: "Exception not found." };
  if (exception.status === "open") return {};

  if (exception.reconciliation_id) {
    const { data: recon } = await supabase.from("reconciliations").select("status").eq("id", exception.reconciliation_id).maybeSingle();
    if (recon?.status === "finalized") return { error: "This period is finalized. Reopen it before changing its exceptions." };
  }

  const { data: updated, error } = await supabase
    .from("exceptions")
    .update({ status: "open", resolved_by: null, resolved_at: null, resolution_reason: null, resolution_note: null })
    .eq("id", exceptionId)
    .select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) return { error: "Nothing was changed. You may not have permission." };

  await supabase.from("audit_log").insert({
    organization_id: membership.organizationId,
    entity_id: exception.entity_id,
    actor_id: membership.userId,
    action: "exception.reopened",
    target_table: "exceptions",
    target_id: exceptionId,
  });

  if (exception.reconciliation_id) await recomputeReconciliationStatus(exception.reconciliation_id);
  refresh();
  return {};
}
