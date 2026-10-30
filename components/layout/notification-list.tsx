"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { markAllNotificationsRead, markNotificationRead, type NotificationItem } from "@/lib/actions/collaboration";
import { timeAgo } from "@/lib/time-ago";
import { Button } from "@/components/ui/button";

const TYPE_LABEL: Record<string, string> = {
  assigned: "Assigned to you",
  review_requested: "Review requested",
  review_approved: "Approved",
  review_changes: "Changes requested",
  mention: "Mention",
  reminder: "Reminder",
  system: "Update",
};

export function NotificationList({ items: initial, hasUnread }: { items: NotificationItem[]; hasUnread: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [anyUnread, setAnyUnread] = useState(hasUnread);

  return (
    <div className="space-y-3">
      {anyUnread && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              setItems((prev) => prev.map((n) => ({ ...n, read: true })));
              setAnyUnread(false);
              await markAllNotificationsRead();
              router.refresh();
            }}
          >
            Mark all as read
          </Button>
        </div>
      )}
      <ul className="divide-y divide-ink-100 overflow-hidden rounded-xl border border-ink-100 bg-white shadow-subtle">
        {items.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={async () => {
                if (!n.read) {
                  setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
                  await markNotificationRead(n.id);
                }
                if (n.linkUrl) router.push(n.linkUrl);
              }}
              className="flex w-full items-start gap-3 px-5 py-4 text-left hover:bg-ink-50"
            >
              <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-accent-500"}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium uppercase tracking-wide text-ink-400">{TYPE_LABEL[n.type] ?? "Update"}</span>
                <span className={`mt-0.5 block text-sm ${n.read ? "text-ink-700" : "font-medium text-ink-900"}`}>{n.title}</span>
                {n.body && <span className="mt-0.5 block text-sm text-ink-500">{n.body}</span>}
              </span>
              <span className="shrink-0 text-xs text-ink-400">{timeAgo(n.createdAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
