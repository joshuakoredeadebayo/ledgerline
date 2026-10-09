"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Chooses which entity a new QuickBooks company will belong to, then starts the Intuit sign-in. */
export function ConnectQuickBooksForm({ options }: { options: { value: string; label: string }[] }) {
  const [value, setValue] = useState(options[0]?.value ?? "");
  if (options.length === 0) {
    return <p className="text-sm text-ink-500">Every entity already has a QuickBooks company connected.</p>;
  }

  const href = value === "__shared__" ? "/api/quickbooks/connect" : `/api/quickbooks/connect?entityId=${encodeURIComponent(value)}`;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
        Connect it for
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-9 min-w-[14rem] rounded border border-ink-200 bg-white py-0 pl-3 pr-8 text-sm font-normal text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <Button asChild>
        <a href={href}>Connect QuickBooks</a>
      </Button>
    </div>
  );
}
