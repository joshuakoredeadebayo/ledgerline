import { isEmailConfigured, sendEmail } from "@/lib/email";
import { notificationEmail } from "@/lib/email-templates";
import { getSiteUrl } from "@/lib/site-url";

export type NotificationType = "assigned" | "review_requested" | "review_approved" | "review_changes" | "mention" | "reminder" | "system";
type EmailKind = "assignments" | "reviews" | "mentions" | "reminders";

const EMAIL_KIND: Record<NotificationType, EmailKind | null> = {
  assigned: "assignments",
  review_requested: "reviews",
  review_approved: "reviews",
  review_changes: "reviews",
  mention: "mentions",
  reminder: "reminders",
  system: null,
};

export interface NotifyInput {
  organizationId: string;
  organizationName: string;
  actorId: string | null;
  recipientIds: string[];
  type: NotificationType;
  title: string;
  body?: string | null;
  /** A path inside the app, such as /reconciliation/…; turned into a full link for emails. */
  linkPath: string;
  dedupeKey?: string;
}

/**
 * Tells people about something: an item in their in-app inbox, and, when email is set up and they
 * haven't turned it off, an email as well. Never notifies the person who caused the event, never
 * throws (a failed notification must not undo the real work), and with a dedupe key raises each
 * reminder once per person.
 */
export async function notify(supabase: any, input: NotifyInput): Promise<void> {
  try {
    const recipients = [...new Set(input.recipientIds)].filter((id) => id && id !== input.actorId);
    if (recipients.length === 0) return;

    const rows = recipients.map((userId) => ({
      organization_id: input.organizationId,
      user_id: userId,
      type: input.type,
      title: input.title.slice(0, 200),
      body: input.body?.slice(0, 500) ?? null,
      link_url: input.linkPath,
      dedupe_key: input.dedupeKey ?? null,
      created_by: input.actorId,
    }));

    const { data: inserted, error } = await supabase
      .from("notifications")
      .upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true })
      .select("user_id");
    if (error) {
      console.error("[notify] could not save notifications:", error.message);
      return;
    }

    const kind = EMAIL_KIND[input.type];
    if (!kind || !isEmailConfigured()) return;

    // Only people whose notification was newly created get an email, so reminders don't repeat daily.
    const newlyNotified = new Set(((inserted ?? []) as { user_id: string }[]).map((r) => r.user_id));
    if (newlyNotified.size === 0) return;

    const { data: prefs } = await supabase
      .from("notification_preferences")
      .select("user_id, email_assignments, email_reviews, email_mentions, email_reminders")
      .in("user_id", [...newlyNotified]);
    const optedOut = new Set<string>();
    for (const p of (prefs ?? []) as any[]) if (p[`email_${kind}`] === false) optedOut.add(p.user_id);

    const { data: roster } = await supabase.rpc("list_org_members", { p_org: input.organizationId });
    const emailById = new Map<string, string>(((roster ?? []) as any[]).map((m) => [m.user_id, m.email]));

    const link = `${await getSiteUrl()}${input.linkPath}`;
    const message = notificationEmail({ title: input.title, body: input.body, link, organizationName: input.organizationName });
    for (const userId of newlyNotified) {
      const to = emailById.get(userId);
      if (!to || optedOut.has(userId)) continue;
      await sendEmail({ to, ...message });
    }
  } catch (err) {
    console.error("[notify] failed:", err);
  }
}
