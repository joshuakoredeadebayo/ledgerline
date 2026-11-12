import Link from "next/link";
import { Building2, BookText, Landmark, Receipt, Repeat, SearchX } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { formatCurrency } from "@/lib/utils";
import { likePattern } from "@/lib/search";
import { PageHero } from "@/components/layout/page-hero";
import { EmptyState } from "@/components/shared/empty-state";

const LIMIT = 8;

const fmtDate = (iso: string) => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function Group({ title, icon, count, children }: { title: string; icon: React.ReactNode; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <section className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-subtle">
      <div className="flex items-center gap-2.5 border-b border-ink-100 px-5 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-50 text-accent-600">{icon}</span>
        <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>
        <span className="text-sm text-ink-500">{count >= LIMIT ? `first ${LIMIT}` : count}</span>
      </div>
      <ul className="divide-y divide-ink-100">{children}</ul>
    </section>
  );
}

const Row = ({ href, title, sub, right }: { href: string; title: string; sub?: string; right?: string }) => (
  <li>
    <Link href={href} className="flex items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-ink-50">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-ink-900">{title}</span>
        {sub && <span className="block truncate text-xs text-ink-500">{sub}</span>}
      </span>
      {right && <span className="shrink-0 text-sm tabular-nums text-ink-700">{right}</span>}
    </Link>
  </li>
);

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const term = (q ?? "").trim().slice(0, 80);
  const membership = await getCurrentMembership();
  if (!membership) return null;

  const hero = <PageHero title="Search" description={term.length >= 2 ? <>Results for “{term}”.</> : "Type at least two characters in the box at the top, or press / to jump to it."} />;
  if (term.length < 2) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        {hero}
        <EmptyState icon={<SearchX className="h-8 w-8" />} title="Search your books" description="Find accounts, entities, transactions, journal entries and recurring entries." />
      </div>
    );
  }

  const supabase = (await createClient()) as any;
  const pattern = likePattern(term);

  const [entities, accountsByName, accountsByCode, entries, transactions, recurring] = await Promise.all([
    supabase.from("entities").select("id, name, currency").ilike("name", pattern).is("archived_at", null).limit(LIMIT),
    supabase.from("accounts").select("id, name, code, entities!entity_id(name)").ilike("name", pattern).is("archived_at", null).limit(LIMIT),
    supabase.from("accounts").select("id, name, code, entities!entity_id(name)").ilike("code", pattern).is("archived_at", null).limit(LIMIT),
    supabase.from("journal_entries").select("id, entry_date, description, status, entities(name)").ilike("description", pattern).order("entry_date", { ascending: false }).limit(LIMIT),
    supabase.from("transactions").select("id, amount, currency, transaction_date, description, account_id, accounts(name)").ilike("description", pattern).order("transaction_date", { ascending: false }).limit(LIMIT),
    supabase.from("recurring_templates").select("id, name, status, entities(name)").ilike("name", pattern).limit(LIMIT),
  ]);

  const accountRows = [...(accountsByName.data ?? []), ...(accountsByCode.data ?? [])].filter((a: any, i: number, all: any[]) => all.findIndex((x) => x.id === a.id) === i).slice(0, LIMIT);
  const e: any[] = entities.data ?? [];
  const j: any[] = entries.data ?? [];
  const t: any[] = transactions.data ?? [];
  const r: any[] = recurring.data ?? [];
  const total = e.length + accountRows.length + j.length + t.length + r.length;
  const failed = [entities, accountsByName, entries, transactions].find((x) => x.error)?.error;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {hero}
      {failed && (
        <p role="alert" className="rounded-lg border border-status-exception/20 bg-status-exceptionBg px-4 py-3 text-sm text-status-exception">
          Part of the search couldn&apos;t run: {failed.message}
        </p>
      )}
      {total === 0 && !failed && <EmptyState icon={<SearchX className="h-8 w-8" />} title={`Nothing found for “${term}”`} description="Try a shorter word, or part of a name, description or account code." />}

      <Group title="Entities" icon={<Building2 className="h-4 w-4" />} count={e.length}>
        {e.map((x) => (
          <Row key={x.id} href={`/entities/${x.id}`} title={x.name} sub={x.currency} />
        ))}
      </Group>
      <Group title="Accounts" icon={<Landmark className="h-4 w-4" />} count={accountRows.length}>
        {accountRows.map((x: any) => (
          <Row key={x.id} href={`/reconciliation/${x.id}`} title={`${x.code ? `${x.code} · ` : ""}${x.name}`} sub={x.entities?.name} />
        ))}
      </Group>
      <Group title="Transactions" icon={<Receipt className="h-4 w-4" />} count={t.length}>
        {t.map((x) => (
          <Row
            key={x.id}
            href={`/reconciliation/${x.account_id}?period=${String(x.transaction_date).slice(0, 7)}`}
            title={x.description ?? "Transaction"}
            sub={`${x.accounts?.name ?? "Account"} · ${fmtDate(x.transaction_date)}`}
            right={formatCurrency(Number(x.amount), x.currency)}
          />
        ))}
      </Group>
      <Group title="Journal entries" icon={<BookText className="h-4 w-4" />} count={j.length}>
        {j.map((x) => (
          <Row key={x.id} href={`/journal-entries/${x.id}`} title={x.description ?? "Journal entry"} sub={`${x.entities?.name ?? ""} · ${fmtDate(x.entry_date)} · ${x.status}`} />
        ))}
      </Group>
      <Group title="Recurring entries" icon={<Repeat className="h-4 w-4" />} count={r.length}>
        {r.map((x) => (
          <Row key={x.id} href={`/recurring/${x.id}`} title={x.name} sub={`${x.entities?.name ?? ""} · ${x.status}`} />
        ))}
      </Group>
    </div>
  );
}
