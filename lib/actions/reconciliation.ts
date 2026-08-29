"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { assertPermission } from "@/lib/permissions";
import { getOrCreateReconciliationPeriod, recomputeReconciliationStatus } from "@/lib/reconciliation-status";
import { refreshCloseChecklistIfPeriodExists } from "@/lib/close-period-status";

export type ActionState = { error?: string; fieldErrors?: Record<string, string> } | null;

/** Confirm a pending/suggested match — marks both transactions matched and logs the audit trail. */
export async function confirmMatch(matchId: string, accountId: string) {
  const membership = await getCurrentMembership();
  if (!membership) throw new Error("Not signed in.");
  assertPermission(membership.role, "reconciliation.match");

  // Cast to `any`: the reconciliations table and the close_checklist_items.is_auto
  // column are new and won't exist in types/database.ts until it's regenerated
  // (`supabase gen types typescript --linked`). Without this, every query below
  // fails to type-check against the stale generated types.
  const supabase = (await createClient()) as any;

  const { data: match } = await supabase
    .from("matches")
    .select("id, entity_id, reconciliation_id, match_lines(transaction_id)")
    .eq("id", matchId)
    .single();

  if (!match) throw new Error("Match not found.");

  const { error: matchError } = await supabase
    .from("matches")
    .update({ status: "confirmed", confirmed_by: membership.userId, confirmed_at: new Date().toISOString() })
    .eq("id", matchId);
  if (matchError) throw new Error(matchError.message);

  const txnIds = (match.match_lines as { transaction_id: string }[]).map((l) => l.transaction_id);
  if (txnIds.length > 0) {
    await supabase.from("transactions").update({ status: "matched" }).in("id", txnIds);
  }

  await supabase.from("audit_log").insert({
    organization_id: membership.organizationId,
    entity_id: match.entity_id,
    actor_id: membership.userId,
    action: "match.confirmed",
    target_table: "matches",
    target_id: matchId,
  });

  if (match.reconciliation_id) await recomputeReconciliationStatus(match.reconciliation_id);

  revalidatePath(`/reconciliation/${accountId}`);
  revalidatePath("/reconciliation");
  revalidatePath("/dashboard");
  revalidatePath("/close");
}

/** Reject a suggested match — both transactions go back to unmatched and become exceptions. */
export async function rejectMatch(matchId: string, accountId: string) {
  const membership = await getCurrentMembership();
  if (!membership) throw new Error("Not signed in.");
  assertPermission(membership.role, "reconciliation.match");

  // Cast to `any`: the reconciliations table and the close_checklist_items.is_auto
  // column are new and won't exist in types/database.ts until it's regenerated
  // (`supabase gen types typescript --linked`). Without this, every query below
  // fails to type-check against the stale generated types.
  const supabase = (await createClient()) as any;

  const { data: match } = await supabase
    .from("matches")
    .select("id, entity_id, reconciliation_id, match_lines(transaction_id)")
    .eq("id", matchId)
    .single();

  if (!match) throw new Error("Match not found.");

  await supabase.from("matches").update({ status: "rejected" }).eq("id", matchId);

  const txnIds = (match.match_lines as { transaction_id: string }[]).map((l) => l.transaction_id);
  if (txnIds.length > 0) {
    await supabase.from("transactions").update({ status: "unmatched" }).in("id", txnIds);

    for (const txnId of txnIds) {
      await supabase.from("exceptions").insert({
        entity_id: match.entity_id,
        transaction_id: txnId,
        exception_type: "unmatched",
        severity: "medium",
        reconciliation_id: match.reconciliation_id,
      });
    }
  }

  await supabase.from("audit_log").insert({
    organization_id: membership.organizationId,
    entity_id: match.entity_id,
    actor_id: membership.userId,
    action: "match.rejected",
    target_table: "matches",
    target_id: matchId,
  });

  if (match.reconciliation_id) await recomputeReconciliationStatus(match.reconciliation_id);

  revalidatePath(`/reconciliation/${accountId}`);
  revalidatePath("/reconciliation");
  revalidatePath("/dashboard");
  revalidatePath("/close");
}

