"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { assertPermission } from "@/lib/permissions";
import { getOrCreateReconciliationPeriod, recomputeReconciliationStatus } from "@/lib/reconciliation-status";
import { refreshCloseChecklistIfPeriodExists } from "@/lib/close-period-status";
import { testToolsEnabled } from "@/lib/test-tools";
import { EXCLUDE_REASONS } from "@/lib/exception-reasons";

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
  if (!testToolsEnabled()) return { error: "Test transactions are switched off in production." };

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

  // Manual entries inherit the account's currency (from any existing
  // synced transaction), falling back to the entity's — rather than the
  // column default of USD, which would mislabel entries on non-USD books.
  const { data: sibling } = await supabase
    .from("transactions")
    .select("currency")
    .eq("account_id", parsed.data.accountId)
    .neq("source", "manual")
    .limit(1)
    .maybeSingle();
  let manualCurrency: string | null = sibling?.currency ?? null;
  if (!manualCurrency) {
    const { data: ent } = await supabase.from("entities").select("currency").eq("id", parsed.data.entityId).single();
    manualCurrency = ent?.currency ?? "USD";
  }

  const { data: txn, error } = await supabase
    .from("transactions")
    .insert({
      entity_id: parsed.data.entityId,
      account_id: parsed.data.accountId,
      currency: manualCurrency,
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

  // An empty month has nothing to certify. Excluded transactions don't count as activity.
  const { count: activityCount } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .neq("status", "excluded")
    .gte("transaction_date", recon.period_start)
    .lte("transaction_date", recon.period_end);
  if ((activityCount ?? 0) === 0) {
    throw new Error("There are no transactions in this period, so there is nothing to finalize.");
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


// ────────────────────────────────────────────────────────────────
// Undo a match, exclude / restore a transaction, bulk confirm
// ────────────────────────────────────────────────────────────────

function refreshReconciliationViews(accountId: string) {
  revalidatePath(`/reconciliation/${accountId}`);
  revalidatePath("/reconciliation");
  revalidatePath("/reconciliation/pending-matches");
  revalidatePath("/reconciliation/exceptions");
  revalidatePath("/dashboard");
  revalidatePath("/close");
}

/**
 * Undo a confirmed match: both transactions return to unmatched and the pair is remembered
 * as rejected so the engine doesn't just suggest it again. The match record is kept, not
 * deleted, so the history stays in the audit trail.
 */
export async function unmatchMatch(matchId: string, accountId: string): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "reconciliation.match");

  const supabase = (await createClient()) as any;
  const { data: match } = await supabase
    .from("matches")
    .select("id, entity_id, status, reconciliation_id, match_lines(transaction_id)")
    .eq("id", matchId)
    .maybeSingle();
  if (!match) return { error: "Match not found." };
  if (match.status !== "confirmed") return { error: "Only a confirmed match can be undone." };

  if (match.reconciliation_id) {
    const { data: recon } = await supabase.from("reconciliations").select("status").eq("id", match.reconciliation_id).maybeSingle();
    if (recon?.status === "finalized") {
      return { error: "This period is finalized. Reopen it (with a reason) before undoing a match." };
    }
  }

  const { error } = await supabase.from("matches").update({ status: "rejected" }).eq("id", matchId);
  if (error) return { error: error.message };

  const txnIds = ((match.match_lines ?? []) as { transaction_id: string }[]).map((l) => l.transaction_id);
  if (txnIds.length > 0) await supabase.from("transactions").update({ status: "unmatched" }).in("id", txnIds);

  await supabase.from("audit_log").insert({
    organization_id: membership.organizationId,
    entity_id: match.entity_id,
    actor_id: membership.userId,
    action: "match.unmatched",
    target_table: "matches",
    target_id: matchId,
  });

  if (match.reconciliation_id) await recomputeReconciliationStatus(match.reconciliation_id);
  refreshReconciliationViews(accountId);
  return {};
}


/** Take a transaction out of the reconciliation entirely (duplicates, transfers, test data). */
export async function excludeTransaction(transactionId: string, accountId: string, reason: string, note?: string): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "reconciliation.match");

  if (!(EXCLUDE_REASONS as readonly string[]).includes(reason)) return { error: "Choose a reason for excluding this transaction." };
  if (reason === "Other" && (note ?? "").trim().length < 5) return { error: "Add a short note explaining why." };

  const supabase = (await createClient()) as any;
  const { data: txn } = await supabase
    .from("transactions")
    .select("id, entity_id, account_id, status, amount, description, transaction_date")
    .eq("id", transactionId)
    .maybeSingle();
  if (!txn) return { error: "Transaction not found." };
  if (txn.status === "matched") return { error: "This transaction is matched. Undo the match first." };
  if (txn.status === "excluded") return {};

  const { data: recon } = await supabase
    .from("reconciliations")
    .select("id, status")
    .eq("account_id", txn.account_id)
    .lte("period_start", txn.transaction_date)
    .gte("period_end", txn.transaction_date)
    .maybeSingle();
  if (recon?.status === "finalized") return { error: "This period is finalized. Reopen it before excluding a transaction." };

  const { error } = await supabase.from("transactions").update({ status: "excluded" }).eq("id", transactionId);
  if (error) return { error: error.message };

  // Close out any open exception for it, so it stops counting as outstanding work.
  await supabase
    .from("exceptions")
    .update({
      status: "dismissed",
      resolved_by: membership.userId,
      resolved_at: new Date().toISOString(),
      resolution_reason: `Excluded: ${reason}`,
      resolution_note: note?.trim() || null,
    })
    .eq("transaction_id", transactionId)
    .eq("status", "open");

  await supabase.from("audit_log").insert({
    organization_id: membership.organizationId,
    entity_id: txn.entity_id,
    actor_id: membership.userId,
    action: "transaction.excluded",
    target_table: "transactions",
    target_id: transactionId,
    after: { reason, note: note?.trim() || null, amount: txn.amount, description: txn.description },
  });

  if (recon?.id) await recomputeReconciliationStatus(recon.id);
  refreshReconciliationViews(accountId);
  return {};
}

