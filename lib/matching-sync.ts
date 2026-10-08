
import { createClient } from "@/lib/supabase/server";
import { suggestMatches } from "@/lib/matching-engine";

/** How many days either side of a month a ledger entry may sit and still be paired with a bank line. */
const MATCH_WINDOW_DAYS = 7;

function shiftDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function chunkIds<T>(items: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

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
  // Bank transactions are matched within their own month. Ledger candidates are looked
  // for a week either side, so a charge the bank posts on Aug 31 can still pair with the
  // ledger entry dated Sep 2. The pair belongs to the month of its bank transaction, so
  // it is suggested exactly once, from that month's page.
  const windowStart = shiftDays(periodStart, -MATCH_WINDOW_DAYS);
  const windowEnd = shiftDays(periodEnd, MATCH_WINDOW_DAYS);
  const { data: candidateTxns } = await supabase
    .from("transactions")
    .select("id, amount, transaction_date, description, source, raw_payload")
    .eq("account_id", accountId)
    .eq("status", "unmatched")
    .gte("transaction_date", windowStart)
    .lte("transaction_date", windowEnd);
  const sideOf = (t: any) => {
    if (t.source === "manual") return t.raw_payload?.side ?? "bank";
    return t.source === "plaid" ? "bank" : "ledger";
  };
  const inPeriod = (t: any) => t.transaction_date >= periodStart && t.transaction_date <= periodEnd;
  const bankTxns = (candidateTxns ?? []).filter((t: any) => sideOf(t) === "bank" && inPeriod(t));
  let ledgerTxns = (candidateTxns ?? []).filter((t: any) => sideOf(t) === "ledger");

  // A ledger entry already suggested to a bank transaction in another month is spoken for.
  if (ledgerTxns.length > 0) {
    const reserved = new Set<string>();
    for (const ids of chunkIds(ledgerTxns.map((t: any) => t.id))) {
      const { data: lines } = await supabase
        .from("match_lines")
        .select("transaction_id, matches!inner(status, reconciliation_id)")
        .in("transaction_id", ids)
        .eq("matches.status", "pending_review")
        .neq("matches.reconciliation_id", reconciliationId);
      for (const l of lines ?? []) reserved.add(l.transaction_id);
    }
    if (reserved.size > 0) ledgerTxns = ledgerTxns.filter((t: any) => !reserved.has(t.id));
  }

  // Pairs a person has rejected or unmatched before never come back as suggestions.
  const excludePairs = new Set<string>();
  const { data: rejected } = await supabase
    .from("matches")
    .select("match_lines(transaction_id, side)")
    .eq("reconciliation_id", reconciliationId)
    .eq("status", "rejected");
  for (const m of rejected ?? []) {
    const lines = (m.match_lines ?? []) as { transaction_id: string; side: string }[];
    const bankLine = lines.find((l) => l.side === "bank");
    const ledgerLine = lines.find((l) => l.side === "ledger");
    if (bankLine && ledgerLine) excludePairs.add(`${bankLine.transaction_id}|${ledgerLine.transaction_id}`);
  }

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
    })),
    { excludePairs }
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