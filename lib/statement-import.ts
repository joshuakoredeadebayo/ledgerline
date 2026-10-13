/**
 * Reading a bank statement exported as CSV: splitting it into cells, working out which column
 * is which, and turning each row into a dated, signed transaction. No database or browser APIs,
 * so it runs in the browser (for the preview) and on the server (to check what was sent),
 * and can be tested on its own.
 *
 * Direction convention (the same one every feed in Ledgerline uses): positive = money going out
 * of the account, negative = money coming in. A statement's debit is money out; a credit is money in.
 */

// ── Splitting the file into cells ──────────────────────────────────────────────

export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 30).join("\n");
  const counts = [",", ";", "\t", "|"].map((d) => [d, sample.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ",";
}

/** A small, strict CSV reader: quoted cells, doubled quotes, delimiters and line breaks inside quotes. */
export function parseDelimited(input: string, delimiter?: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === d) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim()));
}

// ── Working out which column is which ──────────────────────────────────────────

export type DateFormat = "dmy" | "mdy" | "ymd";
export type AmountMode = "split" | "single";

export interface ImportSettings {
  headerRow: number;
  dateCol: number;
  descCol: number;
  mode: AmountMode;
  debitCol: number;
  creditCol: number;
  amountCol: number;
  /** For a single amount column: do positive numbers mean money coming in (most statements) or going out? */
  positiveMeans: "in" | "out";
  balanceCol: number;
  refCol: number;
  dateFormat: DateFormat;
  /** "." for 1,234.56 and "," for 1.234,56 */
  decimal: "." | ",";
}

const KEYWORDS = {
  date: ["transaction date", "trans date", "posting date", "value date", "booking date", "date", "transaction time", "trans time", "time"],
  desc: ["description", "narration", "narrative", "transaction details", "details", "remarks", "particulars", "payee", "memo", "beneficiary"],
  debit: ["debit amount", "debit", "debits", "withdrawal", "withdrawals", "money out", "paid out", "outflow", "dr"],
  credit: ["credit amount", "credit", "credits", "deposit", "deposits", "money in", "paid in", "inflow", "cr"],
  amount: ["transaction amount", "amount", "value"],
  balance: ["balance after", "running balance", "closing balance", "available balance", "balance"],
  ref: ["transaction reference", "reference", "ref no", "ref", "transaction id", "trans id", "txn id", "session id", "cheque no"],
} as const;

const normHeader = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function findColumn(header: string[], words: readonly string[], taken: Set<number>): number {
  const cells = header.map(normHeader);
  for (const w of words) {
    const exact = cells.findIndex((c, i) => !taken.has(i) && c === w);
    if (exact >= 0) return exact;
  }
  for (const w of words) {
    const partial = cells.findIndex((c, i) => !taken.has(i) && c.length > 0 && (` ${c} `.includes(` ${w} `) || (w.length > 3 && c.includes(w))));
    if (partial >= 0) return partial;
  }
  return -1;
}