/** Bring an excluded transaction back into the reconciliation. */
export async function restoreTransaction(transactionId: string, accountId: string): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "reconciliation.match");

  const supabase = (await createClient()) as any;
  const { data: txn } = await supabase
    .from("transactions")
    .select("id, entity_id, account_id, status, transaction_date")
    .eq("id", transactionId)
    .maybeSingle();
  if (!txn) return { error: "Transaction not found." };
  if (txn.status !== "excluded") return {};

  const { data: recon } = await supabase
    .from("reconciliations")
    .select("id, status")
    .eq("account_id", txn.account_id)
    .lte("period_start", txn.transaction_date)
    .gte("period_end", txn.transaction_date)
    .maybeSingle();
  if (recon?.status === "finalized") return { error: "This period is finalized. Reopen it before restoring a transaction." };

  const { error } = await supabase.from("transactions").update({ status: "unmatched" }).eq("id", transactionId);
  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    organization_id: membership.organizationId,
    entity_id: txn.entity_id,
    actor_id: membership.userId,
    action: "transaction.restored",
    target_table: "transactions",
    target_id: transactionId,
  });

  if (recon?.id) await recomputeReconciliationStatus(recon.id);
  refreshReconciliationViews(accountId);
  return {};
}

/**
 * Confirm every pending suggestion at or above a confidence level in one go. Matches are
 * confirmed first and each affected period is recomputed once afterwards; recomputing
 * after every single confirm would rebuild the remaining suggestions underneath us.
 */
export async function confirmMatchesAtOrAbove(minConfidence: number): Promise<{ error?: string; confirmed?: number }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "reconciliation.match");

  const threshold = Math.min(1, Math.max(0.5, Number(minConfidence)));
  const supabase = (await createClient()) as any;

  const { data: pending, error } = await supabase
    .from("matches")
    .select("id, entity_id, reconciliation_id, match_lines(transaction_id)")
    .eq("status", "pending_review")
    .gte("confidence_score", threshold)
    .limit(500);
  if (error) return { error: error.message };
  const matches = (pending ?? []) as { id: string; entity_id: string; reconciliation_id: string | null; match_lines: { transaction_id: string }[] }[];
  if (matches.length === 0) return { confirmed: 0 };

  const matchIds = matches.map((m) => m.id);
  const txnIds = [...new Set(matches.flatMap((m) => m.match_lines.map((l) => l.transaction_id)))];

  for (let i = 0; i < matchIds.length; i += 150) {
    const { error: updateError } = await supabase
      .from("matches")
      .update({ status: "confirmed", confirmed_by: membership.userId, confirmed_at: new Date().toISOString() })
      .in("id", matchIds.slice(i, i + 150));
    if (updateError) return { error: updateError.message };
  }
  for (let i = 0; i < txnIds.length; i += 150) {
    await supabase.from("transactions").update({ status: "matched" }).in("id", txnIds.slice(i, i + 150));
  }

  await supabase.from("audit_log").insert(
    matches.map((m) => ({
      organization_id: membership.organizationId,
      entity_id: m.entity_id,
      actor_id: membership.userId,
      action: "match.confirmed",
      target_table: "matches",
      target_id: m.id,
      after: { bulk: true, min_confidence: threshold },
    }))
  );

  const reconIds = [...new Set(matches.map((m) => m.reconciliation_id).filter(Boolean))] as string[];
  for (const id of reconIds) await recomputeReconciliationStatus(id);

  revalidatePath("/reconciliation", "layout");
  revalidatePath("/dashboard");
  revalidatePath("/close");
  return { confirmed: matches.length };
}
