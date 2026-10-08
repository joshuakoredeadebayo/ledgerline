"use client";

import { useState, useTransition } from "react";
import { changeMemberRole, removeMember, resendInvitation, revokeInvitation } from "@/lib/actions/members";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

/** Role dropdown + Remove button for one roster row. */
export function MemberRowActions({
  userId,
  email,
  currentRole,
  assignableRoles,
}: {
  userId: string;
  email: string;
  currentRole: Role;
  assignableRoles: Role[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const options = assignableRoles.includes(currentRole) ? assignableRoles : [currentRole, ...assignableRoles];

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <select
          aria-label={`Role for ${email}`}
          value={currentRole}
          disabled={pending}
          onChange={(e) => {
            setError(null);
            startTransition(async () => {
              const res = await changeMemberRole(userId, e.target.value as Role);
              if (res.error) setError(res.error);
            });
          }}
          className="h-8 min-w-[8.5rem] rounded border border-ink-200 bg-white py-0 pl-2 pr-8 text-sm text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
        >
          {options.map((r) => (
            <option key={r} value={r} disabled={!assignableRoles.includes(r)}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`Remove ${email} from this organization? They will lose access immediately.`)) return;
            setError(null);
            startTransition(async () => {
              const res = await removeMember(userId);
              if (res.error) setError(res.error);
            });
          }}
        >
          Remove
        </Button>
      </div>
      {error && <p className="max-w-[16rem] text-right text-xs text-status-exception">{error}</p>}
    </div>
  );
}

export function RevokeInvitationButton({ invitationId, email }: { invitationId: string; email: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Revoke the invitation for ${email}? Their link will stop working.`)) return;
          setError(null);
          startTransition(async () => {
            const res = await revokeInvitation(invitationId);
            if (res.error) setError(res.error);
          });
        }}
      >
        Revoke
      </Button>
      {error && <span className="text-xs text-status-exception">{error}</span>}
    </span>
  );
}

export function ResendInvitationButton({ invitationId }: { invitationId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; tone: "error" | "ok" } | null>(null);

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const res = await resendInvitation(invitationId);
            if (res.error) setMessage({ text: res.error, tone: "error" });
            else if (res.success) setMessage({ text: res.success, tone: "ok" });
          });
        }}
      >
        Resend email
      </Button>
      {message && (
        <span className={`max-w-[16rem] text-right text-xs ${message.tone === "error" ? "text-status-exception" : "text-status-matched"}`}>
          {message.text}
        </span>
      )}
    </span>
  );
}