/** Picks the most header-like row in the first 40 (statements often start with account details). */
export function guessHeaderRow(rows: string[][]): number {
  let best = 0;
  let bestScore = -1;
  rows.slice(0, 40).forEach((row, index) => {
    const taken = new Set<number>();
    let score = 0;
    for (const key of Object.keys(KEYWORDS) as (keyof typeof KEYWORDS)[]) {
      const col = findColumn(row, KEYWORDS[key], taken);
      if (col >= 0) {
        taken.add(col);
        score++;
      }
    }
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}

export function guessSettings(rows: string[][], headerRow = guessHeaderRow(rows)): ImportSettings {
  const header = rows[headerRow] ?? [];
  const taken = new Set<number>();
  const pick = (key: keyof typeof KEYWORDS) => {
    const col = findColumn(header, KEYWORDS[key], taken);
    if (col >= 0) taken.add(col);
    return col;
  };
  const dateCol = pick("date");
  const descCol = pick("desc");
  const debitCol = pick("debit");
  const creditCol = pick("credit");
  const balanceCol = pick("balance");
  const refCol = pick("ref");
  const amountCol = debitCol >= 0 && creditCol >= 0 ? -1 : pick("amount");

  const body = rows.slice(headerRow + 1);
  const dateValues = body.map((r) => r[dateCol] ?? "").filter(Boolean);
  const decimalGuess = guessDecimal(body.flatMap((r) => [r[debitCol], r[creditCol], r[amountCol]]).filter((v): v is string => !!v));

  return {
    headerRow,
    dateCol,
    descCol,
    mode: debitCol >= 0 && creditCol >= 0 ? "split" : "single",
    debitCol,
    creditCol,
    amountCol,
    positiveMeans: "in",
    balanceCol,
    refCol,
    dateFormat: detectDateFormat(dateValues).format,
    decimal: decimalGuess,
  };
}

// ── Dates ──────────────────────────────────────────────────────────────────────

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function validDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

/** Reads one date cell. Day-first or month-first only matters for all-numeric dates like 03/04/2026. */
export function parseDateCell(value: string, format: DateFormat): string | null {
  const v = value.trim();
  if (!v) return null;

  // 2026-08-14, 2026/08/14, with an optional time after it
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));

  // 14/08/2026, 8-14-26, 14.08.2026 (+ optional time)
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[T\s].*)?$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = fullYear(Number(m[3]));
    if (format === "mdy") return validDate(y, a, b);
    return validDate(y, b, a); // dmy (and ymd, which doesn't apply to this shape)
  }

  // 14 Aug 2026, 14-Aug-2026, Aug 14, 2026, 14 August 26
  m = v.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{2,4})(?:[T\s].*)?$/);
  if (m) {
    const month = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1;
    return month ? validDate(fullYear(Number(m[3])), month, Number(m[1])) : null;
  }
  m = v.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})(?:[T\s].*)?$/);
  if (m) {
    const month = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1;
    return month ? validDate(fullYear(Number(m[3])), month, Number(m[2])) : null;
  }

  // An Excel date serial such as 46248 (days since 1899-12-30)
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const serial = Math.floor(Number(v));
    if (serial >= 20000 && serial <= 80000) {
      const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      return dt.toISOString().slice(0, 10);
    }
  }
  return null;
}

/**
 * Decides day-first vs month-first from the data itself where it can (a "25/08/2026" can only be
 * day-first). When every date is ambiguous (all days and months are 12 or below) it says so, and
 * the person must confirm; day-first is the default, being the usual order in Nigeria and the UK.
 */
export function detectDateFormat(values: string[]): { format: DateFormat; ambiguous: boolean } {
  let dayFirstEvidence = 0;
  let monthFirstEvidence = 0;
  let iso = 0;
  let numeric = 0;
  for (const raw of values.slice(0, 500)) {
    const v = raw.trim();
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(v)) {
      iso++;
      continue;
    }
    const m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!m) continue;
    numeric++;
    if (Number(m[1]) > 12) dayFirstEvidence++;
    if (Number(m[2]) > 12) monthFirstEvidence++;
  }
  if (iso > 0 && numeric === 0) return { format: "ymd", ambiguous: false };
  if (dayFirstEvidence > 0 && monthFirstEvidence === 0) return { format: "dmy", ambiguous: false };
  if (monthFirstEvidence > 0 && dayFirstEvidence === 0) return { format: "mdy", ambiguous: false };
  return { format: "dmy", ambiguous: numeric > 0 };
}

// ── Amounts ────────────────────────────────────────────────────────────────────

/** 1,234.56 or 1.234,56 depending on which appears; falls back to "." when unclear. */
function guessDecimal(values: string[]): "." | "," {
  let dot = 0;
  let comma = 0;
  for (const v of values.slice(0, 200)) {
    const s = v.replace(/[^\d.,]/g, "");
    if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s)) comma++;
    else if (/\.\d{1,2}$/.test(s)) dot++;
  }
  return comma > dot ? "," : ".";
}

