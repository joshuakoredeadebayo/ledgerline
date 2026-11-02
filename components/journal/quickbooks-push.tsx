"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { pushJournalEntryToQuickBooks } from "@/lib/actions/quickbooks";
import { Button } from "@/components/ui/button";

/** Sends a posted entry to QuickBooks so the books there match, and shows where it went. */
export function QuickBooksPush({
  entryId,
  qbId,
  syncedAt,
  previousError,
  canPost,
}: {
  entryId: string;
  qbId: string | null;
  syncedAt: string | null;
  previousError: string | null;
  canPost: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(previousError);

  const send = (createMissingAccounts: boolean) => {
    setError(null);
    startTransition(async () => {
      const res = await pushJournalEntryToQuickBooks(entryId, { createMissingAccounts });
      if (res.missingAccounts && res.missingAccounts.length > 0) {
        const ok = window.confirm(
          `These accounts aren't in QuickBooks yet:\n\n${res.missingAccounts.map((a) => `• ${a}`).join("\n")}\n\nCreate them in QuickBooks and send the entry? (If an account with the same name already exists there, it will be used instead.)`
        );
        if (ok) send(true);
        return;
      }
      if (res.error) setError(res.error);
      else router.refresh();
    });
  };

  return (
    <section className="space-y-2 rounded-xl border border-ink-100 bg-white p-5 shadow-subtle">
      <h2 className="text-[15px] font-semibold text-ink-900">QuickBooks</h2>
      {qbId ? (
        <p className="text-sm text-ink-700">
          Sent to QuickBooks as journal entry <span className="font-medium text-ink-900">#{qbId}</span>
          {syncedAt ? ` on ${new Date(syncedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}. It won&apos;t be sent twice.
        </p>
      ) : (
        <>
          <p className="text-sm text-ink-600">
            This entry exists only in Ledgerline so far. Send it to QuickBooks so your books there agree. Amounts go across as they are, in the currency of the QuickBooks company.
          </p>
          {error && (
            <p role="alert" className="text-sm text-status-exception">
              {error}
            </p>
          )}
          {canPost ? (
            <Button size="sm" loading={pending} onClick={() => send(false)}>
              {error ? "Try again" : "Send to QuickBooks"}
            </Button>
          ) : (
            <p className="text-xs text-ink-500">A controller or owner can send it.</p>
          )}
        </>
      )}
    </section>
  );
}
