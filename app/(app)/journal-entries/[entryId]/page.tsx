import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { formatCurrency } from "@/lib/utils";
import { Badge, type BadgeStatus } from "@/components/ui/badge";
import { JournalEntryActions } from "@/components/journal/entry-actions";

const STATUS_BADGE: Record<string, { status: BadgeStatus; label: string }> = {
  draft: { status: "pending", label: "Draft" },
  posted: { status: "matched", label: "Posted" },
  reversed: { status: "neutral", label: "Reversed" },
};

const fmtDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function JournalEntryDetailPage({ params }: { params: Promise<{ entryId: string }> }) {
  const { entryId } = await params;
  const membership = await getCurrentMembership();

  // Cast to `any`: some columns are newer than the generated Supabase types.
  const supabase = (await createClient()) as any;

  const { data: entry } = await supabase
    .from("journal_entries")
    .select(
      "id, entity_id, entry_date, description, status, reversed_entry_id, created_by, created_at, posted_at, entities(name, currency), journal_entry_lines(id, debit, credit, memo, accounts(id, name, code, is_reconcilable))"
    )
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) notFound();

  const lines: any[] = entry.journal_entry_lines ?? [];
  const currency = entry.entities?.currency ?? "USD";
  const totalDebit = lines.reduce((n, l) => n + Number(l.debit), 0);
  const totalCredit = lines.reduce((n, l) => n + Number(l.credit), 0);
  const balanced = Math.round(totalDebit * 100) === Math.round(totalCredit * 100) && lines.length >= 2;

  // What this entry points to, and what points back at it.
  const { data: original } = entry.reversed_entry_id
    ? await supabase.from("journal_entries").select("id, entry_date, description").eq("id", entry.reversed_entry_id).maybeSingle()
    : { data: null };
  const { data: reversal } = await supabase.from("journal_entries").select("id, entry_date").eq("reversed_entry_id", entry.id).maybeSingle();

  // The reconciliation items this entry produced (posted entries only), with their current state.
  const { data: itemRows } =
    entry.status !== "draft"
      ? await supabase
          .from("transactions")
          .select("id, account_id, amount, currency, status, transaction_date, accounts(name)")
          .eq("source", "manual")
          .contains("raw_payload", { journal_entry_id: entry.id })
      : { data: [] };
  const items: any[] = itemRows ?? [];

  const { data: rosterData } = membership ? await supabase.rpc("list_org_members", { p_org: membership.organizationId }) : { data: [] };
  const emailById = new Map<string, string>(((rosterData ?? []) as any[]).map((m) => [m.user_id, m.email]));

  const badge = STATUS_BADGE[entry.status] ?? { status: "neutral" as BadgeStatus, label: entry.status };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/journal-entries" className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800">
          <ChevronLeft className="h-3.5 w-3.5" />
          Journal entries
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-semibold text-ink-900">
              {entry.description || "Journal entry"}
              <Badge status={badge.status} label={badge.label} />
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              {entry.entities?.name} · {fmtDate(entry.entry_date)}
            </p>
          </div>
          {membership && (
            <JournalEntryActions
              entryId={entry.id}
              status={entry.status}
              canDraft={can(membership.role, "journal_entries.draft")}
              canPost={can(membership.role, "journal_entries.post")}
              balanced={balanced}
            />
          )}
        </div>
      </div>

      {original && (
        <p className="rounded-lg border border-ink-100 bg-white px-4 py-3 text-sm text-ink-700">
          This entry reverses{" "}
          <Link href={`/journal-entries/${original.id}`} className="font-medium text-accent-600 hover:text-accent-700">
            {original.description ?? "an earlier entry"} ({fmtDate(original.entry_date)})
          </Link>
          .
        </p>
      )}
      {reversal && (
        <p className="rounded-lg border border-status-pending/20 bg-status-pendingBg px-4 py-3 text-sm text-ink-800">
          This entry was reversed on {fmtDate(reversal.entry_date)}.{" "}
          <Link href={`/journal-entries/${reversal.id}`} className="font-medium text-accent-600 hover:text-accent-700">
            View the reversing entry
          </Link>
        </p>
      )}

      <section className="overflow-hidden rounded-xl border border-ink-100 bg-white shadow-subtle">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-100 bg-ink-50 text-left text-xs font-medium text-ink-500">
              <th className="px-5 py-2.5 font-medium">Account</th>
              <th className="px-3 py-2.5 text-right font-medium">Debit</th>
              <th className="px-3 py-2.5 text-right font-medium">Credit</th>
              <th className="px-5 py-2.5 font-medium">Memo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="px-5 py-3 text-ink-900">
                  {l.accounts?.code ? `${l.accounts.code} · ` : ""}
                  {l.accounts?.name ?? "Account"}
                  {l.accounts?.is_reconcilable && <span className="ml-2 rounded-full bg-accent-50 px-2 py-0.5 text-xs text-accent-700">bank/card</span>}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink-900">{Number(l.debit) > 0 ? formatCurrency(Number(l.debit), currency) : ""}</td>
                <td className="px-3 py-3 text-right tabular-nums text-ink-900">{Number(l.credit) > 0 ? formatCurrency(Number(l.credit), currency) : ""}</td>
                <td className="px-5 py-3 text-ink-600">{l.memo ?? ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-ink-100 bg-ink-50 font-medium text-ink-900">
              <td className="px-5 py-3">Total</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(totalDebit, currency)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(totalCredit, currency)}</td>
              <td className="px-5 py-3 text-xs">
                {balanced ? <span className="text-status-matched">Balanced</span> : <span className="text-status-pending">Out of balance</span>}
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      {items.length > 0 && (
        <section className="rounded-xl border border-ink-100 bg-white p-5 shadow-subtle">
          <h2 className="text-[15px] font-semibold text-ink-900">In reconciliation</h2>
          <p className="mb-2 mt-0.5 text-xs text-ink-500">Lines on bank and card accounts appear as ledger items so they can be matched to the bank transaction they explain.</p>
          <ul className="divide-y divide-ink-100 text-sm">
            {items.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <span className="text-ink-800">
                  {t.accounts?.name} · {formatCurrency(Number(t.amount), t.currency)}
                </span>
                <span className="flex items-center gap-3">
                  <Badge
                    status={t.status === "matched" ? "matched" : t.status === "unmatched" ? "pending" : "neutral"}
                    label={t.status === "matched" ? "Matched" : t.status === "unmatched" ? "Waiting to be matched" : "Withdrawn"}
                  />
                  {t.status !== "excluded" && (
                    <Link
                      href={`/reconciliation/${t.account_id}?period=${String(t.transaction_date).slice(0, 7)}`}
                      className="text-xs font-medium text-accent-600 hover:text-accent-700"
                    >
                      Open reconciliation
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-ink-500">
        Created {entry.created_by ? `by ${emailById.get(entry.created_by) ?? "a former member"}` : ""} on{" "}
        {new Date(entry.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        {entry.posted_at ? ` · Posted ${new Date(entry.posted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}.
      </p>
    </div>
  );
}
