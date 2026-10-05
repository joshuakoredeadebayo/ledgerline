import { formatCurrency } from "@/lib/utils";

/**
 * Daily bank cash flow for one month, drawn as plain SVG (no chart library):
 * a pair of bars per day, blue = money out and green = money in. Server-rendered.
 */
export function CashFlowChart({
  daily,
  currency,
  emptyHint,
}: {
  /** Index 0 = day 1 of the month. */
  daily: { out: number; in: number }[];
  currency: string;
  /** Shown under the empty-state message (e.g. a link to the latest month with data). */
  emptyHint?: React.ReactNode;
}) {
  const W = 480;
  const H = 230;
  const pad = { l: 46, r: 6, t: 10, b: 26 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const rawMax = Math.max(1, ...daily.flatMap((d) => [d.out, d.in]));
  const hasData = daily.some((d) => d.out > 0 || d.in > 0);

  // Round the axis up to tidy tick values (e.g. 0, 500, 1K, 1.5K, 2K)
  // instead of whatever the largest day happens to be.
  const rawStep = rawMax / 4;
  const exp = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * exp).find((v) => v >= rawStep) ?? 10 * exp;
  const max = step * 4;

  const slot = innerW / daily.length;
  const barW = Math.min(9, Math.max(2.5, slot * 0.34));
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const x = (i: number) => pad.l + slot * i + slot / 2;

  const compact = (v: number) =>
    new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  const ticks = [0, 1, 2, 3, 4].map((n) => n * step);
  const labelDays = [1, 8, 15, 22, 29].filter((d) => d <= daily.length);

  if (!hasData) {
    return (
      <div className="flex h-[230px] flex-col items-center justify-center gap-1.5 rounded-lg bg-ink-50 px-4 text-center">
        <p className="text-sm text-ink-600">No bank activity in this month.</p>
        {emptyHint && <p className="text-xs text-ink-500">{emptyHint}</p>}
      </div>
    );
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Daily bank cash flow in ${currency}`} className="h-auto w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e8eef6" />
          <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="#66759a">
            {compact(t)}
          </text>
        </g>
      ))}
      {daily.map((d, i) => (
        <g key={i}>
          {d.out > 0 && (
            <rect x={x(i) - barW - 0.5} y={y(d.out)} width={barW} height={pad.t + innerH - y(d.out)} rx="2" fill="#3b73fe">
              <title>{`Day ${i + 1}: out ${formatCurrency(d.out, currency)}`}</title>
            </rect>
          )}
          {d.in > 0 && (
            <rect x={x(i) + 0.5} y={y(d.in)} width={barW} height={pad.t + innerH - y(d.in)} rx="2" fill="#26b36f">
              <title>{`Day ${i + 1}: in ${formatCurrency(d.in, currency)}`}</title>
            </rect>
          )}
        </g>
      ))}
      {labelDays.map((d) => (
        <text key={d} x={x(d - 1)} y={H - 8} textAnchor="middle" fontSize="12" fill="#66759a">
          {d}
        </text>
      ))}
    </svg>
  );
}
