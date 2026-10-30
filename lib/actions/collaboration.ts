"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { assertPermission, can, type Role } from "@/lib/permissions";
import { notify } from "@/lib/notifications";

type Membership = NonNullable<Awaited<ReturnType<typeof getCurrentMembership>>>;

async function roster(supabase: any, organizationId: string) {
  const { data } = await supabase.rpc("list_org_members", { p_org: organizationId });
  return ((data ?? []) as { user_id: string; email: string; role: Role; joined_at: string | null }[]).filter((m) => m.joined_at);
}

const shortName = (email: string) => email.split("@")[0] ?? email;

// ────────────────────────────────────────────────────────────────
// Notifications
// ────────────────────────────────────────────────────────────────

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  createdAt: string;
  read: boolean;
}

export async function listNotifications(limit = 10): Promise<{ unread: number; items: NotificationItem[] }> {
  const membership = await getCurrentMembership();
  if (!membership) return { unread: 0, items: [] };
  const supabase = (await createClient()) as any;

  const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", membership.userId).is("read_at", null);
  const { data } = await supabase
    .from("notifications")
    .select("id, type, title, body, link_url, created_at, read_at")
    .eq("user_id", membership.userId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));

  return {
    unread: count ?? 0,
    items: ((data ?? []) as any[]).map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      linkUrl: n.link_url,
      createdAt: n.created_at,
      read: !!n.read_at,
    })),
  };
}

export async function markNotificationRead(id: string): Promise<void> {
  const membership = await getCurrentMembership();
  if (!membership) return;
  const supabase = (await createClient()) as any;
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).eq("user_id", membership.userId).is("read_at", null);
}

export async function markAllNotificationsRead(): Promise<void> {
  const membership = await getCurrentMembership();
  if (!membership) return;
  const supabase = (await createClient()) as any;
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", membership.userId).is("read_at", null);
  revalidatePath("/notifications");
}

export interface NotificationPrefs {
  emailAssignments: boolean;
  emailReviews: boolean;
  emailMentions: boolean;
  emailReminders: boolean;
}

export async function saveNotificationPreferences(prefs: NotificationPrefs): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  const supabase = (await createClient()) as any;
  const { error } = await supabase.from("notification_preferences").upsert(
    {
      user_id: membership.userId,
      email_assignments: !!prefs.emailAssignments,
      email_reviews: !!prefs.emailReviews,
      email_mentions: !!prefs.emailMentions,
      email_reminders: !!prefs.emailReminders,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) return { error: error.message };
  revalidatePath("/settings/account");
  return {};
}

// ────────────────────────────────────────────────────────────────
// Comments
// ────────────────────────────────────────────────────────────────

export type CommentTarget = "reconciliation" | "exception" | "journal_entry";

export interface CommentItem {
  id: string;
  body: string;
  createdAt: string;
  authorEmail: string;
  mine: boolean;
}

/** What a comment attaches to: where it links back to, a label for the notification, and who is already involved. */
async function describeTarget(supabase: any, type: CommentTarget, id: string): Promise<{ linkPath: string; label: string; interested: (string | null)[] } | null> {
  if (type === "reconciliation") {
    const { data } = await supabase
      .from("reconciliations")
      .select("id, account_id, period_start, submitted_by, reviewer_id, accounts(name)")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    return {
      linkPath: `/reconciliation/${data.account_id}?period=${String(data.period_start).slice(0, 7)}`,
      label: `${data.accounts?.name ?? "an account"} for ${String(data.period_start).slice(0, 7)}`,
      interested: [data.submitted_by, data.reviewer_id],
    };
  }
  if (type === "exception") {
    const { data } = await supabase.from("exceptions").select("id, assigned_to, transactions(description)").eq("id", id).maybeSingle();
    if (!data) return null;
    return { linkPath: "/reconciliation/exceptions", label: `the exception "${data.transactions?.description ?? "transaction"}"`, interested: [data.assigned_to] };
  }
  const { data } = await supabase.from("journal_entries").select("id, description, created_by").eq("id", id).maybeSingle();
  if (!data) return null;
  return { linkPath: `/journal-entries/${id}`, label: `the journal entry "${data.description ?? "entry"}"`, interested: [data.created_by] };
}

