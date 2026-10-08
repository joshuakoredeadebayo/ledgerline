"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { confirmMatch, confirmMatchesAtOrAbove, rejectMatch } from "@/lib/actions/reconciliation";
import { Button } from "@/components/ui/button";

/** Confirm / Reject right from the list, plus a link into the account for the full picture. */
export function PendingMatchActions({ matchId, accountId, reviewHref }: { matchId: string; accountId: string; reviewHref: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (work: () => Promise<unknown>) => {
    setError(null);
    startTransition(async () => {
      try {
        await work();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-1">
        <Link href={reviewHref} className="inline-flex h-8 items-center rounded px-2.5 text-sm font-medium text-accent-600 hover:bg-accent-50">
          Review
        </Link>
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => confirmMatch(matchId, accountId))}>
          <Check className="h-3.5 w-3.5" />
          Confirm
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} aria-label="Reject" onClick={() => run(() => rejectMatch(matchId, accountId))}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {error && <p className="max-w-[14rem] text-right text-xs text-status-exception">{error}</p>}
    </div>
  );
}

/** "Confirm all suggestions at 95% or higher" in one step. */
export function BulkConfirmBar({ threshold, eligible }: { threshold: number; eligible: number }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const pct = Math.round(threshold * 100);

  if (eligible === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-status-matched/20 bg-status-matchedBg px-4 py-3 text-sm">
      <p className="text-ink-800">
        <span className="font-medium">{eligible.toLocaleString()}</span> suggestion{eligible === 1 ? " is" : "s are"} at {pct}% confidence or higher.
      </p>
      <div className="flex items-center gap-3">
        {message && <span className={message.tone === "ok" ? "text-xs text-status-matched" : "text-xs text-status-exception"}>{message.text}</span>}
        <Button
          size="sm"
          loading={pending}
          onClick={() => {
            if (!window.confirm(`Confirm all ${eligible} suggested matches at ${pct}% or higher? You can undo any of them later with Unmatch.`)) return;
            setMessage(null);
            startTransition(async () => {
              const res = await confirmMatchesAtOrAbove(threshold);
              if (res.error) setMessage({ text: res.error, tone: "error" });
              else setMessage({ text: `Confirmed ${res.confirmed ?? 0}.`, tone: "ok" });
            });
          }}
        >
          <Check className="h-3.5 w-3.5" />
          Confirm all ≥ {pct}%
        </Button>
      </div>
    </div>
  );
}
