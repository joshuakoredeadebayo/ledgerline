"use client";

import { useActionState, useEffect, useRef } from "react";
import { changePassword, type AccountActionState } from "@/lib/actions/account";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState<AccountActionState, FormData>(changePassword, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="max-w-sm space-y-4">
      <Input name="currentPassword" type="password" label="Current password" autoComplete="current-password" required />
      <Input
        name="newPassword"
        type="password"
        label="New password"
        hint="At least 8 characters."
        autoComplete="new-password"
        required
      />
      <Input name="confirmPassword" type="password" label="Confirm new password" autoComplete="new-password" required />
      {state?.error && (
        <p role="alert" className="text-sm text-status-exception">
          {state.error}
        </p>
      )}
      {state?.success && <p className="text-sm text-status-matched">{state.success}</p>}
      <Button type="submit" loading={pending}>
        Update password
      </Button>
    </form>
  );
}
