"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, LogOut, User } from "lucide-react";
import { logout } from "@/lib/actions/auth";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export function Topbar({
  organizationName,
  email,
  role,
}: {
  organizationName: string;
  email: string;
  role: Role;
}) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-ink-100 bg-white px-6">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-ink-900">{organizationName}</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            role === "auditor" ? "bg-status-infoBg text-status-info" : "bg-ink-100 text-ink-600"
          )}
        >
          {ROLE_LABELS[role]}
        </span>
      </div>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-ink-600 hover:bg-ink-50">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-200 text-ink-600">
            <User className="h-3.5 w-3.5" />
          </div>
          {email}
          <ChevronDown className="h-3.5 w-3.5 text-ink-400" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="min-w-[10rem] rounded-md border border-ink-100 bg-white p-1 shadow-panel"
          >
            <DropdownMenu.Item
              onSelect={() => logout()}
              className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-sm text-ink-700 outline-none hover:bg-ink-50"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </header>
  );
}
