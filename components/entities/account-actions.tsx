"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import { setAccountArchived, unlinkAccount, updateAccount, type ManageState } from "@/lib/actions/entity-management";
import { Modal, ModalContent, ModalTrigger } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;

export interface AccountForActions {
  id: string;
  name: string;
  code: string | null;
  accountType: string;
  isReconcilable: boolean;
  archived: boolean;
  linked: boolean; // holds both a Plaid and a QuickBooks identity
}

function EditAccountDialog({ account }: { account: AccountForActions }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ManageState, FormData>(updateAccount, null);

  useEffect(() => {
    if (state?.success) setOpen(false);
  }, [state]);

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>
        <Button type="button" size="sm" variant="ghost">
          Edit
        </Button>
      </ModalTrigger>
      <ModalContent title="Edit account" description="Changes you make here are kept, even when QuickBooks is re-imported.">
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="accountId" value={account.id} />
          <Input name="name" label="Account name" defaultValue={account.name} required />
          <div className="grid grid-cols-2 gap-3">
            <Input name="code" label="Code" defaultValue={account.code ?? ""} required />
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`type-${account.id}`} className="text-sm font-medium text-ink-700">
                Type
              </label>
              <select
                id={`type-${account.id}`}
                name="accountType"
                defaultValue={account.accountType}
                className="h-9 rounded border border-ink-200 bg-white px-3 text-sm capitalize text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t} className="capitalize">
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex items-start gap-2.5 text-sm text-ink-800">
            <input
              type="checkbox"
              name="isReconcilable"
              defaultChecked={account.isReconcilable}
              className="mt-0.5 h-4 w-4 rounded border-ink-300 text-accent-500 focus:ring-accent-500"
            />
            <span>
              <span className="font-medium">Include in reconciliation</span>
              <span className="block text-xs text-ink-500">
                Bank and credit-card accounts should be on. Accounts that are off don&apos;t appear in reconciliation or the link list.
              </span>
            </span>
          </label>
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

/** Row actions on the entity page: Reconcile, Edit, Archive/Restore, and Unlink for merged accounts. */
export function AccountActions({ account, canUnlink }: { account: AccountForActions; canUnlink: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; tone: "error" | "ok" } | null>(null);

  const archive = () => {
    const text = account.archived
      ? `Restore ${account.name}?`
      : `Archive ${account.name}?\n\nIt will be hidden from reconciliation. Its transactions are kept, and you can restore it at any time.`;
    if (!window.confirm(text)) return;
    setMessage(null);
    startTransition(async () => {
      const res = await setAccountArchived(account.id, !account.archived);
      if (res.error) setMessage({ text: res.error, tone: "error" });
    });
  };

  const unlink = () => {
    const text =
      `Unlink ${account.name}?\n\nThe QuickBooks half is split back out into its own account, with its transactions. ` +
      `Any confirmed matches between the bank and QuickBooks sides are reset to unmatched.`;
    if (!window.confirm(text)) return;
    setMessage(null);
    startTransition(async () => {
      const res = await unlinkAccount(account.id);
      if (res.error) setMessage({ text: res.error, tone: "error" });
      else setMessage({ text: `Split out as “${res.newAccountName}”.`, tone: "ok" });
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-1">
        {!account.archived && account.isReconcilable && (
          <Link
            href={`/reconciliation/${account.id}`}
            className="inline-flex h-8 items-center rounded px-3 text-sm font-medium text-accent-600 hover:bg-accent-50"
          >
            Reconcile
          </Link>
        )}
        {!account.archived && <EditAccountDialog account={account} />}
        {!account.archived && account.linked && canUnlink && (
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={unlink}>
            Unlink
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={archive}>
          {account.archived ? "Restore" : "Archive"}
        </Button>
      </div>
      {message && (
        <p className={`max-w-[18rem] text-right text-xs ${message.tone === "error" ? "text-status-exception" : "text-status-matched"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
