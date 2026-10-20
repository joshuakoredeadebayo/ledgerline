"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Percent } from "lucide-react";
import { buildVatLines, categoryById, VAT_CATEGORIES, VAT_CODE_HELP, VAT_CODE_LABELS } from "@/lib/vat";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { FormAccount, FormEntity, FormLine } from "@/components/journal/journal-entry-form";

const selectClass =
  "h-9 w-full rounded border border-ink-200 bg-white px-2.5 text-sm text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500";

const TYPE_ORDER = ["asset", "liability", "equity", "revenue", "expense"];

function AccountSelect({
  value,
  onChange,
  accounts,
  placeholder,
  prefer,
}: {
  value: string;
  onChange: (id: string) => void;
  accounts: FormAccount[];
  placeholder: string;
  prefer: string[];
}) {
  const order = [...prefer, ...TYPE_ORDER.filter((t) => !prefer.includes(t))];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
      <option value="">{placeholder}</option>
      {order.map((type) => {
        const items = accounts.filter((a) => a.accountType === type);
        if (items.length === 0) return null;
        return (
          <optgroup key={type} label={type.charAt(0).toUpperCase() + type.slice(1)}>
            {items.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code ? `${a.code} · ` : ""}
                {a.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

/**
 * Works out the VAT on a sale or purchase and fills in the journal lines for you: the revenue (or cost)
 * at the net amount, the VAT on its own line in the VAT account, and the bank line at the total.
 */
export function VatHelper({
  entity,
  accounts,
  defaultAmount,
  defaultSettlementId,
  onApply,
}: {
  entity: FormEntity;
  accounts: FormAccount[];
  defaultAmount: number | null;
  defaultSettlementId: string | null;
  onApply: (lines: FormLine[], categoryLabel: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"sale" | "purchase">("sale");
  const [categoryId, setCategoryId] = useState("professional");
  const [amount, setAmount] = useState(defaultAmount ? String(defaultAmount) : "");
  const [inclusive, setInclusive] = useState(true);
  const [settlementId, setSettlementId] = useState(defaultSettlementId ?? "");
  const [mainId, setMainId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const vatAccountIds = new Set([entity.vatOutputAccountId, entity.vatInputAccountId].filter(Boolean) as string[]);
  const usable = useMemo(() => accounts.filter((a) => !vatAccountIds.has(a.id)), [accounts, entity.vatOutputAccountId, entity.vatInputAccountId]); // eslint-disable-line react-hooks/exhaustive-deps
  const settlementOptions = usable.filter((a) => a.accountType === "asset" || a.accountType === "liability");
  const mainOptions = usable.filter((a) => a.id !== settlementId);

  const amountCents = Math.round(Number(amount) * 100);
  const ready = Number.isFinite(amountCents) && amountCents > 0 && settlementId && mainId;

  const built = useMemo(() => {
    if (!ready) return null;
    return buildVatLines({
      kind,
      categoryId,
      amountCents,
      inclusive,
      ratePercent: entity.vatRate,
      registered: entity.vatRegistered,
      settlementAccountId: settlementId,
      mainAccountId: mainId,
      outputVatAccountId: entity.vatOutputAccountId,
      inputVatAccountId: entity.vatInputAccountId,
    });
  }, [ready, kind, categoryId, amountCents, inclusive, entity, settlementId, mainId]);

  const category = categoryById(categoryId);
  const groups = [...new Set(VAT_CATEGORIES.map((c) => c.group))];

  if (!entity.vatRegistered) {
    return (
      <div className="rounded-xl border border-ink-100 bg-white px-5 py-3 text-sm text-ink-600 shadow-subtle">
        <span className="font-medium text-ink-900">VAT helper.</span> {entity.name} isn&apos;t registered for VAT, so entries are booked without VAT. If it is registered,{" "}
        <Link href={`/entities/${entity.id}`} className="font-medium text-accent-600 hover:text-accent-700">
          turn VAT on in its settings
        </Link>
        .
      </div>
    );
  }

  const missingAccounts = !entity.vatOutputAccountId || !entity.vatInputAccountId;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-xl border border-dashed border-accent-300 bg-accent-50 px-5 py-3 text-left text-sm font-medium text-accent-700 hover:bg-accent-100"
      >
        <Percent className="h-4 w-4" />
        Add VAT ({entity.vatRate}%): work out the VAT and fill in the lines for me
      </button>
    );
  }

  return (
    <section className="space-y-4 rounded-xl border border-accent-300 bg-white p-5 shadow-subtle">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink-900">VAT helper ({entity.vatRate}%)</h2>
          <p className="mt-0.5 text-xs text-ink-500">Fills in the entry lines below. You can still change them afterwards, and the VAT is checked again before posting.</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-xs font-medium text-ink-500 hover:text-ink-800">
          Close
        </button>
      </div>

      {missingAccounts && (
        <p className="rounded-lg border border-status-pending/30 bg-status-pendingBg px-4 py-3 text-sm text-ink-800">
          This entity has no Output VAT or Input VAT account yet.{" "}
          <Link href={`/entities/${entity.id}`} className="font-medium text-accent-700 underline">
            Set them up in its VAT settings
          </Link>{" "}
          (one click creates both), then come back.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
          What is it?
          <select value={kind} onChange={(e) => setKind(e.target.value as "sale" | "purchase")} className={selectClass}>
            <option value="sale">A sale: money received for goods or services</option>
            <option value="purchase">A purchase: money paid for goods or services</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700 lg:col-span-2">
          Type of supply
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={selectClass}>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {VAT_CATEGORIES.filter((c) => c.group === g).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {category && (
            <span className="text-xs font-normal text-ink-500">
              {VAT_CODE_LABELS[category.code]}. {VAT_CODE_HELP[category.code]}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
          Amount
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${selectClass} text-right tabular-nums`}
          />
          <span className="flex items-center gap-2 text-xs font-normal text-ink-600">
            <input type="checkbox" checked={inclusive} onChange={(e) => setInclusive(e.target.checked)} className="h-4 w-4 rounded border-ink-300 text-accent-500 focus:ring-accent-500" />
            This amount already includes VAT
          </span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
          {kind === "sale" ? "Money received into" : "Money paid from"}
          <AccountSelect value={settlementId} onChange={setSettlementId} accounts={settlementOptions} placeholder="Choose the bank or cash account…" prefer={["asset", "liability"]} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
          {kind === "sale" ? "Revenue account" : "Expense (or asset) account"}
          <AccountSelect value={mainId} onChange={setMainId} accounts={mainOptions} placeholder="Choose an account…" prefer={kind === "sale" ? ["revenue"] : ["expense", "asset"]} />
        </label>
      </div>

      {built && !built.problem && (
        <dl className="grid grid-cols-3 gap-4 rounded-lg bg-ink-50 px-4 py-3 text-sm">
          <div>
            <dt className="text-xs text-ink-500">{kind === "sale" ? "Revenue (net)" : "Cost (net)"}</dt>
            <dd className="font-semibold tabular-nums text-ink-900">{formatCurrency(built.split.netCents / 100, entity.currency)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-500">{built.code === "STD" ? `VAT at ${entity.vatRate}%` : "VAT"}</dt>
            <dd className="font-semibold tabular-nums text-ink-900">{formatCurrency(built.split.vatCents / 100, entity.currency)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-500">Total</dt>
            <dd className="font-semibold tabular-nums text-ink-900">{formatCurrency(built.split.grossCents / 100, entity.currency)}</dd>
          </div>
        </dl>
      )}
      {built?.problem && <p className="text-sm text-status-exception">{built.problem}</p>}
      {error && <p className="text-sm text-status-exception">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={!built || !!built.problem || missingAccounts}
          onClick={() => {
            if (!built || built.problem) {
              setError(built?.problem ?? "Fill in the amount and both accounts first.");
              return;
            }
            onApply(
              built.lines.map((l) => ({
                accountId: l.accountId,
                debit: l.debit ? String(l.debit) : "",
                credit: l.credit ? String(l.credit) : "",
                memo: l.memo,
                vat: l.vat ?? null,
              })),
              category?.label ?? "VAT entry"
            );
            setOpen(false);
          }}
        >
          Fill in the entry lines
        </Button>
        <span className="text-xs text-ink-500">This replaces the lines currently in the entry.</span>
      </div>
    </section>
  );
}
