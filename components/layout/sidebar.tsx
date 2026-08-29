"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  GitMerge,
  ClipboardCheck,
  BookText,
  Building2,
  BarChart3,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { can, type Role, type Permission } from "@/lib/permissions";

const NAV: { href: string; label: string; icon: typeof LayoutDashboard; permission: Permission | null }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: null },
  { href: "/reconciliation", label: "Reconciliation", icon: GitMerge, permission: "reconciliation.view" },
  { href: "/close", label: "Close", icon: ClipboardCheck, permission: "close.manage_checklist" },
  { href: "/journal-entries", label: "Journal entries", icon: BookText, permission: "journal_entries.draft" },
  { href: "/entities", label: "Entities", icon: Building2, permission: "entities.manage" },
  { href: "/reports", label: "Reports", icon: BarChart3, permission: "reports.view" },
];

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const visible = NAV.filter((item) => !item.permission || can(role, item.permission));

  return (
    <aside className="flex h-full w-56 flex-col border-r border-ink-100 bg-white">
      <div className="flex h-14 items-center gap-2 border-b border-ink-100 px-4">
        <div className="h-5 w-5 rounded bg-accent-500" />
        <span className="font-semibold text-ink-900">Ledgerline</span>
      </div>

      <nav className="flex-1 space-y-0.5 p-3">
        {visible.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-accent-50 text-accent-700" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-ink-100 p-3">
        <Link
          href="/settings/organization"
          className={cn(
            "flex items-center gap-2.5 rounded px-3 py-2 text-sm font-medium transition-colors",
            pathname.startsWith("/settings") ? "bg-accent-50 text-accent-700" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900"
          )}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
        {role === "auditor" && (
          <Link
            href="/audit"
            className="flex items-center gap-2.5 rounded px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50 hover:text-ink-900"
          >
            <ShieldCheck className="h-4 w-4" />
            Audit view
          </Link>
        )}
      </div>
    </aside>
  );
}
