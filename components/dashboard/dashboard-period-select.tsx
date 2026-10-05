"use client";

import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";

/** Month picker for the home dashboard (?period=YYYY-MM). */
export function DashboardPeriodSelect({
  value,
  options,
}: {
  value: string;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  return (
    <label className="inline-flex items-center gap-2 rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-800">
      <CalendarDays className="h-4 w-4 text-ink-400" />
      <select
        value={value}
        aria-label="Dashboard month"
        onChange={(e) => router.push(`/dashboard?period=${e.target.value}`)}
        className="border-0 bg-transparent py-0 pl-0 pr-7 text-sm font-medium focus:outline-none focus:ring-0"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
