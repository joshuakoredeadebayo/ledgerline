"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Landmark, ArrowRight } from "lucide-react";
import { createEntity, createAccount } from "@/lib/actions/entities";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Step = "welcome" | "entity" | "account" | "done";

const ACCOUNT_TYPES = [
  { value: "asset", label: "Asset" },
  { value: "liability", label: "Liability" },
  { value: "equity", label: "Equity" },
  { value: "revenue", label: "Revenue" },
  { value: "expense", label: "Expense" },
] as const;

/** A single, quiet ceremonial mark — the one signature element this flow
 *  repeats at each step, standing in for a letterhead seal without
 *  literally illustrating one. */
function SignatureDivider() {
  return (
    <div className="my-8 flex items-center gap-3" aria-hidden>
      <div className="h-px flex-1 bg-ink-200" />
      <div className="h-1.5 w-1.5 rotate-45 bg-accent-500" />
      <div className="h-px flex-1 bg-ink-200" />
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium uppercase tracking-[0.14em] text-ink-400">{children}</p>
  );
}

function Headline({ children, italic }: { children: React.ReactNode; italic?: boolean }) {
  return (
    <h1
      className={`mt-2 text-3xl leading-tight text-ink-900 sm:text-4xl ${italic ? "italic" : ""}`}
      style={{ fontFamily: "var(--font-onboarding-serif)", fontWeight: 600 }}
    >
      {children}
    </h1>
  );
}

