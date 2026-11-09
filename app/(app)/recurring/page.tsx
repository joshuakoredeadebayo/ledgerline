import Link from "next/link";
import { CalendarClock, Plus, Repeat } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { describeSchedule, relativeDay } from "@/lib/recurring";
import { templateSchedule, type TemplateRow } from "@/lib/recurring-engine";
import { RECURRING_STARTERS } from "@/lib/recurring-starters";
import { formatCurrency } from "@/lib/utils";
import { Badge, type BadgeStatus } from "@/components/ui/badge";
import { isMissingTable } from "@/lib/safe-query";
import { RecurringActions } from "@/components/recurring/recurring-actions";

const STATUS: Record<string, { status: BadgeStatus; label: string }> = {
  active: { status: "matched", label: "Active" },
  paused: { status: "pending", label: "Paused" },
  ended: { status: "neutral", label: "Ended" },
};

const fmtDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const totalOf = (t: TemplateRow) => (t.lines ?? []).reduce((n, l) => n + Number(l.debit || 0), 0);

export default async function RecurringPage() {
  const membership = await getCurrentMembership();
  if (!membership) return null;
  const canEdit = can(membership.role, "journal_entries.draft");
  const supabase = (await createClient()) as any;

  const { data, error } = await supabase
    .from("recurring_templates")
    .select("*, entities(name, currency)")
    .order("next_run_date", { ascending: true })
    .limit(300);
  const missing = isMissingTable(error);
  const templates: (TemplateRow & { entities: { name: string; currency: string } | null })[] = data ?? [];

  const { count: draftsWaiting } = missing
    ? { count: 0 }
    : await supabase.from("recurring_runs").select("id, journal_entries!inner(status)", { count: "exact", head: true }).eq("journal_entries.status", "draft");

  const today = new Date().toISOString().slice(0, 10);
  const active = templates.filter((t) => t.status === "active");
  const nextUp = [...active].sort((a, b) => a.next_run_date.localeCompare(b.next_run_date))[0];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Recurring entries</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-500">
            Rent, subscriptions, salaries and other regular entries. Each one prepares a <span className="font-medium text-ink-700">draft</span> journal entry on its date, which you
            review before posting. Nothing is posted automatically.
          </p>
        </div>
        {canEdit && !missing && (
          <Link href="/recurring/new" className="inline-flex h-9 items-center gap-2 rounded bg-accent-500 px-4 text-sm font-medium text-white hover:bg-accent-600">
            <Plus className="h-4 w-4" />
            New recurring entry
          </Link>
        )}
      </div>

      {missing && (
        <p className="rounded-lg border border-status-pending/30 bg-status-pendingBg px-4 py-3 text-sm text-ink-800">
          This feature needs the database update <span className="font-medium">0019_recurring_transactions.sql</span>. Ask an owner to run it in the Supabase SQL editor.
        </p>
      )}
      {error && !missing && (
        <p role="alert" className="rounded-lg border border-status-exception/20 bg-status-exceptionBg px-4 py-3 text-sm text-status-exception">
          The recurring entries couldn&apos;t be loaded: {error.message}
        </p>
      )}

      {templates.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-ink-100 bg-white p-5 shadow-subtle">
            <p className="text-xs text-ink-500">Active</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">{active.length}</p>
          </div>
          <div className="rounded-xl border border-ink-100 bg-white p-5 shadow-subtle">
            <p className="text-xs text-ink-500">Next entry</p>
            <p className="mt-1 text-lg font-semibold text-ink-900">{nextUp ? relativeDay(nextUp.next_run_date, today) : "—"}</p>
            <p className="text-xs text-ink-500">{nextUp ? `${nextUp.name} · ${fmtDate(nextUp.next_run_date)}` : "Nothing scheduled"}</p>
          </div>
          <Link href="/journal-entries?status=draft" className="rounded-xl border border-ink-100 bg-white p-5 shadow-subtle transition-shadow hover:shadow-panel">
            <p className="text-xs text-ink-500">Drafts waiting for review</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">{draftsWaiting ?? 0}</p>
          </Link>
        </div>
      )}

      {templates.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white shadow-subtle">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 bg-ink-50 text-left text-xs font-medium text-ink-500">
                <th className="px-5 py-2.5 font-medium">Entry</th>
                <th className="px-3 py-2.5 font-medium">Schedule</th>
                <th className="px-3 py-2.5 font-medium">Next entry</th>
                <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {templates.map((t) => {
                const badge = STATUS[t.status] ?? STATUS.active!;
                return (
                  <tr key={t.id} className="align-top hover:bg-ink-50/60">
                    <td className="px-5 py-4">
                      <Link href={`/recurring/${t.id}`} className="font-medium text-ink-900 hover:text-accent-700">
                        {t.name}
                      </Link>
                      <p className="text-xs text-ink-500">{t.entities?.name}</p>
                    </td>
                    <td className="px-3 py-4 text-ink-700">{describeSchedule(templateSchedule(t))}</td>
                    <td className="whitespace-nowrap px-3 py-4">
                      {t.status === "active" ? (
                        <>
                          <p className="text-ink-900">{fmtDate(t.next_run_date)}</p>
                          <p className={`text-xs ${t.next_run_date < today ? "font-medium text-status-exception" : "text-ink-500"}`}>{relativeDay(t.next_run_date, today)}</p>
                        </>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-right tabular-nums text-ink-900">{formatCurrency(totalOf(t), t.entities?.currency ?? "USD")}</td>
                    <td className="px-3 py-4">
                      <Badge status={badge.status} label={badge.label} />
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right">
                      <RecurringActions id={t.id} status={t.status} canEdit={canEdit} name={t.name} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        !missing &&
        !error && (
          <div className="rounded-xl border border-dashed border-ink-200 bg-white px-6 py-10 text-center">
            <Repeat className="mx-auto h-8 w-8 text-ink-300" />
            <h2 className="mt-3 text-base font-semibold text-ink-900">Stop retyping the same entries</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">Set up an entry once and it prepares itself as a draft every time it&apos;s due. Pick a starting point:</p>
            {canEdit && (
              <div className="mx-auto mt-5 grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-3">
                {RECURRING_STARTERS.map((s) => (
                  <Link key={s.id} href={`/recurring/new?starter=${s.id}`} className="rounded-lg border border-ink-100 bg-white px-3 py-3 text-left transition-colors hover:border-accent-300 hover:bg-accent-50">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-ink-900">
                      <CalendarClock className="h-3.5 w-3.5 text-accent-600" />
                      {s.label}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500">{s.hint}</p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
