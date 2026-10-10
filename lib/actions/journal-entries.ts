"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { assertPermission } from "@/lib/permissions";
import { checkJournalLines, ledgerAmountForLine, reverseLines, type JournalLineInput } from "@/lib/journal-math";
import { getOrCreateReconciliationPeriod, recomputeReconciliationStatus } from "@/lib/reconciliation-status";

export interface JournalEntryInput {
  /** Present when editing an existing draft. */
  id?: string;
  entityId: string;
  entryDate: string;
  description: string;
  lines: JournalLineInput[];
  /** Save and post in one step (needs permission to post). */
  postNow?: boolean;
}

type Membership = NonNullable<Awaited<ReturnType<typeof getCurrentMembership>>>;

async function logAudit(
  supabase: any,
  membership: Membership,
  entityId: string,
  action: string,
  entryId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
) {
  await supabase.from("audit_log").insert({
    organization_id: membership.organizationId,
    entity_id: entityId,
    actor_id: membership.userId,
    action,
    target_table: "journal_entries",
    target_id: entryId,
    before,
    after,
  });
}

function refresh(entryId?: string) {
  revalidatePath("/journal-entries");
  if (entryId) revalidatePath(`/journal-entries/${entryId}`);
  revalidatePath("/reconciliation", "layout");
  revalidatePath("/dashboard");
  revalidatePath("/reports", "layout");
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Everything about the entry that can be checked without touching the database. */
function validateHeader(input: JournalEntryInput): string | null {
  if (!input.entityId) return "Choose an entity.";
  if (!DATE_RE.test(input.entryDate)) return "Enter a valid date.";
  if (input.description.trim().length > 300) return "Keep the description under 300 characters.";
  return null;
}

/** Creates a draft, or replaces an existing draft's header and lines. Optionally posts it straight away. */
export async function saveJournalEntry(input: JournalEntryInput): Promise<{ error?: string; id?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "journal_entries.draft");
  if (input.postNow) assertPermission(membership.role, "journal_entries.post");

  const headerProblem = validateHeader(input);
  if (headerProblem) return { error: headerProblem };

  // A draft may be saved while unbalanced (work in progress); posting requires balance.
  const check = checkJournalLines(input.lines, !!input.postNow);
  if (check.lines.length === 0) return { error: "Add at least one line." };
  const lineProblems = check.problems.filter((p) => input.postNow || !/at least two lines|must be equal/.test(p));
  if (lineProblems.length > 0) return { error: lineProblems[0] };

  const supabase = (await createClient()) as any;

  // Every account must belong to the chosen entity and still be active.
  const accountIds = [...new Set(check.lines.map((l) => l.accountId))];
  const { data: accounts } = await supabase.from("accounts").select("id, entity_id, archived_at").in("id", accountIds);
  const known = new Map<string, any>(((accounts ?? []) as any[]).map((a) => [a.id, a]));
  for (const id of accountIds) {
    const a = known.get(id);
    if (!a || a.entity_id !== input.entityId) return { error: "Every line must use an account from the chosen entity." };
    if (a.archived_at) return { error: "A line uses an archived account. Pick an active one." };
  }

  let entryId = input.id;
  if (entryId) {
    const { data: existing } = await supabase.from("journal_entries").select("id, status, entity_id").eq("id", entryId).maybeSingle();
    if (!existing) return { error: "Journal entry not found." };
    if (existing.status !== "draft") return { error: "Only a draft can be edited. Posted entries can only be reversed." };

    const { error } = await supabase
      .from("journal_entries")
      .update({ entity_id: input.entityId, entry_date: input.entryDate, description: input.description.trim() || null })
      .eq("id", entryId);
    if (error) return { error: error.message };

    const { error: deleteError } = await supabase.from("journal_entry_lines").delete().eq("journal_entry_id", entryId);
    if (deleteError) return { error: deleteError.message };
  } else {
    const { data: created, error } = await supabase
      .from("journal_entries")
      .insert({
        entity_id: input.entityId,
        entry_date: input.entryDate,
        description: input.description.trim() || null,
        status: "draft",
        created_by: membership.userId,
      })
      .select("id")
      .single();
    if (error || !created) return { error: error?.message ?? "Could not create the journal entry." };
    entryId = created.id as string;
  }

  const { error: linesError } = await supabase.from("journal_entry_lines").insert(
    check.lines.map((l) => ({ journal_entry_id: entryId, account_id: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo }))
  );
  if (linesError) return { error: linesError.message };

  await logAudit(supabase, membership, input.entityId, input.id ? "journal_entry.updated" : "journal_entry.created", entryId!, null, {
    date: input.entryDate,
    lines: check.lines.length,
    total: check.totalDebitCents / 100,
  });

  if (input.postNow) {
    const posted = await postJournalEntry(entryId!);
    if (posted.error) return { id: entryId, error: `Saved as a draft, but it couldn't be posted: ${posted.error}` };
  }

  refresh(entryId);
  return { id: entryId };
}

