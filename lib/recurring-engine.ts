import { addDays, nextRunDate, type Frequency, type Schedule } from "@/lib/recurring";
import { fetchAll } from "@/lib/fetch-all";
import { notify } from "@/lib/notifications";

export interface TemplateRow {
  id: string;
  organization_id: string;
  entity_id: string;
  name: string;
  description: string | null;
  frequency: Frequency;
  interval_count: number;
  day_of_month: number | null;
  weekday: number | null;
  start_date: string;
  end_date: string | null;
  next_run_date: string;
  lead_days: number;
  status: "active" | "paused" | "ended";
  lines: { accountId: string; debit: number; credit: number; memo?: string | null }[];
  created_by: string | null;
}

export const templateSchedule = (t: TemplateRow): Schedule => ({
  frequency: t.frequency,
  intervalCount: t.interval_count,
  dayOfMonth: t.day_of_month,
  weekday: t.weekday,
  startDate: t.start_date,
  endDate: t.end_date,
});

export interface EngineOptions {
  today: string;
  organizationId?: string;
  templateId?: string;
  actorId?: string | null;
  /** Most drafts prepared for one template in a single run (catching up after a long gap). */
  maxPerTemplate?: number;
  /** Stop starting new work after this moment (epoch ms). What is left stays due and is picked up on the next run. */
  deadlineAt?: number;
  /** How many templates are worked on at the same time. */
  concurrency?: number;
  /** Safety cap on how many due templates one run will look at. */
  maxTemplates?: number;
}

export interface EngineResult {
  created: number;
  failed: number;
  templates: number;
  /** Templates still due that this run didn't get to (out of time or over the cap). */
  deferred: number;
  timedOut: boolean;
  durationMs: number;
  /** Plain-language notes about anything that went wrong. */
  problems: string[];
}

const CHUNK = 50;
const inChunks = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/**
 * Prepares the draft journal entries that are due.
 *
 * Built to stay quick and safe as the number of customers grows:
 *  - due templates are found with one indexed, paged query, oldest first;
 *  - they are worked through in batches, with the accounts for a whole batch checked in one query;
 *  - a few templates run side by side, and the run stops cleanly when its time budget is spent, leaving the
 *    rest due for the next run (nothing is lost or repeated);
 *  - a date is only ever prepared once (a unique key on template and date), so overlapping runs, retries and
 *    the "prepare now" button can never create the same draft twice;
 *  - one failing template never stops the others.
 * Drafts are never posted automatically; a person reviews each one.
 *
 * `supabase` is either the signed-in user's client (the "prepare now" button) or the service client (the daily job).
 */
