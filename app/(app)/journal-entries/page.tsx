import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { can } from "@/lib/permissions";
import { cn, formatCurrency } from "@/lib/utils";
import { Badge, type BadgeStatus } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";

const PAGE_SIZE = 50;

const STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "posted", label: "Posted" },
  { value: "reversed", label: "Reversed" },
] as const;

const STATUS_BADGE: Record<string, { status: BadgeStatus; label: string }> = {
  draft: { status: "pending", label: "Draft" },
  posted: { status: "matched", label: "Posted" },
  reversed: { status: "neutral", label: "Reversed" },
};

const fmtDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function JournalEntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; entity?: string; page?: string }>;
}) {
  const { status, entity, page } = await searchParams;
  const statusFilter = STATUS_TABS.find((t) => t.value === status)?.value ?? "all";
  const pageNumber = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const from = (pageNumber - 1) * PAGE_SIZE;

  const membership = await getCurrentMembership();
  const canDraft = membership ? can(membership.role, "journal_entries.draft") : false;

  // Cast to `any`: some columns are newer than the generated Supabase types.
  const supabase = (await createClient()) as any;

  const { data: entityRows } = await supabase.from("entities").select("id, name, currency").is("archived_at", null).order("name");
  const entities: { id: string; name: string; currency: string }[] = entityRows ?? [];
  const entityFilter = entities.find((e) => e.id === entity)?.id ?? "";

  let query = supabase
    .from("journal_entries")
    .select("id, entry_date, description, status, created_by, reversed_entry_id, entities(name, currency), journal_entry_lines(debit)", { count: "exact" })
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (statusFilter !== "all") query = query.eq("status", statusFilter);
  if (entityFilter) query = query.eq("entity_id", entityFilter);

  const { data, count } = await query;
  const rows: any[] = data ?? [];
  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const { data: rosterData } = membership ? await supabase.rpc("list_org_members", { p_org: membership.organizationId }) : { data: [] };
  const emailById = new Map<string, string>(((rosterData ?? []) as any[]).map((m) => [m.user_id, m.email]));

  const linkFor = (nextStatus: string, nextEntity: string, nextPage = 1) => {
    const params = new URLSearchParams();
    if (nextStatus !== "all") params.set("status", nextStatus);
    if (nextEntity) params.set("entity", nextEntity);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return `/journal-entries${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Journal entries</h1>
          <p className="mt-1 text-sm text-ink-500">
            Adjusting entries for things like bank fees and corrections. Drafts can be edited; posted entries can only be reversed.
          </p>
        </div>
        {canDraft && entities.length > 0 && (
          <Link
            href="/journal-entries/new"
            className="inline-flex h-9 items-center gap-2 rounded bg-accent-500 px-4 text-sm font-medium text-white hover:bg-accent-600"
          >
            <Plus className="h-4 w-4" />
            New journal entry
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((t) => (
          <Link
            key={t.value}
            href={linkFor(t.value, entityFilter)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium",
              t.value === statusFilter ? "bg-accent-500 text-white" : "border border-ink-200 bg-white text-ink-600 hover:bg-ink-50"
            )}
          >
            {t.label}
          </Link>
        ))}
        {entities.length > 1 && (
          <span className="ml-2 flex flex-wrap items-center gap-2 border-l border-ink-200 pl-4">
            <Link
              href={linkFor(statusFilter, "")}
              className={cn("rounded-full px-3 py-1 text-xs font-medium", !entityFilter ? "bg-ink-800 text-white" : "border border-ink-200 bg-white text-ink-600 hover:bg-ink-50")}
            >
              All entities
            </Link>
            {entities.map((e) => (
              <Link
                key={e.id}
                href={linkFor(statusFilter, e.id)}
                className={cn("rounded-full px-3 py-1 text-xs font-medium", entityFilter === e.id ? "bg-ink-800 text-white" : "border border-ink-200 bg-white text-ink-600 hover:bg-ink-50")}
              >
                {e.name}
              </Link>
            ))}
          </span>
        )}
      </div>

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white shadow-subtle">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 bg-ink-50 text-left text-xs font-medium text-ink-500">
                <th className="px-5 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Description</th>
                <th className="px-3 py-2.5 font-medium">Entity</th>
                <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5 font-medium">Created by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((r) => {
                const amount = ((r.journal_entry_lines ?? []) as { debit: number }[]).reduce((n, l) => n + Number(l.debit), 0);
                const badge = STATUS_BADGE[r.status] ?? { status: "neutral" as BadgeStatus, label: r.status };
                return (
                  <tr key={r.id} className="hover:bg-ink-50">
                    <td className="whitespace-nowrap px-5 py-3 text-ink-600">
                      <Link href={`/journal-entries/${r.id}`} className="font-medium text-accent-600 hover:text-accent-700">
                        {fmtDate(r.entry_date)}
                      </Link>
                    </td>
                    <td className="max-w-xs px-3 py-3 text-ink-900">
                      <Link href={`/journal-entries/${r.id}`} className="block truncate">
                        {r.description ?? "—"}
                      </Link>
                      {r.reversed_entry_id && <span className="text-xs text-ink-500">Reversing entry</span>}
                    </td>
                    <td className="px-3 py-3 text-ink-600">{r.entities?.name ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-ink-900">{formatCurrency(amount, r.entities?.currency ?? "USD")}</td>
                    <td className="px-3 py-3">
                      <Badge status={badge.status} label={badge.label} />
                    </td>
                    <td className="px-5 py-3 text-xs text-ink-500">{r.created_by ? (emailById.get(r.created_by) ?? "Former member") : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title={statusFilter === "all" && !entityFilter ? "No journal entries yet" : "No entries match"}
          description="Use a journal entry to record something that isn't in your accounting system yet, such as a bank fee, then match it to the bank transaction."
          action={
            canDraft && entities.length > 0 ? (
              <Link href="/journal-entries/new" className="text-sm font-medium text-accent-600 hover:text-accent-700">
                Create the first entry →
              </Link>
            ) : undefined
          }
        />
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-600">
          <span>
            Page {pageNumber} of {pageCount} · {total.toLocaleString()} entries
          </span>
          <div className="flex gap-2">
            {pageNumber > 1 && (
              <Link href={linkFor(statusFilter, entityFilter, pageNumber - 1)} className="rounded border border-ink-200 bg-white px-3 py-1.5 hover:bg-ink-50">
                Previous
              </Link>
            )}
            {pageNumber < pageCount && (
              <Link href={linkFor(statusFilter, entityFilter, pageNumber + 1)} className="rounded border border-ink-200 bg-white px-3 py-1.5 hover:bg-ink-50">
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