/** Reads an amount: strips currency symbols and codes, handles (1,000.00) as negative, and either decimal style. */
export function parseAmountCell(value: string, decimal: "." | ","): number | null {
  let v = value.trim();
  if (!v || v === "-" || v === "—") return null;
  const negative = /^\(.*\)$/.test(v) || /^-/.test(v) || /-$/.test(v) || /\bDR\b/i.test(v);
  v = v.replace(/[^\d.,]/g, "");
  if (!v) return null;
  if (decimal === ",") v = v.replace(/\./g, "").replace(",", ".");
  else v = v.replace(/,/g, "");
  if (!/^\d*\.?\d+$/.test(v) && !/^\d+\.$/.test(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// ── Turning rows into transactions ─────────────────────────────────────────────

export interface NormalizedRow {
  /** The row's position in the original file (1-based), for pointing at problems. */
  rowNumber: number;
  date: string;
  description: string;
  /** Positive = money out, negative = money in. */
  amount: number;
  balance: number | null;
  reference: string | null;
  /** Which copy of an identical row this is, so two real, identical purchases aren't mistaken for one. */
  occurrence: number;
}

export interface RowProblem {
  rowNumber: number;
  message: string;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function normalizeRows(rows: string[][], s: ImportSettings): { rows: NormalizedRow[]; problems: RowProblem[]; skipped: number } {
  const out: NormalizedRow[] = [];
  const problems: RowProblem[] = [];
  let skipped = 0;
  const seen = new Map<string, number>();

  rows.slice(s.headerRow + 1).forEach((cells, offset) => {
    const rowNumber = s.headerRow + 2 + offset;
    const cell = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
    if (cells.every((c) => !c.trim())) {
      skipped++;
      return;
    }

    const dateText = cell(s.dateCol);
    const debit = s.mode === "split" ? parseAmountCell(cell(s.debitCol), s.decimal) : null;
    const credit = s.mode === "split" ? parseAmountCell(cell(s.creditCol), s.decimal) : null;
    const single = s.mode === "single" ? parseAmountCell(cell(s.amountCol), s.decimal) : null;
    const hasAmount = debit !== null || credit !== null || single !== null;

    // Totals, notes and other non-transaction lines: nothing that looks like a date or an amount,
    // or a dateless summary line such as "Total" or "Closing balance".
    const looksLikeSummary = /\b(total|totals|sub-?total|opening|closing|brought forward|carried forward|summary)\b/i.test(cell(s.descCol) || cells.join(" "));
    if (!dateText && (!hasAmount || looksLikeSummary)) {
      skipped++;
      return;
    }

    const date = parseDateCell(dateText, s.dateFormat);
    if (!date) {
      problems.push({ rowNumber, message: dateText ? `Couldn't read the date "${dateText}".` : "No date." });
      return;
    }
    if (!hasAmount) {
      problems.push({ rowNumber, message: "No amount." });
      return;
    }

    let amount: number;
    if (s.mode === "split") {
      amount = round2(Math.abs(debit ?? 0) - Math.abs(credit ?? 0));
    } else {
      amount = round2(s.positiveMeans === "in" ? -single! : single!);
    }
    if (amount === 0) {
      skipped++;
      return;
    }

    const description = cell(s.descCol) || "Bank transaction";
    const reference = cell(s.refCol) || null;
    const balance = s.balanceCol >= 0 ? parseAmountCell(cell(s.balanceCol), s.decimal) : null;

    const key = `${date}|${amount}|${description.toLowerCase()}|${reference ?? ""}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);

    out.push({ rowNumber, date, description, amount, balance, reference, occurrence });
  });

  return { rows: out, problems, skipped };
}
