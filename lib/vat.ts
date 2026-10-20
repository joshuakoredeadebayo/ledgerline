/**
 * VAT calculation and classification, free of database calls so it can be tested.
 *
 * Built for Nigerian VAT as it stands under the Nigeria Tax Act 2025 (in force from 1 January 2026):
 * a 7.5% standard rate that applies to goods and services by default, with specific zero-rated and
 * exempt lists. The rate is always passed in (it is a setting, not a constant), and every posted
 * line records the rate it used, so a future rate change never rewrites history.
 *
 * Money is handled in whole cents, with BigInt for the multiplication so very large amounts can't
 * lose precision, and rounding is half-up to the cent (kobo), the usual invoice convention.
 */

export type VatCode = "STD" | "ZERO" | "EXEMPT" | "OUT";
export type VatDirection = "sales" | "purchases";

export const VAT_CODE_LABELS: Record<VatCode, string> = {
  STD: "Standard-rated",
  ZERO: "Zero-rated (0%)",
  EXEMPT: "Exempt",
  OUT: "Outside the scope of VAT",
};

export const VAT_CODE_HELP: Record<VatCode, string> = {
  STD: "VAT is charged at the standard rate. Input VAT on related costs can be recovered.",
  ZERO: "VAT is charged at 0%. Input VAT on related costs can still be recovered.",
  EXEMPT: "No VAT is charged, and input VAT on related costs can't be recovered.",
  OUT: "Not a supply for VAT, such as salaries, loans or transfers between your own accounts.",
};

export interface VatCategory {
  id: string;
  label: string;
  code: VatCode;
  group: string;
  hint?: string;
}

/**
 * Starting classifications, as understood from the Nigeria Tax Act 2025 and the commentary on it in
 * October 2026. The law is the authority, not this list: confirm anything unusual with a tax adviser.
 * Anything not listed is taxable at the standard rate by default, which is how the Act works.
 */
export const VAT_CATEGORIES: VatCategory[] = [
  { id: "manufactured", label: "Manufactured goods", code: "STD", group: "Standard-rated (7.5%)" },
  { id: "professional", label: "Professional and consulting services", code: "STD", group: "Standard-rated (7.5%)", hint: "Accounting, audit, legal, consulting" },
  { id: "retail", label: "Retail sales", code: "STD", group: "Standard-rated (7.5%)" },
  { id: "digital", label: "Digital services and software", code: "STD", group: "Standard-rated (7.5%)", hint: "SaaS, streaming, online platforms" },
  { id: "other_std", label: "Other goods and services", code: "STD", group: "Standard-rated (7.5%)", hint: "Taxable by default unless listed below" },

  { id: "exports", label: "Exports (goods other than oil and gas, and services)", code: "ZERO", group: "Zero-rated (0%)" },
  { id: "basic_food", label: "Basic food items", code: "ZERO", group: "Zero-rated (0%)" },
  { id: "medical", label: "Medical and pharmaceutical products and services", code: "ZERO", group: "Zero-rated (0%)" },
  { id: "education", label: "Educational books, materials and tuition", code: "ZERO", group: "Zero-rated (0%)" },
  { id: "electricity", label: "Electricity", code: "ZERO", group: "Zero-rated (0%)" },

  { id: "road_transport", label: "Shared passenger road transport", code: "EXEMPT", group: "Exempt" },
  { id: "free_zone", label: "Supplies to approved free-zone entities", code: "EXEMPT", group: "Exempt" },
  { id: "diplomatic", label: "Supplies to diplomatic missions", code: "EXEMPT", group: "Exempt" },

  { id: "payroll", label: "Salaries and wages", code: "OUT", group: "Outside the scope of VAT" },
  { id: "transfer", label: "Transfers between your own accounts", code: "OUT", group: "Outside the scope of VAT" },
  { id: "financing", label: "Loans, equity and dividends", code: "OUT", group: "Outside the scope of VAT" },
  { id: "statutory", label: "Taxes and statutory payments", code: "OUT", group: "Outside the scope of VAT" },
];

export const categoryById = (id: string) => VAT_CATEGORIES.find((c) => c.id === id);

export const DEFAULT_VAT_RATE_PERCENT = 7.5;

/** 7.5 -> 750 (basis points: hundredths of a percent). Rates keep to two decimal places. */
export const rateToBp = (percent: number) => Math.round(percent * 100);

/** Half-up integer division for non-negative values. */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

export interface VatSplit {
  netCents: number;
  vatCents: number;
  grossCents: number;
}

/** From a price that EXCLUDES VAT: VAT = net x rate. */
export function vatFromNet(netCents: number, rateBp: number): VatSplit {
  const vat = Number(divRoundHalfUp(BigInt(netCents) * BigInt(rateBp), 10000n));
  return { netCents, vatCents: vat, grossCents: netCents + vat };
}

/**
 * From a price that INCLUDES VAT: VAT = gross x rate / (100% + rate), net = gross - VAT.
 * Working out the VAT first and taking the net as the remainder guarantees net + VAT = gross exactly.
 */