export async function runDueTemplates(supabase: any, opts: EngineOptions): Promise<EngineResult> {
  const started = Date.now();
  const result: EngineResult = { created: 0, failed: 0, templates: 0, deferred: 0, timedOut: false, durationMs: 0, problems: [] };
  const maxPer = opts.maxPerTemplate ?? 12;
  const concurrency = Math.max(1, opts.concurrency ?? 5);
  const maxTemplates = opts.maxTemplates ?? 5000;
  const overDeadline = () => opts.deadlineAt !== undefined && Date.now() >= opts.deadlineAt;

  // 1. Everything that could be due, oldest first.
  let due: TemplateRow[];
  try {
    due = await fetchAll<TemplateRow>((from, to) => {
      let q = supabase.from("recurring_templates").select("*").eq("status", "active").lte("next_run_date", addDays(opts.today, 30));
      if (opts.organizationId) q = q.eq("organization_id", opts.organizationId);
      if (opts.templateId) q = q.eq("id", opts.templateId);
      return q.order("next_run_date", { ascending: true }).order("id", { ascending: true }).range(from, to);
    }, { maxRows: maxTemplates });
  } catch (err) {
    result.problems.push(err instanceof Error ? err.message : String(err));
    result.durationMs = Date.now() - started;
    return result;
  }
  // Only those within their lead time (a manual run on one template ignores the lead time).
  due = due.filter((t) => t.next_run_date <= (opts.templateId ? opts.today : addDays(opts.today, t.lead_days)));

  const createdByOrg = new Map<string, { names: string[]; count: number }>();

  const processTemplate = async (t: TemplateRow, accounts: Map<string, any>) => {
    result.templates++;
    const horizon = opts.templateId ? opts.today : addDays(opts.today, t.lead_days);
    const accountIds = [...new Set((t.lines ?? []).map((l) => l.accountId))];
    const missing = accountIds.some((id) => !accounts.has(id));
    const bad = accountIds.map((id) => accounts.get(id)).find((a) => a && (a.entity_id !== t.entity_id || a.archived_at));
    const accountsProblem = missing ? "One of its accounts no longer exists." : bad ? `The account "${bad.name}" is archived or belongs to another entity.` : null;

    let current = t;
    for (let i = 0; i < maxPer; i++) {
      const runDate = current.next_run_date;
      if (current.end_date && runDate > current.end_date) {
        await supabase.from("recurring_templates").update({ status: "ended", updated_at: new Date().toISOString() }).eq("id", t.id);
        return;
      }
      if (runDate > horizon) return;

      const { data: existing } = await supabase.from("recurring_runs").select("id, status").eq("template_id", t.id).eq("run_date", runDate).maybeSingle();
      let skipCreate = existing?.status === "created"; // prepared already (another run got there first)
      if (existing?.status === "failed") await supabase.from("recurring_runs").delete().eq("id", existing.id); // try again

      if (!skipCreate) {
        const fail = async (message: string) => {
          result.failed++;
          result.problems.push(`${t.name}: ${message}`);
          await supabase.from("recurring_runs").upsert({ template_id: t.id, run_date: runDate, status: "failed", message: message.slice(0, 500) }, { onConflict: "template_id,run_date" });
          if (t.created_by) {
            await notify(supabase, {
              organizationId: t.organization_id,
              organizationName: "",
              actorId: opts.actorId ?? null,
              recipientIds: [t.created_by],
              type: "system",
              title: `The recurring entry "${t.name}" couldn't be prepared`,
              body: message,
              linkPath: `/recurring/${t.id}`,
              dedupeKey: `recurring-fail:${t.id}:${runDate}:${opts.today}`,
            });
          }
        };

        if (accountsProblem) {
          await fail(accountsProblem);
          return;
        }

        const { data: claim, error: claimError } = await supabase.from("recurring_runs").insert({ template_id: t.id, run_date: runDate, status: "created" }).select("id").single();
        if (claimError || !claim) {
          // A unique-key clash means another run just prepared this date; anything else is a real problem.
          if (claimError?.code !== "23505") {
            await fail(claimError?.message ?? "Could not record the run.");
            return;
          }
        } else {
          const { data: entry, error: entryError } = await supabase
            .from("journal_entries")
            .insert({ entity_id: t.entity_id, entry_date: runDate, description: t.description || t.name, status: "draft", created_by: opts.actorId ?? t.created_by })
            .select("id")
            .single();
          if (entryError || !entry) {
            await supabase.from("recurring_runs").delete().eq("id", claim.id);
            await fail(entryError?.message ?? "Could not create the draft.");
            return;
          }
          const { error: linesError } = await supabase.from("journal_entry_lines").insert(
            t.lines.map((l) => ({ journal_entry_id: entry.id, account_id: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, memo: l.memo || null }))
          );
          if (linesError) {
            await supabase.from("journal_entries").delete().eq("id", entry.id);
            await supabase.from("recurring_runs").delete().eq("id", claim.id);
            await fail(linesError.message);
            return;
          }
          await supabase.from("recurring_runs").update({ entry_id: entry.id }).eq("id", claim.id);
          result.created++;
          const bucket = createdByOrg.get(t.organization_id) ?? { names: [], count: 0 };
          bucket.count++;
          if (!bucket.names.includes(t.name)) bucket.names.push(t.name);
          createdByOrg.set(t.organization_id, bucket);
        }
      }

      // Move the template on to its next date, or end it.
      const next = nextRunDate(templateSchedule(current), runDate);
      const patch: Record<string, unknown> = { last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      if (next) patch.next_run_date = next;
      else patch.status = "ended";
      await supabase.from("recurring_templates").update(patch).eq("id", t.id);
      if (!next) return;
      current = { ...current, next_run_date: next };
    }
  };

  // 2. Work through them in batches.
  for (let start = 0; start < due.length; start += CHUNK) {
    if (overDeadline()) {
      result.timedOut = true;
      result.deferred = due.length - start;
      break;
    }
    const batch = due.slice(start, start + CHUNK);

    // One lookup of every account the batch uses, instead of one per template.
    const ids = [...new Set(batch.flatMap((t) => (t.lines ?? []).map((l) => l.accountId)))];
    const accounts = new Map<string, any>();
    for (const part of inChunks(ids, 100)) {
      const { data } = await supabase.from("accounts").select("id, name, entity_id, archived_at").in("id", part);
      for (const a of (data ?? []) as any[]) accounts.set(a.id, a);
    }

    for (const group of inChunks(batch, concurrency)) {
      await Promise.all(
        group.map((t) =>
          processTemplate(t, accounts).catch((err) => {
            result.failed++;
            result.problems.push(`${t.name}: ${err instanceof Error ? err.message : String(err)}`);
          })
        )
      );
    }
  }

  // 3. One notification per organization: "3 recurring entries are ready to review".
  const orgIds = [...createdByOrg.keys()];
  if (orgIds.length > 0) {
    const names = new Map<string, string>();
    for (const part of inChunks(orgIds, 100)) {
      const { data } = await supabase.from("organizations").select("id, name").in("id", part);
      for (const o of (data ?? []) as any[]) names.set(o.id, o.name);
    }
    const recipients = new Map<string, string[]>();
    for (const part of inChunks(orgIds, 50)) {
      const members = await fetchAll<{ organization_id: string; user_id: string; role: string }>((from, to) =>
        supabase.from("organization_members").select("organization_id, user_id, role").in("organization_id", part).not("joined_at", "is", null).order("id").range(from, to)
      ).catch(() => []);
      for (const m of members) {
        if (!["owner", "controller", "accountant"].includes(m.role)) continue;
        recipients.set(m.organization_id, [...(recipients.get(m.organization_id) ?? []), m.user_id]);
      }
    }
    for (const group of inChunks(orgIds, concurrency)) {
      await Promise.all(
        group.map((organizationId) => {
          const info = createdByOrg.get(organizationId)!;
          return notify(supabase, {
            organizationId,
            organizationName: names.get(organizationId) ?? "",
            actorId: opts.actorId ?? null,
            recipientIds: recipients.get(organizationId) ?? [],
            type: "system",
            title: `${info.count} recurring ${info.count === 1 ? "entry is" : "entries are"} ready to review`,
            body: info.names.slice(0, 4).join(", ") + (info.names.length > 4 ? ` and ${info.names.length - 4} more` : ""),
            linkPath: "/journal-entries?status=draft",
            dedupeKey: `recurring-ready:${organizationId}:${opts.today}`,
          });
        })
      );
    }
  }

  result.durationMs = Date.now() - started;
  return result;
}
