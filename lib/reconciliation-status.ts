import { createClient } from "@/lib/supabase/server";
import { refreshCloseChecklistIfPeriodExists } from "@/lib/close-period-status";
import { syncSuggestedMatches } from "@/lib/matching-sync";
import { computePeriodTotals } from "@/lib/reconciliation-math";

export type ReconciliationStatus = "draft" | "needs_review" | "reconciled" | "finalized" | "reopened";

/**
 * Finds (or lazily creates) the reconciliation record covering `date` for
 * this account. There is deliberately no user-facing "start a
 * reconciliation" step — the first time any transaction activity touches
 * a given month for this account, the period record is created quietly
 * in the background as a Draft.
 */
export async function getOrCreateReconciliationPeriod(
  entityId: string,
  accountId: string,
  date: string,
  actorId: string
): Promise<string> {
  // Cast to `any`: the reconciliations table and the close_checklist_items.is_auto
  // column are new and won't exist in types/database.ts until it's regenerated
  // (`supabase gen types typescript --linked`). Without this, every query below
  // fails to type-check against the stale generated types.
  const supabase = (await createClient()) as any;
  const { periodStart, periodEnd } = monthBoundsOf(date);

  const { data: existing } = await supabase
    .from("reconciliations")
    .select("id")
    .eq("account_id", accountId)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .maybeSingle();

  if (existing) return existing.id;

  // Opening balance carries forward from the immediately prior period's
  // closing totals, if one exists — otherwise this is the account's
  // first period and both sides start at zero.
  const { data: priorPeriod } = await supabase
    .from("reconciliations")
    .select("book_total, external_total")
    .eq("account_id", accountId)
    .lt("period_start", periodStart)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: created, error } = await supabase
    .from("reconciliations")
    .insert({
      entity_id: entityId,
      account_id: accountId,
      period_start: periodStart,
      period_end: periodEnd,
      opening_balance_book: priorPeriod?.book_total ?? 0,
      opening_balance_external: priorPeriod?.external_total ?? 0,
      prepared_by: actorId,
    })
    .select("id")
    .single();

  if (error || !created) throw new Error(error?.message ?? "Failed to create reconciliation period.");
  return created.id;
}

/**
 * Recomputes balances and status for a reconciliation period from its
 * current transactions/matches/exceptions. Called after every confirm,
 * reject, or new transaction — never invoked directly by a user action.
 * A finalized or reopened period is left untouched here; only Finalize
 * and Reopen (explicit, role-gated actions) may change those statuses.
 */
