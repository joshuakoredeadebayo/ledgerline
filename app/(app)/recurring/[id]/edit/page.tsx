import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { loadJournalFormData } from "@/lib/journal-form-data";
import type { TemplateRow } from "@/lib/recurring-engine";
import { RecurringForm } from "@/components/recurring/recurring-form";

export default async function EditRecurringPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const membership = await getCurrentMembership();
  if (!membership || !can(membership.role, "journal_entries.draft")) redirect(`/recurring/${id}`);

  const supabase = (await createClient()) as any;
  const { data } = await supabase.from("recurring_templates").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const t = data as TemplateRow;

  const { entities, accounts } = await loadJournalFormData();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href={`/recurring/${id}`} className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800">
          <ChevronLeft className="h-3.5 w-3.5" />
          {t.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-ink-900">Edit recurring entry</h1>
        <p className="mt-1 text-sm text-ink-500">Changes apply to drafts prepared from now on. Drafts already prepared are not changed.</p>
      </div>
      <RecurringForm
        entities={entities}
        accounts={accounts}
        initial={{
          id: t.id,
          entityId: t.entity_id,
          name: t.name,
          description: t.description ?? "",
          frequency: t.frequency,
          intervalCount: t.interval_count,
          dayOfMonth: t.day_of_month,
          weekday: t.weekday,
          startDate: t.start_date,
          endDate: t.end_date ?? "",
          leadDays: t.lead_days,
          lines: (t.lines ?? []).map((l) => ({
            accountId: l.accountId,
            debit: Number(l.debit) > 0 ? String(l.debit) : "",
            credit: Number(l.credit) > 0 ? String(l.credit) : "",
            memo: l.memo ?? "",
          })),
        }}
      />
    </div>
  );
}
