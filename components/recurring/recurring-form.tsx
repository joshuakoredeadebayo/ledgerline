"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { CalendarClock, Plus, X } from "lucide-react";
import { saveRecurringTemplate } from "@/lib/actions/recurring";
import { checkJournalLines } from "@/lib/journal-math";
import { describeSchedule, upcomingDates, validateSchedule, type Frequency, type Schedule } from "@/lib/recurring";
import { RECURRING_STARTERS } from "@/lib/recurring-starters";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { FormAccount, FormEntity } from "@/components/journal/journal-entry-form";

export interface RecurringFormInitial {
  id?: string;
  entityId: string;
  name: string;
  description: string;
  frequency: Frequency;
  intervalCount: number;
  dayOfMonth: number | null;
  weekday: number | null;
  startDate: string;
  endDate: string;
  leadDays: number;
  lines: { accountId: string; debit: string; credit: string; memo: string }[];
}

const field =
  "h-9 w-full rounded border border-ink-200 bg-white px-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500";
const TYPE_ORDER = ["asset", "liability", "equity", "revenue", "expense"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const todayIso = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const UNIT: Record<Frequency, [string, string]> = {
  weekly: ["week", "weeks"],
  monthly: ["month", "months"],
  quarterly: ["quarter", "quarters"],
  yearly: ["year", "years"],
};

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-ink-100 bg-white p-5 shadow-subtle">
      <div>
        <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Label({ text, hint, children }: { text: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
      {text}
      {children}
      {hint && <span className="text-xs font-normal text-ink-500">{hint}</span>}
    </label>
  );
}

/**
 * Create or edit a recurring entry: what to book, how often, and from when. A live preview shows the
 * exact dates it will produce, so the schedule can be checked before saving.
 */
export function RecurringForm({ entities, accounts, initial }: { entities: FormEntity[]; accounts: FormAccount[]; initial: RecurringFormInitial }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [entityId, setEntityId] = useState(initial.entityId);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [frequency, setFrequency] = useState<Frequency>(initial.frequency);
  const [intervalCount, setIntervalCount] = useState(String(initial.intervalCount));
  const [dayOfMonth, setDayOfMonth] = useState(String(initial.dayOfMonth ?? 1));
  const [weekday, setWeekday] = useState(String(initial.weekday ?? 5));
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [leadDays, setLeadDays] = useState(String(initial.leadDays));
  const [skipPast, setSkipPast] = useState(true);
  const [lines, setLines] = useState(initial.lines);
  const keys = useRef(initial.lines.map((_, i) => i));
  const nextKey = useRef(initial.lines.length);

  const entity = entities.find((e) => e.id === entityId);
  const currency = entity?.currency ?? "USD";
  const entityAccounts = useMemo(() => accounts.filter((a) => a.entityId === entityId), [accounts, entityId]);
  const grouped = useMemo(() => TYPE_ORDER.map((type) => ({ type, items: entityAccounts.filter((a) => a.accountType === type) })).filter((g) => g.items.length > 0), [entityAccounts]);

  const schedule: Schedule = {
    frequency,
    intervalCount: Number(intervalCount) || 0,
    dayOfMonth: frequency === "weekly" ? null : Number(dayOfMonth) || 1,
    weekday: frequency === "weekly" ? Number(weekday) : null,
    startDate,
    endDate: endDate || null,
  };
  const scheduleProblem = validateSchedule(schedule);
  const preview = scheduleProblem ? [] : upcomingDates(schedule, skipPast && startDate < todayIso() ? todayIso() : startDate, 6);
  const past = !scheduleProblem && startDate < todayIso() ? upcomingDates(schedule, startDate, 60).filter((d) => d < todayIso()) : [];

  const check = checkJournalLines(lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo })));
  const balanced = check.totalDebitCents === check.totalCreditCents && check.totalDebitCents > 0;
  const update = (i: number, patch: Partial<(typeof lines)[number]>) => setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const applyStarter = (id: string) => {
    const s = RECURRING_STARTERS.find((x) => x.id === id);
    if (!s) return;
    setName(s.name);
    setDescription(s.description);
    setFrequency(s.frequency);
    setDayOfMonth(String(s.dayOfMonth));
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await saveRecurringTemplate({
        id: initial.id,
        entityId,
        name,
        description,
        frequency,
        intervalCount: Number(intervalCount),
        dayOfMonth: schedule.dayOfMonth,
        weekday: schedule.weekday,
        startDate,
        endDate: endDate || null,
        leadDays: Number(leadDays) || 0,
        lines: lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo })),
        skipPast,
      });
      if (res.error) setError(res.error);
      else router.push(`/recurring/${res.id}`);
    });
  };

  return (
    <div className="space-y-5">
      {!initial.id && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ink-500">Start from</span>
          {RECURRING_STARTERS.map((s) => (
            <button key={s.id} type="button" onClick={() => applyStarter(s.id)} title={s.hint} className="rounded-full border border-ink-200 bg-white px-3 py-1 text-xs font-medium text-ink-700 hover:border-accent-300 hover:bg-accent-50 hover:text-accent-700">
              {s.label}
            </button>
          ))}
        </div>
      )}

      <Section title="What to book">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Label text="Name" hint="How you'll recognise it in the list.">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Office rent" className={field} />
          </Label>
          <Label text="Entity">
            <select
              value={entityId}
              onChange={(e) => {
                setEntityId(e.target.value);
                setLines((prev) => prev.map((l) => ({ ...l, accountId: "" })));
              }}
              className={field}
            >
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.currency})
                </option>
              ))}
            </select>
          </Label>
          <div className="sm:col-span-2">
            <Label text="Description on each entry" hint="This becomes the description of every draft it prepares.">
              <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="Monthly rent" className={field} />
            </Label>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-ink-100">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-ink-100 bg-ink-50 text-left text-xs font-medium text-ink-500">
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="w-32 px-2 py-2 text-right font-medium">Debit</th>
                <th className="w-32 px-2 py-2 text-right font-medium">Credit</th>
                <th className="px-2 py-2 font-medium">Memo</th>
                <th className="w-9" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {lines.map((l, i) => (
                <tr key={keys.current[i]}>
                  <td className="px-3 py-2">
                    <select aria-label={`Account for line ${i + 1}`} value={l.accountId} onChange={(e) => update(i, { accountId: e.target.value })} className={field}>
                      <option value="">Choose an account…</option>
                      {grouped.map((g) => (
                        <optgroup key={g.type} label={g.type.charAt(0).toUpperCase() + g.type.slice(1)}>
                          {g.items.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code ? `${a.code} · ` : ""}
                              {a.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input aria-label={`Debit for line ${i + 1}`} type="number" min="0" step="0.01" inputMode="decimal" value={l.debit} onChange={(e) => update(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} className={`${field} text-right tabular-nums`} />
                  </td>
                  <td className="px-2 py-2">
                    <input aria-label={`Credit for line ${i + 1}`} type="number" min="0" step="0.01" inputMode="decimal" value={l.credit} onChange={(e) => update(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} className={`${field} text-right tabular-nums`} />
                  </td>
                  <td className="px-2 py-2">
                    <input aria-label={`Memo for line ${i + 1}`} value={l.memo} onChange={(e) => update(i, { memo: e.target.value })} maxLength={200} className={field} />
                  </td>
                  <td className="px-1 py-2">
                    {lines.length > 2 && (
                      <button
                        type="button"
                        aria-label={`Remove line ${i + 1}`}
                        onClick={() => {
                          keys.current.splice(i, 1);
                          setLines((prev) => prev.filter((_, idx) => idx !== i));
                        }}
                        className="rounded p-1.5 text-ink-400 hover:bg-ink-50 hover:text-ink-700"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-ink-100 bg-ink-50 font-medium text-ink-900">
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      keys.current.push(nextKey.current++);
                      setLines((prev) => [...prev, { accountId: "", debit: "", credit: "", memo: "" }]);
                    }}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-600 hover:text-accent-700"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add a line
                  </button>
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">{formatCurrency(check.totalDebitCents / 100, currency)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{formatCurrency(check.totalCreditCents / 100, currency)}</td>
                <td colSpan={2} className="px-2 py-2.5 text-xs">
                  {balanced ? <span className="text-status-matched">Balanced</span> : <span className="text-status-pending">Debits and credits must be equal</span>}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-xs text-ink-500">The amounts are fixed. If one month differs, change that month&apos;s draft before posting it.</p>
      </Section>

      <Section title="When" hint="Set how often it repeats and when it starts.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Label text="Repeats">
            <div className="flex items-center gap-2">
              <span className="text-sm font-normal text-ink-600">Every</span>
              <input type="number" min={1} max={52} value={intervalCount} onChange={(e) => setIntervalCount(e.target.value)} className={`${field} w-16 text-center`} aria-label="Repeat every" />
              <select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)} className={field} aria-label="Repeat unit">
                {(Object.keys(UNIT) as Frequency[]).map((f) => (
                  <option key={f} value={f}>
                    {Number(intervalCount) === 1 ? UNIT[f][0] : UNIT[f][1]}
                  </option>
                ))}
              </select>
            </div>
          </Label>
          {frequency === "weekly" ? (
            <Label text="On">
              <select value={weekday} onChange={(e) => setWeekday(e.target.value)} className={field}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </Label>
          ) : (
            <Label text="On day" hint="If a month is shorter, it falls on the last day.">
              <select value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} className={field}>
                {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
                <option value={31}>Last day of the month</option>
              </select>
            </Label>
          )}
          <Label text="Prepare the draft" hint="Days before its date, so it can be reviewed in good time.">
            <input type="number" min={0} max={30} value={leadDays} onChange={(e) => setLeadDays(e.target.value)} className={field} />
          </Label>
          <Label text="Starts">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={field} />
          </Label>
          <Label text="Ends (optional)" hint="Leave empty to repeat until you stop it.">
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={field} />
          </Label>
        </div>

        {past.length > 0 && (
          <label className="flex items-start gap-2.5 rounded-lg border border-status-pending/30 bg-status-pendingBg px-4 py-3 text-sm text-ink-800">
            <input type="checkbox" checked={skipPast} onChange={(e) => setSkipPast(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-ink-300 text-accent-500 focus:ring-accent-500" />
            <span>
              <span className="font-medium">Skip the {past.length} date{past.length === 1 ? "" : "s"} that {past.length === 1 ? "has" : "have"} already passed.</span>
              <span className="block text-xs text-ink-600">Untick it to prepare a draft for each past date too (oldest first), so nothing is missed.</span>
            </span>
          </label>
        )}

        <div className="rounded-lg bg-ink-50 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-ink-900">
            <CalendarClock className="h-4 w-4 text-accent-600" />
            {scheduleProblem ? "Check the schedule" : describeSchedule(schedule)}
          </p>
          {scheduleProblem ? (
            <p className="mt-1 text-sm text-status-exception">{scheduleProblem}</p>
          ) : preview.length > 0 ? (
            <>
              <p className="mt-2 text-xs text-ink-500">The next dates, each prepared as a draft you review before posting:</p>
              <ul className="mt-1.5 grid grid-cols-1 gap-x-6 gap-y-0.5 text-sm text-ink-800 sm:grid-cols-2">
                {preview.map((d) => (
                  <li key={d} className="tabular-nums">
                    {fmtDate(d)}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-500">No dates left on this schedule.</p>
          )}
        </div>
      </Section>

      {error && (
        <p role="alert" className="rounded-lg border border-status-exception/20 bg-status-exceptionBg px-4 py-3 text-sm text-status-exception">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" loading={pending} disabled={!!scheduleProblem || !balanced || !name.trim()} onClick={submit}>
          {initial.id ? "Save changes" : "Create recurring entry"}
        </Button>
        <Link href={initial.id ? `/recurring/${initial.id}` : "/recurring"} className="text-sm font-medium text-ink-600 hover:text-ink-900">
          Cancel
        </Link>
      </div>
    </div>
  );
}
