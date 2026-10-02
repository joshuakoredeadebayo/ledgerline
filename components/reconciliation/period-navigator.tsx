"use client";

import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, FastForward } from "lucide-react";
import { Button } from "@/components/ui/button";

/** "YYYY-MM" shifted by `delta` months. */
function shiftMonth(month: string, delta: number) {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(Date.UTC(year, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

function monthsBetween(start: string, end: string) {
  const months: string[] = [];
  for (let m = start; m <= end; m = shiftMonth(m, 1)) months.push(m);
  return months;
}

function labelOf(month: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-15T12:00:00.000Z`)
  );
}

/**
 * Month picker for the matching workspace. Always visible as a bordered
 * bar: Previous / Next buttons, a dropdown of every month in range (with
 * transaction counts so empty months are obvious), and a shortcut back to
 * the account's latest activity.
 */
export function PeriodNavigator({
  accountId,
  selectedMonth,
  currentMonth,
  activity,
}: {
  accountId: string;
  selectedMonth: string;
  currentMonth: string;
  /** "YYYY-MM" -> number of transactions on this account that month. */
  activity: Record<string, number>;
}) {
  const router = useRouter();
  const go = (month: string) => router.push(`/reconciliation/${accountId}?period=${month}`);

  const activityMonths = Object.keys(activity).sort();
  const earliestActivity = activityMonths[0];
  const latestActivity = activityMonths[activityMonths.length - 1];

  const rangeStart = [earliestActivity ?? currentMonth, selectedMonth].sort()[0] ?? selectedMonth;
  const rangeEnd = [latestActivity ?? currentMonth, currentMonth, selectedMonth].sort().slice(-1)[0] ?? selectedMonth;
  const options = monthsBetween(rangeStart, rangeEnd).reverse();

  const selectedCount = activity[selectedMonth] ?? 0;
  const canGoPrev = selectedMonth > rangeStart;
  const canGoNext = selectedMonth < rangeEnd;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-ink-100 bg-white px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-medium text-ink-700">
        <CalendarDays className="h-4 w-4 text-ink-400" />
        Period
      </div>

      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={!canGoPrev}
        onClick={() => go(shiftMonth(selectedMonth, -1))}
        aria-label="Previous month"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Previous
      </Button>

      <select
        value={selectedMonth}
        onChange={(e) => go(e.target.value)}
        aria-label="Select reconciliation month"
        className="h-8 min-w-[11rem] rounded border border-ink-200 bg-white px-3 text-sm font-medium text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
      >
        {options.map((m) => (
          <option key={m} value={m}>
            {labelOf(m)}
            {activity[m] ? ` — ${activity[m]} transaction${activity[m] === 1 ? "" : "s"}` : " — no activity"}
          </option>
        ))}
      </select>

      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={!canGoNext}
        onClick={() => go(shiftMonth(selectedMonth, 1))}
        aria-label="Next month"
      >
        Next
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>

      {latestActivity && latestActivity !== selectedMonth && (
        <Button type="button" size="sm" variant="ghost" onClick={() => go(latestActivity)}>
          <FastForward className="h-3.5 w-3.5" />
          Jump to latest activity
        </Button>
      )}

      <span className="ml-auto text-xs text-ink-500">
        {selectedCount > 0
          ? `${selectedCount} transaction${selectedCount === 1 ? "" : "s"} in ${labelOf(selectedMonth)}`
          : `No transactions in ${labelOf(selectedMonth)}`}
      </span>
    </div>
  );
}
