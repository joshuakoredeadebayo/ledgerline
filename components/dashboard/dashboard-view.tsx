import Link from "next/link";
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, ChevronRight, ClipboardCheck, GitMerge, Landmark, ListChecks } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { Badge, type BadgeStatus } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { DashboardPeriodSelect } from "@/components/dashboard/dashboard-period-select";
import { CashFlowChart } from "@/components/dashboard/cash-flow-chart";
import { ReconciliationDonut } from "@/components/dashboard/reconciliation-donut";

export interface DashboardViewModel {
  userName: string;
  orgName: string;
  month: string;
  monthLabel: string;
  monthOptions: { value: string; label: string }[];
  openExceptions: number;
  pendingMatches: number;
  closePeriod: { label: string; statusLabel: string } | null;
  checklistDone: number;
  checklistTotal: number;
  currency: string;
  otherCurrencyCount: number;
  bankNet: number;
  ledgerNet: number;
  difference: number;
  daily: { out: number; in: number }[];
  totalIn: number;
  totalOut: number;
  matchedCount: number;
  exceptionCount: number;
  plainUnmatched: number;
  unmatchedTotal: number;
  reconcilable: number;
  progressPct: number;
  recent: { id: string; dateLabel: string; description: string; account: string; amount: string; statusLabel: string; status: BadgeStatus; href: string }[];
  deadlines: { month: string; day: number; title: string; subtitle: string; dueLabel: string; overdue: boolean }[];
  health: { label: string; done: number; total: number }[];
  latestBankMonth: { value: string; label: string } | null;
  hasAnyData: boolean;
  hasAccount: boolean;
}

const card = "rounded-xl border border-ink-100 bg-white p-5 shadow-subtle";
const cardTitle = "text-[15px] font-semibold text-ink-900";
const cardLink = "text-xs font-medium text-accent-600 hover:text-accent-700";

