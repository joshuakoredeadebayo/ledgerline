"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { saveJournalEntry } from "@/lib/actions/journal-entries";
import { checkJournalLines } from "@/lib/journal-math";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface FormEntity {
  id: string;
  name: string;
  currency: string;
}

export interface FormAccount {
  id: string;
  entityId: string;
  name: string;
  code: string | null;
  accountType: string;
  reconcilable: boolean;
}

export interface FormLine {
  accountId: string;
  debit: string;
  credit: string;
  memo: string;
}

export interface JournalFormInitial {
  id?: string;
  entityId: string;
  entryDate: string;
  description: string;
  lines: FormLine[];
}

const TYPE_ORDER = ["asset", "liability", "equity", "revenue", "expense"];
const blankLine = (): FormLine => ({ accountId: "", debit: "", credit: "", memo: "" });

const inputClass =
  "h-9 w-full rounded border border-ink-200 bg-white px-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500";

/**
 * Create or edit a draft journal entry. Totals and the balance check update as you type, so you
 * can see at a glance whether the entry will post. A draft may be saved unbalanced; posting needs it balanced.
 */
export function JournalEntryForm({
  entities,
  accounts,
  initial,
  canPost,
}: {
  entities: FormEntity[];
  accounts: FormAccount[];
  initial: JournalFormInitial;
  canPost: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [entityId, setEntityId] = useState(initial.entityId);
  const [entryDate, setEntryDate] = useState(initial.entryDate);
  const [description, setDescription] = useState(initial.description);
  const [lines, setLines] = useState<FormLine[]>(initial.lines.length >= 2 ? initial.lines : [...initial.lines, blankLine(), blankLine()].slice(0, Math.max(2, initial.lines.length)));
  const [error, setError] = useState<string | null>(null);
  const keys = useRef<number[]>(lines.map((_, i) => i));
  const nextKey = useRef(lines.length);

  const entity = entities.find((e) => e.id === entityId);
  const entityAccounts = useMemo(() => accounts.filter((a) => a.entityId === entityId), [accounts, entityId]);
  const grouped = useMemo(
    () =>
      TYPE_ORDER.map((type) => ({ type, items: entityAccounts.filter((a) => a.accountType === type) })).filter((g) => g.items.length > 0),
    [entityAccounts]
  );

  const check = checkJournalLines(lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo })));
  const diff = (check.totalDebitCents - check.totalCreditCents) / 100;
  const balanced = check.totalDebitCents === check.totalCreditCents && check.totalDebitCents > 0;
  const currency = entity?.currency ?? "USD";
  const feedAccounts = lines
    .map((l) => entityAccounts.find((a) => a.id === l.accountId))
    .filter((a): a is FormAccount => !!a && a.reconcilable);

  const update = (index: number, patch: Partial<FormLine>) =>
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const addLine = () => {
    keys.current.push(nextKey.current++);
    setLines((prev) => [...prev, blankLine()]);
  };
  const removeLine = (index: number) => {
    keys.current.splice(index, 1);
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const changeEntity = (id: string) => {
    setEntityId(id);
    // Accounts belong to one entity, so any already chosen would no longer be valid.
    setLines((prev) => prev.map((l) => ({ ...l, accountId: "" })));
  };

  const submit = (postNow: boolean) => {
    setError(null);
    startTransition(async () => {
      const res = await saveJournalEntry({
        id: initial.id,
        entityId,
        entryDate,
        description,
        lines: lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo })),
        postNow,
      });
      if (res.error) {
        setError(res.error);
        // A draft that was saved but couldn't post still exists; take them to it.
        if (res.id && !initial.id) router.replace(`/journal-entries/${res.id}/edit`);
        return;
      }
      router.push(`/journal-entries/${res.id}`);
    });
  };

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-1 gap-4 rounded-xl border border-ink-100 bg-white p-5 shadow-subtle sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
          Entity
          <select
            value={entityId}
            onChange={(e) => changeEntity(e.target.value)}
            className="h-9 rounded border border-ink-200 bg-white px-2.5 text-sm font-normal text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
          >
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.currency})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
          Date
          <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700 sm:col-span-3">
          Description
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={300}
            placeholder="What is this entry for?"
            className={inputClass}
          />
        </label>
      </section>

      <section className="overflow-x-auto rounded-xl border border-ink-100 bg-white shadow-subtle">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-ink-100 bg-ink-50 text-left text-xs font-medium text-ink-500">
              <th className="px-4 py-2.5 font-medium">Account</th>
              <th className="w-36 px-2 py-2.5 text-right font-medium">Debit</th>
              <th className="w-36 px-2 py-2.5 text-right font-medium">Credit</th>
              <th className="px-2 py-2.5 font-medium">Memo (optional)</th>
              <th className="w-10 px-2 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {lines.map((line, index) => (
              <tr key={keys.current[index]} className="align-top">
                <td className="px-4 py-2">
                  <select
                    aria-label={`Account for line ${index + 1}`}
                    value={line.accountId}
                    onChange={(e) => update(index, { accountId: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">Choose an account…</option>
                    {grouped.map((g) => (
                      <optgroup key={g.type} label={g.type.charAt(0).toUpperCase() + g.type.slice(1)}>
                        {g.items.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code ? `${a.code} · ` : ""}
                            {a.name}
                            {a.reconcilable ? "  (bank/card)" : ""}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2">
                  <input
                    aria-label={`Debit for line ${index + 1}`}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={line.debit}
                    onChange={(e) => update(index, { debit: e.target.value, credit: e.target.value ? "" : line.credit })}
                    className={`${inputClass} text-right tabular-nums`}
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    aria-label={`Credit for line ${index + 1}`}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={line.credit}
                    onChange={(e) => update(index, { credit: e.target.value, debit: e.target.value ? "" : line.debit })}
                    className={`${inputClass} text-right tabular-nums`}
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    aria-label={`Memo for line ${index + 1}`}
                    value={line.memo}
                    onChange={(e) => update(index, { memo: e.target.value })}
                    maxLength={200}
                    className={inputClass}
                  />
                </td>
                <td className="px-2 py-2 text-right">
                  {lines.length > 2 && (
                    <button type="button" aria-label={`Remove line ${index + 1}`} onClick={() => removeLine(index)} className="rounded p-1.5 text-ink-400 hover:bg-ink-50 hover:text-ink-700">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-ink-100 bg-ink-50 text-sm font-medium text-ink-900">
              <td className="px-4 py-3">
                <button type="button" onClick={addLine} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-600 hover:text-accent-700">
                  <Plus className="h-3.5 w-3.5" />
                  Add a line
                </button>
              </td>
              <td className="px-2 py-3 text-right tabular-nums">{formatCurrency(check.totalDebitCents / 100, currency)}</td>
              <td className="px-2 py-3 text-right tabular-nums">{formatCurrency(check.totalCreditCents / 100, currency)}</td>
              <td colSpan={2} className="px-2 py-3 text-xs">
                {balanced ? (
                  <span className="text-status-matched">Balanced</span>
                ) : check.totalDebitCents + check.totalCreditCents === 0 ? (
                  <span className="text-ink-500">Enter amounts</span>
                ) : (
                  <span className="text-status-pending">Out of balance by {formatCurrency(Math.abs(diff), currency)}</span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      {feedAccounts.length > 0 && (
        <p className="rounded-lg border border-accent-100 bg-accent-50 px-4 py-3 text-sm text-ink-800">
          Once posted, the lines on {[...new Set(feedAccounts.map((a) => a.name))].join(", ")} appear in that account&apos;s reconciliation as ledger items,
          where they can be matched against the bank transaction they explain. A credit counts as money out, a debit as money in.
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-status-exception/20 bg-status-exceptionBg px-4 py-3 text-sm text-status-exception">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" loading={pending} onClick={() => submit(false)}>
          Save draft
        </Button>
        {canPost && (
          <Button type="button" loading={pending} disabled={!balanced} onClick={() => submit(true)} title={balanced ? "" : "Debits and credits must be equal to post"}>
            Save and post
          </Button>
        )}
        <Link href={initial.id ? `/journal-entries/${initial.id}` : "/journal-entries"} className="text-sm font-medium text-ink-600 hover:text-ink-900">
          Cancel
        </Link>
        {!canPost && <span className="text-xs text-ink-500">A controller or owner reviews and posts drafts.</span>}
      </div>
    </div>
  );
}
