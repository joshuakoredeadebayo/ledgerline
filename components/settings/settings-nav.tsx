"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Tab bar shared by every page under /settings. */
export function SettingsNav({ showAuditLog }: { showAuditLog: boolean }) {
  const pathname = usePathname();
  const tabs = [
    { href: "/settings/organization", label: "Organization" },
    { href: "/settings/members", label: "Members" },
    { href: "/settings/integrations", label: "Integrations" },
    ...(showAuditLog ? [{ href: "/settings/audit-log", label: "Audit log" }] : []),
  ];

  return (
    <nav aria-label="Settings" className="mx-auto mb-6 flex max-w-5xl gap-1 border-b border-ink-100">
      {tabs.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              active ? "border-accent-500 text-accent-700" : "border-transparent text-ink-500 hover:text-ink-900"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
