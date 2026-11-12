"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, GitMerge, ClipboardCheck, BookText, Building2, BarChart3, Settings, ShieldCheck, Repeat, LogOut } from "lucide-react";
import { logout } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";
import { can, type Role, type Permission } from "@/lib/permissions";
import { BrandLogo } from "@/components/layout/brand-logo";

const NAV: { href: string; label: string; icon: typeof LayoutDashboard; permission: Permission | null }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: null },
  { href: "/reconciliation", label: "Reconciliation", icon: GitMerge, permission: "reconciliation.view" },
  { href: "/close", label: "Close", icon: ClipboardCheck, permission: "close.manage_checklist" },
  { href: "/journal-entries", label: "Journal entries", icon: BookText, permission: "journal_entries.draft" },
  { href: "/recurring", label: "Recurring", icon: Repeat, permission: "journal_entries.draft" },
  { href: "/entities", label: "Entities", icon: Building2, permission: "entities.manage" },
  { href: "/reports", label: "Reports", icon: BarChart3, permission: "reports.view" },
];

const itemClass = (active: boolean) =>
  cn(
    "flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-[15px] font-medium transition-colors",
    active ? "bg-accent-500 text-white shadow-lg shadow-black/25" : "text-white/80 hover:bg-white/10 hover:text-white"
  );

/** The dark navigation rail down the left of every page, with a soft curve of brand blue at the bottom. */
export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const visible = NAV.filter((item) => !item.permission || can(role, item.permission));

  return (
    <aside className="relative flex h-full w-60 shrink-0 flex-col overflow-hidden bg-gradient-to-b from-navy-900 via-navy-950 to-navy-950 print:hidden">
      <svg aria-hidden viewBox="0 0 240 420" preserveAspectRatio="none" className="pointer-events-none absolute bottom-0 left-0 h-[58%] w-full">
        <path d="M0 170 C 60 180, 160 250, 240 340 L240 420 L0 420 Z" fill="#100DED" opacity="0.85" />
        <path d="M0 250 C 70 262, 150 318, 240 388 L240 420 L0 420 Z" fill="#02007C" opacity="0.75" />
      </svg>

      <div className="relative z-10 px-5 pb-3 pt-6">
        <Link href="/dashboard" aria-label="Ledgerline home">
          <BrandLogo className="h-9 w-auto" />
        </Link>
      </div>

      <nav aria-label="Main" className="relative z-10 flex-1 space-y-1.5 px-3 pt-5">
        {visible.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} aria-current={pathname.startsWith(href) ? "page" : undefined} className={itemClass(pathname.startsWith(href))}>
            <Icon className="h-5 w-5" strokeWidth={1.9} />
            {label}
          </Link>
        ))}
      </nav>

      <div className="relative z-10 space-y-1.5 px-3 pb-5">
        {role === "auditor" && (
          <Link href="/settings/audit-log" className={itemClass(pathname.startsWith("/settings/audit-log"))}>
            <ShieldCheck className="h-5 w-5" strokeWidth={1.9} />
            Audit view
          </Link>
        )}
        <Link href="/settings" aria-current={pathname.startsWith("/settings") ? "page" : undefined} className={itemClass(pathname.startsWith("/settings") && !pathname.startsWith("/settings/audit-log"))}>
          <Settings className="h-5 w-5" strokeWidth={1.9} />
          Settings
        </Link>
        <button type="button" onClick={() => void logout()} className={itemClass(false)}>
          <LogOut className="h-5 w-5" strokeWidth={1.9} />
          Log Out
        </button>
      </div>
    </aside>
  );
}