/** Manually pair a bank transaction with a ledger transaction (accountant-initiated, not engine-suggested). */
export async function createManualMatch(
  entityId: string,
  accountId: string,
  bankTxnId: string,
  ledgerTxnId: string
) {
  const membership = await getCurrentMembership();
  if (!membership) throw new Error("Not signed in.");
  assertPermission(membership.role, "reconciliation.match");

  // Cast to `any`: the reconciliations table and the close_checklist_items.is_auto
  // column are new and won't exist in types/database.ts until it's regenerated
  // (`supabase gen types typescript --linked`). Without this, every query below
  // fails to type-check against the stale generated types.
  const supabase = (await createClient()) as any;

  const { data: bankTxn } = await supabase
    .from("transactions")
    .select("transaction_date")
    .eq("id", bankTxnId)
    .single();

  const reconciliationId = bankTxn
    ? await getOrCreateReconciliationPeriod(entityId, accountId, bankTxn.transaction_date, membership.userId)
    : null;

  const { data: match, error } = await supabase
    .from("matches")
    .insert({
      entity_id: entityId,
      match_type: "manual",
      status: "confirmed",
      created_by: membership.userId,
      confirmed_by: membership.userId,
      confirmed_at: new Date().toISOString(),
      reconciliation_id: reconciliationId,
    })
    .select("id")
    .single();

  if (error || !match) throw new Error(error?.message ?? "Failed to create match.");

  await supabase.from("match_lines").insert([
    { match_id: match.id, transaction_id: bankTxnId, side: "bank" },
    { match_id: match.id, transaction_id: ledgerTxnId, side: "ledger" },
  ]);

  await supabase.from("transactions").update({ status: "matched" }).in("id", [bankTxnId, ledgerTxnId]);

  await supabase.from("audit_log").insert({
    organization_id: membership.organizationId,
    entity_id: entityId,
    actor_id: membership.userId,
    action: "match.created_manual",
    target_table: "matches",
    target_id: match.id,
  });

  if (reconciliationId) await recomputeReconciliationStatus(reconciliationId);

  revalidatePath(`/reconciliation/${accountId}`);
  revalidatePath("/reconciliation");
  revalidatePath("/dashboard");
  revalidatePath("/close");
}

/** For testing/demo before Plaid & QuickBooks are wired up — manually add a transaction to an account. */
const manualTxnSchema = z.object({
  accountId: z.string().uuid(),
  entityId: z.string().uuid(),
  source: z.enum(["manual"]),
  side: z.enum(["bank", "ledger"]),
  amount: z.coerce.number(),
  transaction_date: z.string().min(1),
  description: z.string().optional(),
});

