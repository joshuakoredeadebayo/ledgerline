import Link from "next/link";
import { AlertTriangle, ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";

const TYPE_LABEL: Record<string, string> = {
  unmatched: "Unmatched",
  duplicate: "Possible duplicate",
  variance_threshold: "Variance",
  stale: "Stale",
};

export default async function OpenExceptionsPage() {
  // Cast to `any`: some columns are newer than the generated Supabase types.
  const supabase = (await createClient()) as any;

  const { data } = await supabase
    .from("exceptions")
    .select(
      "id, exception_type, severity, created_at, transactions(id, amount, currency, transaction_date, description, account_id, accounts(name, entities(name)))"
    )
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(500);

  const rows: any[] = data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/reconciliation" className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800">
          <ChevronLeft className="h-3.5 w-3.5" />
          Reconciliation
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-ink-900">Open exceptions</h1>
        <p className="mt-1 text-sm text-ink-500">
          {rows.length} open exception{rows.length === 1 ? "" : "s"}. Select one to open its account and month.
        </p>
      </div>

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-ink-100 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs font-medium uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2.5">Transaction</th>
                <th className="px-3 py-2.5">Account</th>
                <th className="px-3 py-2.5 text-right">Amount</th>
                <th className="px-3 py-2.5">Type</th>
                <th className="px-3 py-2.5">Severity</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((e) => {
                const t = e.transactions;
                const href = t ? `/reconciliation/${t.account_id}?period=${String(t.transaction_date).slice(0, 7)}` : "/reconciliation";
                return (
                  <tr key={e.id} className="hover:bg-ink-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink-900">{t?.description ?? "Transaction"}</p>
                      <p className="text-xs text-ink-500">{t ? new Date(`${t.transaction_date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—"}</p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-ink-800">{t?.accounts?.name ?? "—"}</p>
                      <p className="text-xs text-ink-500">{t?.accounts?.entities?.name ?? ""}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-ink-900">
                      {t ? formatCurrency(Number(t.amount), t.currency) : "—"}
                    </td>
                    <td className="px-3 py-3">
                      <Badge status="exception" label={TYPE_LABEL[e.exception_type] ?? e.exception_type} />
                    </td>
                    <td className="px-3 py-3 capitalize text-ink-700">{e.severity}</td>
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
          icon={<AlertTriangle className="h-8 w-8" />}
          title="No open exceptions"
          description="Every transaction is either matched or has been resolved."
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
