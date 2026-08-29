import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { getOrCreateReconciliationPeriod, recomputeReconciliationStatus } from "@/lib/reconciliation-status";
import { MatchingWorkspace } from "@/components/reconciliation/matching-workspace";
import { AddManualTransactionForm } from "@/components/reconciliation/add-manual-transaction-form";
import { PeriodSummary } from "@/components/reconciliation/period-summary";

export default async function MatchingWorkspacePage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
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
      new Date().toISOString(),
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
        </p>
      </div>

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
          currency={entity?.currency ?? "USD"}
          finalizedAt={periodSummary.finalized_at}
          canFinalize={canFinalize}
        />
      )}

      {canMatch && periodSummary?.status !== "finalized" && (
        <AddManualTransactionForm accountId={accountId} entityId={account.entity_id} />
      )}

      <MatchingWorkspace
        accountId={accountId}
        currency={entity?.currency ?? "USD"}
        existingMatches={(existingMatches ?? []) as any}
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
