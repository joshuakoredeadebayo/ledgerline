"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { assertPermission } from "@/lib/permissions";

/**
 * Toggle the one manual checklist item. The assignee can always toggle
 * their own item; anyone else needs close.manage_checklist (Controller/
 * Owner) — mirrored from the RLS policy on this table.
 */
export async function toggleManualChecklistItem(itemId: string, entityId: string) {
  const membership = await getCurrentMembership();
  if (!membership) throw new Error("Not signed in.");

  // Cast to `any`: the reconciliations table and the close_checklist_items.is_auto
  // column are new and won't exist in types/database.ts until it's regenerated
  // (`supabase gen types typescript --linked`). Without this, every query below
  // fails to type-check against the stale generated types.
  const supabase = (await createClient()) as any;
  const { data: item } = await supabase
    .from("close_checklist_items")
    .select("id, status, assignee_id, is_auto, close_period_id")
    .eq("id", itemId)
    .single();

  if (!item) throw new Error("Checklist item not found.");
  if (item.is_auto) throw new Error("This item is verified automatically and can't be toggled manually.");

  const isAssignee = item.assignee_id === membership.userId;
  if (!isAssignee) assertPermission(membership.role, "close.manage_checklist");

  const nowComplete = item.status !== "complete";

  await supabase
    .from("close_checklist_items")
    .update({
      status: nowComplete ? "complete" : "not_started",
      completed_at: nowComplete ? new Date().toISOString() : null,
    })
    .eq("id", itemId);

  await supabase.from("audit_log").insert({
    organization_id: membership.organizationId,
    entity_id: entityId,
    actor_id: membership.userId,
    action: nowComplete ? "close_checklist_item.completed" : "close_checklist_item.reopened",
    target_table: "close_checklist_items",
    target_id: itemId,
  });

  revalidatePath("/close");
}

/**
 * Close a period — the one deliberate human action in this whole flow.
 * Restricted to Controller/Owner, and only allowed once every checklist
 * item (the two auto-verified ones and the manual sign-off) is complete.
 */
export async function closePeriod(closePeriodId: string) {
  const membership = await getCurrentMembership();
  if (!membership) throw new Error("Not signed in.");
  assertPermission(membership.role, "close.lock_period");

  // Cast to `any`: the reconciliations table and the close_checklist_items.is_auto
  // column are new and won't exist in types/database.ts until it's regenerated
  // (`supabase gen types typescript --linked`). Without this, every query below
  // fails to type-check against the stale generated types.
  const supabase = (await createClient()) as any;
  const { data: period } = await supabase
    .from("close_periods")
    .select("id, entity_id, status")
    .eq("id", closePeriodId)
    .single();

  if (!period) throw new Error("Close period not found.");

  const { data: items } = await supabase
    .from("close_checklist_items")
    .select("status")
    .eq("close_period_id", closePeriodId);

  const allComplete = (items ?? []).length > 0 && (items ?? []).every((i: any) => i.status === "complete");
  if (!allComplete) {
    throw new Error("Every checklist item needs to be complete before this period can close.");
  }

  await supabase
    .from("close_periods")
    .update({ status: "closed", closed_by: membership.userId, closed_at: new Date().toISOString() })
    .eq("id", closePeriodId);

  await supabase.from("audit_log").insert({
    organization_id: membership.organizationId,
    entity_id: period.entity_id,
    actor_id: membership.userId,
    action: "close_period.closed",
    target_table: "close_periods",
    target_id: closePeriodId,
  });

  revalidatePath("/close");
}
