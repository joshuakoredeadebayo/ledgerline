"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { addManualTransaction, type ActionState } from "@/lib/actions/reconciliation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function AddManualTransactionForm({ accountId, entityId }: { accountId: string; entityId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(addManualTransaction, null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-sm font-medium text-accent-600 hover:text-accent-700"
      >
        <Plus className="h-3.5 w-3.5" />
        Add a test transaction
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-ink-100 bg-white p-4">
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="entityId" value={entityId} />

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-ink-700">Side</label>
        <select
          name="side"
          className="h-9 rounded border border-ink-200 bg-white px-3 text-sm text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
        >
          <option value="bank">Bank</option>
          <option value="ledger">Ledger</option>
        </select>
      </div>
      <div className="w-32">
        <Input name="amount" type="number" step="0.01" label="Amount" placeholder="150.00" required />
      </div>
      <div className="w-40">
        <Input name="transaction_date" type="date" label="Date" required />
      </div>
      <div className="min-w-[12rem] flex-1">
        <Input name="description" label="Description" placeholder="Optional" />
      </div>
      <Button type="submit" loading={pending}>
        Add
      </Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {state?.error && <p className="w-full text-sm text-status-exception">{state.error}</p>}
    </form>
  );
}
