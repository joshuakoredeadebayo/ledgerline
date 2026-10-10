import { chunkList, fetchAll } from "@/lib/fetch-all";

export interface ReportTxn {
  id: string;
  amount: number;
  currency: string;
  date: string;
  description: string | null;
  side: "bank" | "ledger";
  status: string;
}

export interface ReportPair {
  matchId: string;
  matchType: string;
  confidence: number | null;
  bank: ReportTxn | null;
  ledger: ReportTxn | null;
  /** The two halves fall in different months (a cut-off difference). */
  crossPeriod: boolean;
}

export interface ReportExplained {
  txn: ReportTxn;
  outcome: "resolved" | "dismissed";
  reason: string;
  note: string | null;
  by: string | null;
  at: string | null;
}

export interface ReportExcluded {
  txn: ReportTxn;
  reason: string | null;
  note: string | null;
}

export interface ReconciliationReport {
  account: { id: string; name: string; code: string | null; entityName: string; currency: string };
  month: string;
  periodStart: string;
  periodEnd: string;
  reconciliation: {
    id: string;
    status: string;
    bookTotal: number;
    externalTotal: number;
    difference: number;
    preparedBy: string | null;
    finalizedBy: string | null;
    finalizedAt: string | null;
    reopenedReason: string | null;
  } | null;
  matched: ReportPair[];
  explained: ReportExplained[];
  unresolved: ReportTxn[];
  excluded: ReportExcluded[];
  transactionCount: number;
}

const sideOf = (t: { source: string; raw_payload: any }): "bank" | "ledger" => {
  if (t.source === "manual") return t.raw_payload?.side === "ledger" ? "ledger" : "bank";
  return t.source === "plaid" ? "bank" : "ledger";
};

const toTxn = (t: any): ReportTxn => ({
  id: t.id,
  amount: Number(t.amount),
  currency: t.currency,
  date: String(t.transaction_date).slice(0, 10),
  description: t.description ?? null,
  side: sideOf(t),
  status: t.status,
});

