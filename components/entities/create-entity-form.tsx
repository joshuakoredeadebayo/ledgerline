"use client";

import { useActionState } from "react";
import { createEntity, type ActionState } from "@/lib/actions/entities";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function CreateEntityForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(createEntity, null);

  return (
    <form action={formAction} className="flex items-end gap-3 rounded-lg border border-ink-100 bg-white p-4">
      <div className="flex-1">
        <Input name="name" label="Entity name" placeholder="Acme Inc." error={state?.fieldErrors?.name} required />
      </div>
      <div className="w-28">
        <Input name="currency" label="Currency" defaultValue="USD" maxLength={3} />
      </div>
      <Button type="submit" loading={pending}>
        Add entity
      </Button>
      {state?.error && <p className="text-sm text-status-exception">{state.error}</p>}
    </form>
  );
}
