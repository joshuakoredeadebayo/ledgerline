"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Bell } from "lucide-react";
import { listNotifications, markAllNotificationsRead, markNotificationRead, type NotificationItem } from "@/lib/actions/collaboration";
import { timeAgo } from "@/lib/time-ago";

/** The bell in the top bar: a count of unread notifications and the latest few. Refreshes every minute. */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await listNotifications(8);
      setUnread(res.unread);
      setItems(res.items);
    } catch {
      // A failed refresh just leaves the last known list in place.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const openItem = async (n: NotificationItem) => {
    setOpen(false);
    if (!n.read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((c) => Math.max(0, c - 1));
      await markNotificationRead(n.id);
    }
    if (n.linkUrl) router.push(n.linkUrl);
  };

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink-600 hover:bg-ink-50 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
        >
          <Bell className="h-[18px] w-[18px]" />
          {unread > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-semibold leading-none text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-lg border border-ink-100 bg-white shadow-panel"
        >
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-ink-900">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={async () => {
                  setItems((prev) => prev.map((x) => ({ ...x, read: true })));
                  setUnread(0);
                  await markAllNotificationsRead();
                }}
                className="text-xs font-medium text-accent-600 hover:text-accent-700"
              >
                Mark all as read
              </button>
            )}
          </div>
          <div className="max-h-[22rem] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-500">You&apos;re all caught up.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {items.map((n) => (
                  <li key={n.id}>
                    <button type="button" onClick={() => void openItem(n)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-ink-50">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-accent-500"}`} />
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm ${n.read ? "text-ink-700" : "font-medium text-ink-900"}`}>{n.title}</span>
                        {n.body && <span className="mt-0.5 block truncate text-xs text-ink-500">{n.body}</span>}
                        <span className="mt-0.5 block text-xs text-ink-400">{timeAgo(n.createdAt)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-ink-100 px-4 py-2.5 text-center">
            <Link href="/notifications" onClick={() => setOpen(false)} className="text-xs font-medium text-accent-600 hover:text-accent-700">
              See all notifications
            </Link>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