export function vatFromGross(grossCents: number, rateBp: number): VatSplit {
  const vat = Number(divRoundHalfUp(BigInt(grossCents) * BigInt(rateBp), BigInt(10000 + rateBp)));
  return { netCents: grossCents - vat, vatCents: vat, grossCents };
}

export function splitAmount(input: { amountCents: number; inclusive: boolean; rateBp: number; code: VatCode }): VatSplit {
  // Only standard-rated supplies carry VAT; the other codes pass through unchanged.
  if (input.code !== "STD") return { netCents: input.amountCents, vatCents: 0, grossCents: input.amountCents };
  return input.inclusive ? vatFromGross(input.amountCents, input.rateBp) : vatFromNet(input.amountCents, input.rateBp);
}

// ── Journal lines ──────────────────────────────────────────────────────────────

export interface VatTag {
  code: VatCode;
  direction: VatDirection;
  /** The percentage applied, kept with the line so history survives a rate change. */
  rate: number;
  /** The VAT on this line's net amount, posted on its own line to the VAT account. */
  amount: number;
  category: string;
}

export interface BuiltLine {
  accountId: string;
  debit: number;
  credit: number;
  memo: string;
  vat?: VatTag;
}

export interface BuildInput {
  kind: "sale" | "purchase";
  categoryId: string;
  amountCents: number;
  inclusive: boolean;
  ratePercent: number;
  /** Is the entity registered for VAT? If not, it neither charges nor reclaims VAT. */
  registered: boolean;
  /** Where the money is received into or paid from (a bank or cash account). */
  settlementAccountId: string;
  /** The revenue account (sale) or expense account (purchase). */
  mainAccountId: string;
  outputVatAccountId: string | null;
  inputVatAccountId: string | null;
}

/**
 * The lines of a journal entry for one sale or purchase, with VAT split out.
 *
 *   Sale (money in):      Dr Bank gross | Cr Revenue net (tagged) | Cr Output VAT payable
 *   Purchase (money out): Dr Expense net (tagged) | Dr Input VAT recoverable | Cr Bank gross
 *
 * A business that isn't registered for VAT books the full amount as revenue or cost, with no VAT line.
 */
export function buildVatLines(input: BuildInput): { lines: BuiltLine[]; split: VatSplit; code: VatCode; problem?: string } {
  const category = categoryById(input.categoryId) ?? categoryById("other_std")!;
  const code = input.registered ? category.code : "OUT";
  const rateBp = rateToBp(input.ratePercent);
  const split = input.registered
    ? splitAmount({ amountCents: input.amountCents, inclusive: input.inclusive, rateBp, code })
    : { netCents: input.amountCents, vatCents: 0, grossCents: input.amountCents };

  const money = (c: number) => c / 100;
  const tag = (vatCents: number): VatTag | undefined =>
    input.registered
      ? { code, direction: input.kind === "sale" ? "sales" : "purchases", rate: code === "STD" ? input.ratePercent : 0, amount: money(vatCents), category: category.id }
      : undefined;

  const vatAccountId = input.kind === "sale" ? input.outputVatAccountId : input.inputVatAccountId;
  if (input.registered && split.vatCents > 0 && !vatAccountId) {
    return {
      lines: [],
      split,
      code,
      problem: input.kind === "sale" ? "Set up this entity's Output VAT account first (Entities, then VAT settings)." : "Set up this entity's Input VAT account first (Entities, then VAT settings).",
    };
  }

  const lines: BuiltLine[] = [];
  if (input.kind === "sale") {
    lines.push({ accountId: input.settlementAccountId, debit: money(split.grossCents), credit: 0, memo: "" });
    lines.push({ accountId: input.mainAccountId, debit: 0, credit: money(split.netCents), memo: "", vat: tag(split.vatCents) });
    if (split.vatCents > 0) lines.push({ accountId: vatAccountId!, debit: 0, credit: money(split.vatCents), memo: `Output VAT ${input.ratePercent}%` });
  } else {
    lines.push({ accountId: input.mainAccountId, debit: money(split.netCents), credit: 0, memo: "", vat: tag(split.vatCents) });
    if (split.vatCents > 0) lines.push({ accountId: vatAccountId!, debit: money(split.vatCents), credit: 0, memo: `Input VAT ${input.ratePercent}%` });
    lines.push({ accountId: input.settlementAccountId, debit: 0, credit: money(split.grossCents), memo: "" });
  }
  return { lines, split, code };
}

// ── Consistency check ──────────────────────────────────────────────────────────

export interface TaggedLine {
  accountId: string;
  debit: number | string;
  credit: number | string;
  vat?: { code: VatCode; direction: VatDirection; rate: number; amount: number } | null;
}

const cents = (n: number | string) => Math.round(Number(n || 0) * 100);

/**
 * A line tagged with VAT says how much VAT sits on it; that VAT must really be posted to the VAT account,
 * and by the same amount. Entries with no VAT tags (for example paying the VAT bill to the tax authority)
 * are not checked.
 */