export async function recomputeReconciliationStatus(reconciliationId: string) {
  // Cast to `any`: the reconciliations table and the close_checklist_items.is_auto
  // column are new and won't exist in types/database.ts until it's regenerated
  // (`supabase gen types typescript --linked`). Without this, every query below
  // fails to type-check against the stale generated types.
  const supabase = (await createClient()) as any;

  const { data: recon } = await supabase
    .from("reconciliations")
    .select("id, entity_id, account_id, period_start, period_end, status")
    .eq("id", reconciliationId)
    .single();

  if (!recon || recon.status === "finalized") return;

  const { data: txns } = await supabase
    .from("transactions")
    .select("id, amount, source, raw_payload, status")
    .eq("account_id", recon.account_id)
    .gte("transaction_date", recon.period_start)
    .lte("transaction_date", recon.period_end);

  const sideOf = (t: { source: string; raw_payload: unknown }): "bank" | "ledger" => {
    if (t.source === "manual") return (t.raw_payload as { side?: string } | null)?.side === "ledger" ? "ledger" : "bank";
    return t.source === "plaid" ? "bank" : "ledger";
  };

  const periodTxns = (txns ?? []).map((t: any) => ({
    id: t.id as string,
    amount: t.amount as number,
    side: sideOf(t),
    status: t.status as "unmatched" | "matched" | "excluded",
  }));
  const unmatchedIds = periodTxns.filter((t: { status: string }) => t.status === "unmatched").map((t: { id: string }) => t.id);
  const matchedIds = periodTxns.filter((t: { status: string }) => t.status === "matched").map((t: { id: string }) => t.id);

  // Unmatched transactions a person has explained (resolved or dismissed with a reason):
  // they stay unmatched, but no longer block the period or count toward the difference.
  const explainedIds = new Set<string>();
  for (const ids of chunk(unmatchedIds)) {
    const { data: explained } = await supabase
      .from("exceptions")
      .select("transaction_id")
      .in("transaction_id", ids)
      .in("status", ["resolved", "dismissed"])
      .not("resolved_by", "is", null);
    for (const e of explained ?? []) explainedIds.add(e.transaction_id);
  }

  // Matched transactions whose partner sits in another month (a cut-off difference).
  const crossPeriodIds = new Set<string>();
  for (const ids of chunk(matchedIds)) {
    const { data: ownLines } = await supabase
      .from("match_lines")
      .select("match_id, transaction_id, matches!inner(status)")
      .in("transaction_id", ids)
      .eq("matches.status", "confirmed");
    const byMatch = new Map<string, string[]>();
    for (const l of ownLines ?? []) byMatch.set(l.match_id, [...(byMatch.get(l.match_id) ?? []), l.transaction_id]);
    for (const matchIds of chunk([...byMatch.keys()])) {
      const { data: allLines } = await supabase
        .from("match_lines")
        .select("match_id, transactions(transaction_date)")
        .in("match_id", matchIds);
      const outside = new Set<string>();
      for (const l of allLines ?? []) {
        const date = l.transactions?.transaction_date as string | undefined;
        if (date && (date < recon.period_start || date > recon.period_end)) outside.add(l.match_id);
      }
      for (const m of outside) for (const id of byMatch.get(m) ?? []) crossPeriodIds.add(id);
    }
  }

  const totals = computePeriodTotals(periodTxns, explainedIds, crossPeriodIds);
  const unmatchedTxnIds = totals.unresolvedIds;
  let hasUnresolved = unmatchedTxnIds.length > 0;

  // Regenerate suggested matches from current unmatched transactions
  // before counting pending ones below, so "matches pending review"
  // reflects what's actually there right now — this is what makes that
  // number real everywhere it's shown (dashboard, this page, close),
  // rather than only ever reading zero.
  await syncSuggestedMatches(reconciliationId, recon.entity_id, recon.account_id, recon.period_start, recon.period_end);

  const { count: pendingCount } = await supabase
    .from("matches")
    .select("id", { count: "exact", head: true })
    .eq("reconciliation_id", reconciliationId)
    .eq("status", "pending_review");

  if ((pendingCount ?? 0) > 0) hasUnresolved = true;

  // Keep the exceptions table itself in sync with reality — not just this
  // reconciliation's own status flag. Both the dashboard's "open
  // exceptions" count and the close checklist's "no open exceptions" item
  // read directly from this table, so a lone unmatched transaction with
  // no rejected match needs a real exception row too, not just an
  // internal "needs_review" flag nobody else can see.
  const { data: existingExceptions } = await supabase
    .from("exceptions")
    .select("id, transaction_id, status")
    .eq("reconciliation_id", reconciliationId);

  const existingByTxn = new Map<string, any>(
    (existingExceptions ?? []).map((e: any): [string, any] => [e.transaction_id, e])
  );

  for (const txnId of unmatchedTxnIds) {
    const existing = existingByTxn.get(txnId);
    if (!existing) {
      await supabase.from("exceptions").insert({
        entity_id: recon.entity_id,
        transaction_id: txnId,
        reconciliation_id: reconciliationId,
        exception_type: "unmatched",
        severity: "medium",
        status: "open",
      });
    } else if (existing.status !== "open") {
      // A transaction that was resolved and has since gone back to
      // unmatched (e.g. a reopened period) — reopen its exception too.
      await supabase
        .from("exceptions")
        .update({ status: "open", resolved_by: null, resolved_at: null, resolution_reason: null, resolution_note: null })
        .eq("id", existing.id);
    }
  }

  for (const [txnId, exc] of existingByTxn.entries()) {
    if (!unmatchedTxnIds.includes(txnId as string) && (exc as any).status === "open") {
      await supabase.from("exceptions").update({ status: "resolved" }).eq("id", (exc as any).id);
    }
  }

  const difference = totals.difference;
  const status: ReconciliationStatus =
    hasUnresolved || difference !== 0 ? "needs_review" : "reconciled";

  await supabase
    .from("reconciliations")
    .update({
      book_total: totals.bookTotal,
      external_total: totals.externalTotal,
      unexplained_difference: difference,
      status,
    })
    .eq("id", reconciliationId);

  await refreshCloseChecklistIfPeriodExists(recon.entity_id, recon.period_start, recon.period_end);
}

/** Splits an array so long `in (...)` lists stay within URL limits. */
function chunk<T>(items: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function monthBoundsOf(dateStr: string) {
  const d = new Date(dateStr);
  const periodStart = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  const periodEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { periodStart, periodEnd };
}