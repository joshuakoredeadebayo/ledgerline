import Link from "next/link";
import { Bell } from "lucide-react";
import { listNotifications } from "@/lib/actions/collaboration";
import { EmptyState } from "@/components/shared/empty-state";
import { NotificationList } from "@/components/layout/notification-list";

import { PageHero, HERO_BUTTON } from "@/components/layout/page-hero";
export default async function NotificationsPage() {
  const { unread, items } = await listNotifications(100);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHero
        title="Notifications"
        description={<>{unread > 0 ? `${unread} unread. ` : "Nothing unread. "}Choose which ones also reach your email under <Link href="/settings/account" className="font-semibold text-white underline decoration-white/50 underline-offset-2 hover:decoration-white">My account</Link>.</>}
      />
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
