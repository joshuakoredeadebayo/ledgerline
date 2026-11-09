"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pause, Pencil, Play, Trash2, Zap } from "lucide-react";
import { deleteRecurringTemplate, runRecurringNow, setRecurringStatus } from "@/lib/actions/recurring";
import { ACTION_BUTTON, ACTION_LINK } from "@/components/ui/action-styles";

/** Pause or resume, prepare now, edit and delete for one recurring entry. */
export function RecurringActions({ id, status, canEdit, name }: { id: string; status: "active" | "paused" | "ended"; canEdit: boolean; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  if (!canEdit) return null;

  const run = (work: () => Promise<{ error?: string }>, after?: () => void) => {
    setNote(null);
    startTransition(async () => {
      const res = await work();
      if (res.error) setNote({ tone: "bad", text: res.error });
      else {
        after?.();
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {status === "active" && (
          <button
            type="button"
            disabled={pending}
            className={ACTION_BUTTON}
            title="Prepare the draft that is due now, without waiting for the daily run"
            onClick={() =>
              startTransition(async () => {
                setNote(null);
                const res = await runRecurringNow(id);
                if (res.error) setNote({ tone: "bad", text: res.error });
                else if (res.failed) setNote({ tone: "bad", text: res.problems?.[0] ?? "It couldn't be prepared." });
                else setNote({ tone: "ok", text: res.created ? `${res.created} draft${res.created === 1 ? "" : "s"} prepared.` : "Nothing is due yet." });
                router.refresh();
              })
            }
          >
            <Zap className="h-3.5 w-3.5" />
            Prepare now
          </button>
        )}
        {status === "active" ? (
          <button type="button" disabled={pending} className={ACTION_BUTTON} onClick={() => run(() => setRecurringStatus(id, "paused"))}>
            <Pause className="h-3.5 w-3.5" />
            Pause
          </button>
        ) : (
          <button type="button" disabled={pending} className={ACTION_BUTTON} onClick={() => run(() => setRecurringStatus(id, "active"))}>
            <Play className="h-3.5 w-3.5" />
            {status === "ended" ? "Restart" : "Resume"}
          </button>
        )}
      </div>
      <div className="flex items-center justify-end gap-0.5">
        <Link href={`/recurring/${id}/edit`} className={ACTION_LINK}>
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Link>
        <button
          type="button"
          disabled={pending}
          className={`${ACTION_LINK} hover:!text-status-exception`}
          onClick={() => {
            if (!window.confirm(`Delete "${name}"? Drafts it has already prepared are kept. This can't be undone.`)) return;
            run(() => deleteRecurringTemplate(id), () => router.push("/recurring"));
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
      </div>
      {note && <p className={`max-w-xs text-right text-xs ${note.tone === "ok" ? "text-status-matched" : "text-status-exception"}`}>{note.text}</p>}
    </div>
  );
}
