import { createClient } from "@/lib/supabase/server";

const AUTO_ITEM_TITLES = {
  reconciled: "All accounts reconciled",
  noExceptions: "No open exceptions",
} as const;

const MANUAL_ITEM_TITLE = "Final review complete";
/**
 * Finds (or lazily creates) the close period covering `date` for this
 * entity, seeding it with a lean 3-item checklist: two items the system
 * verifies on its own from live data, and exactly one that requires a
 * person's judgment. There's no "create a close period" step for anyone
 * to remember — it appears the moment someone looks at Close for a given
 * month, the same way reconciliation periods appear on the matching
 * workspace.
 */
export async function getOrCreateClosePeriod(
  entityId: string,
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
    .from("close_periods")
    .select("id")
    .eq("entity_id", entityId)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from("close_periods")
    .insert({ entity_id: entityId, period_start: periodStart, period_end: periodEnd, status: "open" })
    .select("id")
    .single();

  if (error || !created) throw new Error(error?.message ?? "Failed to create close period.");

  await supabase.from("close_checklist_items").insert([
    { close_period_id: created.id, title: AUTO_ITEM_TITLES.reconciled, is_auto: true, sort_order: 0 },
    { close_period_id: created.id, title: AUTO_ITEM_TITLES.noExceptions, is_auto: true, sort_order: 1 },
    {
      close_period_id: created.id,
      title: MANUAL_ITEM_TITLE,
      description: "One person confirms everything above genuinely looks right before the period closes.",
      assignee_id: actorId,
      is_auto: false,
      sort_order: 2,
    },
  ]);

  return created.id;
}

/**
 * Refreshes the two auto-verified checklist items from live data. Called
 * whenever the close page is viewed and whenever a reconciliation action
 * happens — never by direct user interaction. The manual item is
 * untouched here; only the explicit toggle action changes it.
 */
export async function recomputeCloseChecklist(closePeriodId: string) {
  // Cast to `any`: the reconciliations table and the close_checklist_items.is_auto
  // column are new and won't exist in types/database.ts until it's regenerated
  // (`supabase gen types typescript --linked`). Without this, every query below
  // fails to type-check against the stale generated types.
  const supabase = (await createClient()) as any;

  const { data: period } = await supabase
    .from("close_periods")
    .select("id, entity_id, period_start, period_end, status")
    .eq("id", closePeriodId)
    .single();

  if (!period || period.status === "closed") return;

  const { data: accounts } = await supabase
    .from("accounts")
    .select("id")
    .eq("entity_id", period.entity_id);
  const accountIds = (accounts ?? []).map((a: any) => a.id);

  let allReconciled = true;
  if (accountIds.length > 0) {
    const { data: recons } = await supabase
      .from("reconciliations")
      .select("status, account_id")
      .in("account_id", accountIds)
      .eq("period_start", period.period_start)
      .eq("period_end", period.period_end);

    // An account with no reconciliation record yet has had zero activity
    // this period — nothing to reconcile, so it doesn't block closing.
    allReconciled = (recons ?? []).every((r: any) => r.status === "reconciled" || r.status === "finalized");
  }

  const { count: openExceptionCount } = await supabase
    .from("exceptions")
    .select("id", { count: "exact", head: true })
    .eq("entity_id", period.entity_id)
    .eq("status", "open");

  await setAutoItemStatus(closePeriodId, AUTO_ITEM_TITLES.reconciled, allReconciled);
  await setAutoItemStatus(closePeriodId, AUTO_ITEM_TITLES.noExceptions, (openExceptionCount ?? 0) === 0);
}

async function setAutoItemStatus(closePeriodId: string, title: string, complete: boolean) {
  // Cast to `any`: the reconciliations table and the close_checklist_items.is_auto
  // column are new and won't exist in types/database.ts until it's regenerated
  // (`supabase gen types typescript --linked`). Without this, every query below
  // fails to type-check against the stale generated types.
  const supabase = (await createClient()) as any;
  await supabase
    .from("close_checklist_items")
    .update({
      status: complete ? "complete" : "not_started",
      completed_at: complete ? new Date().toISOString() : null,
    })
    .eq("close_period_id", closePeriodId)
    .eq("title", title)
    .eq("is_auto", true);
}

/**
 * Called from reconciliation actions after a match changes. Deliberately
 * does NOT create a close period on its own — if nobody's opened Close
 * for this month yet, there's nothing to refresh, and this is a no-op.
 * This is what makes the close checklist self-updating without anyone
 * needing to revisit it after reconciling.
 */
export async function refreshCloseChecklistIfPeriodExists(
  entityId: string,
  periodStart: string,
  periodEnd: string
) {
  // Cast to `any`: the reconciliations table and the close_checklist_items.is_auto
  // column are new and won't exist in types/database.ts until it's regenerated
  // (`supabase gen types typescript --linked`). Without this, every query below
  // fails to type-check against the stale generated types.
  const supabase = (await createClient()) as any;
  const { data: closePeriod } = await supabase
    .from("close_periods")
    .select("id")
    .eq("entity_id", entityId)
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .maybeSingle();

  if (closePeriod) await recomputeCloseChecklist(closePeriod.id);
}

function monthBoundsOf(dateStr: string) {
  const d = new Date(dateStr);
  const periodStart = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  const periodEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { periodStart, periodEnd };
}
