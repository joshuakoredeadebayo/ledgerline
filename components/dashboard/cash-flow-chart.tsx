import { formatCurrency } from "@/lib/utils";

/**
 * Daily bank cash flow for one month, drawn as plain SVG (no chart library):
 * bars = money out, line = money in. Server-rendered.
 */
export function CashFlowChart({
  daily,
  currency,
}: {
  /** Index 0 = day 1 of the month. */
  daily: { out: number; in: number }[];
  currency: string;
}) {
  const W = 640;
  const H = 230;
  const pad = { l: 56, r: 12, t: 12, b: 28 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const max = Math.max(1, ...daily.flatMap((d) => [d.out, d.in]));
  const hasData = daily.some((d) => d.out > 0 || d.in > 0);
  const slot = innerW / daily.length;
  const barW = Math.max(3, slot * 0.55);
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const x = (i: number) => pad.l + slot * i + slot / 2;

  const compact = (v: number) =>
    new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelDays = [1, 8, 15, 22, 29].filter((d) => d <= daily.length);

  const linePoints = daily.map((d, i) => `${x(i)},${y(d.in)}`).join(" ");

  if (!hasData) {
    return (
      <div className="flex h-[230px] items-center justify-center rounded-md bg-ink-50 text-sm text-ink-500">
        No bank activity in this month.
      </div>
    );
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Daily bank cash flow in ${currency}`} className="h-auto w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#eceef0" />
          <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#6b7684">
            {compact(t)}
          </text>
        </g>
      ))}
      {daily.map((d, i) =>
        d.out > 0 ? (
          <rect key={i} x={x(i) - barW / 2} y={y(d.out)} width={barW} height={pad.t + innerH - y(d.out)} rx="2" fill="#4655d6">
            <title>{`Day ${i + 1}: out ${formatCurrency(d.out, currency)}`}</title>
          </rect>
        ) : null
      )}
      <polyline points={linePoints} fill="none" stroke="#16794f" strokeWidth="2" strokeLinejoin="round" />
      {daily.map((d, i) =>
        d.in > 0 ? (
          <circle key={i} cx={x(i)} cy={y(d.in)} r="3" fill="#16794f">
            <title>{`Day ${i + 1}: in ${formatCurrency(d.in, currency)}`}</title>
          </circle>
        ) : null
      )}
      {labelDays.map((d) => (
        <text key={d} x={x(d - 1)} y={H - 8} textAnchor="middle" fontSize="10" fill="#6b7684">
          {d}
        </text>
      ))}
    </svg>
  );
}
