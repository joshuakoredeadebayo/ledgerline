import { createClient } from "@/lib/supabase/server";

export interface OpenClosePeriod {
  id: string;
  period_start: string;
  period_end: string;
  status: string;
}

/**
 * The three "needs attention" numbers shown on both the home dashboard and
 * the Reconciliation hub, so the two pages can never disagree.
 */
export async function getAttentionCounts() {
  // Cast to `any`: some columns are newer than the generated Supabase types.
  const supabase = (await createClient()) as any;

  const [exceptionsRes, matchesRes, periodsRes] = await Promise.all([
    supabase.from("exceptions").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("matches").select("id", { count: "exact", head: true }).eq("status", "pending_review"),
    supabase
      .from("close_periods")
      .select("id, period_start, period_end, status")
      .in("status", ["open", "in_review"])
      .order("period_end", { ascending: false }),
  ]);

  const openPeriods: OpenClosePeriod[] = periodsRes.data ?? [];

  return {
    openExceptions: (exceptionsRes.count ?? 0) as number,
    pendingMatches: (matchesRes.count ?? 0) as number,
    openPeriods,
    latestOpenPeriod: openPeriods[0] ?? null,
  };
}

/** "2026-10-01" -> "October 2026" (UTC-safe). */
export function monthLabel(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${isoDate.slice(0, 7)}-15T12:00:00.000Z`)
  );
}