export function monthBounds(month: string): { start: string; end: string } {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

/**
 * Everything the reconciliation report shows for one account and month, gathered with paged
 * queries so a busy period is complete, never silently cut off.
 */
export async function loadReconciliationReport(supabase: any, accountId: string, month: string): Promise<ReconciliationReport | null> {
  const { data: account } = await supabase
    .from("accounts")
    .select("id, name, code, entity_id, entities(name, currency)")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) return null;

  const { start, end } = monthBounds(month);

  const { data: recon } = await supabase
    .from("reconciliations")
    .select("id, status, book_total, external_total, unexplained_difference, prepared_by, finalized_by, finalized_at, reopened_reason")
    .eq("account_id", accountId)
    .eq("period_start", start)
    .maybeSingle();

  const txnRows = await fetchAll<any>((from, to) =>
    supabase
      .from("transactions")
      .select("id, amount, currency, transaction_date, description, source, raw_payload, status")
      .eq("account_id", accountId)
      .gte("transaction_date", start)
      .lte("transaction_date", end)
      .order("transaction_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
  const txns = txnRows.map(toTxn);

  // Exceptions for these transactions: they carry the reasons for anything explained or excluded.
  const exceptionByTxn = new Map<string, any>();
  for (const ids of chunkList(txns.map((t) => t.id))) {
    const { data } = await supabase
      .from("exceptions")
      .select("transaction_id, status, resolved_by, resolved_at, resolution_reason, resolution_note")
      .in("transaction_id", ids);
    for (const e of data ?? []) exceptionByTxn.set(e.transaction_id, e);
  }

  // Confirmed matches: this period's own, plus any that pair one of this month's items with a
  // partner booked in another month (those belong to the other month's reconciliation).
  const pairs = new Map<string, ReportPair>();
  const matchedIds = txns.filter((t) => t.status === "matched").map((t) => t.id);
  for (const ids of chunkList(matchedIds)) {
    const { data: ownLines } = await supabase
      .from("match_lines")
      .select("match_id, matches!inner(status)")
      .in("transaction_id", ids)
      .eq("matches.status", "confirmed");
    const matchIds: string[] = [...new Set<string>((ownLines ?? []).map((l: any) => l.match_id as string))].filter((id) => !pairs.has(id));
    for (const mIds of chunkList(matchIds)) {
      const { data: matches } = await supabase
        .from("matches")
        .select("id, match_type, confidence_score, match_lines(side, transactions(id, amount, currency, transaction_date, description, source, raw_payload, status))")
        .in("id", mIds);
      for (const m of matches ?? []) {
        const lines: any[] = m.match_lines ?? [];
        const bank = lines.find((l) => l.side === "bank")?.transactions;
        const ledger = lines.find((l) => l.side === "ledger")?.transactions;
        const dates = [bank?.transaction_date, ledger?.transaction_date].filter(Boolean).map((d: string) => String(d).slice(0, 10));
        pairs.set(m.id, {
          matchId: m.id,
          matchType: m.match_type,
          confidence: m.confidence_score == null ? null : Number(m.confidence_score),
          bank: bank ? toTxn(bank) : null,
          ledger: ledger ? toTxn(ledger) : null,
          crossPeriod: dates.some((d: string) => d < start || d > end),
        });
      }
    }
  }
  const matched = [...pairs.values()].sort((a, b) => (a.bank?.date ?? a.ledger?.date ?? "").localeCompare(b.bank?.date ?? b.ledger?.date ?? ""));

  const explained: ReportExplained[] = [];
  const unresolved: ReportTxn[] = [];
  const excluded: ReportExcluded[] = [];
  for (const t of txns) {
    const e = exceptionByTxn.get(t.id);
    if (t.status === "excluded") {
      excluded.push({ txn: t, reason: e?.resolution_reason ?? null, note: e?.resolution_note ?? null });
    } else if (t.status === "unmatched") {
      if (e && e.resolved_by && (e.status === "resolved" || e.status === "dismissed")) {
        explained.push({
          txn: t,
          outcome: e.status,
          reason: e.resolution_reason ?? "No reason recorded",
          note: e.resolution_note ?? null,
          by: e.resolved_by,
          at: e.resolved_at,
        });
      } else {
        unresolved.push(t);
      }
    }
  }

  return {
    account: {
      id: account.id,
      name: account.name,
      code: account.code,
      entityName: account.entities?.name ?? "",
      currency: account.entities?.currency ?? "USD",
    },
    month,
    periodStart: start,
    periodEnd: end,
    reconciliation: recon
      ? {
          id: recon.id,
          status: recon.status,
          bookTotal: Number(recon.book_total),
          externalTotal: Number(recon.external_total),
          difference: Number(recon.unexplained_difference),
          preparedBy: recon.prepared_by,
          finalizedBy: recon.finalized_by,
          finalizedAt: recon.finalized_at,
          reopenedReason: recon.reopened_reason,
        }
      : null,
    matched,
    explained,
    unresolved,
    excluded,
    transactionCount: txns.length,
  };
}

/** Rows for the CSV download: one row per item, labelled by what became of it. */
export function reconciliationReportCsvRows(r: ReconciliationReport, nameOf: (userId: string | null) => string) {
  const cell = (t: ReportTxn | null) => (t ? [t.date, t.description ?? "", t.amount, t.currency] : ["", "", "", ""]);
  const rows: unknown[][] = [];
  for (const p of r.matched) {
    rows.push([
      p.crossPeriod ? "Matched (other month)" : "Matched",
      ...cell(p.bank),
      ...cell(p.ledger),
      p.matchType === "manual" ? "Matched by hand" : p.confidence != null ? `Suggested match, ${Math.round(p.confidence * 100)}% confidence` : "Suggested match",
      "",
    ]);
  }
  for (const e of r.explained) {
    const side = e.txn.side === "bank" ? [cell(e.txn), cell(null)] : [cell(null), cell(e.txn)];
    rows.push([
      e.outcome === "resolved" ? "Explained: resolved" : "Explained: dismissed",
      ...side[0]!,
      ...side[1]!,
      e.reason,
      [e.note, e.by ? `by ${nameOf(e.by)}` : ""].filter(Boolean).join(" · "),
    ]);
  }
  for (const t of r.unresolved) {
    const side = t.side === "bank" ? [cell(t), cell(null)] : [cell(null), cell(t)];
    rows.push(["Unresolved", ...side[0]!, ...side[1]!, "Not matched and not explained", ""]);
  }
  for (const x of r.excluded) {
    const side = x.txn.side === "bank" ? [cell(x.txn), cell(null)] : [cell(null), cell(x.txn)];
    rows.push(["Excluded", ...side[0]!, ...side[1]!, x.reason ?? "", x.note ?? ""]);
  }
  return rows;
}

export const RECONCILIATION_CSV_HEADER = [
  "Section",
  "Bank date",
  "Bank description",
  "Bank amount",
  "Bank currency",
  "Ledger date",
  "Ledger description",
  "Ledger amount",
  "Ledger currency",
  "Basis / reason",
  "Note",
];
