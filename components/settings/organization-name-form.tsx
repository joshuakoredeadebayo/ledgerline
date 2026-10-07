"use client";

import { useActionState } from "react";
import { updateOrganizationName, type MemberActionState } from "@/lib/actions/members";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function OrganizationNameForm({ name, canEdit }: { name: string; canEdit: boolean }) {
  const [state, formAction, pending] = useActionState<MemberActionState, FormData>(updateOrganizationName, null);

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1">
          <Input
            name="name"
            label="Organization name"
            defaultValue={name}
            disabled={!canEdit}
            hint={canEdit ? undefined : "Only an owner can rename the organization."}
            required
          />
        </div>
        {canEdit && (
          <Button type="submit" loading={pending}>
            Save
          </Button>
        )}
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-status-exception">
          {state.error}
        </p>
      )}
      {state?.success && <p className="text-sm text-status-matched">{state.success}</p>}
    </form>
  );
}
