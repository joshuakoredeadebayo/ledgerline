import { getCurrentMembership } from "@/lib/actions/membership";
import { createClient } from "@/lib/supabase/server";
import { getAttentionCounts, monthLabel } from "@/lib/attention-counts";
import { formatCurrency } from "@/lib/utils";
import { DashboardView, type DashboardViewModel } from "@/components/dashboard/dashboard-view";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Same convention as the matching workspace: plaid = bank, quickbooks = ledger,
// manual entries carry their side in raw_payload.
function sideOf(t: { source: string; raw_payload?: any }): "bank" | "ledger" {
  if (t.source === "plaid") return "bank";
  if (t.source === "manual" && (t.raw_payload?.side === "bank" || t.raw_payload?.side === "ledger")) {
    return t.raw_payload.side;
  }
  return "ledger";
}

/** "2026-10-01" -> "Oct 2026" (compact form for headline cards). */
function shortMonth(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${isoDate.slice(0, 7)}-15T12:00:00.000Z`)
  );
}

function daysUntil(isoDate: string) {
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  const d = Number(isoDate.slice(8, 10));
  return Math.round((Date.UTC(y, m - 1, d) - todayUtc) / 86_400_000);
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period } = await searchParams;
  const membership = await getCurrentMembership();
  // Cast to `any`: some columns are newer than the generated Supabase types.
  const supabase = (await createClient()) as any;

  // ── Which month are we looking at? ───────────────────────────────
  // Newest transaction dates first; the months present drive both the
  // picker and the default (the latest month with activity, so the page
  // never opens on an empty current month).
  const { data: dateRows } = await supabase
    .from("transactions")
    .select("transaction_date")
    .order("transaction_date", { ascending: false })
    .limit(1000);

  const monthsWithData: string[] = [];
  for (const r of dateRows ?? []) {
    const m = String(r.transaction_date).slice(0, 7);
    if (!monthsWithData.includes(m)) monthsWithData.push(m);
  }

  // Default to the newest month with real bank (Plaid) activity rather than the
  // newest month with *any* transaction — a month holding only hand-typed test
  // entries has nothing for the cash-flow chart to draw.
  const { data: latestBankRow } = await supabase
    .from("transactions")
    .select("transaction_date")
    .eq("source", "plaid")
    .order("transaction_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestBankMonthValue: string | null = latestBankRow?.transaction_date ? String(latestBankRow.transaction_date).slice(0, 7) : null;

  const month = MONTH_RE.test(period ?? "")
    ? (period as string)
    : (latestBankMonthValue ?? monthsWithData[0] ?? new Date().toISOString().slice(0, 7));
  const pickerMonths = monthsWithData.includes(month) ? monthsWithData : [month, ...monthsWithData];

  const yy = Number(month.slice(0, 4));
  const mm = Number(month.slice(5, 7));
  const periodStart = `${month}-01`;
  const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const periodEnd = `${month}-${String(lastDay).padStart(2, "0")}`;

  // ── Data ─────────────────────────────────────────────────────────
  const counts = await getAttentionCounts();

  const { data: txnRows } = await supabase
    .from("transactions")
    .select("id, amount, currency, transaction_date, description, status, source, raw_payload, account_id, accounts(name)")
    .gte("transaction_date", periodStart)
    .lte("transaction_date", periodEnd)
    .order("transaction_date", { ascending: false })
    .limit(5000);
  const txns: any[] = txnRows ?? [];

  const { count: periodExceptions } = await supabase
    .from("exceptions")
    .select("id, transactions!inner(transaction_date)", { count: "exact", head: true })
    .eq("status", "open")
    .gte("transactions.transaction_date", periodStart)
    .lte("transactions.transaction_date", periodEnd);

  const { count: confirmedMatches } = await supabase
    .from("matches")
    .select("id", { count: "exact", head: true })
    .eq("status", "confirmed");

  const { count: allExceptions } = await supabase.from("exceptions").select("id", { count: "exact", head: true });

  const { data: periodRecons } = await supabase
    .from("reconciliations")
    .select("status")
    .eq("period_start", periodStart);

  // Close checklist for the newest open close period.
  const latest = counts.latestOpenPeriod;
  const { data: checklistRows } = latest
    ? await supabase.from("close_checklist_items").select("status").eq("close_period_id", latest.id)
    : { data: [] };
  const checklistTotal = (checklistRows ?? []).length;
  const checklistDone = (checklistRows ?? []).filter((i: any) => i.status === "complete").length;

  const { data: dueItems } = await supabase
    .from("close_checklist_items")
    .select("title, description, due_date, close_periods(entities(name))")
    .not("due_date", "is", null)
    .neq("status", "complete")
    .order("due_date", { ascending: true })
    .limit(4);

  // ── Derived numbers ──────────────────────────────────────────────
  // Totals are plain sums with no currency conversion, so they are shown in
  // the month's dominant currency and anything else is flagged, not mixed in.
  const currencyCounts = new Map<string, number>();
  for (const t of txns) currencyCounts.set(t.currency, (currencyCounts.get(t.currency) ?? 0) + 1);
  const currency = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";
  const otherCurrencyCount = txns.filter((t) => t.currency !== currency).length;
  const money = txns.filter((t) => t.currency === currency);

  const bankNet = money.filter((t) => sideOf(t) === "bank").reduce((s, t) => s + Number(t.amount), 0);
  const ledgerNet = money.filter((t) => sideOf(t) === "ledger").reduce((s, t) => s + Number(t.amount), 0);
  const difference = Math.round((ledgerNet - bankNet) * 100) / 100;

  // Positive = money out, negative = money in (bank side only).
  const daily = Array.from({ length: lastDay }, () => ({ out: 0, in: 0 }));
  let totalIn = 0;
  let totalOut = 0;
  for (const t of money) {
    if (sideOf(t) !== "bank") continue;
    const bucket = daily[Number(String(t.transaction_date).slice(8, 10)) - 1];
    if (!bucket) continue;
    const amt = Number(t.amount);
    if (amt >= 0) {
      bucket.out += amt;
      totalOut += amt;
    } else {
      bucket.in += -amt;
      totalIn += -amt;
    }
  }

  const matchedCount = txns.filter((t) => t.status === "matched").length;
  const unmatchedTotal = txns.filter((t) => t.status === "unmatched").length;
  const exceptionCount = Math.min(periodExceptions ?? 0, unmatchedTotal);
  const plainUnmatched = Math.max(0, unmatchedTotal - exceptionCount);
  const reconcilable = matchedCount + unmatchedTotal;
  const progressPct = reconcilable === 0 ? 0 : Math.round((matchedCount / reconcilable) * 100);

  const reconsDone = (periodRecons ?? []).filter((r: any) => r.status === "reconciled" || r.status === "finalized").length;
  const reconsTotal = (periodRecons ?? []).length;
  const pendingTotal = counts.pendingMatches + (confirmedMatches ?? 0);
  const resolvedExceptions = Math.max(0, (allExceptions ?? 0) - counts.openExceptions);

  // Deadlines: open close periods' end dates plus any dated checklist tasks.
  type Deadline = { date: string; title: string; subtitle: string };
  const deadlines: Deadline[] = [
    ...counts.openPeriods.slice(0, 2).map((p) => ({
      date: p.period_end,
      title: "Month-end close",
      subtitle: `Complete the ${monthLabel(p.period_start)} close checklist`,
    })),
    ...(dueItems ?? []).map((i: any) => ({
      date: i.due_date as string,
      title: i.title as string,
      subtitle: (i.close_periods?.entities?.name as string | undefined) ?? (i.description as string | undefined) ?? "Close task",
    })),
  ]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 4);

  const hasAnyData = txns.length > 0 || counts.openExceptions > 0 || counts.pendingMatches > 0 || counts.openPeriods.length > 0;
  const { count: accountCount } = await supabase.from("accounts").select("id", { count: "exact", head: true });
  const hasAccount = (accountCount ?? 0) > 0;

  const recent = txns.slice(0, 5);

  const vm: DashboardViewModel = {
    userName: membership?.email.split("@")[0] ?? "",
    orgName: membership?.organizationName ?? "",
    month,
    monthLabel: monthLabel(periodStart),
    monthOptions: pickerMonths.map((m) => ({ value: m, label: monthLabel(`${m}-01`) })),
    openExceptions: counts.openExceptions,
    pendingMatches: counts.pendingMatches,
    closePeriod: latest
      ? { label: shortMonth(latest.period_start), statusLabel: latest.status === "in_review" ? "In review" : "Open" }
      : null,
    checklistDone,
    checklistTotal,
    currency,
    otherCurrencyCount,
    bankNet,
    ledgerNet,
    difference,
    daily,
    totalIn,
    totalOut,
    matchedCount,
    exceptionCount,
    plainUnmatched,
    unmatchedTotal,
    reconcilable,
    progressPct,
    recent: recent.map((t) => ({
      id: t.id,
      dateLabel: new Date(`${t.transaction_date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      description: t.description ?? "—",
      account: t.accounts?.name ?? "—",
      amount: formatCurrency(Number(t.amount), t.currency),
      statusLabel: t.status === "matched" ? "Matched" : t.status === "unmatched" ? "Unmatched" : "Excluded",
      status: t.status === "matched" ? "matched" : t.status === "unmatched" ? "pending" : "neutral",
      href: `/reconciliation/${t.account_id}?period=${String(t.transaction_date).slice(0, 7)}`,
    })),
    deadlines: deadlines.map((d) => {
      const days = daysUntil(d.date);
      const dt = new Date(`${d.date.slice(0, 10)}T12:00:00Z`);
      return {
        month: dt.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
        day: dt.getUTCDate(),
        title: d.title,
        subtitle: d.subtitle,
        overdue: days < 0,
        dueLabel:
          days < 0
            ? `Overdue by ${-days} day${days === -1 ? "" : "s"}`
            : days === 0
              ? "Due today"
              : `Due in ${days} day${days === 1 ? "" : "s"}`,
      };
    }),
    health: [
      { label: "Bank reconciliation", done: reconsDone, total: reconsTotal },
      { label: "Matches reviewed", done: confirmedMatches ?? 0, total: pendingTotal },
      { label: "Exceptions resolved", done: resolvedExceptions, total: allExceptions ?? 0 },
      { label: "Close checklist", done: checklistDone, total: checklistTotal },
    ],
    latestBankMonth: latestBankMonthValue ? { value: latestBankMonthValue, label: monthLabel(`${latestBankMonthValue}-01`) } : null,
    hasAnyData,
    hasAccount,
  };

  return <DashboardView vm={vm} />;
}
