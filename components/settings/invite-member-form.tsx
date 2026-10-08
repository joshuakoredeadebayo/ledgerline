"use client";

import { useActionState } from "react";
import { inviteMember, type MemberActionState } from "@/lib/actions/members";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CopyLinkButton } from "@/components/settings/copy-link-button";

export function InviteMemberForm({ roles, emailConfigured }: { roles: Role[]; emailConfigured: boolean }) {
  const [state, formAction, pending] = useActionState<MemberActionState, FormData>(inviteMember, null);

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1">
          <Input name="email" type="email" label="Email address" placeholder="colleague@company.com" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-role" className="text-sm font-medium text-ink-700">
            Role
          </label>
          <select
            id="invite-role"
            name="role"
            defaultValue={roles[roles.length - 2] ?? roles[0]}
            className="h-9 min-w-[9rem] rounded border border-ink-200 bg-white py-0 pl-3 pr-8 text-sm text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" loading={pending}>
          Create invitation
        </Button>
      </form>

      {state?.error && (
        <p role="alert" className="text-sm text-status-exception">
          {state.error}
        </p>
      )}

      {state?.inviteLink && (
        <div
          className={
            state.emailStatus === "sent"
              ? "rounded-lg border border-status-matched/20 bg-status-matchedBg p-3 text-sm"
              : "rounded-lg border border-status-pending/20 bg-status-pendingBg p-3 text-sm"
          }
        >
          <p className="font-medium text-ink-900">{state.success}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1.5 text-xs text-ink-800">{state.inviteLink}</code>
            <CopyLinkButton text={state.inviteLink} />
          </div>
          <p className="mt-2 text-xs text-ink-600">It works once and expires in 14 days.</p>
        </div>
      )}

      {!state?.inviteLink && !emailConfigured && (
        <p className="text-xs text-ink-500">
          Email sending isn&apos;t set up yet, so you&apos;ll get a link to share yourself. See the setup note in the project README to turn it on.
        </p>
      )}
    </div>
  );
}
