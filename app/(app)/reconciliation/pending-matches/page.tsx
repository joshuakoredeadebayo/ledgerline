import Link from "next/link";
import { ChevronLeft, GitMerge } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { formatCurrency } from "@/lib/utils";
import { ConfidenceScore } from "@/components/reconciliation/confidence-score";
import { EmptyState } from "@/components/shared/empty-state";
import { BulkConfirmBar, PendingMatchActions } from "@/components/reconciliation/pending-match-actions";

const PAGE_SIZE = 50;
const BULK_THRESHOLD = 0.95;

function TxnCell({ t }: { t: any }) {
  if (!t) return <span className="text-ink-400">—</span>;
  return (
    <div>
      <p className="font-medium tabular-nums text-ink-900">{formatCurrency(Number(t.amount), t.currency)}</p>
      <p className="text-xs text-ink-500">
        {new Date(`${t.transaction_date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
        {t.description ? ` · ${t.description}` : ""}
      </p>
    </div>
  );
}

export default async function PendingMatchesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page } = await searchParams;
  const pageNumber = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const from = (pageNumber - 1) * PAGE_SIZE;

  const membership = await getCurrentMembership();
  const canAct = membership ? can(membership.role, "reconciliation.match") : false;

  // Cast to `any`: some columns are newer than the generated Supabase types.
  const supabase = (await createClient()) as any;

  const { data, count } = await supabase
    .from("matches")
    .select(
      "id, confidence_score, match_type, created_at, match_lines(side, transactions(id, amount, currency, transaction_date, description, account_id, accounts(name, entities(name))))",
      { count: "exact" }
    )
    .eq("status", "pending_review")
    .order("confidence_score", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  const { count: eligible } = await supabase
    .from("matches")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending_review")
    .gte("confidence_score", BULK_THRESHOLD);

  const rows: any[] = data ?? [];
  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/reconciliation" className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800">
          <ChevronLeft className="h-3.5 w-3.5" />
          Reconciliation
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-ink-900">Matches pending review</h1>
        <p className="mt-1 text-sm text-ink-500">
          {total.toLocaleString()} suggested match{total === 1 ? "" : "es"}, highest confidence first. Confirm or reject them here, or open the account to
          see them in context.
        </p>
      </div>

      {canAct && <BulkConfirmBar threshold={BULK_THRESHOLD} eligible={eligible ?? 0} />}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white shadow-subtle">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 bg-ink-50 text-left text-xs font-medium text-ink-500">
                <th className="px-4 py-2.5 font-medium">Account</th>
                <th className="px-3 py-2.5 font-medium">Bank transaction</th>
                <th className="px-3 py-2.5 font-medium">Ledger transaction</th>
                <th className="px-3 py-2.5 font-medium">Confidence</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((m) => {
                const lines: any[] = m.match_lines ?? [];
                const bank = lines.find((l) => l.side === "bank")?.transactions;
                const ledger = lines.find((l) => l.side === "ledger")?.transactions;
                const anchor = bank ?? ledger;
                const href = anchor
                  ? `/reconciliation/${anchor.account_id}?period=${String(anchor.transaction_date).slice(0, 7)}`
                  : "/reconciliation";
                return (
                  <tr key={m.id} className="align-top hover:bg-ink-50">
                    <td className="px-4 py-3">
                      <p className="text-ink-800">{anchor?.accounts?.name ?? "—"}</p>
                      <p className="text-xs text-ink-500">{anchor?.accounts?.entities?.name ?? ""}</p>
                    </td>
                    <td className="px-3 py-3"><TxnCell t={bank} /></td>
                    <td className="px-3 py-3"><TxnCell t={ledger} /></td>
                    <td className="px-3 py-3">
                      {m.confidence_score != null ? <ConfidenceScore score={Number(m.confidence_score)} /> : <span className="text-ink-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canAct && anchor ? (
                        <PendingMatchActions matchId={m.id} accountId={anchor.account_id} reviewHref={href} />
                      ) : (
                        <Link href={href} className="text-sm font-medium text-accent-600 hover:text-accent-700">
                          Review →
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={<GitMerge className="h-8 w-8" />}
          title="No matches waiting for review"
          description="Suggested matches appear here when the engine pairs a bank and ledger transaction."
          action={
            <Link href="/reconciliation" className="text-sm font-medium text-accent-600 hover:text-accent-700">
              Back to Reconciliation →
            </Link>
          }
        />
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-600">
          <span>
            Page {pageNumber} of {pageCount}
          </span>
          <div className="flex gap-2">
            {pageNumber > 1 && (
              <Link href={`/reconciliation/pending-matches?page=${pageNumber - 1}`} className="rounded border border-ink-200 bg-white px-3 py-1.5 hover:bg-ink-50">
                Previous
              </Link>
            )}
            {pageNumber < pageCount && (
              <Link href={`/reconciliation/pending-matches?page=${pageNumber + 1}`} className="rounded border border-ink-200 bg-white px-3 py-1.5 hover:bg-ink-50">
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
