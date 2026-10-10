import { chunkList, fetchAll } from "@/lib/fetch-all";
import { monthBounds } from "@/lib/reports/reconciliation-report";

export interface PeriodSummaryRow {
  entityName: string;
  accountId: string;
  accountName: string;
  currency: string;
  status: string;
  bookTotal: number | null;
  externalTotal: number | null;
  difference: number | null;
  openExceptions: number;
  unmatched: number;
  finalizedBy: string | null;
  finalizedAt: string | null;
}

/** One line per reconcilable account for a month: where each stands, so a close can be reviewed at a glance. */
export async function loadPeriodSummary(supabase: any, month: string): Promise<PeriodSummaryRow[]> {
  const { start, end } = monthBounds(month);

  const accounts = await fetchAll<any>((from, to) =>
    supabase
      .from("accounts")
      .select("id, name, entities!inner(name, currency, archived_at)")
      .eq("is_reconcilable", true)
      .is("archived_at", null)
      .is("entities.archived_at", null)
      .order("name")
      .range(from, to)
  );

  const recons = await fetchAll<any>((from, to) =>
    supabase
      .from("reconciliations")
      .select("id, account_id, status, book_total, external_total, unexplained_difference, finalized_by, finalized_at")
      .eq("period_start", start)
      .order("id")
      .range(from, to)
  );
  const reconByAccount = new Map<string, any>(recons.map((r) => [r.account_id, r]));

  // Open exceptions per reconciliation.
  const openByRecon = new Map<string, number>();
  for (const ids of chunkList(recons.map((r) => r.id))) {
    const rows = await fetchAll<any>((from, to) =>
      supabase.from("exceptions").select("id, reconciliation_id").in("reconciliation_id", ids).eq("status", "open").order("id").range(from, to)
    );
    for (const e of rows) openByRecon.set(e.reconciliation_id, (openByRecon.get(e.reconciliation_id) ?? 0) + 1);
  }

  // Unmatched transactions per account in the month.
  const unmatchedRows = await fetchAll<any>((from, to) =>
    supabase
      .from("transactions")
      .select("id, account_id")
      .eq("status", "unmatched")
      .gte("transaction_date", start)
      .lte("transaction_date", end)
      .order("id")
      .range(from, to)
  );
  const unmatchedByAccount = new Map<string, number>();
  for (const t of unmatchedRows) unmatchedByAccount.set(t.account_id, (unmatchedByAccount.get(t.account_id) ?? 0) + 1);

  return accounts
    .map((a) => {
      const r = reconByAccount.get(a.id);
      return {
        entityName: a.entities?.name ?? "",
        accountId: a.id,
        accountName: a.name,
        currency: a.entities?.currency ?? "USD",
        status: r?.status ?? "not_started",
        bookTotal: r ? Number(r.book_total) : null,
        externalTotal: r ? Number(r.external_total) : null,
        difference: r ? Number(r.unexplained_difference) : null,
        openExceptions: r ? (openByRecon.get(r.id) ?? 0) : 0,
        unmatched: unmatchedByAccount.get(a.id) ?? 0,
        finalizedBy: r?.finalized_by ?? null,
        finalizedAt: r?.finalized_at ?? null,
      } satisfies PeriodSummaryRow;
    })
    .sort((x, y) => x.entityName.localeCompare(y.entityName) || x.accountName.localeCompare(y.accountName));
}
