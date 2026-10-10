import Link from "next/link";
import { ChevronLeft, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { formatCurrency } from "@/lib/utils";
import { loadPeriodSummary } from "@/lib/reports/period-summary";
import { Badge, type BadgeStatus } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { PrintButton } from "@/components/reports/print-button";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const STATUS: Record<string, { status: BadgeStatus; label: string }> = {
  not_started: { status: "neutral", label: "Not started" },
  draft: { status: "neutral", label: "In progress" },
  needs_review: { status: "pending", label: "Needs review" },
  reconciled: { status: "info", label: "Ready to finalize" },
  finalized: { status: "matched", label: "Finalized" },
  reopened: { status: "pending", label: "Reopened" },
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const monthTitle = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export default async function PeriodSummaryPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
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

  // Default to the most recent month that has any transactions.
  let month = MONTH_RE.test(sp.period ?? "") ? (sp.period as string) : "";
  if (!month) {
    const { data: latest } = await supabase
      .from("transactions")
      .select("transaction_date")
      .order("transaction_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    month = latest?.transaction_date ? String(latest.transaction_date).slice(0, 7) : new Date().toISOString().slice(0, 7);
  }

  const rows = await loadPeriodSummary(supabase, month);
  const { data: rosterData } = await supabase.rpc("list_org_members", { p_org: membership.organizationId });
  const emails = new Map<string, string>(((rosterData ?? []) as any[]).map((m) => [m.user_id, m.email]));

  const finalized = rows.filter((r) => r.status === "finalized").length;
  const openItems = rows.reduce((n, r) => n + r.openExceptions, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="print:hidden">
        <Link href="/reports" className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800">
          <ChevronLeft className="h-3.5 w-3.5" />
          Reports
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Period summary · {monthTitle(month)}</h1>
          <p className="mt-1 text-sm text-ink-500">
            {finalized} of {rows.length} account{rows.length === 1 ? "" : "s"} finalized · {openItems.toLocaleString()} open exception{openItems === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <a
            href={`/api/reports/period-summary?period=${month}`}
            className="inline-flex h-9 items-center gap-2 rounded border border-ink-200 bg-white px-4 text-sm font-medium text-ink-800 hover:bg-ink-50"
          >
            <Download className="h-4 w-4" />
            CSV
          </a>
          <PrintButton />
        </div>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-ink-100 bg-white p-4 shadow-subtle print:hidden">
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
          Show month
        </button>
      </form>

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white shadow-subtle print:shadow-none">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 bg-ink-50 text-left text-xs font-medium text-ink-500">
                <th className="px-5 py-2.5 font-medium">Account</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 text-right font-medium">Ledger</th>
                <th className="px-3 py-2.5 text-right font-medium">Bank</th>
                <th className="px-3 py-2.5 text-right font-medium">Difference</th>
                <th className="px-3 py-2.5 text-right font-medium">Open items</th>
                <th className="px-5 py-2.5 font-medium">Finalized</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((r) => {
                const badge = STATUS[r.status] ?? { status: "neutral" as BadgeStatus, label: r.status };
                return (
                  <tr key={r.accountId} className="align-top">
                    <td className="px-5 py-3">
                      <Link href={`/reports/reconciliation?account=${r.accountId}&period=${month}`} className="font-medium text-ink-900 hover:text-accent-700">
                        {r.accountName}
                      </Link>
                      <p className="text-xs text-ink-500">{r.entityName}</p>
                    </td>
                    <td className="px-3 py-3"><Badge status={badge.status} label={badge.label} /></td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-ink-800">{r.bookTotal === null ? "—" : formatCurrency(r.bookTotal, r.currency)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-ink-800">{r.externalTotal === null ? "—" : formatCurrency(r.externalTotal, r.currency)}</td>
                    <td className={`whitespace-nowrap px-3 py-3 text-right tabular-nums ${r.difference ? "font-medium text-status-exception" : "text-ink-800"}`}>
                      {r.difference === null ? "—" : formatCurrency(r.difference, r.currency)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink-800">
                      {r.openExceptions}
                      {r.unmatched > 0 && <span className="block text-xs text-ink-500">{r.unmatched} unmatched</span>}
                    </td>
                    <td className="px-5 py-3 text-xs text-ink-600">
                      {r.finalizedAt ? (
                        <>
                          {fmtDate(r.finalizedAt)}
                          <span className="block text-ink-400">{r.finalizedBy ? (emails.get(r.finalizedBy) ?? "a former member") : ""}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="No accounts to show" description="Switch Reconciliation on for an account to include it here." />
      )}

      <p className="text-xs text-ink-400">
        Generated {new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} by {membership.email}.
      </p>
    </div>
  );
}