export function DashboardView({ vm }: { vm: DashboardViewModel }) {
  const fmt = (n: number) => formatCurrency(n, vm.currency);
  const balanced = vm.difference === 0;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* Greeting + month picker */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[1.65rem] font-semibold leading-9 tracking-tight text-ink-900">Good to see you, {vm.userName}.</h1>
          <p className="mt-0.5 text-sm text-ink-500">Here&apos;s what needs attention across {vm.orgName}.</p>
        </div>
        <DashboardPeriodSelect value={vm.month} options={vm.monthOptions} />
      </div>

      {!vm.hasAnyData && (
        <EmptyState
          title="Nothing needs attention right now"
          description={
            vm.hasAccount
              ? "Your first account is set up. Once bank or ledger transactions sync in, unmatched items and close tasks will show up here."
              : "Once your bank and ledger accounts sync, unmatched transactions and close tasks will show up here."
          }
          action={
            vm.hasAccount ? undefined : (
              <Link href="/entities" className="text-sm font-medium text-accent-600 hover:text-accent-700">
                Set up your first account →
              </Link>
            )
          }
        />
      )}

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6 2xl:grid-cols-5">
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Open exceptions"
          value={vm.openExceptions}
          tone={vm.openExceptions ? "exception" : "neutral"}
          badge={vm.openExceptions > 0 ? <Badge status="exception" /> : undefined}
          subtext="Need a decision"
          className="xl:col-span-2 2xl:col-span-1"
          href="/reconciliation/exceptions"
        />
        <KpiCard
          icon={<GitMerge className="h-4 w-4" />}
          label="Matches pending review"
          value={vm.pendingMatches}
          tone={vm.pendingMatches ? "pending" : "neutral"}
          badge={vm.pendingMatches > 0 ? <Badge status="pending" label="Pending" /> : undefined}
          subtext="Awaiting your confirmation"
          className="xl:col-span-2 2xl:col-span-1"
          href="/reconciliation/pending-matches"
        />
        <KpiCard
          icon={<ClipboardCheck className="h-4 w-4" />}
          label="Open close period"
          value={vm.closePeriod ? vm.closePeriod.label : "None"}
          tone="info"
          subtext={vm.closePeriod ? `${vm.closePeriod.statusLabel} · ${vm.checklistDone} of ${vm.checklistTotal} tasks done` : "No close period is open"}
          className="xl:col-span-2 2xl:col-span-1"
          href="/close"
        />
        <KpiCard
          icon={<Landmark className="h-4 w-4" />}
          label="Bank vs ledger"
          value={fmt(Math.abs(vm.difference))}
          tone={balanced ? "matched" : "exception"}
          badge={<Badge status={balanced ? "matched" : "exception"} label={balanced ? "Balanced" : "Difference"} />}
          subtext={`Bank ${fmt(vm.bankNet)} · Ledger ${fmt(vm.ledgerNet)}`}
          className="xl:col-span-3 2xl:col-span-1"
        />
        <KpiCard
          icon={<ListChecks className="h-4 w-4" />}
          label="Reconciliation progress"
          className="sm:col-span-2 xl:col-span-3 2xl:col-span-1"
          value={`${vm.progressPct}%`}
          tone="info"
          subtext={`${vm.matchedCount.toLocaleString()} of ${vm.reconcilable.toLocaleString()} matched`}
        >
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100">
            <div className="h-full rounded-full bg-accent-500" style={{ width: `${vm.progressPct}%` }} />
          </div>
        </KpiCard>
      </div>

      {vm.otherCurrencyCount > 0 && (
        <p className="rounded-lg border border-status-pending/20 bg-status-pendingBg px-3 py-2 text-sm text-ink-800">
          {vm.otherCurrencyCount} transaction{vm.otherCurrencyCount === 1 ? "" : "s"} this month use a currency other than {vm.currency}. They
          are not converted, so they are left out of the money totals here.
        </p>
      )}

      {/* Cash flow + reconciliation overview */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <section className={cn(card, "lg:col-span-3")}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className={cardTitle}>Cash flow overview</h2>
              <p className="text-xs text-ink-500">Daily bank activity · {vm.monthLabel} · {vm.currency}</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-ink-600">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#3b73fe]" />Money out</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#26b36f]" />Money in</span>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-[1fr_12.5rem]">
            <CashFlowChart
              daily={vm.daily}
              currency={vm.currency}
              emptyHint={
                vm.latestBankMonth && vm.latestBankMonth.value !== vm.month ? (
                  <>
                    Latest bank activity is in{" "}
                    <Link href={`/dashboard?period=${vm.latestBankMonth.value}`} className="font-medium text-accent-600 hover:text-accent-700">
                      {vm.latestBankMonth.label}
                    </Link>
                    .
                  </>
                ) : undefined
              }
            />
            <div className="space-y-4 md:border-l md:border-ink-100 md:pl-5">
              <div className="flex items-start gap-3">
                <ArrowDownCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#26b36f]" />
                <div>
                  <p className="text-xs text-ink-500">Total money in</p>
                  <p className="text-lg font-semibold tracking-tight tabular-nums text-ink-900">{fmt(vm.totalIn)}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ArrowUpCircle className="mt-0.5 h-5 w-5 shrink-0 text-status-exception" />
                <div>
                  <p className="text-xs text-ink-500">Total money out</p>
                  <p className="text-lg font-semibold tracking-tight tabular-nums text-ink-900">{fmt(vm.totalOut)}</p>
                </div>
              </div>
              <div className="border-t border-ink-100 pt-3">
                <p className="text-xs text-ink-500">Net movement</p>
                <p className="text-lg font-semibold tracking-tight tabular-nums text-ink-900">{fmt(vm.totalIn - vm.totalOut)}</p>
              </div>
            </div>
          </div>
        </section>

        <section className={cn(card, "lg:col-span-2")}>
          <div className="flex items-start justify-between">
            <div>
              <h2 className={cardTitle}>Reconciliation overview</h2>
              <p className="text-xs text-ink-500">{vm.monthLabel}</p>
            </div>
            <Link href="/reconciliation" className={cardLink}>View all</Link>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-6">
            <ReconciliationDonut matched={vm.matchedCount} exceptions={vm.exceptionCount} unmatched={vm.plainUnmatched} />
            <dl className="min-w-[10rem] flex-1 space-y-2.5 text-sm">
              {[
                { label: "Matched", value: vm.matchedCount, dot: "bg-[#26b36f]" },
                { label: "Exceptions", value: vm.exceptionCount, dot: "bg-[#f59e0b]" },
                { label: "Unmatched", value: vm.plainUnmatched, dot: "bg-[#a3c1fa]" },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between border-b border-ink-100 pb-2.5">
                  <dt className="flex items-center gap-2 text-ink-600">
                    <span className={cn("h-2.5 w-2.5 rounded-full", row.dot)} />
                    {row.label}
                  </dt>
                  <dd className="font-medium tabular-nums text-ink-900">{row.value.toLocaleString()}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <dt className="text-ink-500">Total items</dt>
                <dd className="font-medium tabular-nums text-ink-900">{vm.reconcilable.toLocaleString()}</dd>
              </div>
            </dl>
          </div>
        </section>
      </div>

      {/* Recent transactions + outstanding items */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <section className={cn(card, "px-0 pb-2 lg:col-span-3")}>
          <div className="flex items-center justify-between px-5">
            <h2 className={cardTitle}>Recent transactions</h2>
            <Link href="/reconciliation" className={cardLink}>View all</Link>
          </div>
          {vm.recent.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-ink-100 bg-ink-50 text-left text-xs font-medium text-ink-500">
                    <th className="px-5 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 font-medium">Account</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-5 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {vm.recent.map((t) => (
                    <tr key={t.id} className="hover:bg-ink-50">
                      <td className="whitespace-nowrap px-5 py-3 text-ink-600">
                        <Link href={t.href}>{t.dateLabel}</Link>
                      </td>
                      <td className="max-w-[13rem] truncate px-3 py-3 text-ink-900">{t.description}</td>
                      <td className="px-3 py-3 text-ink-600">{t.account}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-ink-900">{t.amount}</td>
                      <td className="px-5 py-3">
                        <Badge status={t.status} label={t.statusLabel} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-5 py-10 text-center text-sm text-ink-500">No transactions in {vm.monthLabel}.</p>
          )}
        </section>

        <section className={cn(card, "lg:col-span-2")}>
          <div className="flex items-center justify-between">
            <h2 className={cardTitle}>Outstanding items</h2>
            <Link href="/reconciliation" className={cardLink}>View all</Link>
          </div>
          <ul className="mt-3 space-y-0.5">
            {[
              { n: vm.unmatchedTotal, title: "Unreconciled transactions", sub: `Unmatched in ${vm.monthLabel}`, href: "/reconciliation", tone: "bg-status-exceptionBg text-status-exception" },
              { n: vm.pendingMatches, title: "Matches awaiting review", sub: "Confirm or reject suggestions", href: "/reconciliation/pending-matches", tone: "bg-status-pendingBg text-status-pending" },
              { n: Math.max(0, vm.checklistTotal - vm.checklistDone), title: "Close tasks remaining", sub: vm.closePeriod ? vm.closePeriod.label : "No open close period", href: "/close", tone: "bg-status-infoBg text-status-info" },
              { n: vm.openExceptions, title: "Exceptions to investigate", sub: "Potential discrepancies", href: "/reconciliation/exceptions", tone: "bg-status-exceptionBg text-status-exception" },
            ].map((item) => (
              <li key={item.title}>
                <Link href={item.href} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-ink-50">
                  <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-base font-semibold tabular-nums", item.tone)}>
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
        <section className={cn(card, "lg:col-span-3")}>
          <div className="flex items-center justify-between">
            <h2 className={cardTitle}>Upcoming deadlines</h2>
            <Link href="/close" className={cardLink}>View close</Link>
          </div>
          {vm.deadlines.length > 0 ? (
            <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {vm.deadlines.map((d, i) => (
                <li key={`${d.title}-${i}`} className="flex gap-3 rounded-lg bg-ink-50 p-3">
                  <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-accent-50 text-accent-700">
                    <span className="text-[10px] font-medium uppercase">{d.month}</span>
                    <span className="text-base font-semibold leading-none">{d.day}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">{d.title}</p>
                    <p className="truncate text-xs text-ink-500">{d.subtitle}</p>
                    <p className={cn("text-xs", d.overdue ? "font-medium text-status-exception" : "text-ink-500")}>{d.dueLabel}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-ink-500">No deadlines yet. Open close periods and dated checklist tasks appear here.</p>
          )}
        </section>

        <section className={cn(card, "lg:col-span-2")}>
          <h2 className={cardTitle}>Health &amp; compliance</h2>
          <ul className="mt-2 divide-y divide-ink-100">
            {vm.health.map((row) => {
              const healthy = row.total > 0 && row.done === row.total;
              return (
                <li key={row.label} className="flex items-center justify-between gap-3 py-3 text-sm">
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
