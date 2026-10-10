import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { loadJournalFormData } from "@/lib/journal-form-data";
import { JournalEntryForm } from "@/components/journal/journal-entry-form";

export default async function EditJournalEntryPage({ params }: { params: Promise<{ entryId: string }> }) {
  const { entryId } = await params;
  const membership = await getCurrentMembership();
  if (!membership || !can(membership.role, "journal_entries.draft")) redirect(`/journal-entries/${entryId}`);

  const supabase = (await createClient()) as any;
  const { data: entry } = await supabase
    .from("journal_entries")
    .select("id, entity_id, entry_date, description, status, journal_entry_lines(account_id, debit, credit, memo)")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) notFound();
  if (entry.status !== "draft") redirect(`/journal-entries/${entryId}`);

  const { entities, accounts } = await loadJournalFormData();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href={`/journal-entries/${entryId}`} className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800">
          <ChevronLeft className="h-3.5 w-3.5" />
          Back to entry
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-ink-900">Edit draft</h1>
      </div>
      <JournalEntryForm
        entities={entities}
        accounts={accounts}
        canPost={can(membership.role, "journal_entries.post")}
        initial={{
          id: entry.id,
          entityId: entry.entity_id,
          entryDate: entry.entry_date,
          description: entry.description ?? "",
          lines: ((entry.journal_entry_lines ?? []) as any[]).map((l) => ({
            accountId: l.account_id,
            debit: Number(l.debit) > 0 ? String(l.debit) : "",
            credit: Number(l.credit) > 0 ? String(l.credit) : "",
            memo: l.memo ?? "",
          })),
        }}
      />
    </div>
  );
}