export function checkVatConsistency(lines: TaggedLine[], outputVatAccountId: string | null, inputVatAccountId: string | null): string[] {
  const problems: string[] = [];
  const tagged = lines.filter((l) => l.vat);
  if (tagged.length === 0) return problems;

  for (const l of tagged) {
    const v = l.vat!;
    if (v.code !== "STD" && cents(v.amount) !== 0) problems.push(`A ${VAT_CODE_LABELS[v.code].toLowerCase()} line can't carry VAT.`);
    if (v.amount < 0) problems.push("VAT amounts can't be negative.");
  }

  const check = (direction: VatDirection, accountId: string | null, label: string, sign: 1 | -1) => {
    const expected = tagged.filter((l) => l.vat!.direction === direction).reduce((n, l) => n + cents(l.vat!.amount), 0);
    if (expected === 0) return;
    if (!accountId) {
      problems.push(`${label} account isn't set up for this entity.`);
      return;
    }
    // Output VAT is a credit balance, input VAT a debit balance.
    const posted = lines.filter((l) => l.accountId === accountId).reduce((n, l) => n + sign * (cents(l.credit) - cents(l.debit)), 0);
    if (posted !== expected) {
      problems.push(`The VAT on the tagged lines (${(expected / 100).toFixed(2)}) doesn't match what is posted to the ${label} account (${(posted / 100).toFixed(2)}). Re-run the VAT helper, or correct the VAT line.`);
    }
  };
  check("sales", outputVatAccountId, "Output VAT", 1);
  check("purchases", inputVatAccountId, "Input VAT", -1);
  return problems;
}

// ── The VAT return summary ─────────────────────────────────────────────────────

export interface VatLineRecord {
  entryId: string;
  entryDate: string;
  description: string | null;
  direction: VatDirection;
  code: VatCode;
  category: string;
  rate: number;
  /** The net amount the VAT relates to. */
  base: number;
  vat: number;
}

export interface VatSummary {
  salesByCode: Record<VatCode, { base: number; vat: number; count: number }>;
  purchasesByCode: Record<VatCode, { base: number; vat: number; count: number }>;
  outputVat: number;
  inputVat: number;
  recoverableInputVat: number;
  netPayable: number;
}

const emptyBuckets = (): Record<VatCode, { base: number; vat: number; count: number }> => ({
  STD: { base: 0, vat: 0, count: 0 },
  ZERO: { base: 0, vat: 0, count: 0 },
  EXEMPT: { base: 0, vat: 0, count: 0 },
  OUT: { base: 0, vat: 0, count: 0 },
});

/**
 * Totals for a VAT return. Input VAT is reduced to the recoverable share (100% when everything
 * relates to taxable or zero-rated sales; less when costs also serve exempt sales, which is for the
 * business and its adviser to determine). Net payable below zero is a refundable credit.
 */
export function summarizeVat(records: VatLineRecord[], recoverablePercent: number): VatSummary {
  const sales = emptyBuckets();
  const purchases = emptyBuckets();
  let output = 0;
  let input = 0;

  for (const r of records) {
    const bucket = (r.direction === "sales" ? sales : purchases)[r.code];
    bucket.base += Math.round(r.base * 100);
    bucket.vat += Math.round(r.vat * 100);
    bucket.count += 1;
    if (r.direction === "sales") output += Math.round(r.vat * 100);
    else input += Math.round(r.vat * 100);
  }

  const recoverable = Math.round((input * Math.min(100, Math.max(0, recoverablePercent))) / 100);
  const fix = (b: Record<VatCode, { base: number; vat: number; count: number }>) =>
    Object.fromEntries((Object.keys(b) as VatCode[]).map((k) => [k, { base: b[k].base / 100, vat: b[k].vat / 100, count: b[k].count }])) as Record<VatCode, { base: number; vat: number; count: number }>;

  return {
    salesByCode: fix(sales),
    purchasesByCode: fix(purchases),
    outputVat: output / 100,
    inputVat: input / 100,
    recoverableInputVat: recoverable / 100,
    netPayable: (output - recoverable) / 100,
  };
}

/** The 21st of the month after the period: when the return and the payment are due. */
export function vatDueDate(month: string): string {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const next = new Date(Date.UTC(year, m, 21)); // month index m = the following month
  return next.toISOString().slice(0, 10);
}

/** The return that falls due next: on or before the 21st it is last month's, after the 21st it is this month's. */
export function nextVatDue(today: Date): { dueDate: string; period: string } {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth(); // 0-based
  const dueThisMonth = Date.UTC(y, m, 21);
  const startOfToday = Date.UTC(y, m, today.getUTCDate());
  const prev = new Date(Date.UTC(y, m - 1, 1));
  const cur = new Date(Date.UTC(y, m, 1));
  if (startOfToday <= dueThisMonth) {
    return { dueDate: new Date(dueThisMonth).toISOString().slice(0, 10), period: prev.toISOString().slice(0, 7) };
  }
  return { dueDate: new Date(Date.UTC(y, m + 1, 21)).toISOString().slice(0, 10), period: cur.toISOString().slice(0, 7) };
}
