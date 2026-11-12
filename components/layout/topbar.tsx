"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { ChevronDown, LogOut, Settings, User } from "lucide-react";
import { logout } from "@/lib/actions/auth";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { GlobalSearch } from "@/components/layout/global-search";
import { NotificationBell } from "@/components/layout/notification-bell";

/** The bar across the top: who you are working for, search, notifications and your account. */
export function Topbar({ organizationName, email, role }: { organizationName: string; email: string; role: Role }) {
  const initial = (email.trim()[0] ?? "?").toUpperCase();

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-ink-100 bg-white px-6 print:hidden">
      <div className="flex min-w-0 shrink-0 items-center gap-2.5">
        <span className="truncate text-[15px] font-semibold text-ink-900">{organizationName}</span>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", role === "auditor" ? "bg-status-infoBg text-status-info" : "bg-accent-50 text-accent-700")}>{ROLE_LABELS[role]}</span>
      </div>

      <GlobalSearch className="mx-auto hidden w-full max-w-xl flex-1 md:block" />
      <div className="flex-1 md:hidden" />

      <div className="flex shrink-0 items-center gap-2">
        <NotificationBell />
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2.5 text-sm text-ink-700 hover:bg-ink-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-500 text-sm font-semibold text-white">{initial}</span>
            <span className="hidden max-w-[11rem] truncate font-medium text-ink-900 lg:block">{email}</span>
            <ChevronDown className="h-4 w-4 text-ink-400" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={8} className="z-50 min-w-[13rem] rounded-xl border border-ink-100 bg-white p-1.5 shadow-panel">
              <div className="border-b border-ink-100 px-3 py-2">
                <p className="truncate text-sm font-medium text-ink-900">{email}</p>
                <p className="text-xs text-ink-500">{ROLE_LABELS[role]}</p>
              </div>
              <DropdownMenu.Item asChild>
                <Link href="/settings/account" className="mt-1 flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 outline-none hover:bg-ink-50 data-[highlighted]:bg-ink-50">
                  <User className="h-4 w-4" />
                  My account
                </Link>
              </DropdownMenu.Item>
              <DropdownMenu.Item asChild>
                <Link href="/settings" className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 outline-none hover:bg-ink-50 data-[highlighted]:bg-ink-50">
                  <Settings className="h-4 w-4" />
                  Settings
                </Link>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => void logout()}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 outline-none hover:bg-ink-50 data-[highlighted]:bg-ink-50"
              >
                <LogOut className="h-4 w-4" />
                Log out
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}
