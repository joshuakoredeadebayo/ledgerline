"use client";

import { useActionState } from "react";
import { createAccount, type ActionState } from "@/lib/actions/entities";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;

export function CreateAccountForm({ entityId }: { entityId: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(createAccount, null);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-ink-100 bg-white p-4">
      <input type="hidden" name="entityId" value={entityId} />
      <div className="flex-1 min-w-[10rem]">
        <Input name="name" label="Account name" placeholder="Operating Checking" error={state?.fieldErrors?.name} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-ink-700">Type</label>
        <select
          name="account_type"
          className="h-9 rounded border border-ink-200 bg-white px-3 text-sm text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
        >
          {TYPES.map((t) => (
            <option key={t} value={t} className="capitalize">
              {t}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" loading={pending}>
        Add account
      </Button>
      {state?.error && <p className="text-sm text-status-exception">{state.error}</p>}
    </form>
  );
}
