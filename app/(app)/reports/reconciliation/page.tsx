import Link from "next/link";
import { ChevronLeft, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { formatCurrency } from "@/lib/utils";
import { loadReconciliationReport, type ReportTxn } from "@/lib/reports/reconciliation-report";
import { Badge, type BadgeStatus } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { PrintButton } from "@/components/reports/print-button";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const STATUS: Record<string, { status: BadgeStatus; label: string }> = {
  draft: { status: "neutral", label: "In progress" },
  needs_review: { status: "pending", label: "Needs review" },
  reconciled: { status: "info", label: "Reconciled, not yet finalized" },
  finalized: { status: "matched", label: "Finalized" },
  reopened: { status: "pending", label: "Reopened" },
};

const fmtDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const monthTitle = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

function TxnLine({ t }: { t: ReportTxn | null }) {
  if (!t) return <span className="text-ink-400">—</span>;
  return (
    <div>
      <p className="tabular-nums text-ink-900">{formatCurrency(t.amount, t.currency)}</p>
      <p className="text-xs text-ink-500">
        {fmtDate(t.date)}
        {t.description ? ` · ${t.description}` : ""}
      </p>
    </div>
  );
}

function Section({ title, count, note, children }: { title: string; count: number; note?: string; children: React.ReactNode }) {
  return (
    <section className="print-avoid-break rounded-xl border border-ink-100 bg-white shadow-subtle print:shadow-none">
      <div className="border-b border-ink-100 px-5 py-3">
        <h2 className="text-[15px] font-semibold text-ink-900">
          {title} <span className="font-normal text-ink-500">({count})</span>
        </h2>
        {note && <p className="mt-0.5 text-xs text-ink-500">{note}</p>}
      </div>
      {count > 0 ? <div className="overflow-x-auto">{children}</div> : <p className="px-5 py-4 text-sm text-ink-500">None.</p>}
    </section>
  );
}

export default async function ReconciliationReportPage({ searchParams }: { searchParams: Promise<{ account?: string; period?: string }> }) {
  const sp = await searchParams;
  const membership = await getCurrentMembership();
  if (!membership) return null;

  if (!can(membership.role, "reports.view")) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState title="You don't have access to reports" description="Ask an owner if you need it." />
      </div>
    );
  }

  const supabase = (await createClient()) as any;

  const { data: accountRows } = await supabase
    .from("accounts")
    .select("id, name, code, entities!inner(name, archived_at)")
    .eq("is_reconcilable", true)
    .is("archived_at", null)
    .is("entities.archived_at", null)
    .order("name");
  const accounts: { id: string; name: string; entities: { name: string } }[] = accountRows ?? [];
  const accountId = accounts.find((a) => a.id === sp.account)?.id ?? accounts[0]?.id;

  // Default month: the account's most recent month with activity.
  let month = MONTH_RE.test(sp.period ?? "") ? (sp.period as string) : "";
  if (!month && accountId) {
    const { data: latest } = await supabase
      .from("transactions")
      .select("transaction_date")
      .eq("account_id", accountId)
      .order("transaction_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    month = latest?.transaction_date ? String(latest.transaction_date).slice(0, 7) : new Date().toISOString().slice(0, 7);
  }

  const report = accountId && month ? await loadReconciliationReport(supabase, accountId, month) : null;

  const { data: rosterData } = await supabase.rpc("list_org_members", { p_org: membership.organizationId });
  const nameOf = new Map<string, string>(((rosterData ?? []) as any[]).map((m) => [m.user_id, m.email]));
  const who = (id: string | null | undefined) => (id ? (nameOf.get(id) ?? "a former member") : "—");

  const r = report?.reconciliation ?? null;
  const badge = r ? (STATUS[r.status] ?? { status: "neutral" as BadgeStatus, label: r.status }) : { status: "neutral" as BadgeStatus, label: "Not started" };
  const cur = report?.account.currency ?? "USD";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="print:hidden">
        <Link href="/reports" className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800">
          <ChevronLeft className="h-3.5 w-3.5" />
          Reports
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-ink-900">Reconciliation report</h1>
        <p className="mt-1 text-sm text-ink-500">What was matched, what was explained and why, and what is still open, for one account and month.</p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-ink-100 bg-white p-4 shadow-subtle print:hidden">
        <label className="flex min-w-[16rem] flex-1 flex-col gap-1.5 text-sm font-medium text-ink-700">
          Account
          <select
            name="account"
            defaultValue={accountId}
            className="h-9 rounded border border-ink-200 bg-white px-2.5 text-sm font-normal text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.entities?.name} · {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
          Month
          <input
            type="month"
            name="period"
            defaultValue={month}
            className="h-9 rounded border border-ink-200 bg-white px-2.5 text-sm font-normal text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
          />
        </label>
        <button type="submit" className="h-9 rounded bg-accent-500 px-4 text-sm font-medium text-white hover:bg-accent-600">
          Run report
        </button>
      </form>

      {accounts.length === 0 && (
        <EmptyState title="No accounts to report on" description="Connect a bank or import accounts, and switch Reconciliation on for them." />
      )}

      {report && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Reconciliation report</p>
              <h2 className="mt-0.5 text-xl font-semibold text-ink-900">
                {report.account.entityName} · {report.account.name}
              </h2>
              <p className="text-sm text-ink-600">
                {monthTitle(report.month)} ({fmtDate(report.periodStart)} to {fmtDate(report.periodEnd)}) · {report.account.currency}
              </p>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <a
                href={`/api/reports/reconciliation?account=${report.account.id}&period=${report.month}`}
                className="inline-flex h-9 items-center gap-2 rounded border border-ink-200 bg-white px-4 text-sm font-medium text-ink-800 hover:bg-ink-50"
              >
                <Download className="h-4 w-4" />
                CSV
              </a>
              <PrintButton />
            </div>
          </div>

          <section className="print-avoid-break rounded-xl border border-ink-100 bg-white p-5 shadow-subtle print:shadow-none">
            <div className="flex flex-wrap items-center gap-3">
              <Badge status={badge.status} label={badge.label} />
              {r?.status === "reopened" && r.reopenedReason && <span className="text-xs text-ink-600">Reopened: {r.reopenedReason}</span>}
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-ink-500">Ledger total</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink-900">{r ? formatCurrency(r.bookTotal, cur) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-500">Bank total</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink-900">{r ? formatCurrency(r.externalTotal, cur) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-500">Unexplained difference</dt>
                <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${r && r.difference !== 0 ? "text-status-exception" : "text-ink-900"}`}>
                  {r ? formatCurrency(r.difference, cur) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-500">Transactions</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink-900">{report.transactionCount.toLocaleString()}</dd>
              </div>
            </dl>
            {!r && <p className="mt-3 text-sm text-ink-500">No reconciliation has been started for this period yet, so there are no totals to show.</p>}
            <p className="mt-4 text-xs text-ink-500">
              The ledger and bank totals cover every transaction in the month except excluded ones. The difference sets aside items a person explained and matches
              that span two months. Amounts count money going out as positive and money coming in as negative.
            </p>
          </section>

          <Section
            title="Matched"
            count={report.matched.length}
            note="Bank and ledger transactions confirmed as the same event. Pairs marked 'other month' have a partner booked in an adjoining month."
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 bg-ink-50 text-left text-xs font-medium text-ink-500">
                  <th className="px-5 py-2 font-medium">Bank</th>
                  <th className="px-3 py-2 font-medium">Ledger</th>
                  <th className="px-5 py-2 font-medium">Basis</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {report.matched.map((p) => (
                  <tr key={p.matchId} className="align-top">
                    <td className="px-5 py-2.5"><TxnLine t={p.bank} /></td>
                    <td className="px-3 py-2.5"><TxnLine t={p.ledger} /></td>
                    <td className="px-5 py-2.5 text-xs text-ink-600">
                      {p.matchType === "manual" ? "Matched by hand" : p.confidence != null ? `Suggested, ${Math.round(p.confidence * 100)}% confidence` : "Suggested"}
                      {p.crossPeriod && <span className="ml-2 rounded-full bg-status-pendingBg px-2 py-0.5 text-status-pending">other month</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section
            title="Explained, not matched"
            count={report.explained.length}
            note="Items with no counterpart that a person reviewed and closed, with the reason recorded."
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 bg-ink-50 text-left text-xs font-medium text-ink-500">
                  <th className="px-5 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 font-medium">Outcome</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-5 py-2 font-medium">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {report.explained.map((e) => (
                  <tr key={e.txn.id} className="align-top">
                    <td className="px-5 py-2.5">
                      <TxnLine t={e.txn} />
                      <p className="text-xs text-ink-400">{e.txn.side === "bank" ? "Bank" : "Ledger"}</p>
                    </td>
                    <td className="px-3 py-2.5 text-ink-700">{e.outcome === "resolved" ? "Resolved" : "Dismissed"}</td>
                    <td className="px-3 py-2.5">
                      <p className="text-ink-800">{e.reason}</p>
                      {e.note && <p className="text-xs text-ink-500">{e.note}</p>}
                    </td>
                    <td className="px-5 py-2.5 text-xs text-ink-500">
                      {who(e.by)}
                      {e.at ? ` · ${fmtDate(e.at)}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Still open" count={report.unresolved.length} note="Not matched and not explained. These make up the unexplained difference.">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-ink-100">
                {report.unresolved.map((t) => (
                  <tr key={t.id}>
                    <td className="px-5 py-2.5"><TxnLine t={t} /></td>
                    <td className="px-5 py-2.5 text-right text-xs text-ink-500">{t.side === "bank" ? "Bank" : "Ledger"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Excluded" count={report.excluded.length} note="Left out of the reconciliation, for example duplicates or internal transfers.">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-ink-100">
                {report.excluded.map((x) => (
                  <tr key={x.txn.id} className="align-top">
                    <td className="px-5 py-2.5"><TxnLine t={x.txn} /></td>
                    <td className="px-5 py-2.5 text-xs text-ink-600">
                      {x.reason ?? "No reason recorded"}
                      {x.note ? ` · ${x.note}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <section className="print-avoid-break rounded-xl border border-ink-100 bg-white p-5 text-sm shadow-subtle print:shadow-none">
            <h2 className="text-[15px] font-semibold text-ink-900">Sign-off</h2>
            <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-ink-500">Prepared by</dt>
                <dd className="text-ink-900">{who(r?.preparedBy)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-500">Finalized by</dt>
                <dd className="text-ink-900">{r?.finalizedBy ? who(r.finalizedBy) : "Not finalized"}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-500">Finalized on</dt>
                <dd className="text-ink-900">{r?.finalizedAt ? fmtDateTime(r.finalizedAt) : "—"}</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-ink-400">
              Generated {fmtDateTime(new Date().toISOString())} by {membership.email} from Ledgerline.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
