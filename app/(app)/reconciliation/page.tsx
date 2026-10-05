import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  GitMerge,
  Landmark,
  ListChecks,
  ShieldCheck,
} from "lucide-react";
import { getCurrentMembership } from "@/lib/actions/membership";
import { createClient } from "@/lib/supabase/server";
import { getAttentionCounts, monthLabel } from "@/lib/attention-counts";
import { cn, formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { DashboardPeriodSelect } from "@/components/dashboard/dashboard-period-select";
import { CashFlowChart } from "@/components/dashboard/cash-flow-chart";
import { ReconciliationDonut } from "@/components/dashboard/reconciliation-donut";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Same convention as the matching workspace: plaid = bank, quickbooks = ledger,
// manual entries carry their side in raw_payload.
function sideOf(t: { source: string; raw_payload?: any }): "bank" | "ledger" {
  if (t.source === "plaid") return "bank";
  if (t.source === "manual" && (t.raw_payload?.side === "bank" || t.raw_payload?.side === "ledger")) {
    return t.raw_payload.side;
  }
  return "ledger";
}

function daysUntil(isoDate: string) {
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  const d = Number(isoDate.slice(8, 10));
  return Math.round((Date.UTC(y, m - 1, d) - todayUtc) / 86_400_000);
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period } = await searchParams;
  const membership = await getCurrentMembership();
  // Cast to `any`: some columns are newer than the generated Supabase types.
  const supabase = (await createClient()) as any;

  // ── Which month are we looking at? ───────────────────────────────
  // Newest transaction dates first; the months present drive both the
  // picker and the default (the latest month with activity, so the page
  // never opens on an empty current month).
  const { data: dateRows } = await supabase
    .from("transactions")
    .select("transaction_date")
    .order("transaction_date", { ascending: false })
    .limit(1000);

  const monthsWithData: string[] = [];
  for (const r of dateRows ?? []) {
    const m = String(r.transaction_date).slice(0, 7);
    if (!monthsWithData.includes(m)) monthsWithData.push(m);
  }
  const month = MONTH_RE.test(period ?? "") ? (period as string) : (monthsWithData[0] ?? new Date().toISOString().slice(0, 7));
  const pickerMonths = monthsWithData.includes(month) ? monthsWithData : [month, ...monthsWithData];

  const yy = Number(month.slice(0, 4));
  const mm = Number(month.slice(5, 7));
  const periodStart = `${month}-01`;
  const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const periodEnd = `${month}-${String(lastDay).padStart(2, "0")}`;

  // ── Data ─────────────────────────────────────────────────────────
  const counts = await getAttentionCounts();

  const { data: txnRows } = await supabase
    .from("transactions")
    .select("id, amount, currency, transaction_date, description, status, source, raw_payload, account_id, accounts(name)")
    .gte("transaction_date", periodStart)
    .lte("transaction_date", periodEnd)
    .order("transaction_date", { ascending: false })
    .limit(5000);
  const txns: any[] = txnRows ?? [];

  const { count: periodExceptions } = await supabase
    .from("exceptions")
    .select("id, transactions!inner(transaction_date)", { count: "exact", head: true })
    .eq("status", "open")
    .gte("transactions.transaction_date", periodStart)
    .lte("transactions.transaction_date", periodEnd);

  const { count: confirmedMatches } = await supabase
    .from("matches")
    .select("id", { count: "exact", head: true })
    .eq("status", "confirmed");

  const { count: allExceptions } = await supabase.from("exceptions").select("id", { count: "exact", head: true });

  const { data: periodRecons } = await supabase
    .from("reconciliations")
    .select("status")
    .eq("period_start", periodStart);

  // Close checklist for the newest open close period.
  const latest = counts.latestOpenPeriod;
  const { data: checklistRows } = latest
    ? await supabase.from("close_checklist_items").select("status").eq("close_period_id", latest.id)
    : { data: [] };
  const checklistTotal = (checklistRows ?? []).length;
  const checklistDone = (checklistRows ?? []).filter((i: any) => i.status === "complete").length;

  const { data: dueItems } = await supabase
    .from("close_checklist_items")
    .select("title, description, due_date, close_periods(entities(name))")
    .not("due_date", "is", null)
    .neq("status", "complete")
    .order("due_date", { ascending: true })
    .limit(4);

  // ── Derived numbers ──────────────────────────────────────────────
  // Totals are plain sums with no currency conversion, so they are shown in
  // the month's dominant currency and anything else is flagged, not mixed in.
  const currencyCounts = new Map<string, number>();
  for (const t of txns) currencyCounts.set(t.currency, (currencyCounts.get(t.currency) ?? 0) + 1);
  const currency = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";
  const otherCurrencyCount = txns.filter((t) => t.currency !== currency).length;
  const money = txns.filter((t) => t.currency === currency);

  const bankNet = money.filter((t) => sideOf(t) === "bank").reduce((s, t) => s + Number(t.amount), 0);
  const ledgerNet = money.filter((t) => sideOf(t) === "ledger").reduce((s, t) => s + Number(t.amount), 0);
  const difference = Math.round((ledgerNet - bankNet) * 100) / 100;

  // Positive = money out, negative = money in (bank side only).
  const daily = Array.from({ length: lastDay }, () => ({ out: 0, in: 0 }));
  let totalIn = 0;
  let totalOut = 0;
  for (const t of money) {
    if (sideOf(t) !== "bank") continue;
    const bucket = daily[Number(String(t.transaction_date).slice(8, 10)) - 1];
    if (!bucket) continue;
    const amt = Number(t.amount);
    if (amt >= 0) {
      bucket.out += amt;
      totalOut += amt;
    } else {
      bucket.in += -amt;
      totalIn += -amt;
    }
  }

  const matchedCount = txns.filter((t) => t.status === "matched").length;
  const unmatchedTotal = txns.filter((t) => t.status === "unmatched").length;
  const exceptionCount = Math.min(periodExceptions ?? 0, unmatchedTotal);
  const plainUnmatched = Math.max(0, unmatchedTotal - exceptionCount);
  const reconcilable = matchedCount + unmatchedTotal;
  const progressPct = reconcilable === 0 ? 0 : Math.round((matchedCount / reconcilable) * 100);

  const reconsDone = (periodRecons ?? []).filter((r: any) => r.status === "reconciled" || r.status === "finalized").length;
  const reconsTotal = (periodRecons ?? []).length;
  const pendingTotal = counts.pendingMatches + (confirmedMatches ?? 0);
  const resolvedExceptions = Math.max(0, (allExceptions ?? 0) - counts.openExceptions);

  // Deadlines: open close periods' end dates plus any dated checklist tasks.
  type Deadline = { date: string; title: string; subtitle: string };
  const deadlines: Deadline[] = [
    ...counts.openPeriods.slice(0, 2).map((p) => ({
      date: p.period_end,
      title: "Month-end close",
      subtitle: `Complete the ${monthLabel(p.period_start)} close checklist`,
    })),
    ...(dueItems ?? []).map((i: any) => ({
      date: i.due_date as string,
      title: i.title as string,
      subtitle: (i.close_periods?.entities?.name as string | undefined) ?? (i.description as string | undefined) ?? "Close task",
    })),
  ]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 4);

  const hasAnyData = txns.length > 0 || counts.openExceptions > 0 || counts.pendingMatches > 0 || counts.openPeriods.length > 0;
  const { count: accountCount } = await supabase.from("accounts").select("id", { count: "exact", head: true });
  const hasAccount = (accountCount ?? 0) > 0;

  const recent = txns.slice(0, 5);
  const fmt = (n: number) => formatCurrency(n, currency);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Greeting + month picker */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Good to see you, {membership?.email.split("@")[0]}.</h1>
          <p className="mt-1 text-sm text-ink-500">Here&apos;s what needs attention across {membership?.organizationName}.</p>
        </div>
        <DashboardPeriodSelect
          value={month}
          options={pickerMonths.map((m) => ({ value: m, label: monthLabel(`${m}-01`) }))}
        />
      </div>

      {!hasAnyData && (
        <EmptyState
          title="Nothing needs attention right now"
          description={
            hasAccount
              ? "Your first account is set up. Once bank or ledger transactions sync in, unmatched items and close tasks will show up here."
              : "Once your bank and ledger accounts sync, unmatched transactions and close tasks will show up here."
          }
          action={
            hasAccount ? undefined : (
              <Link href="/entities" className="text-sm font-medium text-accent-600 hover:text-accent-700">
                Set up your first account →
              </Link>
            )
          }
        />
      )}

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Open exceptions"
          value={counts.openExceptions}
          tone={counts.openExceptions ? "exception" : "neutral"}
          badge={counts.openExceptions > 0 ? <Badge status="exception" /> : undefined}
          subtext="Unmatched items that need a decision"
          href="/reconciliation/exceptions"
        />
        <KpiCard
          icon={<GitMerge className="h-4 w-4" />}
          label="Matches pending review"
          value={counts.pendingMatches}
          tone={counts.pendingMatches ? "pending" : "neutral"}
          badge={counts.pendingMatches > 0 ? <Badge status="pending" label="Pending" /> : undefined}
          subtext="Suggested matches awaiting your confirmation"
          href="/reconciliation/pending-matches"
        />
        <KpiCard
          icon={<ClipboardCheck className="h-4 w-4" />}
          label="Open close period"
          value={latest ? monthLabel(latest.period_start) : "None"}
          tone="info"
          subtext={
            latest
              ? `${latest.status === "in_review" ? "In review" : "Open"} · ${checklistDone}/${checklistTotal} tasks done`
              : "No close period is open"
          }
          href="/close"
        />
        <KpiCard
          icon={<Landmark className="h-4 w-4" />}
          label="Bank vs ledger"
          value={fmt(Math.abs(difference))}
          tone={difference === 0 ? "matched" : "exception"}
          badge={<Badge status={difference === 0 ? "matched" : "exception"} label={difference === 0 ? "Balanced" : "Difference"} />}
          subtext={`${monthLabel(periodStart)} · bank ${fmt(bankNet)} · ledger ${fmt(ledgerNet)}`}
        />
        <KpiCard
          icon={<ListChecks className="h-4 w-4" />}
          label="Reconciliation progress"
          value={`${progressPct}%`}
          tone="info"
          subtext={`${matchedCount.toLocaleString()} of ${reconcilable.toLocaleString()} matched`}
        >
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100">
            <div className="h-full rounded-full bg-accent-500" style={{ width: `${progressPct}%` }} />
          </div>
        </KpiCard>
      </div>

      {otherCurrencyCount > 0 && (
        <p className="rounded-md border border-status-pending/30 bg-status-pendingBg px-3 py-2 text-sm text-ink-800">
          {otherCurrencyCount} transaction{otherCurrencyCount === 1 ? "" : "s"} in this month use a currency other than {currency}.
          Amounts are not converted, so they are left out of the money totals on this page.
        </p>
      )}

      {/* Cash flow + reconciliation overview */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <section className="rounded-lg border border-ink-100 bg-white p-5 shadow-subtle lg:col-span-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-ink-900">Cash flow overview</h2>
              <p className="text-xs text-ink-500">Daily bank activity · {monthLabel(periodStart)} · {currency}</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-ink-600">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-accent-500" />Money out</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-status-matched" />Money in</span>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[1fr_13rem]">
            <CashFlowChart daily={daily} currency={currency} />
            <div className="space-y-4 md:border-l md:border-ink-100 md:pl-4">
              <div className="flex items-start gap-3">
                <ArrowDownCircle className="mt-0.5 h-5 w-5 text-status-matched" />
                <div>
                  <p className="text-xs text-ink-500">Total money in</p>
                  <p className="text-lg font-semibold tabular-nums text-ink-900">{fmt(totalIn)}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ArrowUpCircle className="mt-0.5 h-5 w-5 text-status-exception" />
                <div>
                  <p className="text-xs text-ink-500">Total money out</p>
                  <p className="text-lg font-semibold tabular-nums text-ink-900">{fmt(totalOut)}</p>
                </div>
              </div>
              <div className="border-t border-ink-100 pt-3">
                <p className="text-xs text-ink-500">Net movement</p>
                <p className="text-lg font-semibold tabular-nums text-ink-900">{fmt(totalIn - totalOut)}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-ink-100 bg-white p-5 shadow-subtle lg:col-span-2">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-semibold text-ink-900">Reconciliation overview</h2>
              <p className="text-xs text-ink-500">{monthLabel(periodStart)}</p>
            </div>
            <Link href="/reconciliation" className="text-xs font-medium text-accent-600 hover:text-accent-700">
              View all
            </Link>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-6">
            <ReconciliationDonut matched={matchedCount} exceptions={exceptionCount} unmatched={plainUnmatched} />
            <dl className="min-w-[10rem] flex-1 space-y-2.5 text-sm">
              {[
                { label: "Matched", value: matchedCount, dot: "bg-status-matched" },
                { label: "Exceptions", value: exceptionCount, dot: "bg-[#d98e04]" },
                { label: "Unmatched", value: plainUnmatched, dot: "bg-accent-300" },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between border-b border-ink-100 pb-2">
                  <dt className="flex items-center gap-2 text-ink-700">
                    <span className={cn("h-2.5 w-2.5 rounded-full", row.dot)} />
                    {row.label}
                  </dt>
                  <dd className="font-medium tabular-nums text-ink-900">{row.value.toLocaleString()}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <dt className="text-ink-500">Total items</dt>
                <dd className="font-medium tabular-nums text-ink-900">{reconcilable.toLocaleString()}</dd>
              </div>
            </dl>
          </div>
        </section>
      </div>

      {/* Recent transactions + outstanding items */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <section className="rounded-lg border border-ink-100 bg-white shadow-subtle lg:col-span-3">
          <div className="flex items-center justify-between px-5 pt-5">
            <h2 className="text-base font-semibold text-ink-900">Recent transactions</h2>
            <Link href="/reconciliation" className="text-xs font-medium text-accent-600 hover:text-accent-700">
              View all
            </Link>
          </div>
          {recent.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-ink-50 text-left text-xs font-medium uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="px-5 py-2">Date</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2">Account</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-5 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {recent.map((t) => (
                    <tr key={t.id} className="hover:bg-ink-50">
                      <td className="whitespace-nowrap px-5 py-2.5 text-ink-600">
                        <Link href={`/reconciliation/${t.account_id}?period=${String(t.transaction_date).slice(0, 7)}`}>
                          {new Date(`${t.transaction_date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                        </Link>
                      </td>
                      <td className="max-w-[14rem] truncate px-3 py-2.5 text-ink-900">{t.description ?? "—"}</td>
                      <td className="px-3 py-2.5 text-ink-600">{t.accounts?.name ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink-900">
                        {formatCurrency(Number(t.amount), t.currency)}
                      </td>
                      <td className="px-5 py-2.5">
                        <Badge
                          status={t.status === "matched" ? "matched" : t.status === "unmatched" ? "pending" : "neutral"}
                          label={t.status === "matched" ? "Matched" : t.status === "unmatched" ? "Unmatched" : "Excluded"}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-5 py-10 text-center text-sm text-ink-500">No transactions in {monthLabel(periodStart)}.</p>
          )}
        </section>

        <section className="rounded-lg border border-ink-100 bg-white p-5 shadow-subtle lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink-900">Outstanding items</h2>
            <Link href="/reconciliation" className="text-xs font-medium text-accent-600 hover:text-accent-700">
              View all
            </Link>
          </div>
          <ul className="mt-3 space-y-1">
            {[
              { n: unmatchedTotal, title: "Unreconciled transactions", sub: `Unmatched in ${monthLabel(periodStart)}`, href: "/reconciliation", tone: "bg-status-exceptionBg text-status-exception" },
              { n: counts.pendingMatches, title: "Matches awaiting review", sub: "Confirm or reject suggestions", href: "/reconciliation/pending-matches", tone: "bg-status-pendingBg text-status-pending" },
              { n: Math.max(0, checklistTotal - checklistDone), title: "Close tasks remaining", sub: latest ? monthLabel(latest.period_start) : "No open close period", href: "/close", tone: "bg-status-infoBg text-status-info" },
              { n: counts.openExceptions, title: "Exceptions to investigate", sub: "Potential discrepancies", href: "/reconciliation/exceptions", tone: "bg-status-exceptionBg text-status-exception" },
            ].map((item) => (
              <li key={item.title}>
                <Link href={item.href} className="flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-ink-50">
                  <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-lg font-semibold tabular-nums", item.tone)}>
                    {item.n}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink-900">{item.title}</span>
                    <span className="block truncate text-xs text-ink-500">{item.sub}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-ink-300" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Deadlines + health */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <section className="rounded-lg border border-ink-100 bg-white p-5 shadow-subtle lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
              <CalendarClock className="h-4 w-4 text-ink-500" />
              Upcoming deadlines
            </h2>
            <Link href="/close" className="text-xs font-medium text-accent-600 hover:text-accent-700">
              View close
            </Link>
          </div>
          {deadlines.length > 0 ? (
            <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {deadlines.map((d, i) => {
                const days = daysUntil(d.date);
                const dt = new Date(`${d.date.slice(0, 10)}T12:00:00Z`);
                return (
                  <li key={`${d.title}-${i}`} className="flex gap-3 rounded-md bg-ink-50 p-3">
                    <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-md bg-accent-50 text-accent-700">
                      <span className="text-[10px] font-medium uppercase">
                        {dt.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}
                      </span>
                      <span className="text-base font-semibold leading-none">{dt.getUTCDate()}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">{d.title}</p>
                      <p className="truncate text-xs text-ink-500">{d.subtitle}</p>
                      <p className={cn("text-xs", days < 0 ? "font-medium text-status-exception" : "text-ink-500")}>
                        {days < 0 ? `Overdue by ${-days} day${days === -1 ? "" : "s"}` : days === 0 ? "Due today" : `Due in ${days} day${days === 1 ? "" : "s"}`}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-ink-500">No deadlines yet. Open close periods and dated checklist tasks appear here.</p>
          )}
        </section>

        <section className="rounded-lg border border-ink-100 bg-white p-5 shadow-subtle lg:col-span-2">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
            <ShieldCheck className="h-4 w-4 text-ink-500" />
            Health &amp; compliance
          </h2>
          <ul className="mt-3 divide-y divide-ink-100">
            {[
              { label: "Bank reconciliation", done: reconsDone, total: reconsTotal },
              { label: "Matches reviewed", done: confirmedMatches ?? 0, total: pendingTotal },
              { label: "Exceptions resolved", done: resolvedExceptions, total: allExceptions ?? 0 },
              { label: "Close checklist", done: checklistDone, total: checklistTotal },
            ].map((row) => {
              const healthy = row.total > 0 && row.done === row.total;
              return (
                <li key={row.label} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="text-ink-800">{row.label}</span>
                  <span className="flex items-center gap-3">
                    <Badge
                      status={row.total === 0 ? "neutral" : healthy ? "matched" : "pending"}
                      label={row.total === 0 ? "No data" : healthy ? "Healthy" : "Attention"}
                    />
                    <span className="w-12 text-right text-xs tabular-nums text-ink-500">
                      {row.done}/{row.total}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}