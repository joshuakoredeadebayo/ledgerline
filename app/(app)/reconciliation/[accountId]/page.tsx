import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { getOrCreateReconciliationPeriod, recomputeReconciliationStatus } from "@/lib/reconciliation-status";
import { MatchingWorkspace } from "@/components/reconciliation/matching-workspace";
import { AddManualTransactionForm } from "@/components/reconciliation/add-manual-transaction-form";
import { PeriodSummary } from "@/components/reconciliation/period-summary";

export default async function MatchingWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { accountId } = await params;
  const { period } = await searchParams;
  // Optional ?period=YYYY-MM selects which month to review; anything
  // missing or malformed falls back to the current month. Midday on the
  // 15th keeps month-boundary maths safe from timezone shifts.
  const periodDate = /^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? "")
    ? `${period}-15T12:00:00.000Z`
    : new Date().toISOString();
  const membership = await getCurrentMembership();
  // Cast to `any`: this page now also queries the `reconciliations` table,
  // which won't exist in types/database.ts until it's regenerated
  // (`supabase gen types typescript --linked`) — without this cast, the
  // periodSummary query below fails to type-check against stale types.
  const supabase = (await createClient()) as any;

  const { data: account } = await supabase
    .from("accounts")
    .select("id, name, entity_id, entities(name, currency)")
    .eq("id", accountId)
    .single();

  if (!account) notFound();

  const entity = account.entities as unknown as { name: string; currency: string };

  // The current calendar month's reconciliation period — created quietly
  // if this is the first activity on this account this month, then
  // refreshed to reflect whatever's true right now before we render.
  // This recompute is also what regenerates suggested matches below, via
  // the sync built into recomputeReconciliationStatus itself.
  let periodSummary: {
    id: string;
    status: "draft" | "needs_review" | "reconciled" | "finalized" | "reopened";
    period_start: string;
    period_end: string;
    book_total: number;
    external_total: number;
    unexplained_difference: number;
    finalized_at: string | null;
  } | null = null;

  if (membership) {
    const reconciliationId = await getOrCreateReconciliationPeriod(
      account.entity_id,
      accountId,
      periodDate,
      membership.userId
    );
    await recomputeReconciliationStatus(reconciliationId);
    const { data } = await supabase
      .from("reconciliations")
      .select("id, status, period_start, period_end, book_total, external_total, unexplained_difference, finalized_at")
      .eq("id", reconciliationId)
      .single();
    periodSummary = data;
  }

  // Pending suggested matches for THIS account's current period specifically
  // — scoped by reconciliation_id, not just entity_id, since an entity can
  // have several accounts each with their own pending suggestions.
  const { data: existingMatches } = await supabase
    .from("matches")
    .select(
      "id, status, confidence_score, match_type, match_lines(transaction_id, side, transactions(id, amount, currency, transaction_date, description, source, raw_payload))"
    )
    .eq("reconciliation_id", periodSummary?.id ?? "")
    .eq("status", "pending_review");

  // Raw unmatched transactions the matching engine found no plausible
  // suggestion for — these never appeared in the workspace before,
  // even though the Reconciliation list page's "unmatched" count
  // includes them. Scoped to the current period's date range, split by
  // side the same way recomputeReconciliationStatus classifies them
  // (source === "plaid" → bank; manual entries carry their side in
  // raw_payload; everything else, including QuickBooks, → ledger).
  const { data: unmatchedRaw } = await supabase
    .from("transactions")
    .select("id, amount, currency, transaction_date, description, source, raw_payload")
    .eq("account_id", accountId)
    .eq("status", "unmatched")
    .gte("transaction_date", periodSummary?.period_start ?? "1970-01-01")
    .lte("transaction_date", periodSummary?.period_end ?? "2999-12-31")
    .order("transaction_date", { ascending: false });

  // Display currency for this account's totals. Transactions carry their
  // own currency (Plaid reports it per transaction, USD in sandbox), and
  // the period totals are plain sums of those amounts — so labelling them
  // with the *entity's* currency would mislabel them. Use the account's
  // dominant transaction currency, falling back to the entity's when the
  // period has no transactions yet, and warn if more than one is present
  // (no conversion happens, so a mixed total isn't meaningful).
  const { data: periodCurrencyRows } = await supabase
    .from("transactions")
    .select("currency")
    .eq("account_id", accountId)
    .gte("transaction_date", periodSummary?.period_start ?? "1970-01-01")
    .lte("transaction_date", periodSummary?.period_end ?? "2999-12-31");

  const currencyCounts = new Map<string, number>();
  for (const row of periodCurrencyRows ?? []) {
    const c = (row.currency as string | null) ?? entity?.currency ?? "USD";
    currencyCounts.set(c, (currencyCounts.get(c) ?? 0) + 1);
  }
  const mixedCurrencies = currencyCounts.size > 1;
  const accountCurrency =
    [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? entity?.currency ?? "USD";

  // Previous/next month links for the period navigator.
  const shiftMonth = (isoDate: string, delta: number) => {
    const year = Number(isoDate.slice(0, 4));
    const month = Number(isoDate.slice(5, 7));
    return new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7);
  };
  const currentMonth = new Date().toISOString().slice(0, 7);
  const prevMonth = periodSummary ? shiftMonth(periodSummary.period_start, -1) : null;
  const nextMonth = periodSummary ? shiftMonth(periodSummary.period_start, 1) : null;

  const sideOf = (t: { source: string; raw_payload: any }): "bank" | "ledger" => {
    if (t.source === "plaid") return "bank";
    if (t.source === "manual" && (t.raw_payload?.side === "bank" || t.raw_payload?.side === "ledger")) {
      return t.raw_payload.side;
    }
    return "ledger";
  };

  const unmatchedBank = (unmatchedRaw ?? []).filter((t: any) => sideOf(t) === "bank");
  const unmatchedLedger = (unmatchedRaw ?? []).filter((t: any) => sideOf(t) === "ledger");

  const canMatch = membership ? can(membership.role, "reconciliation.match") : false;
  const canFinalize = membership ? can(membership.role, "reconciliation.finalize") : false;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/reconciliation" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800">
          <ChevronLeft className="h-3.5 w-3.5" />
          Reconciliation
        </Link>
        <h1 className="text-2xl font-semibold text-ink-900">{account.name}</h1>
        <p className="mt-1 text-sm text-ink-500">
          {entity?.name} · {entity?.currency}
          {accountCurrency !== entity?.currency && ` · account in ${accountCurrency}`}
        </p>
      </div>

      {periodSummary && prevMonth && nextMonth && (
        <div className="flex items-center gap-3 text-sm">
          <Link href={`/reconciliation/${accountId}?period=${prevMonth}`} className="inline-flex items-center gap-1 text-ink-500 hover:text-ink-800">
            <ChevronLeft className="h-3.5 w-3.5" />
            {prevMonth}
          </Link>
          {nextMonth <= currentMonth && (
            <Link href={`/reconciliation/${accountId}?period=${nextMonth}`} className="inline-flex items-center gap-1 text-ink-500 hover:text-ink-800">
              {nextMonth}
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )}

      {mixedCurrencies && (
        <p className="rounded-md border border-status-pending/30 bg-white px-3 py-2 text-sm text-ink-700">
          This period contains more than one currency ({[...currencyCounts.keys()].join(", ")}). Amounts are not
          converted, so the totals below are not a meaningful comparison.
        </p>
      )}

      {periodSummary && (
        <PeriodSummary
          reconciliationId={periodSummary.id}
          accountId={accountId}
          status={periodSummary.status}
          periodStart={periodSummary.period_start}
          periodEnd={periodSummary.period_end}
          bookTotal={periodSummary.book_total}
          externalTotal={periodSummary.external_total}
          difference={periodSummary.unexplained_difference}
          currency={accountCurrency}
          finalizedAt={periodSummary.finalized_at}
          canFinalize={canFinalize}
        />
      )}

      {canMatch && periodSummary?.status !== "finalized" && (
        <AddManualTransactionForm accountId={accountId} entityId={account.entity_id} />
      )}

      <MatchingWorkspace
        accountId={accountId}
        entityId={account.entity_id}
        currency={accountCurrency}
        existingMatches={(existingMatches ?? []) as any}
        unmatchedBank={unmatchedBank as any}
        unmatchedLedger={unmatchedLedger as any}
        canMatch={canMatch && periodSummary?.status !== "finalized"}
      />

      {periodSummary?.status === "finalized" && (
        <p className="text-sm text-ink-500">
          This period is finalized and locked. Use Reopen above if a correction is genuinely needed.
        </p>
      )}
    </div>
  );
}