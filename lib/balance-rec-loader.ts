import { chunkList, fetchAll } from "@/lib/fetch-all";
import { suggestClosingBalance, type BalanceKind, type BalanceRow, type RecItem } from "@/lib/balance-rec";

const sideOf = (t: { source: string; raw_payload: any }): "bank" | "ledger" => {
  if (t.source === "manual") return t.raw_payload?.side === "ledger" ? "ledger" : "bank";
  return t.source === "plaid" ? "bank" : "ledger";
};

/**
 * The items that are still "in flight" at the end of the period: transactions with no counterpart
 * yet, plus transactions whose confirmed counterpart is dated after the period ended (a bank line
 * on the 31st that the books recorded on the 2nd). Excluded transactions are left out.
 * Complete, not capped at 1,000.
 */
export async function loadBalanceRecItems(supabase: any, accountId: string, periodStart: string, periodEnd: string): Promise<RecItem[]> {
  const txns = await fetchAll<any>((from, to) =>
    supabase
      .from("transactions")
      .select("id, amount, transaction_date, description, source, raw_payload, status")
      .eq("account_id", accountId)
      .gte("transaction_date", periodStart)
      .lte("transaction_date", periodEnd)
      .neq("status", "excluded")
      .order("id")
      .range(from, to)
  );

  const matchedIds = txns.filter((t) => t.status === "matched").map((t) => t.id as string);
  const laterPartner = new Set<string>();

  for (const ids of chunkList(matchedIds)) {
    const { data: ownLines } = await supabase
      .from("match_lines")
      .select("match_id, transaction_id, matches!inner(status)")
      .in("transaction_id", ids)
      .eq("matches.status", "confirmed");
    const matchIds: string[] = [...new Set<string>((ownLines ?? []).map((l: any) => l.match_id as string))];
    const ownByMatch = new Map<string, string[]>();
    for (const l of ownLines ?? []) ownByMatch.set(l.match_id, [...(ownByMatch.get(l.match_id) ?? []), l.transaction_id]);

    for (const mIds of chunkList(matchIds)) {
      const { data: allLines } = await supabase.from("match_lines").select("match_id, transactions(transaction_date)").in("match_id", mIds);
      const latest = new Map<string, string>();
      for (const l of allLines ?? []) {
        const d = l.transactions?.transaction_date ? String(l.transactions.transaction_date).slice(0, 10) : "";
        if (d && d > (latest.get(l.match_id) ?? "")) latest.set(l.match_id, d);
      }
      for (const m of mIds) {
        if ((latest.get(m) ?? "") > periodEnd) for (const id of ownByMatch.get(m) ?? []) laterPartner.add(id);
      }
    }
  }

  return txns
    .filter((t) => t.status === "unmatched" || laterPartner.has(t.id))
    .map((t) => ({
      id: t.id as string,
      side: sideOf(t),
      amount: Number(t.amount),
      date: String(t.transaction_date).slice(0, 10),
      description: t.description ?? null,
    }));
}

/** A closing balance read from the running balances of imported bank rows, when they chain cleanly. */
export async function loadSuggestedClosing(
  supabase: any,
  accountId: string,
  periodStart: string,
  periodEnd: string,
  kind: BalanceKind
): Promise<{ balance: number; asOf: string } | null> {
  const rows = await fetchAll<any>((from, to) =>
    supabase
      .from("transactions")
      .select("id, amount, transaction_date, source, raw_payload, status")
      .eq("account_id", accountId)
      .eq("source", "manual")
      .gte("transaction_date", periodStart)
      .lte("transaction_date", periodEnd)
      .neq("status", "excluded")
      .order("id")
      .range(from, to)
  );

  const balanceRows: BalanceRow[] = rows
    .filter((t) => t.raw_payload?.side === "bank" && typeof t.raw_payload?.balance === "number")
    .map((t, index) => ({
      row: Number(t.raw_payload?.row ?? index),
      date: String(t.transaction_date).slice(0, 10),
      amount: Number(t.amount),
      balance: t.raw_payload.balance as number,
    }));

  return suggestClosingBalance(balanceRows, kind);
}
