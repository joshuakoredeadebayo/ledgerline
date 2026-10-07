"use client";

import { useState, useTransition } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import { setEntityArchived } from "@/lib/actions/entity-management";
import { Button } from "@/components/ui/button";

export function ArchiveEntityButton({ entityId, name, archived }: { entityId: string; name: string; archived: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    const message = archived
      ? `Restore ${name}? Its accounts return to reconciliation.`
      : `Archive ${name}?\n\nIt and its accounts will be hidden from reconciliation, the close and bank syncing. Nothing is deleted, and you can restore it at any time.`;
    if (!window.confirm(message)) return;
    setError(null);
    startTransition(async () => {
      const res = await setEntityArchived(entityId, !archived);
      if (res.error) setError(res.error);
    });
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button type="button" size="sm" variant={archived ? "primary" : "ghost"} disabled={pending} onClick={run}>
        {archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
        {archived ? "Restore entity" : "Archive entity"}
      </Button>
      {error && <span className="max-w-xs text-xs text-status-exception">{error}</span>}
    </span>
  );
}
