
import { createClient } from "@/lib/supabase/server";
import { suggestMatches } from "@/lib/matching-engine";
/**
 * Regenerates the pending "suggested" matches for one account's current
 * reconciliation period from scratch. Suggestions are never a user
 * decision — nothing is lost by wiping and rebuilding them fresh each
 * time this runs, and doing it this way means there's no drift to worry
 * about (a transaction that got matched a different way, deleted, or
 * changed simply won't produce a suggestion next time, full stop).
 *
 * Called after every reconciliation action (confirm, reject, add
 * transaction) and whenever the matching workspace page loads — this is
 * what makes "matches pending review" on the dashboard an honest number
 * instead of always reading zero.
 */
export async function syncSuggestedMatches(
  reconciliationId: string,
  entityId: string,
  accountId: string,
  periodStart: string,
  periodEnd: string
) {
  const supabase = (await createClient()) as any;
  const { data: stalePending } = await supabase
    .from("matches")
    .select("id")
    .eq("reconciliation_id", reconciliationId)
    .eq("status", "pending_review");
  const staleIds = (stalePending ?? []).map((m: any) => m.id);
  if (staleIds.length > 0) {
    const { error: lineErr } = await supabase.from("match_lines").delete().in("match_id", staleIds);
    if (lineErr) {
      console.error("[syncSuggestedMatches] failed to clear stale match_lines:", lineErr.message);
      throw new Error(`syncSuggestedMatches: could not clear stale match_lines: ${lineErr.message}`);
    }
    const { error: matchErr } = await supabase.from("matches").delete().in("id", staleIds);
    if (matchErr) {
      console.error("[syncSuggestedMatches] failed to clear stale matches:", matchErr.message);
      throw new Error(`syncSuggestedMatches: could not clear stale matches: ${matchErr.message}`);
    }
  }
  const { data: unmatchedTxns } = await supabase
    .from("transactions")
    .select("id, amount, transaction_date, description, source, raw_payload")
    .eq("account_id", accountId)
    .eq("status", "unmatched")
    .gte("transaction_date", periodStart)
    .lte("transaction_date", periodEnd);
  const sideOf = (t: any) => {
    if (t.source === "manual") return t.raw_payload?.side ?? "bank";
    return t.source === "plaid" ? "bank" : "ledger";
  };
  const bankTxns = (unmatchedTxns ?? []).filter((t: any) => sideOf(t) === "bank");
  const ledgerTxns = (unmatchedTxns ?? []).filter((t: any) => sideOf(t) === "ledger");
  const suggestions = suggestMatches(
    bankTxns.map((t: any) => ({
      id: t.id,
      amount: t.amount,
      transaction_date: t.transaction_date,
      description: t.description,
      source: t.source,
    })),
    ledgerTxns.map((t: any) => ({
      id: t.id,
      amount: t.amount,
      transaction_date: t.transaction_date,
      description: t.description,
      source: t.source,
    }))
  );
  for (const s of suggestions) {
    const { data: newMatch } = await supabase
      .from("matches")
      .insert({
        entity_id: entityId,
        match_type: "suggested",
        status: "pending_review",
        confidence_score: s.confidence,
        reconciliation_id: reconciliationId,
      })
      .select("id")
      .single();
    if (newMatch) {
      await supabase.from("match_lines").insert([
        { match_id: newMatch.id, transaction_id: s.bankTransaction.id, side: "bank" },
        { match_id: newMatch.id, transaction_id: s.ledgerTransaction.id, side: "ledger" },
      ]);
    }
  }
}