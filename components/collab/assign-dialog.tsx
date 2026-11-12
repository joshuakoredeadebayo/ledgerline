"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { UserPlus } from "lucide-react";
import { assignItem } from "@/lib/actions/collaboration";
import { Modal, ModalContent, ModalTrigger } from "@/components/ui/modal";
import { ACTION_LINK } from "@/components/ui/action-styles";
import { Button } from "@/components/ui/button";

export interface Assignable {
  id: string;
  email: string;
}

const field =
  "h-9 w-full rounded border border-ink-200 bg-white px-2.5 text-sm text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500";

/** Pick who looks after an item and by when. They are notified straight away. */
export function AssignDialog({
  type,
  id,
  label,
  members,
  currentAssigneeId,
  currentDueDate,
  buttonText,
}: {
  type: "exception" | "close_task";
  id: string;
  label: string;
  members: Assignable[];
  currentAssigneeId: string | null;
  currentDueDate: string | null;
  buttonText?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [assignee, setAssignee] = useState(currentAssigneeId ?? "");
  const [due, setDue] = useState(currentDueDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (clear: boolean) => {
    setError(null);
    startTransition(async () => {
      const res = await assignItem({ type, id, assigneeId: clear ? null : assignee || null, dueDate: clear ? null : due || null });
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>
        <button type="button" className={ACTION_LINK}>
          <UserPlus className="h-4 w-4" />
          {buttonText ?? (currentAssigneeId ? "Reassign" : "Assign")}
        </button>
      </ModalTrigger>
      <ModalContent title="Assign" description={label}>
        <div className="space-y-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
            Assign to
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={field}>
              <option value="">Choose a person…</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.email}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
            Due date (optional)
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={field} />
          </label>
          {error && <p className="text-sm text-status-exception">{error}</p>}
          <div className="flex items-center justify-between gap-2 pt-1">
            {currentAssigneeId ? (
              <button type="button" disabled={pending} onClick={() => save(true)} className="text-xs font-medium text-ink-500 hover:text-status-exception">
                Remove assignment
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" loading={pending} disabled={!assignee} onClick={() => save(false)}>
                Assign
              </Button>
            </div>
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}
