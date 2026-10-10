import Link from "next/link";
import { AlertTriangle, ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ExceptionActions } from "@/components/reconciliation/exception-actions";

const PAGE_SIZE = 50;

const TYPE_LABEL: Record<string, string> = {
  unmatched: "Unmatched",
  duplicate: "Possible duplicate",
  variance_threshold: "Variance",
  stale: "Stale",
};

const TABS = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
] as const;

type Tab = (typeof TABS)[number]["value"];

/**
 * A bank transaction nobody has booked yet (a fee, interest) is fixed with an adjusting entry:
 * the link opens a new draft with the bank-side line already filled in. Ledger-side items don't
 * get one, since they are already in the books.
 */
function adjustHref(t: any): string | undefined {
  if (!t || (t.source !== "plaid" && t.raw_payload?.side !== "bank")) return undefined;
  const amount = Math.abs(Number(t.amount));
  if (!amount) return undefined;
  const params = new URLSearchParams({
    entity: t.entity_id,
    account: t.account_id,
    amount: String(amount),
    // Positive bank amounts are money out, which is a credit to the bank account.
    direction: Number(t.amount) > 0 ? "credit" : "debit",
    date: String(t.transaction_date).slice(0, 10),
    description: t.description ?? "",
  });
  return `/journal-entries/new?${params.toString()}`;
}

const fmtDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function ExceptionsPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const { status, page } = await searchParams;
  const tab: Tab = TABS.find((t) => t.value === status)?.value ?? "open";
  const pageNumber = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const from = (pageNumber - 1) * PAGE_SIZE;

  const membership = await getCurrentMembership();
  const canAct = membership ? can(membership.role, "reconciliation.match") : false;

  // Cast to `any`: some columns are newer than the generated Supabase types.
  const supabase = (await createClient()) as any;

  const { data, count } = await supabase
    .from("exceptions")
    .select(
      "id, exception_type, severity, status, created_at, resolved_at, resolved_by, resolution_reason, resolution_note, transactions(id, amount, currency, transaction_date, description, account_id, entity_id, source, raw_payload, accounts(name, entities(name)))",
      { count: "exact" }
    )
    .eq("status", tab)
    .order(tab === "open" ? "created_at" : "resolved_at", { ascending: false, nullsFirst: false })
    .range(from, from + PAGE_SIZE - 1);

  const rows: any[] = data ?? [];
  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const { data: rosterData } = membership
    ? await supabase.rpc("list_org_members", { p_org: membership.organizationId })
    : { data: [] };
  const emailById = new Map<string, string>(((rosterData ?? []) as any[]).map((m) => [m.user_id, m.email]));

  const linkFor = (nextTab: Tab, nextPage = 1) => {
    const params = new URLSearchParams();
    if (nextTab !== "open") params.set("status", nextTab);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return `/reconciliation/exceptions${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/reconciliation" className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800">
          <ChevronLeft className="h-3.5 w-3.5" />
          Reconciliation
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-ink-900">Exceptions</h1>
        <p className="mt-1 text-sm text-ink-500">
          Items that couldn&apos;t be matched. Resolve one when you understand it (it then stops counting toward the unexplained
          difference), or dismiss it when it isn&apos;t a real issue. Both need a reason, which is kept in the audit log.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.value}
            href={linkFor(t.value)}
            className={
              t.value === tab
                ? "rounded-full bg-accent-500 px-3 py-1 text-xs font-medium text-white"
                : "rounded-full border border-ink-200 bg-white px-3 py-1 text-xs font-medium text-ink-600 hover:bg-ink-50"
            }
          >
            {t.label}
          </Link>
        ))}
        <span className="ml-1 self-center text-xs text-ink-500">
          {total.toLocaleString()} {tab}
        </span>
      </div>

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white shadow-subtle">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 bg-ink-50 text-left text-xs font-medium text-ink-500">
                <th className="px-4 py-2.5 font-medium">Transaction</th>
                <th className="px-3 py-2.5 font-medium">Account</th>
                <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                <th className="px-3 py-2.5 font-medium">{tab === "open" ? "Type" : "Outcome"}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((e) => {
                const t = e.transactions;
                const href = t ? `/reconciliation/${t.account_id}?period=${String(t.transaction_date).slice(0, 7)}` : "/reconciliation";
                return (
                  <tr key={e.id} className="align-top hover:bg-ink-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink-900">{t?.description ?? "Transaction"}</p>
                      <p className="text-xs text-ink-500">{t ? fmtDate(t.transaction_date) : "—"}</p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-ink-800">{t?.accounts?.name ?? "—"}</p>
                      <p className="text-xs text-ink-500">{t?.accounts?.entities?.name ?? ""}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-ink-900">
                      {t ? formatCurrency(Number(t.amount), t.currency) : "—"}
                    </td>
                    <td className="px-3 py-3">
                      {tab === "open" ? (
                        <div className="flex items-center gap-2">
                          <Badge status="exception" label={TYPE_LABEL[e.exception_type] ?? e.exception_type} />
                          <span className="text-xs capitalize text-ink-500">{e.severity}</span>
                        </div>
                      ) : (
                        <div className="max-w-xs">
                          <Badge status={tab === "resolved" ? "matched" : "neutral"} label={tab === "resolved" ? "Resolved" : "Dismissed"} />
                          <p className="mt-1 text-xs text-ink-800">{e.resolution_reason ?? "Cleared when the transaction was matched"}</p>
                          {e.resolution_note && <p className="mt-0.5 text-xs text-ink-500">{e.resolution_note}</p>}
                          {e.resolved_at && (
                            <p className="mt-0.5 text-xs text-ink-400">
                              {e.resolved_by ? (emailById.get(e.resolved_by) ?? "Former member") : "Automatically"} · {fmtDate(e.resolved_at)}
                            </p>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ExceptionActions exceptionId={e.id} status={e.status} canAct={canAct} reviewHref={href} adjustHref={adjustHref(t)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={<AlertTriangle className="h-8 w-8" />}
          title={tab === "open" ? "No open exceptions" : `Nothing ${tab} yet`}
          description={tab === "open" ? "Every transaction is either matched or has been resolved." : "Exceptions you close will appear here with their reason."}
        />
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-600">
          <span>
            Page {pageNumber} of {pageCount}
          </span>
          <div className="flex gap-2">
            {pageNumber > 1 && (
              <Link href={linkFor(tab, pageNumber - 1)} className="rounded border border-ink-200 bg-white px-3 py-1.5 hover:bg-ink-50">
                Previous
              </Link>
            )}
            {pageNumber < pageCount && (
              <Link href={linkFor(tab, pageNumber + 1)} className="rounded border border-ink-200 bg-white px-3 py-1.5 hover:bg-ink-50">
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
