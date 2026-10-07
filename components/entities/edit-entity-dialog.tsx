"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { updateEntity, type ManageState } from "@/lib/actions/entity-management";
import { Modal, ModalContent, ModalTrigger } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function EditEntityDialog({
  entityId,
  name,
  currency,
  fiscalYearEnd,
}: {
  entityId: string;
  name: string;
  currency: string;
  fiscalYearEnd: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ManageState, FormData>(updateEntity, null);

  useEffect(() => {
    if (state?.success) setOpen(false);
  }, [state]);

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>
        <Button type="button" size="sm" variant="secondary">
          <Pencil className="h-3.5 w-3.5" />
          Edit entity
        </Button>
      </ModalTrigger>
      <ModalContent title="Edit entity" description="Update this entity's name, currency and fiscal year.">
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="entityId" value={entityId} />
          <Input name="name" label="Entity name" defaultValue={name} required />
          <Input
            name="currency"
            label="Currency"
            defaultValue={currency}
            maxLength={3}
            hint="3-letter code, e.g. USD or NGN. Existing transactions keep the currency they were recorded in; nothing is converted."
            required
          />
          <Input
            name="fiscalYearEnd"
            type="date"
            label="Fiscal year end"
            defaultValue={fiscalYearEnd ?? ""}
            hint="Any date on which your fiscal year ends; the day and month are what matter."
          />
          {state?.error && (
            <p role="alert" className="text-sm text-status-exception">
              {state.error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Save changes
            </Button>
          </div>
        </form>
      </ModalContent>
    </Modal>
  );
}
