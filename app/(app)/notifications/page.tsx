import Link from "next/link";
import { Bell } from "lucide-react";
import { listNotifications } from "@/lib/actions/collaboration";
import { EmptyState } from "@/components/shared/empty-state";
import { NotificationList } from "@/components/layout/notification-list";

export default async function NotificationsPage() {
  const { unread, items } = await listNotifications(100);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Notifications</h1>
          <p className="mt-1 text-sm text-ink-500">
            {unread > 0 ? `${unread} unread. ` : "Nothing unread. "}
            Choose which ones also reach your email under{" "}
            <Link href="/settings/account" className="font-medium text-accent-600 hover:text-accent-700">
              My account
            </Link>
            .
          </p>
        </div>
      </div>
      {items.length > 0 ? (
        <NotificationList items={items} hasUnread={unread > 0} />
      ) : (
        <EmptyState
          icon={<Bell className="h-8 w-8" />}
          title="No notifications yet"
          description="You'll see assignments, review requests, mentions and reminders here."
        />
      )}
    </div>
  );
}
