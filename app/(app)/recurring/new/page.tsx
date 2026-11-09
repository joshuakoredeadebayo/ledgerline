import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { loadJournalFormData } from "@/lib/journal-form-data";
import { RECURRING_STARTERS } from "@/lib/recurring-starters";
import { EmptyState } from "@/components/shared/empty-state";
import { RecurringForm } from "@/components/recurring/recurring-form";

export default async function NewRecurringPage({ searchParams }: { searchParams: Promise<{ starter?: string }> }) {
  const sp = await searchParams;
  const membership = await getCurrentMembership();
  if (!membership || !can(membership.role, "journal_entries.draft")) redirect("/recurring");

  const { entities, accounts } = await loadJournalFormData();
  if (entities.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState title="Add an entity first" description="Recurring entries belong to an entity and use its accounts." />
      </div>
    );
  }

  const starter = RECURRING_STARTERS.find((s) => s.id === sp.starter);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/recurring" className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800">
          <ChevronLeft className="h-3.5 w-3.5" />
          Recurring entries
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-ink-900">New recurring entry</h1>
      </div>
      <RecurringForm
        entities={entities}
        accounts={accounts}
        initial={{
          entityId: entities[0]!.id,
          name: starter?.name ?? "",
          description: starter?.description ?? "",
          frequency: starter?.frequency ?? "monthly",
          intervalCount: 1,
          dayOfMonth: starter?.dayOfMonth ?? 1,
          weekday: 5,
          startDate: today,
          endDate: "",
          leadDays: 0,
          lines: [
            { accountId: "", debit: "", credit: "", memo: "" },
            { accountId: "", debit: "", credit: "", memo: "" },
          ],
        }}
      />
    </div>
  );
}
