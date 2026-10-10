"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteJournalEntry, postJournalEntry, reverseJournalEntry } from "@/lib/actions/journal-entries";
import { Button } from "@/components/ui/button";

/** Edit / Post / Delete for a draft; Reverse for a posted entry. */
export function JournalEntryActions({
  entryId,
  status,
  canDraft,
  canPost,
  balanced,
}: {
  entryId: string;
  status: "draft" | "posted" | "reversed";
  canDraft: boolean;
  canPost: boolean;
  balanced: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (work: () => Promise<{ error?: string }>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const res = await work();
      if (res.error) setError(res.error);
      else after?.();
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {status === "draft" && canDraft && (
          <Link
            href={`/journal-entries/${entryId}/edit`}
            className="inline-flex h-9 items-center rounded border border-ink-200 bg-white px-4 text-sm font-medium text-ink-800 hover:bg-ink-50"
          >
            Edit
          </Link>
        )}
        {status === "draft" && canPost && (
          <Button
            loading={pending}
            disabled={!balanced}
            title={balanced ? "" : "Debits and credits must be equal to post"}
            onClick={() => {
              if (!window.confirm("Post this entry? Once posted it can't be edited, only reversed.")) return;
              run(() => postJournalEntry(entryId), () => router.refresh());
            }}
          >
            Post entry
          </Button>
        )}
        {status === "draft" && canDraft && (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (!window.confirm("Delete this draft? This can't be undone.")) return;
              run(() => deleteJournalEntry(entryId), () => router.push("/journal-entries"));
            }}
          >
            Delete draft
          </Button>
        )}
        {status === "posted" && canPost && (
          <Button
            variant="secondary"
            loading={pending}
            onClick={() => {
              if (!window.confirm("Reverse this entry? A mirror-image entry is recorded, and the entry's reconciliation items are withdrawn.")) return;
              run(
                () => reverseJournalEntry(entryId),
                () => router.refresh()
              );
            }}
          >
            Reverse entry
          </Button>
        )}
      </div>
      {error && <p className="max-w-md text-right text-sm text-status-exception">{error}</p>}
    </div>
  );
}
