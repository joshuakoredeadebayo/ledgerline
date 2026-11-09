import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { describeSchedule, relativeDay, upcomingDates } from "@/lib/recurring";
import { templateSchedule, type TemplateRow } from "@/lib/recurring-engine";
import { formatCurrency } from "@/lib/utils";
import { Badge, type BadgeStatus } from "@/components/ui/badge";
import { RecurringActions } from "@/components/recurring/recurring-actions";

const STATUS: Record<string, { status: BadgeStatus; label: string }> = {
  active: { status: "matched", label: "Active" },
  paused: { status: "pending", label: "Paused" },
  ended: { status: "neutral", label: "Ended" },
};
const ENTRY_STATUS: Record<string, { status: BadgeStatus; label: string }> = {
  draft: { status: "pending", label: "Draft, waiting for review" },
  posted: { status: "matched", label: "Posted" },
  reversed: { status: "neutral", label: "Reversed" },
};

const fmtDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function RecurringDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const membership = await getCurrentMembership();
  if (!membership) return null;
  const supabase = (await createClient()) as any;

  const { data } = await supabase.from("recurring_templates").select("*, entities(name, currency)").eq("id", id).maybeSingle();
  if (!data) notFound();
  const t = data as TemplateRow & { entities: { name: string; currency: string } | null };
  const currency = t.entities?.currency ?? "USD";

  const accountIds = [...new Set((t.lines ?? []).map((l) => l.accountId))];
  const { data: accountRows } = await supabase.from("accounts").select("id, name, code").in("id", accountIds);
  const accountName = new Map<string, string>(((accountRows ?? []) as any[]).map((a) => [a.id, `${a.code ? `${a.code} · ` : ""}${a.name}`]));

  const { data: runRows } = await supabase
    .from("recurring_runs")
    .select("id, run_date, status, message, entry_id, journal_entries(status)")
    .eq("template_id", id)
    .order("run_date", { ascending: false })
    .limit(24);
  const runs: any[] = runRows ?? [];

  const today = new Date().toISOString().slice(0, 10);
  const schedule = templateSchedule(t);
  const coming = t.status === "active" ? upcomingDates(schedule, t.next_run_date, 6) : [];
  const total = (t.lines ?? []).reduce((n, l) => n + Number(l.debit || 0), 0);
  const badge = STATUS[t.status] ?? STATUS.active!;
  const canEdit = can(membership.role, "journal_entries.draft");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/recurring" className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800">
          <ChevronLeft className="h-3.5 w-3.5" />
          Recurring entries
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-semibold text-ink-900">
              {t.name}
              <Badge status={badge.status} label={badge.label} />
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              {t.entities?.name} · {t.description || "No description"}
            </p>
          </div>
          <RecurringActions id={t.id} status={t.status} canEdit={canEdit} name={t.name} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-ink-100 bg-white p-5 shadow-subtle">
          <p className="text-xs text-ink-500">Schedule</p>
          <p className="mt-1 flex items-center gap-2 text-base font-semibold text-ink-900">
            <CalendarClock className="h-4 w-4 text-accent-600" />
            {describeSchedule(schedule)}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            From {fmtDate(t.start_date)}
            {t.end_date ? ` to ${fmtDate(t.end_date)}` : ", no end date"}
          </p>
        </div>
        <div className="rounded-xl border border-ink-100 bg-white p-5 shadow-subtle">
          <p className="text-xs text-ink-500">Next entry</p>
          {t.status === "active" ? (
            <>
              <p className="mt-1 text-base font-semibold text-ink-900">{relativeDay(t.next_run_date, today)}</p>
              <p className="mt-1 text-xs text-ink-500">
                {fmtDate(t.next_run_date)}
                {t.lead_days > 0 ? ` · prepared ${t.lead_days} day${t.lead_days === 1 ? "" : "s"} ahead` : ""}
              </p>
            </>
          ) : (
            <p className="mt-1 text-base font-semibold text-ink-400">{t.status === "paused" ? "Paused" : "No dates left"}</p>
          )}
        </div>
        <div className="rounded-xl border border-ink-100 bg-white p-5 shadow-subtle">
          <p className="text-xs text-ink-500">Amount each time</p>
          <p className="mt-1 text-base font-semibold tabular-nums text-ink-900">{formatCurrency(total, currency)}</p>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-ink-100 bg-white shadow-subtle">
        <div className="border-b border-ink-100 px-5 py-3">
          <h2 className="text-[15px] font-semibold text-ink-900">What it books</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-100 bg-ink-50 text-left text-xs font-medium text-ink-500">
              <th className="px-5 py-2 font-medium">Account</th>
              <th className="px-3 py-2 text-right font-medium">Debit</th>
              <th className="px-3 py-2 text-right font-medium">Credit</th>
              <th className="px-5 py-2 font-medium">Memo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {(t.lines ?? []).map((l, i) => (
              <tr key={i}>
                <td className="px-5 py-2.5 text-ink-900">{accountName.get(l.accountId) ?? "Account"}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{Number(l.debit) > 0 ? formatCurrency(Number(l.debit), currency) : ""}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{Number(l.credit) > 0 ? formatCurrency(Number(l.credit), currency) : ""}</td>
                <td className="px-5 py-2.5 text-ink-600">{l.memo ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <section className="rounded-xl border border-ink-100 bg-white p-5 shadow-subtle lg:col-span-2">
          <h2 className="text-[15px] font-semibold text-ink-900">Coming up</h2>
          {coming.length > 0 ? (
            <ul className="mt-3 space-y-1.5 text-sm">
              {coming.map((d) => (
                <li key={d} className="flex justify-between gap-3">
                  <span className="tabular-nums text-ink-800">{fmtDate(d)}</span>
                  <span className="text-xs text-ink-500">{relativeDay(d, today)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-ink-500">Nothing is scheduled while this is {t.status === "paused" ? "paused" : "ended"}.</p>
          )}
        </section>

        <section className="overflow-hidden rounded-xl border border-ink-100 bg-white shadow-subtle lg:col-span-3">
          <div className="border-b border-ink-100 px-5 py-3">
            <h2 className="text-[15px] font-semibold text-ink-900">History</h2>
          </div>
          {runs.length > 0 ? (
            <ul className="divide-y divide-ink-100 text-sm">
              {runs.map((r) => {
                const es = r.journal_entries?.status ? ENTRY_STATUS[r.journal_entries.status] : null;
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <span className="tabular-nums text-ink-800">{fmtDate(r.run_date)}</span>
                    {r.status === "failed" ? (
                      <span className="text-xs text-status-exception">Couldn&apos;t be prepared: {r.message}</span>
                    ) : r.entry_id ? (
                      <span className="flex items-center gap-3">
                        {es && <Badge status={es.status} label={es.label} />}
                        <Link href={`/journal-entries/${r.entry_id}`} className="text-xs font-medium text-accent-600 hover:text-accent-700">
                          Open entry
                        </Link>
                      </span>
                    ) : (
                      <span className="text-xs text-ink-400">Entry no longer exists</span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-5 py-6 text-sm text-ink-500">Nothing has been prepared yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