export async function deleteJournalEntry(entryId: string): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "journal_entries.draft");

  const supabase = (await createClient()) as any;
  const { data: entry } = await supabase.from("journal_entries").select("id, entity_id, status, entry_date, description").eq("id", entryId).maybeSingle();
  if (!entry) return { error: "Journal entry not found." };
  if (entry.status !== "draft") return { error: "Only a draft can be deleted. Posted entries can only be reversed." };

  const { data: removed, error } = await supabase.from("journal_entries").delete().eq("id", entryId).select("id");
  if (error) return { error: error.message };
  if (!removed || removed.length === 0) return { error: "Nothing was deleted. You may not have permission." };

  await logAudit(supabase, membership, entry.entity_id, "journal_entry.deleted", entryId, { date: entry.entry_date, description: entry.description }, null);
  refresh();
  return {};
}

/** Finds a finalized reconciliation covering a date for an account, if there is one. */
async function finalizedPeriodFor(supabase: any, accountId: string, date: string) {
  const { data } = await supabase
    .from("reconciliations")
    .select("id, status, period_start")
    .eq("account_id", accountId)
    .lte("period_start", date)
    .gte("period_end", date)
    .eq("status", "finalized")
    .maybeSingle();
  return data as { id: string; status: string; period_start: string } | null;
}

