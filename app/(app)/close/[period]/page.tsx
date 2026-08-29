import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, CheckCircle2, Circle, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { recomputeCloseChecklist } from "@/lib/close-period-status";
import { getOrCreateReconciliationPeriod, recomputeReconciliationStatus } from "@/lib/reconciliation-status";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { ChecklistItemRow } from "@/components/close/checklist-item-row";
import { CloseButton } from "@/components/close/close-button";

export default async function ClosePeriodPage({ params }: { params: Promise<{ period: string }> }) {
  const { period: closePeriodId } = await params;
  const membership = await getCurrentMembership();
  // Cast to `any`: the reconciliations table and the close_checklist_items.is_auto
  // column are new and won't exist in types/database.ts until it's regenerated
  // (`supabase gen types typescript --linked`). Without this, every query below
  // fails to type-check against the stale generated types.
  const supabase = (await createClient()) as any;

  const { data: periodLookup } = await supabase
    .from("close_periods")
    .select("id, entity_id, period_start")
    .eq("id", closePeriodId)
    .single();

  if (!periodLookup) notFound();

  // Same reasoning as the Close list page — refresh every account's
  // reconciliation status for this entity/period before computing the
  // checklist, so "verified automatically" is actually current rather
  // than whatever it happened to be the last time someone opened that
  // specific account's page.
  if (membership) {
    const { data: accounts } = await supabase
      .from("accounts")
      .select("id")
      .eq("entity_id", periodLookup.entity_id);
    for (const account of accounts ?? []) {
      const reconciliationId = await getOrCreateReconciliationPeriod(
        periodLookup.entity_id,
        account.id,
        periodLookup.period_start,
        membership.userId
      );
      await recomputeReconciliationStatus(reconciliationId);
    }
  }

  await recomputeCloseChecklist(closePeriodId);

  const { data: period } = await supabase
    .from("close_periods")
    .select("id, entity_id, period_start, period_end, status, closed_at, entities(name)")
    .eq("id", closePeriodId)
    .single();

  if (!period) notFound();

  const { data: items } = await supabase
    .from("close_checklist_items")
    .select("id, title, description, status, is_auto, assignee_id, completed_at")
    .eq("close_period_id", closePeriodId)
    .order("sort_order");

  const entityName = (period.entities as unknown as { name: string })?.name ?? "Entity";
  const allComplete = (items ?? []).length > 0 && (items ?? []).every((i: any) => i.status === "complete");
  const canClose = membership ? can(membership.role, "close.lock_period") : false;
  const canToggle = membership ? can(membership.role, "close.manage_checklist") : false;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/close" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800">
          <ChevronLeft className="h-3.5 w-3.5" />
          Close
        </Link>
        <h1 className="text-2xl font-semibold text-ink-900">{entityName}</h1>
        <p className="mt-1 text-sm text-ink-500">
          {new Date(period.period_start).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </p>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-ink-100 bg-white p-5">
        <div>
          <Badge
            status={period.status === "closed" ? "matched" : allComplete ? "pending" : "neutral"}
            label={period.status === "closed" ? "Closed" : allComplete ? "Ready to close" : "In progress"}
          />
          {period.status === "closed" && period.closed_at && (
            <p className="mt-1.5 text-xs text-ink-500">Closed on {formatDate(period.closed_at)}</p>
          )}
        </div>
        {canClose && period.status !== "closed" && (
          <CloseButton closePeriodId={closePeriodId} disabled={!allComplete} />
        )}
      </div>

      <div className="divide-y divide-ink-100 rounded-lg border border-ink-100 bg-white">
        {(items ?? []).map((item: any) => (
          <div key={item.id} className="flex items-start gap-3 px-4 py-4">
            {item.status === "complete" ? (
              <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-status-matched" />
            ) : (
              <Circle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-ink-300" />
            )}
            <div className="flex-1">
              <p className="text-sm font-medium text-ink-900">{item.title}</p>
              {item.description && <p className="mt-0.5 text-sm text-ink-500">{item.description}</p>}
              {item.is_auto && (
                <p className="mt-1 text-xs text-ink-400">Verified automatically from your data</p>
              )}
            </div>
            {!item.is_auto && period.status !== "closed" && (
              <ChecklistItemRow
                itemId={item.id}
                entityId={period.entity_id}
                complete={item.status === "complete"}
                canToggle={canToggle || item.assignee_id === membership?.userId}
              />
            )}
          </div>
        ))}
      </div>

      {period.status === "closed" && (
        <p className="flex items-center gap-1.5 text-sm text-ink-500">
          <Lock className="h-3.5 w-3.5" />
          This period is closed. Reconciliations underneath it remain locked to their finalized state.
        </p>
      )}
    </div>
  );
}
