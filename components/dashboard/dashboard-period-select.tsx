"use client";

import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";

/** Month picker for the home dashboard (?period=YYYY-MM). */
export function DashboardPeriodSelect({
  value,
  options,
  onDark = false,
}: {
  value: string;
  options: { value: string; label: string }[];
  /** Style it for the blue banner. */
  onDark?: boolean;
}) {
  const router = useRouter();
  return (
    <label className={onDark ? "inline-flex items-center gap-2 rounded-lg border border-white/30 bg-white/10 px-3.5 py-2.5 text-sm text-white" : "inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800 shadow-subtle"}>
      <CalendarDays className={onDark ? "h-4 w-4 text-white/80" : "h-4 w-4 text-ink-400"} />
      <select
        value={value}
        aria-label="Dashboard month"
        onChange={(e) => router.push(`/dashboard?period=${e.target.value}`)}
        className="border-0 bg-transparent py-0 pl-0 pr-7 text-sm font-medium focus:outline-none focus:ring-0"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="text-ink-900">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
