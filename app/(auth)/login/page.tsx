"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login } from "@/lib/actions/auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, null);

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-ink-900">Sign in</h1>
      <p className="mb-6 text-sm text-ink-500">Welcome back. Enter your details to continue.</p>

      <form action={formAction} className="flex flex-col gap-4">
        <Input
          name="email"
          type="email"
          label="Email"
          placeholder="you@company.com"
          error={state?.fieldErrors?.email}
          autoComplete="email"
          required
        />
        <Input
          name="password"
          type="password"
          label="Password"
          error={state?.fieldErrors?.password}
          autoComplete="current-password"
          required
        />

        {state?.error && (
          <p role="alert" className="text-sm text-status-exception">
            {state.error}
          </p>
        )}

        <Button type="submit" loading={pending} className="mt-1 w-full">
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-500">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-medium text-accent-600 hover:text-accent-700">
          Create one
        </Link>
      </p>
    </>
  );
}
