"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup } from "@/lib/actions/auth";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface InvitationInfo {
  token: string;
  email: string;
  role: Role;
  organizationName: string;
}

export function SignupForm({ invitation }: { invitation: InvitationInfo | null }) {
  const [state, formAction, pending] = useActionState(signup, null);

  return (
    <>
      {invitation ? (
        <>
          <h1 className="mb-1 text-xl font-semibold text-ink-900">Join {invitation.organizationName}</h1>
          <p className="mb-6 text-sm text-ink-500">
            You&apos;ve been invited as {ROLE_LABELS[invitation.role]}. Choose a password to create your account.
          </p>
        </>
      ) : (
        <>
          <h1 className="mb-1 text-xl font-semibold text-ink-900">Create your account</h1>
          <p className="mb-6 text-sm text-ink-500">Set up your organization in a couple of minutes.</p>
        </>
      )}

      <form action={formAction} className="flex flex-col gap-4">
        {invitation && <input type="hidden" name="inviteToken" value={invitation.token} />}
        {!invitation && (
          <Input
            name="orgName"
            label="Company name"
            placeholder="Acme Inc."
            error={state?.fieldErrors?.orgName}
            required
          />
        )}
        <Input
          name="email"
          type="email"
          label={invitation ? "Email" : "Work email"}
          placeholder="you@company.com"
          defaultValue={invitation?.email}
          readOnly={!!invitation}
          error={state?.fieldErrors?.email}
          autoComplete="email"
          required
        />
        <Input
          name="password"
          type="password"
          label="Password"
          hint="At least 8 characters."
          error={state?.fieldErrors?.password}
          autoComplete="new-password"
          required
        />

        {state?.error && (
          <p role="alert" className="text-sm text-status-exception">
            {state.error}
          </p>
        )}

        <Button type="submit" loading={pending} className="mt-1 w-full">
          {invitation ? "Join organization" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent-600 hover:text-accent-700">
          Sign in
        </Link>
      </p>
    </>
  );
}
