"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { assertPermission } from "@/lib/permissions";
import { recomputeReconciliationStatus } from "@/lib/reconciliation-status";

const EXTERNAL_ID_FIELDS = ["plaid_account_id", "plaid_item_id", "quickbooks_account_id", "quickbooks_item_id"] as const;

export interface LinkableAccount {
  id: string;
  name: string;
  code: string;
  source: string;
}

/**
 * Accounts eligible to be linked: reconcilable (Bank/Credit Card — the
 * only types that actually get matched against a feed), belonging to
 * this entity. Both already-standalone and already-partially-linked
 * accounts are included, since a three-way link (Plaid + QuickBooks +
 * something else) isn't supported, but re-linking after a mistake is.
 */
export async function getLinkableAccounts(entityId: string): Promise<LinkableAccount[]> {
  const membership = await getCurrentMembership();
  if (!membership) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("accounts")
    .select("id, name, code, source, plaid_account_id, quickbooks_account_id")
    .eq("entity_id", entityId)
    .eq("is_reconcilable", true)
    .order("name");

  return (data ?? []).map((a) => ({ id: a.id, name: a.name, code: a.code, source: a.source }));
}

/**
 * Merges two account rows that represent the same real-world bank
 * account — one Plaid-sourced, one QuickBooks-sourced — into a single
 * canonical row (`primaryAccountId`, chosen explicitly rather than
 * guessed). This is what lets the matching engine actually compare
 * bank-side and book-side activity for the same account, since
 * recomputeReconciliationStatus classifies "bank" vs "ledger" by
 * `source` within one shared account_id — see lib/reconciliation-status.ts.
 *
 * Every dependent row (transactions, reconciliations, matches,
 * journal_entry_lines) is explicitly re-pointed to the primary account
 * before the secondary row is deleted, rather than relying on FK
 * cascade rules — several of those are NO ACTION or SET NULL, neither
 * of which would do the right thing here (NO ACTION blocks the delete
 * outright; SET NULL would silently orphan exceptions and cause
 * recomputeReconciliationStatus to regenerate duplicates for them).
 */