export async function listComments(type: CommentTarget, id: string): Promise<CommentItem[]> {
  const membership = await getCurrentMembership();
  if (!membership) return [];
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("comments")
    .select("id, body, created_at, author_id")
    .eq("target_type", type)
    .eq("target_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(200);
  const people = new Map((await roster(supabase, membership.organizationId)).map((m) => [m.user_id, m.email]));
  return ((data ?? []) as any[]).map((c) => ({
    id: c.id,
    body: c.body,
    createdAt: c.created_at,
    authorEmail: people.get(c.author_id) ?? "Former member",
    mine: c.author_id === membership.userId,
  }));
}

/** Posts a comment. Anyone named with @ (for example @ada for ada@company.com) is notified. */
export async function addComment(type: CommentTarget, id: string, body: string): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  // Everyone who can see the item can discuss it, except read-only auditors.
  assertPermission(membership.role, "reconciliation.view");

  const text = body.trim();
  if (!text) return { error: "Write a comment first." };
  if (text.length > 2000) return { error: "Keep comments under 2,000 characters." };

  const supabase = (await createClient()) as any;
  const target = await describeTarget(supabase, type, id);
  if (!target) return { error: "That item wasn't found." };

  const { error } = await supabase.from("comments").insert({
    organization_id: membership.organizationId,
    target_type: type,
    target_id: id,
    body: text,
    author_id: membership.userId,
  });
  if (error) return { error: error.message };

  const people = await roster(supabase, membership.organizationId);
  const mentioned = new Set<string>();
  for (const [, token] of text.matchAll(/@([A-Za-z0-9._-]+)/g)) {
    const t = (token ?? "").toLowerCase().replace(/[.,;:]+$/, "");
    for (const m of people) if (m.email.toLowerCase() === t || shortName(m.email).toLowerCase() === t) mentioned.add(m.user_id);
  }

  const author = shortName(membership.email);
  const excerpt = text.length > 160 ? `${text.slice(0, 157)}…` : text;
  if (mentioned.size > 0) {
    await notify(supabase, {
      organizationId: membership.organizationId,
      organizationName: membership.organizationName,
      actorId: membership.userId,
      recipientIds: [...mentioned],
      type: "mention",
      title: `${author} mentioned you on ${target.label}`,
      body: excerpt,
      linkPath: target.linkPath,
    });
  }
  const others = target.interested.filter((u): u is string => !!u && !mentioned.has(u));
  if (others.length > 0) {
    await notify(supabase, {
      organizationId: membership.organizationId,
      organizationName: membership.organizationName,
      actorId: membership.userId,
      recipientIds: others,
      type: "system",
      title: `${author} commented on ${target.label}`,
      body: excerpt,
      linkPath: target.linkPath,
    });
  }
  return {};
}

export async function deleteComment(commentId: string): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  const supabase = (await createClient()) as any;
  const { data, error } = await supabase
    .from("comments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", commentId)
    .eq("author_id", membership.userId)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "You can only delete your own comments." };
  return {};
}

// ────────────────────────────────────────────────────────────────
// Assignments
// ────────────────────────────────────────────────────────────────

/** Assigns an exception or a close task to a team member, with an optional due date, and tells them. */
export async function assignItem(input: {
  type: "exception" | "close_task";
  id: string;
  assigneeId: string | null;
  dueDate: string | null;
}): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, input.type === "exception" ? "reconciliation.match" : "close.manage_checklist");

  if (input.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) return { error: "Enter a valid due date." };

  const supabase = (await createClient()) as any;
  const people = await roster(supabase, membership.organizationId);
  let assignee: (typeof people)[number] | undefined;
  if (input.assigneeId) {
    assignee = people.find((m) => m.user_id === input.assigneeId);
    if (!assignee) return { error: "That person isn't a member of this organization." };
    if (!can(assignee.role, input.type === "exception" ? "reconciliation.match" : "close.manage_checklist")) {
      return { error: `${assignee.email} doesn't have permission to work on this kind of item.` };
    }
  }

  let linkPath = "/reconciliation/exceptions";
  let label = "an exception";
  if (input.type === "exception") {
    const { data: exception } = await supabase.from("exceptions").select("id, transactions(description)").eq("id", input.id).maybeSingle();
    if (!exception) return { error: "Exception not found." };
    label = `the exception "${exception.transactions?.description ?? "transaction"}"`;
    const { error } = await supabase
      .from("exceptions")
      .update({ assigned_to: input.assigneeId, assigned_at: input.assigneeId ? new Date().toISOString() : null, due_date: input.assigneeId ? input.dueDate : null })
      .eq("id", input.id);
    if (error) return { error: error.message };
  } else {
    const { data: item } = await supabase.from("close_checklist_items").select("id, title, close_period_id").eq("id", input.id).maybeSingle();
    if (!item) return { error: "Task not found." };
    label = `the close task "${item.title}"`;
    linkPath = `/close/${item.close_period_id}`;
    const { error } = await supabase
      .from("close_checklist_items")
      .update({ assignee_id: input.assigneeId, due_date: input.assigneeId ? input.dueDate : null })
      .eq("id", input.id);
    if (error) return { error: error.message };
  }

  await supabase.from("audit_log").insert({
    organization_id: membership.organizationId,
    actor_id: membership.userId,
    action: input.assigneeId ? `${input.type}.assigned` : `${input.type}.unassigned`,
    target_table: input.type === "exception" ? "exceptions" : "close_checklist_items",
    target_id: input.id,
    after: { assignee: assignee?.email ?? null, due_date: input.dueDate },
  });

  if (assignee) {
    await notify(supabase, {
      organizationId: membership.organizationId,
      organizationName: membership.organizationName,
      actorId: membership.userId,
      recipientIds: [assignee.user_id],
      type: "assigned",
      title: `${shortName(membership.email)} assigned you ${label}`,
      body: input.dueDate ? `Due ${input.dueDate}` : null,
      linkPath,
    });
  }

  revalidatePath("/reconciliation/exceptions");
  revalidatePath("/close", "layout");
  revalidatePath("/dashboard");
  return {};
}
