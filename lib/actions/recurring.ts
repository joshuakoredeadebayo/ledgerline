"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { assertPermission } from "@/lib/permissions";
import { checkJournalLines, type JournalLineInput } from "@/lib/journal-math";
import { addDays, firstRunDate, nextRunDate, validateSchedule, type Frequency, type Schedule } from "@/lib/recurring";
import { runDueTemplates, templateSchedule, type TemplateRow } from "@/lib/recurring-engine";

export interface RecurringInput {
  id?: string;
  entityId: string;
  name: string;
  description: string;
  frequency: Frequency;
  intervalCount: number;
  dayOfMonth: number | null;
  weekday: number | null;
  startDate: string;
  endDate: string | null;
  leadDays: number;
  lines: JournalLineInput[];
  /** Don't prepare drafts for dates that have already passed. */
  skipPast: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);

function refresh(id?: string) {
  revalidatePath("/recurring");
  if (id) revalidatePath(`/recurring/${id}`);
  revalidatePath("/journal-entries");
  revalidatePath("/dashboard");
}

async function audit(supabase: any, organizationId: string, actorId: string, entityId: string | null, action: string, id: string, after: Record<string, unknown>) {
  await supabase.from("audit_log").insert({ organization_id: organizationId, entity_id: entityId, actor_id: actorId, action, target_table: "recurring_templates", target_id: id, after });
}

export async function saveRecurringTemplate(input: RecurringInput): Promise<{ error?: string; id?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "journal_entries.draft");

  const name = input.name.trim();
  if (!name) return { error: "Give it a name, such as “Office rent”." };
  if (name.length > 120) return { error: "Keep the name under 120 characters." };
  if (input.description.trim().length > 300) return { error: "Keep the description under 300 characters." };
  if (!Number.isInteger(input.leadDays) || input.leadDays < 0 || input.leadDays > 30) return { error: "Prepare it between 0 and 30 days ahead." };

  const schedule: Schedule = {
    frequency: input.frequency,
    intervalCount: input.intervalCount,
    dayOfMonth: input.frequency === "weekly" ? null : input.dayOfMonth,
    weekday: input.frequency === "weekly" ? input.weekday : null,
    startDate: input.startDate,
    endDate: input.endDate || null,
  };
  const scheduleProblem = validateSchedule(schedule);
  if (scheduleProblem) return { error: scheduleProblem };

  if (input.lines.length > 50) return { error: "A recurring entry can have at most 50 lines." };
  const check = checkJournalLines(input.lines, true);
  if (!check.ok) return { error: check.problems[0] };

  const supabase = (await createClient()) as any;
  const { data: entity } = await supabase.from("entities").select("id, archived_at").eq("id", input.entityId).maybeSingle();
  if (!entity || entity.archived_at) return { error: "Choose an active entity." };

  const accountIds = [...new Set(check.lines.map((l) => l.accountId))];
  const { data: accounts } = await supabase.from("accounts").select("id, entity_id, archived_at").in("id", accountIds);
  const known = new Map<string, any>(((accounts ?? []) as any[]).map((a) => [a.id, a]));
  for (const id of accountIds) {
    const a = known.get(id);
    if (!a || a.entity_id !== input.entityId) return { error: "Every line must use an account from the chosen entity." };
    if (a.archived_at) return { error: "A line uses an archived account. Pick an active one." };
  }

  // Where the schedule stands: after anything already prepared, and (optionally) not in the past.
  let lastPrepared: string | null = null;
  if (input.id) {
    const { data: runs } = await supabase.from("recurring_runs").select("run_date").eq("template_id", input.id).eq("status", "created").order("run_date", { ascending: false }).limit(1);
    lastPrepared = runs?.[0]?.run_date ?? null;
  }
  const floor = input.skipPast ? addDays(today(), -1) : null;
  const after = [lastPrepared, floor, addDays(input.startDate, -1)].filter((d): d is string => !!d).sort().pop()!;
  const next = nextRunDate(schedule, after) ?? (input.id ? null : firstRunDate(schedule));
  if (!next) return { error: "Every date on this schedule is already in the past or has been prepared. Extend the end date or choose a later start." };

  const record = {
    entity_id: input.entityId,
    name,
    description: input.description.trim() || null,
    frequency: schedule.frequency,
    interval_count: schedule.intervalCount,
    day_of_month: schedule.dayOfMonth,
    weekday: schedule.weekday,
    start_date: schedule.startDate,
    end_date: schedule.endDate,
    next_run_date: next,
    lead_days: input.leadDays,
    lines: check.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo })),
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { data, error } = await supabase.from("recurring_templates").update({ ...record, status: "active" }).eq("id", input.id).select("id");
    if (error) return { error: error.message };
    if (!data || data.length === 0) return { error: "That recurring entry wasn't found." };
    await audit(supabase, membership.organizationId, membership.userId, input.entityId, "recurring.updated", input.id, { name, next_run: next });
    refresh(input.id);
    return { id: input.id };
  }

  const { data: created, error } = await supabase
    .from("recurring_templates")
    .insert({ ...record, organization_id: membership.organizationId, created_by: membership.userId })
    .select("id")
    .single();
  if (error || !created) return { error: error?.message ?? "Could not save the recurring entry." };
  await audit(supabase, membership.organizationId, membership.userId, input.entityId, "recurring.created", created.id, { name, schedule: schedule.frequency, next_run: next });
  refresh(created.id);
  return { id: created.id };
}

export async function setRecurringStatus(id: string, status: "active" | "paused"): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "journal_entries.draft");

  const supabase = (await createClient()) as any;
  const { data: t } = await supabase.from("recurring_templates").select("*").eq("id", id).maybeSingle();
  if (!t) return { error: "That recurring entry wasn't found." };

  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "active") {
    // Resuming skips the dates missed while paused, rather than flooding the drafts with catch-up entries.
    const next = nextRunDate(templateSchedule(t as TemplateRow), addDays(today(), -1));
    if (!next) return { error: "This schedule has no dates left. Edit it to extend the end date." };
    patch.next_run_date = next;
  }
  const { error } = await supabase.from("recurring_templates").update(patch).eq("id", id);
  if (error) return { error: error.message };
  await audit(supabase, membership.organizationId, membership.userId, t.entity_id, status === "active" ? "recurring.resumed" : "recurring.paused", id, { name: t.name });
  refresh(id);
  return {};
}

export async function deleteRecurringTemplate(id: string): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "journal_entries.draft");

  const supabase = (await createClient()) as any;
  const { data: t } = await supabase.from("recurring_templates").select("id, name, entity_id").eq("id", id).maybeSingle();
  if (!t) return { error: "That recurring entry wasn't found." };
  const { error } = await supabase.from("recurring_templates").delete().eq("id", id);
  if (error) return { error: error.message };
  await audit(supabase, membership.organizationId, membership.userId, t.entity_id, "recurring.deleted", id, { name: t.name });
  refresh();
  return {};
}

/** Prepares whatever is due now, for one template or all of them, without waiting for the daily job. */
export async function runRecurringNow(templateId?: string): Promise<{ error?: string; created?: number; failed?: number; problems?: string[] }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "journal_entries.draft");

  const supabase = (await createClient()) as any;
  const result = await runDueTemplates(supabase, { today: today(), organizationId: membership.organizationId, templateId, actorId: membership.userId });
  refresh(templateId);
  return { created: result.created, failed: result.failed, problems: result.problems };
}