export async function linkAccounts(
  entityId: string,
  primaryAccountId: string,
  secondaryAccountId: string
): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };

  assertPermission(membership.role, "entities.manage");

  if (primaryAccountId === secondaryAccountId) {
    return { error: "Choose two different accounts to link." };
  }

  const supabase = await createClient();

  const { data: accounts, error: fetchError } = await supabase
    .from("accounts")
    .select("id, entity_id, plaid_account_id, plaid_item_id, quickbooks_account_id, quickbooks_item_id")
    .in("id", [primaryAccountId, secondaryAccountId]);

  if (fetchError) return { error: fetchError.message };

  const primary = accounts?.find((a) => a.id === primaryAccountId);
  const secondary = accounts?.find((a) => a.id === secondaryAccountId);

  if (!primary || !secondary) return { error: "Could not find both accounts." };
  if (primary.entity_id !== entityId || secondary.entity_id !== entityId) {
    return { error: "Both accounts must belong to this entity." };
  }

  // Merge each external-id field: primary keeps its own value if set,
  // otherwise inherits secondary's. If both sides already have a value
  // for the *same* field (e.g. two different Plaid-linked accounts),
  // that's a genuine conflict this merge can't resolve automatically.
  const mergedFields: Record<string, string | null> = {};
  for (const field of EXTERNAL_ID_FIELDS) {
    const primaryValue = (primary as any)[field];
    const secondaryValue = (secondary as any)[field];
    if (primaryValue && secondaryValue && primaryValue !== secondaryValue) {
      return {
        error: `Both accounts already have a ${field.replace(/_/g, " ")} set to different values — can't merge automatically.`,
      };
    }
    mergedFields[field] = primaryValue ?? secondaryValue ?? null;
  }

  // Clear the fields we're about to move onto primary from secondary
  // FIRST — writing them to primary while secondary still holds the
  // same values would momentarily duplicate a unique (entity_id,
  // plaid_account_id)/(entity_id, quickbooks_account_id) pair, which
  // is exactly what caused the constraint violation this fixes.
  const clearFromSecondary: Record<string, null> = {};
  for (const field of EXTERNAL_ID_FIELDS) {
    if ((secondary as any)[field] && (secondary as any)[field] === mergedFields[field]) {
      clearFromSecondary[field] = null;
    }
  }
  if (Object.keys(clearFromSecondary).length > 0) {
    const { error: clearError } = await supabase.from("accounts").update(clearFromSecondary).eq("id", secondaryAccountId);
    if (clearError) return { error: clearError.message };
  }

  const { error: updateAccountError } = await supabase.from("accounts").update(mergedFields).eq("id", primaryAccountId);
  if (updateAccountError) return { error: updateAccountError.message };

  // Move every transaction off the secondary account. Safe with
  // respect to the (entity_id, plaid_transaction_id) and (entity_id,
  // quickbooks_transaction_id) unique constraints, since entity_id is
  // unchanged and those constraints don't include account_id.
  const { error: txnError } = await supabase
    .from("transactions")
    .update({ account_id: primaryAccountId })
    .eq("account_id", secondaryAccountId);
  if (txnError) return { error: txnError.message };

  // Manual GL entries posted against the secondary account, if any —
  // journal_entry_lines.account_id has no cascade rule, so leaving
  // these unmoved would block deleting the secondary account entirely.
  const { error: jelError } = await supabase
    .from("journal_entry_lines")
    .update({ account_id: primaryAccountId })
    .eq("account_id", secondaryAccountId);
  if (jelError) return { error: jelError.message };

  // Reconciliation periods: where the primary has no row for a given
  // period yet, just re-point the secondary's row rather than create a
  // fresh one. Where both already have a row for the same period,
  // keep primary's, re-point that period's matches onto it (matches
  // are actual reviewed/pending pairings — worth preserving), drop the
  // secondary's exceptions (cheap to regenerate on the next recompute,
  // and re-pointing them risks duplicate rows for the same transaction
  // if primary's recompute hasn't run since the merge), then delete
  // the now-redundant secondary reconciliation row.
  const { data: primaryRecons } = await supabase
    .from("reconciliations")
    .select("id, period_start, period_end")
    .eq("account_id", primaryAccountId);
  const primaryByPeriod = new Map((primaryRecons ?? []).map((r) => [`${r.period_start}_${r.period_end}`, r.id]));

  const { data: secondaryRecons } = await supabase
    .from("reconciliations")
    .select("id, period_start, period_end")
    .eq("account_id", secondaryAccountId);

  const recomputeIds = new Set<string>();

  for (const secRecon of secondaryRecons ?? []) {
    const key = `${secRecon.period_start}_${secRecon.period_end}`;
    const primaryReconId = primaryByPeriod.get(key);

    if (!primaryReconId) {
      // No conflict — this period only existed on the secondary side,
      // so it simply becomes primary's row for that period.
      await supabase.from("reconciliations").update({ account_id: primaryAccountId }).eq("id", secRecon.id);
      recomputeIds.add(secRecon.id);
      continue;
    }

    // Conflict — both sides already had a period record. Preserve
    // matches, drop exceptions (regenerated fresh below), then remove
    // the redundant row.
    await supabase.from("matches").update({ reconciliation_id: primaryReconId }).eq("reconciliation_id", secRecon.id);
    await supabase.from("exceptions").delete().eq("reconciliation_id", secRecon.id);
    await supabase.from("reconciliations").delete().eq("id", secRecon.id);
    recomputeIds.add(primaryReconId);
  }

  // Also delete the now-empty secondary account row — everything that
  // referenced it has been moved above, so this should never hit the
  // journal_entry_lines NO ACTION block or cascade unexpectedly.
  const { error: deleteError } = await supabase.from("accounts").delete().eq("id", secondaryAccountId);
  if (deleteError) return { error: deleteError.message };

  // Recompute every affected period now that both sides' transactions
  // actually live under one account_id — this is what makes the
  // matching engine finally able to compare bank vs. book activity.
  for (const reconciliationId of recomputeIds) {
    await recomputeReconciliationStatus(reconciliationId).catch((err) => {
      console.error("Post-merge recompute failed:", err);
    });
  }

  revalidatePath(`/entities/${entityId}`);
  revalidatePath("/reconciliation");
  return {};
}
