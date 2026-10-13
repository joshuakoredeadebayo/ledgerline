"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FileUp } from "lucide-react";
import { finishStatementImport, importStatementBatch } from "@/lib/actions/statement-import";
import {
  detectDateFormat,
  guessSettings,
  normalizeRows,
  parseDelimited,
  type DateFormat,
  type ImportSettings,
} from "@/lib/statement-import";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const BATCH_SIZE = 500;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const selectClass =
  "h-9 w-full rounded border border-ink-200 bg-white px-2.5 text-sm text-ink-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500";

type Phase = "choose" | "review" | "importing" | "done";

interface Result {
  inserted: number;
  duplicates: number;
  problems: number;
  months: string[];
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
      {label}
      {children}
      {hint && <span className="text-xs font-normal text-ink-500">{hint}</span>}
    </label>
  );
}

/**
 * Import a bank statement saved as CSV into one account. Choose the file, confirm which column is
 * which (they are guessed for you), check the preview, and import. Rows already imported are skipped.
 */
export function StatementImport({ accountId, accountName, currency }: { accountId: string; accountName: string; currency: string }) {
  const [phase, setPhase] = useState<Phase>("choose");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [settings, setSettings] = useState<ImportSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  const readFile = async (file: File) => {
    setError(null);
    if (file.size > MAX_FILE_BYTES) {
      setError("That file is larger than 5 MB. Split the statement into smaller periods and import them one at a time.");
      return;
    }
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      setError("This is an Excel file. In Excel choose File → Save As → CSV, then choose the CSV file here.");
      return;
    }
    const text = await file.text();
    // Blank lines are kept so the line numbers shown in messages match the file as it opens in Excel.
    const parsed = parseDelimited(text);
    if (parsed.filter((r) => r.some((c) => c !== "")).length < 2) {
      setError("That file doesn't look like a statement: it has fewer than two rows.");
      return;
    }
    setFileName(file.name);
    setRows(parsed);
    setSettings(guessSettings(parsed));
    setPhase("review");
  };

  const normalized = useMemo(() => (settings ? normalizeRows(rows, settings) : null), [rows, settings]);
  const dateCheck = useMemo(
    () => (settings ? detectDateFormat(rows.slice(settings.headerRow + 1).map((r) => r[settings.dateCol] ?? "")) : null),
    [rows, settings]
  );

  const header = settings ? (rows[settings.headerRow] ?? []) : [];
  const columnOptions = (optional: boolean) => (
    <>
      {optional && <option value={-1}>None</option>}
      {!optional && <option value={-1}>Choose a column…</option>}
      {header.map((h, i) => (
        <option key={i} value={i}>
          {i + 1}: {h || "(blank)"}
        </option>
      ))}
    </>
  );

  const set = (patch: Partial<ImportSettings>) => setSettings((s) => (s ? { ...s, ...patch } : s));

  const changeHeaderRow = (index: number) => {
    // Re-guess the columns for the new header row, keeping the person's other choices where possible.
    const guess = guessSettings(rows, index);
    setSettings((s) => (s ? { ...guess, positiveMeans: s.positiveMeans } : guess));
  };

  const missing =
    !settings ||
    settings.dateCol < 0 ||
    (settings.mode === "split" ? settings.debitCol < 0 && settings.creditCol < 0 : settings.amountCol < 0);

  const valid = normalized?.rows ?? [];
  const totalOut = valid.filter((r) => r.amount > 0).reduce((n, r) => n + r.amount, 0);
  const totalIn = valid.filter((r) => r.amount < 0).reduce((n, r) => n - r.amount, 0);
  const dates = valid.map((r) => r.date).sort();

  const run = async () => {
    if (!normalized || valid.length === 0) return;
    setPhase("importing");
    setError(null);
    const batchId = crypto.randomUUID();
    let inserted = 0;
    let duplicates = 0;
    try {
      for (let i = 0; i < valid.length; i += BATCH_SIZE) {
        setProgress(`Importing ${Math.min(i + BATCH_SIZE, valid.length).toLocaleString()} of ${valid.length.toLocaleString()}…`);
        const res = await importStatementBatch({ accountId, batchId, fileName, rows: valid.slice(i, i + BATCH_SIZE) });
        if (res.error) throw new Error(res.error);
        inserted += res.inserted ?? 0;
        duplicates += res.duplicates ?? 0;
      }
      const months = [...new Set(valid.map((r) => r.date.slice(0, 7)))];
      const done = await finishStatementImport({
        accountId,
        batchId,
        fileName,
        inserted,
        duplicates,
        skippedRows: normalized.problems.length,
        months,
      });
      if (done.error) throw new Error(done.error);
      setResult({ inserted, duplicates, problems: normalized.problems.length, months });
      setPhase("done");
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : "The import stopped."}${inserted > 0 ? ` ${inserted} rows were saved before it stopped; importing the file again will skip them.` : ""}`
      );
      setPhase("review");
    }
  };

  const reset = () => {
    setPhase("choose");
    setRows([]);
    setSettings(null);
    setResult(null);
    setError(null);
    setFileName("");
  };

  // ── Step 1: choose a file ─────────────────────────────────────────
  if (phase === "choose") {
    return (
      <div className="space-y-4">
        <label className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-ink-200 bg-white px-6 py-12 text-center hover:border-accent-300 hover:bg-accent-50/40">
          <FileUp className="h-8 w-8 text-ink-400" />
          <span className="text-sm font-medium text-ink-900">Choose a statement file (CSV)</span>
          <span className="max-w-md text-xs text-ink-500">
            Export the statement from your bank or wallet and save it as CSV. In Excel: File → Save As → CSV. The file stays in your browser until you
            confirm the import.
          </span>
          <input
            type="file"
            accept=".csv,.txt,.tsv,text/csv,text/plain"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readFile(f);
              e.target.value = "";
            }}
          />
        </label>
        {error && (
          <p role="alert" className="rounded-lg border border-status-exception/20 bg-status-exceptionBg px-4 py-3 text-sm text-status-exception">
            {error}
          </p>
        )}
      </div>
    );
  }

  // ── Step 4: done ──────────────────────────────────────────────────
  if (phase === "done" && result) {
    const latest = [...result.months].sort().pop();
    return (
      <div className="space-y-4 rounded-xl border border-status-matched/20 bg-status-matchedBg p-6">
        <h2 className="text-lg font-semibold text-ink-900">Import complete</h2>
        <ul className="space-y-1 text-sm text-ink-800">
          <li>{result.inserted.toLocaleString()} new transaction{result.inserted === 1 ? "" : "s"} added to {accountName}.</li>
          {result.duplicates > 0 && <li>{result.duplicates.toLocaleString()} already there, so skipped.</li>}
          {result.problems > 0 && <li>{result.problems.toLocaleString()} row{result.problems === 1 ? "" : "s"} couldn&apos;t be read and {result.problems === 1 ? "was" : "were"} left out.</li>}
        </ul>
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/reconciliation/${accountId}${latest ? `?period=${latest}` : ""}`}
            className="inline-flex h-9 items-center rounded bg-accent-500 px-4 text-sm font-medium text-white hover:bg-accent-600"
          >
            Go to reconciliation
          </Link>
          <Button variant="secondary" onClick={reset}>
            Import another file
          </Button>
        </div>
      </div>
    );
  }

  // ── Steps 2 and 3: confirm columns, preview ───────────────────────
  if (!settings || !normalized) return null;
  const importing = phase === "importing";

  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-xl border border-ink-100 bg-white p-5 shadow-subtle">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-ink-900">1. Check the columns</h2>
          <button type="button" onClick={reset} disabled={importing} className="text-xs font-medium text-accent-600 hover:text-accent-700 disabled:opacity-50">
            Choose a different file
          </button>
        </div>
        <p className="text-xs text-ink-500">
          {fileName} · {rows.length.toLocaleString()} lines. We guessed the columns from the headings; change anything that looks wrong.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Heading row" hint="The row that holds the column names.">
            <select value={settings.headerRow} onChange={(e) => changeHeaderRow(Number(e.target.value))} className={selectClass}>
              {rows.slice(0, 25).map((r, i) => (
                <option key={i} value={i}>
                  Line {i + 1}: {r.filter(Boolean).slice(0, 3).join(" · ") || "(blank)"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <select value={settings.dateCol} onChange={(e) => set({ dateCol: Number(e.target.value) })} className={selectClass}>
              {columnOptions(false)}
            </select>
          </Field>
          <Field label="Description">
            <select value={settings.descCol} onChange={(e) => set({ descCol: Number(e.target.value) })} className={selectClass}>
              {columnOptions(true)}
            </select>
          </Field>

          <Field label="How are amounts shown?">
            <select value={settings.mode} onChange={(e) => set({ mode: e.target.value as ImportSettings["mode"] })} className={selectClass}>
              <option value="split">Separate debit and credit columns</option>
              <option value="single">One amount column</option>
            </select>
          </Field>
          {settings.mode === "split" ? (
            <>
              <Field label="Debit (money out)">
                <select value={settings.debitCol} onChange={(e) => set({ debitCol: Number(e.target.value) })} className={selectClass}>
                  {columnOptions(true)}
                </select>
              </Field>
              <Field label="Credit (money in)">
                <select value={settings.creditCol} onChange={(e) => set({ creditCol: Number(e.target.value) })} className={selectClass}>
                  {columnOptions(true)}
                </select>
              </Field>
            </>
          ) : (
            <>
              <Field label="Amount">
                <select value={settings.amountCol} onChange={(e) => set({ amountCol: Number(e.target.value) })} className={selectClass}>
                  {columnOptions(false)}
                </select>
              </Field>
              <Field label="A positive amount means" hint="Most statements show money in as positive.">
                <select value={settings.positiveMeans} onChange={(e) => set({ positiveMeans: e.target.value as "in" | "out" })} className={selectClass}>
                  <option value="in">Money coming in</option>
                  <option value="out">Money going out</option>
                </select>
              </Field>
            </>
          )}

          <Field label="Reference (optional)">
            <select value={settings.refCol} onChange={(e) => set({ refCol: Number(e.target.value) })} className={selectClass}>
              {columnOptions(true)}
            </select>
          </Field>
          <Field label="Running balance (optional)" hint="Kept with each transaction for later checks.">
            <select value={settings.balanceCol} onChange={(e) => set({ balanceCol: Number(e.target.value) })} className={selectClass}>
              {columnOptions(true)}
            </select>
          </Field>
          <Field label="Date order">
            <select value={settings.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as DateFormat })} className={selectClass}>
              <option value="dmy">Day / month / year (14/08/2026)</option>
              <option value="mdy">Month / day / year (08/14/2026)</option>
              <option value="ymd">Year-month-day (2026-08-14)</option>
            </select>
          </Field>
          <Field label="Numbers look like">
            <select value={settings.decimal} onChange={(e) => set({ decimal: e.target.value as "." | "," })} className={selectClass}>
              <option value=".">1,234.56</option>
              <option value=",">1.234,56</option>
            </select>
          </Field>
        </div>

        {dateCheck?.ambiguous && (
          <p className="rounded-lg border border-status-pending/30 bg-status-pendingBg px-4 py-3 text-sm text-ink-800">
            Every date in this file could be read two ways (03/04/2026 is 3 April or 4 March). Check the preview below and change &ldquo;Date order&rdquo; if
            the dates are wrong.
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-ink-100 bg-white p-5 shadow-subtle">
        <h2 className="text-[15px] font-semibold text-ink-900">2. Check the preview</h2>
        {missing ? (
          <p className="text-sm text-ink-500">Choose the date and amount columns above to see a preview.</p>
        ) : valid.length === 0 ? (
          <p className="text-sm text-status-exception">No transactions could be read with these settings. Try a different heading row or column choice.</p>
        ) : (
          <>
            <p className="text-sm text-ink-700">
              <span className="font-medium">{valid.length.toLocaleString()}</span> transactions from {dates[0]} to {dates[dates.length - 1]} · money out{" "}
              <span className="font-medium tabular-nums">{formatCurrency(totalOut, currency)}</span> · money in{" "}
              <span className="font-medium tabular-nums">{formatCurrency(totalIn, currency)}</span>
            </p>
            <div className="overflow-x-auto rounded-lg border border-ink-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-100 bg-ink-50 text-left text-xs font-medium text-ink-500">
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 text-right font-medium">Money out</th>
                    <th className="px-4 py-2 text-right font-medium">Money in</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {valid.slice(0, 8).map((r) => (
                    <tr key={r.rowNumber}>
                      <td className="whitespace-nowrap px-4 py-2 text-ink-700">{r.date}</td>
                      <td className="max-w-xs truncate px-3 py-2 text-ink-900">{r.description}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-900">{r.amount > 0 ? formatCurrency(r.amount, currency) : ""}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink-900">{r.amount < 0 ? formatCurrency(-r.amount, currency) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {valid.length > 8 && <p className="text-xs text-ink-500">Showing the first 8 of {valid.length.toLocaleString()}.</p>}
          </>
        )}

        {normalized.problems.length > 0 && (
          <div className="rounded-lg border border-status-pending/30 bg-status-pendingBg px-4 py-3 text-sm text-ink-800">
            <p className="font-medium">
              {normalized.problems.length} row{normalized.problems.length === 1 ? "" : "s"} can&apos;t be read and will be left out:
            </p>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {normalized.problems.slice(0, 5).map((p) => (
                <li key={p.rowNumber}>
                  Line {p.rowNumber}: {p.message}
                </li>
              ))}
            </ul>
            {normalized.problems.length > 5 && <p className="mt-1 text-xs">…and {normalized.problems.length - 5} more.</p>}
          </div>
        )}
      </section>

      {error && (
        <p role="alert" className="rounded-lg border border-status-exception/20 bg-status-exceptionBg px-4 py-3 text-sm text-status-exception">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={run} loading={importing} disabled={missing || valid.length === 0}>
          Import {valid.length > 0 ? valid.length.toLocaleString() : ""} transaction{valid.length === 1 ? "" : "s"}
        </Button>
        {importing && <span className="text-sm text-ink-500">{progress}</span>}
        {!importing && <span className="text-xs text-ink-500">Transactions already imported from an earlier file are skipped, not duplicated.</span>}
      </div>
    </div>
  );
}
