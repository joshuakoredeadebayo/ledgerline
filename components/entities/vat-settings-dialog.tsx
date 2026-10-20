"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Percent } from "lucide-react";
import { createVatAccounts, saveVatSettings } from "@/lib/actions/vat";
import { Modal, ModalContent, ModalTrigger } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

export interface VatDialogEntity {
  id: string;
  name: string;
  registered: boolean;
  vatNumber: string;
  ratePercent: number;
  outputAccountId: string | null;
  inputAccountId: string | null;
  recoverablePercent: number;
}

export interface VatDialogAccount {
  id: string;
  name: string;
  code: string | null;
  accountType: string;
}

const field =
  "h-9 w-full rounded border border-ink-200 bg-white px-2.5 text-sm text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500";

export function VatSettingsDialog({ entity, accounts }: { entity: VatDialogEntity; accounts: VatDialogAccount[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [registered, setRegistered] = useState(entity.registered);
  const [vatNumber, setVatNumber] = useState(entity.vatNumber);
  const [rate, setRate] = useState(String(entity.ratePercent));
  const [outputId, setOutputId] = useState(entity.outputAccountId ?? "");
  const [inputId, setInputId] = useState(entity.inputAccountId ?? "");
  const [recoverable, setRecoverable] = useState(String(entity.recoverablePercent));
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const label = (a: VatDialogAccount) => `${a.code ? `${a.code} · ` : ""}${a.name}`;
  const liabilities = accounts.filter((a) => a.accountType === "liability");
  const inputCandidates = accounts.filter((a) => a.accountType === "asset" || a.accountType === "liability");

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await saveVatSettings({
        entityId: entity.id,
        registered,
        vatNumber,
        ratePercent: Number(rate),
        outputAccountId: outputId || null,
        inputAccountId: inputId || null,
        recoverablePercent: Number(recoverable),
      });
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  };

  const makeAccounts = () => {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const res = await createVatAccounts(entity.id);
      if (res.error) setError(res.error);
      else {
        setOutputId(res.outputAccountId ?? "");
        setInputId(res.inputAccountId ?? "");
        setNote("Created “Output VAT payable” and “Input VAT recoverable”. Save to finish.");
        router.refresh();
      }
    });
  };

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>
        <Button type="button" size="sm" variant="secondary">
          <Percent className="h-3.5 w-3.5" />
          VAT settings
        </Button>
      </ModalTrigger>
      <ModalContent title={`VAT settings for ${entity.name}`} description="Used by the VAT helper in journal entries and by the VAT report.">
        <div className="space-y-4">
          <label className="flex items-start gap-2.5 text-sm text-ink-800">
            <input type="checkbox" checked={registered} onChange={(e) => setRegistered(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-ink-300 text-accent-500 focus:ring-accent-500" />
            <span>
              <span className="font-medium">This entity is registered for VAT</span>
              <span className="block text-xs text-ink-500">Turn this off if it is below the registration threshold or not registered. Entries are then booked without VAT.</span>
            </span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
              VAT rate (%)
              <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className={field} />
              <span className="text-xs font-normal text-ink-500">Nigeria&apos;s standard rate is 7.5.</span>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
              VAT or tax ID number
              <input value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} maxLength={30} className={field} />
            </label>
          </div>

          <div className="space-y-3 rounded-lg bg-ink-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-ink-800">VAT accounts</p>
              <button type="button" onClick={makeAccounts} disabled={pending} className="text-xs font-medium text-accent-600 hover:text-accent-700 disabled:opacity-50">
                Create them for me
              </button>
            </div>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
              Output VAT (VAT you collect and owe)
              <select value={outputId} onChange={(e) => setOutputId(e.target.value)} className={field}>
                <option value="">Choose a liability account…</option>
                {liabilities.map((a) => (
                  <option key={a.id} value={a.id}>
                    {label(a)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
              Input VAT (VAT you pay and can reclaim)
              <select value={inputId} onChange={(e) => setInputId(e.target.value)} className={field}>
                <option value="">Choose an asset account…</option>
                {inputCandidates.map((a) => (
                  <option key={a.id} value={a.id}>
                    {label(a)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
            Share of input VAT you can reclaim (%)
            <input value={recoverable} onChange={(e) => setRecoverable(e.target.value)} inputMode="decimal" className={`${field} max-w-[8rem]`} />
            <span className="text-xs font-normal text-ink-500">
              100 when your costs relate to taxable or zero-rated sales. Lower it if some costs also serve exempt sales; your tax adviser can tell you the right figure.
            </span>
          </label>

          {note && <p className="text-sm text-status-matched">{note}</p>}
          {error && (
            <p role="alert" className="text-sm text-status-exception">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" loading={pending} onClick={save}>
              Save VAT settings
            </Button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}
