import Link from "next/link";
import { ChevronLeft, GitMerge } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";
import { ConfidenceScore } from "@/components/reconciliation/confidence-score";
import { EmptyState } from "@/components/shared/empty-state";

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

export default async function PendingMatchesPage() {
  // Cast to `any`: some columns are newer than the generated Supabase types.
  const supabase = (await createClient()) as any;

  const { data } = await supabase
    .from("matches")
    .select(
      "id, confidence_score, match_type, created_at, match_lines(side, transactions(id, amount, currency, transaction_date, description, account_id, accounts(name, entities(name))))"
    )
    .eq("status", "pending_review")
    .order("confidence_score", { ascending: false })
    .limit(500);

  const rows: any[] = data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/reconciliation" className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800">
          <ChevronLeft className="h-3.5 w-3.5" />
          Reconciliation
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-ink-900">Matches pending review</h1>
        <p className="mt-1 text-sm text-ink-500">
          {rows.length} suggested match{rows.length === 1 ? "" : "es"}, highest confidence first. Select one to confirm or reject it.
        </p>
      </div>

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-ink-100 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs font-medium uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2.5">Account</th>
                <th className="px-3 py-2.5">Bank transaction</th>
                <th className="px-3 py-2.5">Ledger transaction</th>
                <th className="px-3 py-2.5">Confidence</th>
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
                  <tr key={m.id} className="hover:bg-ink-50">
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
                      <Link href={href} className="text-sm font-medium text-accent-600 hover:text-accent-700">
                        Review →
                      </Link>
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
    </div>
  );
}
