"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setRequireSignoff } from "@/lib/actions/signoff";

export function SignoffPolicyToggle({ initial, canEdit }: { initial: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const change = () => {
    const next = !on;
    if (next && !window.confirm("Turn on required sign-off? From now on a reconciliation can only be finalized after someone other than its preparer approves it, and the person who wrote a journal entry can't be the one to post it.")) return;
    setError(null);
    setOn(next);
    startTransition(async () => {
      const res = await setRequireSignoff(next);
      if (res.error) {
        setOn(!next);
        setError(res.error);
      } else router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink-900">Require a second person to approve</p>
          <p className="mt-0.5 max-w-xl text-xs text-ink-500">
            A reconciliation can only be finalized after someone other than its preparer reviews and approves it, and journal entries must be posted by someone other
            than their author. This is the usual control that auditors look for.
          </p>
        </div>
        <label className={`relative inline-flex shrink-0 items-center ${canEdit ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
          <input type="checkbox" checked={on} disabled={!canEdit || pending} onChange={change} className="peer sr-only" aria-label="Require a second person to approve" />
          <span className="h-6 w-11 rounded-full bg-ink-200 transition peer-checked:bg-accent-500 peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500" />
          <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
        </label>
      </div>
      {!canEdit && <p className="text-xs text-ink-500">Only an owner can change this.</p>}
      {on && <p className="text-xs text-ink-500">You need at least two people who can approve (a controller or owner besides the preparer), or periods can&apos;t be finalized.</p>}
      {error && <p className="text-sm text-status-exception">{error}</p>}
    </div>
  );
}