async function recomputeFor(supabase: any, membership: Membership, accounts: { entityId: string; accountId: string; date: string }[]) {
  const seen = new Set<string>();
  for (const a of accounts) {
    const key = `${a.accountId}|${a.date.slice(0, 7)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const reconciliationId = await getOrCreateReconciliationPeriod(a.entityId, a.accountId, `${a.date}T12:00:00.000Z`, membership.userId);
      await recomputeReconciliationStatus(reconciliationId);
    } catch (err) {
      console.error("Journal entry: reconciliation recompute failed:", err);
    }
  }
}

/**
 * Posting makes an entry permanent and, for every line on a reconcilable (bank or card)
 * account, adds a ledger-side item to that account's reconciliation, so the booking can be
 * matched against the bank line it explains. Credits count as money out, debits as money in.
 */
export async function postJournalEntry(entryId: string): Promise<{ error?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "journal_entries.post");

  const supabase = (await createClient()) as any;
  const { data: entry } = await supabase
    .from("journal_entries")
    .select("id, entity_id, entry_date, description, status, journal_entry_lines(id, account_id, debit, credit, memo, accounts(id, name, is_reconcilable, archived_at))")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) return { error: "Journal entry not found." };
  if (entry.status !== "draft") return { error: "This entry has already been posted." };

  const lines: any[] = entry.journal_entry_lines ?? [];
  const check = checkJournalLines(lines.map((l) => ({ accountId: l.account_id, debit: l.debit, credit: l.credit, memo: l.memo })));
  if (!check.ok) return { error: check.problems[0] };
  if (lines.some((l) => l.accounts?.archived_at)) return { error: "A line uses an archived account. Edit the draft to pick an active one." };

  const feedLines = lines.filter((l) => l.accounts?.is_reconcilable);

  // A period that has been finalized must not quietly change underneath its sign-off.
  for (const l of feedLines) {
    const finalized = await finalizedPeriodFor(supabase, l.account_id, entry.entry_date);
    if (finalized) {
      return { error: `${l.accounts.name} is already finalized for ${finalized.period_start.slice(0, 7)}. Reopen that period first, or date the entry in an open period.` };
    }
  }

  // Ledger items first, then the status change: if posting is refused, the items are withdrawn.
  const createdTxnIds: string[] = [];
  const affected: { entityId: string; accountId: string; date: string }[] = [];
  if (feedLines.length > 0) {
    const currencyByAccount = new Map<string, string>();
    const { data: entity } = await supabase.from("entities").select("currency").eq("id", entry.entity_id).maybeSingle();
    for (const l of feedLines) {
      if (currencyByAccount.has(l.account_id)) continue;
      const { data: sibling } = await supabase.from("transactions").select("currency").eq("account_id", l.account_id).limit(1).maybeSingle();
      currencyByAccount.set(l.account_id, sibling?.currency ?? entity?.currency ?? "USD");
    }

    const rows = feedLines.map((l) => ({
      entity_id: entry.entity_id,
      account_id: l.account_id,
      source: "manual",
      external_id: `journal-${l.id}`,
      amount: ledgerAmountForLine(l),
      currency: currencyByAccount.get(l.account_id),
      transaction_date: entry.entry_date,
      description: l.memo || entry.description || "Journal entry",
      raw_payload: { side: "ledger", journal_entry_id: entry.id, journal_entry_line_id: l.id },
      status: "unmatched",
    }));
    const { data: inserted, error: insertError } = await supabase.from("transactions").insert(rows).select("id");
    if (insertError) return { error: insertError.message };
    createdTxnIds.push(...((inserted ?? []) as { id: string }[]).map((t) => t.id));
    for (const l of feedLines) affected.push({ entityId: entry.entity_id, accountId: l.account_id, date: entry.entry_date });
  }

  const { data: posted, error: postError } = await supabase
    .from("journal_entries")
    .update({ status: "posted", posted_at: new Date().toISOString() })
    .eq("id", entryId)
    .eq("status", "draft")
    .select("id");
  if (postError || !posted || posted.length === 0) {
    if (createdTxnIds.length > 0) await supabase.from("transactions").update({ status: "excluded" }).in("id", createdTxnIds);
    return { error: postError?.message ?? "The entry could not be posted. It may have been changed by someone else." };
  }

  await logAudit(supabase, membership, entry.entity_id, "journal_entry.posted", entryId, null, {
    date: entry.entry_date,
    total: check.totalDebitCents / 100,
    reconciliation_items: createdTxnIds.length,
  });

  await recomputeFor(supabase, membership, affected);
  refresh(entryId);
  return {};
}

/**
 * Reverses a posted entry: records a mirror-image entry (debits and credits swapped, linked
 * to the original) and marks the original reversed. The original's still-unmatched
 * reconciliation items are withdrawn, so the two cancel out; if one has already been matched
 * to a bank line, the reversal is refused until that match is undone.
 */
export async function reverseJournalEntry(entryId: string): Promise<{ error?: string; reversalId?: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: "Not signed in." };
  assertPermission(membership.role, "journal_entries.post");

  const supabase = (await createClient()) as any;
  const { data: entry } = await supabase
    .from("journal_entries")
    .select("id, entity_id, entry_date, description, status, journal_entry_lines(account_id, debit, credit, memo)")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) return { error: "Journal entry not found." };
  if (entry.status !== "posted") return { error: "Only a posted entry can be reversed." };

  const { data: generated } = await supabase
    .from("transactions")
    .select("id, account_id, status, transaction_date")
    .eq("source", "manual")
    .contains("raw_payload", { journal_entry_id: entryId });
  const items: { id: string; account_id: string; status: string; transaction_date: string }[] = generated ?? [];

  if (items.some((t) => t.status === "matched")) {
    return { error: "One of this entry's lines is matched to a bank transaction. Undo that match first, then reverse the entry." };
  }
  for (const t of items) {
    const finalized = await finalizedPeriodFor(supabase, t.account_id, t.transaction_date);
    if (finalized) return { error: `A period it affects (${finalized.period_start.slice(0, 7)}) is finalized. Reopen it before reversing this entry.` };
  }

  const swapped = reverseLines(((entry.journal_entry_lines ?? []) as any[]).map((l) => ({ ...l })));
  const today = new Date().toISOString().slice(0, 10);

  const { data: reversal, error: headerError } = await supabase
    .from("journal_entries")
    .insert({
      entity_id: entry.entity_id,
      entry_date: today,
      description: `Reversal of: ${entry.description ?? "journal entry"}`.slice(0, 300),
      status: "draft",
      reversed_entry_id: entry.id,
      created_by: membership.userId,
    })
    .select("id")
    .single();
  if (headerError || !reversal) return { error: headerError?.message ?? "Could not create the reversing entry." };

  const { error: linesError } = await supabase.from("journal_entry_lines").insert(
    swapped.map((l: any) => ({ journal_entry_id: reversal.id, account_id: l.account_id, debit: l.debit, credit: l.credit, memo: l.memo }))
  );
  if (linesError) {
    await supabase.from("journal_entries").delete().eq("id", reversal.id);
    return { error: linesError.message };
  }

  const { error: postError } = await supabase
    .from("journal_entries")
    .update({ status: "posted", posted_at: new Date().toISOString() })
    .eq("id", reversal.id);
  if (postError) {
    await supabase.from("journal_entries").delete().eq("id", reversal.id);
    return { error: postError.message };
  }

  const { data: marked, error: markError } = await supabase
    .from("journal_entries")
    .update({ status: "reversed" })
    .eq("id", entryId)
    .eq("status", "posted")
    .select("id");
  if (markError || !marked || marked.length === 0) {
    return { error: markError?.message ?? "The reversing entry was created, but the original could not be marked reversed." };
  }

  const idsToWithdraw = items.map((t) => t.id);
  if (idsToWithdraw.length > 0) await supabase.from("transactions").update({ status: "excluded" }).in("id", idsToWithdraw);

  await logAudit(supabase, membership, entry.entity_id, "journal_entry.reversed", entryId, null, { reversal_id: reversal.id });
  await recomputeFor(
    supabase,
    membership,
    items.map((t) => ({ entityId: entry.entity_id, accountId: t.account_id, date: t.transaction_date }))
  );
  refresh(entryId);
  return { reversalId: reversal.id };
}