export function OnboardingWizard({
  organizationName,
  alreadyOnboarded,
}: {
  organizationName: string;
  alreadyOnboarded: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [entityId, setEntityId] = useState<string | null>(null);
  const [entityName, setEntityName] = useState("");
  const [accountName, setAccountName] = useState<string | null>(null);

  // Captured ONCE from the initial prop value and never reconsidered —
  // deliberately not just reading `alreadyOnboarded` directly, since that
  // prop can flip to true mid-session (the moment this wizard's own
  // account-creation action succeeds) as a side effect of Next.js
  // refreshing the parent Server Component. Locking it into local state
  // at mount time means later refreshes can't retroactively decide this
  // session shouldn't be happening.
  const [shouldLeaveImmediately] = useState(alreadyOnboarded);

  useEffect(() => {
    if (shouldLeaveImmediately) {
      router.replace("/dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [isPending, startTransition] = useTransition();
  const [entityError, setEntityError] = useState<string | undefined>();
  const [entityFieldErrors, setEntityFieldErrors] = useState<Record<string, string> | undefined>();
  const [accountError, setAccountError] = useState<string | undefined>();
  const [accountFieldErrors, setAccountFieldErrors] = useState<Record<string, string> | undefined>();

  // Deliberately NOT using <form action={...}> here. Next.js automatically
  // refreshes the current route's server components after a form-bound
  // Server Action completes — which would re-run this page's "already
  // onboarded?" check the instant the entity is created, and boot the user
  // straight to the dashboard mid-wizard. Calling the actions directly as
  // plain functions (same pattern as the reconciliation workspace) avoids
  // that automatic refresh entirely, so the wizard's own step state stays
  // in control of navigation.
  function handleEntitySubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setEntityName((formData.get("name") as string) ?? "");
    setEntityError(undefined);
    setEntityFieldErrors(undefined);
    startTransition(async () => {
      const result = await createEntity(null, formData);
      if (result?.error) setEntityError(result.error);
      else if (result?.fieldErrors) setEntityFieldErrors(result.fieldErrors);
      else if (result?.entityId) {
        setEntityId(result.entityId);
        setStep("account");
      }
    });
  }

  function handleAccountSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setAccountName((formData.get("name") as string) ?? "");
    setAccountError(undefined);
    setAccountFieldErrors(undefined);
    startTransition(async () => {
      const result = await createAccount(null, formData);
      if (result?.error) setAccountError(result.error);
      else if (result?.fieldErrors) setAccountFieldErrors(result.fieldErrors);
      else if (result?.success) setStep("done");
    });
  }

  if (shouldLeaveImmediately) {
    // Redirecting via the effect above — render nothing rather than
    // flashing the welcome screen for a user who's already done this.
    return null;
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <div className="h-5 w-5 rounded bg-accent-500" />
        <span className="text-sm font-semibold text-ink-900">Ledgerline</span>
      </div>

      {step === "welcome" && (
        <section>
          <Eyebrow>Welcome</Eyebrow>
          <Headline>
            Good to have you, <span className="italic">{organizationName}</span>.
          </Headline>
          <p className="mt-4 max-w-md text-base text-ink-600">
            Before your books can reconcile themselves, we need two things from you: a legal
            entity, and its first account. It takes about two minutes.
          </p>
          <SignatureDivider />
          <Button size="lg" onClick={() => setStep("entity")}>
            Begin setup
            <ArrowRight className="h-4 w-4" />
          </Button>
        </section>
      )}

      {step === "entity" && (
        <section>
          <Eyebrow>Step 1 of 2</Eyebrow>
          <Headline>Add your first entity.</Headline>
          <p className="mt-4 max-w-md text-base text-ink-600">
            An entity is a legal business unit with its own books — most organizations start
            with one.
          </p>

          <div className="mt-8 rounded-lg border border-ink-100 bg-white p-8">
            <div className="mb-5 flex h-9 w-9 items-center justify-center rounded-full bg-accent-50 text-accent-600">
              <Building2 className="h-4 w-4" />
            </div>
            <form onSubmit={handleEntitySubmit} className="flex flex-col gap-4">
              <Input
                name="name"
                label="Entity name"
                placeholder="Acme Inc."
                error={entityFieldErrors?.name}
                required
                autoFocus
              />
              <Input
                name="currency"
                label="Currency"
                defaultValue="USD"
                maxLength={3}
                hint="Three-letter ISO code, e.g. USD, GBP, NGN."
              />
              {entityError && (
                <p className="text-sm text-status-exception">{entityError}</p>
              )}
              <Button type="submit" loading={isPending} className="mt-2 self-start">
                Continue
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </section>
      )}

      {step === "account" && entityId && (
        <section>
          <Eyebrow>Step 2 of 2</Eyebrow>
          <Headline>Add your first account.</Headline>
          <p className="mt-4 max-w-md text-base text-ink-600">
            This is what you&apos;ll reconcile against — typically your primary operating bank
            account.
          </p>

          <div className="mt-8 rounded-lg border border-ink-100 bg-white p-8">
            <div className="mb-5 flex h-9 w-9 items-center justify-center rounded-full bg-accent-50 text-accent-600">
              <Landmark className="h-4 w-4" />
            </div>
            <form onSubmit={handleAccountSubmit} className="flex flex-col gap-4">
              <input type="hidden" name="entityId" value={entityId} />
              <Input
                name="name"
                label="Account name"
                placeholder="Operating Checking"
                error={accountFieldErrors?.name}
                required
                autoFocus
              />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-ink-700">Account type</label>
                <select
                  name="account_type"
                  defaultValue="asset"
                  className="h-9 rounded border border-ink-200 bg-white px-3 text-sm text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              {accountError && (
                <p className="text-sm text-status-exception">{accountError}</p>
              )}
              <div className="mt-2 flex items-center gap-3">
                <Button type="submit" loading={isPending}>
                  Add account
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" onClick={() => setStep("done")}>
                  Skip for now
                </Button>
              </div>
            </form>
          </div>
        </section>
      )}

      {step === "done" && (
        <section>
          <Eyebrow>You&apos;re set up</Eyebrow>
          <Headline italic>Everything&apos;s in order.</Headline>
          <p className="mt-4 max-w-md text-base text-ink-600">
            <span className="font-medium text-ink-900">{entityName || organizationName}</span> is
            ready
            {accountName ? (
              <>
                {" "}
                with <span className="font-medium text-ink-900">{accountName}</span> as its first
                account.
              </>
            ) : (
              " — you can add accounts any time from Entities."
            )}
          </p>
          <SignatureDivider />
          <Button size="lg" onClick={() => router.push("/dashboard")}>
            Go to dashboard
            <ArrowRight className="h-4 w-4" />
          </Button>
        </section>
      )}
    </div>
  );
}
