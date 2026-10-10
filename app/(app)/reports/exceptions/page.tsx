import Link from "next/link";
import { ChevronLeft, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { cn, formatCurrency } from "@/lib/utils";
import { AGE_BUCKETS, loadExceptionAging } from "@/lib/reports/exception-aging";
import { EmptyState } from "@/components/shared/empty-state";
import { PrintButton } from "@/components/reports/print-button";

const fmtDate = (iso: string) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";

export default async function ExceptionAgingPage({ searchParams }: { searchParams: Promise<{ entity?: string }> }) {
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
  const { data: entityRows } = await supabase.from("entities").select("id, name").is("archived_at", null).order("name");
  const entities: { id: string; name: string }[] = entityRows ?? [];
  const entityId = entities.find((e) => e.id === sp.entity)?.id;

  const rows = await loadExceptionAging(supabase, entityId);

  const summary = AGE_BUCKETS.map((b) => {
    const inBucket = rows.filter((r) => r.bucket === b.key);
    // Amounts are never added across currencies; each currency gets its own total.
    const totals = new Map<string, number>();
    for (const r of inBucket) totals.set(r.currency, (totals.get(r.currency) ?? 0) + Math.abs(r.amount));
    return { ...b, count: inBucket.length, totals: [...totals.entries()] };
  });

  const entityName = entityId ? entities.find((e) => e.id === entityId)?.name : "All entities";

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
          <h1 className="text-2xl font-semibold text-ink-900">Exception aging</h1>
          <p className="mt-1 text-sm text-ink-500">
            {entityName} · {rows.length.toLocaleString()} open exception{rows.length === 1 ? "" : "s"} as of {fmtDate(new Date().toISOString())}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <a
            href={`/api/reports/exceptions${entityId ? `?entity=${entityId}` : ""}`}
            className="inline-flex h-9 items-center gap-2 rounded border border-ink-200 bg-white px-4 text-sm font-medium text-ink-800 hover:bg-ink-50"
          >
            <Download className="h-4 w-4" />
            CSV
          </a>
          <PrintButton />
        </div>
      </div>

      {entities.length > 1 && (
        <div className="flex flex-wrap gap-2 print:hidden">
          <Link
            href="/reports/exceptions"
            className={cn("rounded-full px-3 py-1 text-xs font-medium", !entityId ? "bg-accent-500 text-white" : "border border-ink-200 bg-white text-ink-600 hover:bg-ink-50")}
          >
            All entities
          </Link>
          {entities.map((e) => (
            <Link
              key={e.id}
              href={`/reports/exceptions?entity=${e.id}`}
              className={cn("rounded-full px-3 py-1 text-xs font-medium", entityId === e.id ? "bg-accent-500 text-white" : "border border-ink-200 bg-white text-ink-600 hover:bg-ink-50")}
            >
              {e.name}
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {summary.map((b) => (
          <div key={b.key} className="print-avoid-break rounded-xl border border-ink-100 bg-white p-4 shadow-subtle print:shadow-none">
            <p className="text-xs font-medium text-ink-500">{b.label}</p>
            <p className={cn("mt-1 text-2xl font-semibold tabular-nums", b.key === "61+" && b.count > 0 ? "text-status-exception" : "text-ink-900")}>{b.count}</p>
            <p className="mt-1 text-xs text-ink-500">
              {b.totals.length > 0 ? b.totals.map(([cur, total]) => formatCurrency(total, cur)).join(" · ") : "Nothing open"}
            </p>
          </div>
        ))}
      </div>

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white shadow-subtle print:shadow-none">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 bg-ink-50 text-left text-xs font-medium text-ink-500">
                <th className="px-5 py-2.5 font-medium">Age</th>
                <th className="px-3 py-2.5 font-medium">Transaction</th>
                <th className="px-3 py-2.5 font-medium">Account</th>
                <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                <th className="px-5 py-2.5 font-medium">Severity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {/* Oldest first: the ones that most need attention lead the list. */}
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap px-5 py-2.5">
                    <span className={cn("font-medium tabular-nums", r.ageDays > 60 ? "text-status-exception" : "text-ink-900")}>{r.ageDays}d</span>
                    <span className="block text-xs text-ink-400">since {fmtDate(r.openedOn)}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="text-ink-900">{r.description ?? "Transaction"}</p>
                    <p className="text-xs text-ink-500">{fmtDate(r.transactionDate)}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    {r.accountId ? (
                      <Link
                        href={`/reconciliation/${r.accountId}?period=${r.transactionDate.slice(0, 7)}`}
                        className="text-ink-800 hover:text-accent-700 print:no-underline"
                      >
                        {r.accountName}
                      </Link>
                    ) : (
                      r.accountName
                    )}
                    <p className="text-xs text-ink-500">{r.entityName}</p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink-900">{formatCurrency(r.amount, r.currency)}</td>
                  <td className="px-5 py-2.5 text-xs capitalize text-ink-600">{r.severity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="No open exceptions" description="Everything is matched or has been explained." />
      )}

      <p className="text-xs text-ink-400 print:block">
        Generated {new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} by {membership.email}. Amounts in
        different currencies are shown separately and never added together.
      </p>
    </div>
  );
}