export async function addManualTransaction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "reconciliation.match");

  const parsed = manualTxnSchema.safeParse({
    accountId: formData.get("accountId"),
    entityId: formData.get("entityId"),
    source: "manual",
    side: formData.get("side"),
    amount: formData.get("amount"),
    transaction_date: formData.get("transaction_date"),
    description: formData.get("description") || undefined,
  });

  if (!parsed.success) {
    return { fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])) };
  }

  // Cast to `any`: the reconciliations table and the close_checklist_items.is_auto
  // column are new and won't exist in types/database.ts until it's regenerated
  // (`supabase gen types typescript --linked`). Without this, every query below
  // fails to type-check against the stale generated types.
  const supabase = (await createClient()) as any;
  const { data: txn, error } = await supabase
    .from("transactions")
    .insert({
      entity_id: parsed.data.entityId,
      account_id: parsed.data.accountId,
      source: "manual",
      external_id: `manual-${crypto.randomUUID()}`,
      amount: parsed.data.amount,
      transaction_date: parsed.data.transaction_date,
      description: parsed.data.description,
      status: "unmatched",
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // Tag which "side" this manual transaction represents via raw_payload,
  // since the matching workspace needs to split bank vs. ledger and manual
  // entries have no natural source to distinguish them by.
  await supabase.from("transactions").update({ raw_payload: { side: parsed.data.side } }).eq("id", txn.id);

  const reconciliationId = await getOrCreateReconciliationPeriod(
    parsed.data.entityId,
    parsed.data.accountId,
    parsed.data.transaction_date,
    membership.userId
  );
  await recomputeReconciliationStatus(reconciliationId);

  revalidatePath(`/reconciliation/${parsed.data.accountId}`);
  revalidatePath("/close");
  return null;
}

/**
 * Finalize a reconciliation period — the one genuinely manual, deliberate
 * action in this whole workflow. Restricted to Controller/Owner, and only
 * allowed once the period has auto-reached "reconciled" (zero unexplained
 * difference, nothing left unresolved). Locks the period: recomputation
 * skips finalized periods, so nothing can silently change it afterward.
 */
export async function finalizeReconciliation(reconciliationId: string, accountId: string) {
  const membership = await getCurrentMembership();
  if (!membership) throw new Error("Not signed in.");
  assertPermission(membership.role, "reconciliation.finalize");

  // Cast to `any`: the reconciliations table and the close_checklist_items.is_auto
  // column are new and won't exist in types/database.ts until it's regenerated
  // (`supabase gen types typescript --linked`). Without this, every query below
  // fails to type-check against the stale generated types.
  const supabase = (await createClient()) as any;
  const { data: recon } = await supabase
    .from("reconciliations")
    .select("id, entity_id, status, period_start, period_end")
    .eq("id", reconciliationId)
    .single();

  if (!recon) throw new Error("Reconciliation period not found.");
  if (recon.status !== "reconciled") {
    throw new Error("This period can only be finalized once it's fully reconciled.");
  }

  await supabase
    .from("reconciliations")
    .update({ status: "finalized", finalized_by: membership.userId, finalized_at: new Date().toISOString() })
    .eq("id", reconciliationId);

  await supabase.from("audit_log").insert({
    organization_id: membership.organizationId,
    entity_id: recon.entity_id,
    actor_id: membership.userId,
    action: "reconciliation.finalized",
    target_table: "reconciliations",
    target_id: reconciliationId,
  });

  await refreshCloseChecklistIfPeriodExists(recon.entity_id, recon.period_start, recon.period_end);

  revalidatePath(`/reconciliation/${accountId}`);
  revalidatePath("/close");
}

/** Reopen a finalized period under controlled permission — requires a documented reason, per audit best practice. */
export async function reopenReconciliation(reconciliationId: string, accountId: string, reason: string) {
  const membership = await getCurrentMembership();
  if (!membership) throw new Error("Not signed in.");
  assertPermission(membership.role, "reconciliation.finalize");

  if (!reason || reason.trim().length < 5) {
    throw new Error("A documented reason is required to reopen a finalized period.");
  }

  // Cast to `any`: the reconciliations table and the close_checklist_items.is_auto
  // column are new and won't exist in types/database.ts until it's regenerated
  // (`supabase gen types typescript --linked`). Without this, every query below
  // fails to type-check against the stale generated types.
  const supabase = (await createClient()) as any;
  const { data: recon } = await supabase
    .from("reconciliations")
    .select("id, entity_id, account_id")
    .eq("id", reconciliationId)
    .single();

  if (!recon) throw new Error("Reconciliation period not found.");

  await supabase
    .from("reconciliations")
    .update({ status: "reopened", reopened_reason: reason.trim() })
    .eq("id", reconciliationId);

  await supabase.from("audit_log").insert({
    organization_id: membership.organizationId,
    entity_id: recon.entity_id,
    actor_id: membership.userId,
    action: "reconciliation.reopened",
    target_table: "reconciliations",
    target_id: reconciliationId,
    after: { reason: reason.trim() },
  });

  await recomputeReconciliationStatus(reconciliationId);

  revalidatePath(`/reconciliation/${accountId}`);
  revalidatePath("/close");
}
