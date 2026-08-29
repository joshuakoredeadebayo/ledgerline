"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toggleManualChecklistItem } from "@/lib/actions/close";

export function ChecklistItemRow({
  itemId,
  entityId,
  complete,
  canToggle,
}: {
  itemId: string;
  entityId: string;
  complete: boolean;
  canToggle: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  if (!canToggle) return null;

  return (
    <Button
      size="sm"
      variant={complete ? "ghost" : "secondary"}
      loading={isPending}
      onClick={() => startTransition(() => toggleManualChecklistItem(itemId, entityId))}
    >
      {complete ? "Mark not done" : "Mark done"}
    </Button>
  );
}
