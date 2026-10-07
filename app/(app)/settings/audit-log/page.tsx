import Link from "next/link";
import { Download } from "lucide-react";
import { getCurrentMembership } from "@/lib/actions/membership";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import { AUDIT_CATEGORIES, applyAuditCategory, humanizeAction, summarizeChange } from "@/lib/audit-log";
import { EmptyState } from "@/components/shared/empty-state";

const PAGE_SIZE = 50;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; page?: string }>;
}) {
  const { category, page } = await searchParams;
  const membership = await getCurrentMembership();
  if (!membership) return null;

  if (!can(membership.role, "audit_log.view")) {
    return (
      <div className="mx-auto max-w-5xl">
        <EmptyState
          title="You don't have access to the audit log"
          description="Owners, admins, controllers and auditors can view it. Ask an owner if you need access."
        />
      </div>
    );
  }

  const supabase = (await createClient()) as any;
  const pageNumber = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const from = (pageNumber - 1) * PAGE_SIZE;

  const query = applyAuditCategory(
    supabase
      .from("audit_log")
      .select("id, actor_id, action, target_table, before, after, created_at", { count: "exact" })
      .eq("organization_id", membership.organizationId)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1),
    category
  );
  const { data, count } = await query;
  const rows: any[] = data ?? [];
  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const { data: rosterData } = await supabase.rpc("list_org_members", { p_org: membership.organizationId });
  const emailById = new Map<string, string>(((rosterData ?? []) as any[]).map((m) => [m.user_id, m.email]));

  const activeCategory = AUDIT_CATEGORIES.find((c) => c.value === category)?.value ?? "all";
  const linkFor = (p: number, c = activeCategory) => {
    const params = new URLSearchParams();
    if (c !== "all") params.set("category", c);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/settings/audit-log${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Audit log</h1>
          <p className="mt-1 text-sm text-ink-500">
            A permanent record of who did what. Entries can&apos;t be edited or deleted.
          </p>
        </div>
        {can(membership.role, "audit_log.export") && (
          <a
            href={`/api/audit-log/export${activeCategory !== "all" ? `?category=${activeCategory}` : ""}`}
            className="inline-flex h-9 items-center gap-2 rounded border border-ink-200 bg-white px-4 text-sm font-medium text-ink-800 hover:bg-ink-50"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </a>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {AUDIT_CATEGORIES.map((c) => (
          <Link
            key={c.value}
            href={linkFor(1, c.value)}
            className={
              c.value === activeCategory
                ? "rounded-full bg-accent-500 px-3 py-1 text-xs font-medium text-white"
                : "rounded-full border border-ink-200 bg-white px-3 py-1 text-xs font-medium text-ink-600 hover:bg-ink-50"
            }
          >
            {c.label}
          </Link>
        ))}
      </div>

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white shadow-subtle">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 bg-ink-50 text-left text-xs font-medium text-ink-500">
                <th className="px-5 py-2.5 font-medium">When</th>
                <th className="px-3 py-2.5 font-medium">Who</th>
                <th className="px-3 py-2.5 font-medium">Action</th>
                <th className="px-5 py-2.5 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((r) => (
                <tr key={r.id} className="align-top hover:bg-ink-50">
                  <td className="whitespace-nowrap px-5 py-3 text-ink-600">
                    {new Date(r.created_at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-3 py-3 text-ink-800">
                    {r.actor_id ? (emailById.get(r.actor_id) ?? "Former member") : "System"}
                  </td>
                  <td className="px-3 py-3 font-medium text-ink-900">{humanizeAction(r.action)}</td>
                  <td className="px-5 py-3 text-xs text-ink-500">{summarizeChange(r.before, r.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="No activity to show"
          description={activeCategory === "all" ? "Actions like confirming matches or finalizing periods will appear here." : "Nothing in this category yet."}
        />
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-600">
          <span>
            Page {pageNumber} of {pageCount} · {total.toLocaleString()} entries
          </span>
          <div className="flex gap-2">
            {pageNumber > 1 && (
              <Link href={linkFor(pageNumber - 1)} className="rounded border border-ink-200 bg-white px-3 py-1.5 hover:bg-ink-50">
                Previous
              </Link>
            )}
            {pageNumber < pageCount && (
              <Link href={linkFor(pageNumber + 1)} className="rounded border border-ink-200 bg-white px-3 py-1.5 hover:bg-ink-50">
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
