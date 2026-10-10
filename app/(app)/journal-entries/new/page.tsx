import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { loadJournalFormData } from "@/lib/journal-form-data";
import { EmptyState } from "@/components/shared/empty-state";
import { JournalEntryForm, type FormLine } from "@/components/journal/journal-entry-form";

/**
 * New draft. The URL can pre-fill it — used by "Create adjusting entry" on an exception:
 *   ?entity=…&account=…&amount=25&direction=credit&date=2026-08-14&description=…
 * That puts the bank-side line in place and leaves the balancing account for you to choose.
 */
export default async function NewJournalEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; account?: string; amount?: string; direction?: string; date?: string; description?: string }>;
}) {
  const sp = await searchParams;
  const membership = await getCurrentMembership();
  if (!membership || !can(membership.role, "journal_entries.draft")) redirect("/journal-entries");

  const { entities, accounts } = await loadJournalFormData();
  if (entities.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState title="Add an entity first" description="Journal entries belong to an entity and use its accounts." />
      </div>
    );
  }

  const entityId = entities.find((e) => e.id === sp.entity)?.id ?? entities[0]!.id;
  const prefillAccount = accounts.find((a) => a.id === sp.account && a.entityId === entityId);
  const amount = Number(sp.amount);
  const hasAmount = Number.isFinite(amount) && amount > 0;
  const firstIsCredit = sp.direction !== "debit";

  const lines: FormLine[] = [
    {
      accountId: prefillAccount?.id ?? "",
      debit: hasAmount && !firstIsCredit ? String(amount) : "",
      credit: hasAmount && firstIsCredit ? String(amount) : "",
      memo: "",
    },
    { accountId: "", debit: hasAmount && firstIsCredit ? String(amount) : "", credit: hasAmount && !firstIsCredit ? String(amount) : "", memo: "" },
  ];

  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? (sp.date as string) : new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/journal-entries" className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800">
          <ChevronLeft className="h-3.5 w-3.5" />
          Journal entries
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-ink-900">New journal entry</h1>
        <p className="mt-1 text-sm text-ink-500">Every entry needs at least two lines, and total debits must equal total credits before it can be posted.</p>
      </div>
      <JournalEntryForm
        entities={entities}
        accounts={accounts}
        canPost={can(membership.role, "journal_entries.post")}
        initial={{ entityId, entryDate: date, description: (sp.description ?? "").slice(0, 300), lines }}
      />
    </div>
  );
}
