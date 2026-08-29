import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { getOrCreateClosePeriod, recomputeCloseChecklist } from "@/lib/close-period-status";
import { getOrCreateReconciliationPeriod, recomputeReconciliationStatus } from "@/lib/reconciliation-status";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";

export default async function ClosePage() {
  const membership = await getCurrentMembership();
  // Cast to `any`: the reconciliations table and the close_checklist_items.is_auto
  // column are new and won't exist in types/database.ts until it's regenerated
  // (`supabase gen types typescript --linked`). Without this, every query below
  // fails to type-check against the stale generated types.
  const supabase = (await createClient()) as any;

  const { data: entities } = await supabase.from("entities").select("id, name").order("name");

  const rows: {
    entityId: string;
    entityName: string;
    closePeriodId: string;
    periodStart: string;
    periodEnd: string;
    status: string;
    completed: number;
    total: number;
  }[] = [];

  if (membership) {
    for (const entity of entities ?? []) {
      // Refresh every account's reconciliation status for this entity
      // before computing the checklist — otherwise "All accounts
      // reconciled" and "No open exceptions" only reflect whatever was
      // last true the moment someone happened to open that specific
      // account's page, not the current truth.
      const { data: accounts } = await supabase.from("accounts").select("id").eq("entity_id", entity.id);
      for (const account of accounts ?? []) {
        const reconciliationId = await getOrCreateReconciliationPeriod(
          entity.id,
          account.id,
          new Date().toISOString(),
          membership.userId
        );
        await recomputeReconciliationStatus(reconciliationId);
      }

      const closePeriodId = await getOrCreateClosePeriod(entity.id, new Date().toISOString(), membership.userId);
      await recomputeCloseChecklist(closePeriodId);

      const { data: period } = await supabase
        .from("close_periods")
        .select("period_start, period_end, status")
        .eq("id", closePeriodId)
        .single();

      const { data: items } = await supabase
        .from("close_checklist_items")
        .select("status")
        .eq("close_period_id", closePeriodId);

      const completed = (items ?? []).filter((i: any) => i.status === "complete").length;

      if (period) {
        rows.push({
          entityId: entity.id,
          entityName: entity.name,
          closePeriodId,
          periodStart: period.period_start,
          periodEnd: period.period_end,
          status: period.status,
          completed,
          total: (items ?? []).length,
        });
      }
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Close</h1>
        <p className="mt-1 text-sm text-ink-500">This month's close status across your entities.</p>
      </div>

      {rows.length > 0 ? (
        <div className="divide-y divide-ink-100 rounded-lg border border-ink-100 bg-white">
          {rows.map((row) => (
            <Link
              key={row.closePeriodId}
              href={`/close/${row.closePeriodId}`}
              className="flex items-center justify-between px-4 py-3.5 hover:bg-ink-50"
            >
              <div className="flex items-center gap-3">
                <ClipboardCheck className="h-4 w-4 text-ink-400" />
                <div>
                  <p className="text-sm font-medium text-ink-900">{row.entityName}</p>
                  <p className="text-xs text-ink-500">
                    {new Date(row.periodStart).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums text-ink-500">
                  {row.completed}/{row.total} complete
                </span>
                <Badge
                  status={row.status === "closed" ? "matched" : row.completed === row.total ? "pending" : "neutral"}
                  label={row.status === "closed" ? "Closed" : row.completed === row.total ? "Ready to close" : "In progress"}
                />
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<ClipboardCheck className="h-8 w-8" />}
          title="No entities to close yet"
          description="Add an entity and at least one account before month-end close applies."
        />
      )}
    </div>
  );
}
