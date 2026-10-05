/** Matched / exceptions / unmatched ring. Server-rendered SVG. */
export function ReconciliationDonut({
  matched,
  exceptions,
  unmatched,
}: {
  matched: number;
  exceptions: number;
  unmatched: number;
}) {
  const total = matched + exceptions + unmatched;
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = total === 0 ? 0 : Math.round((matched / total) * 100);

  const segments = [
    { value: matched, color: "#16794f" },
    { value: exceptions, color: "#d98e04" },
    { value: unmatched, color: "#98a7f0" },
  ];

  let offset = 0;
  return (
    <svg viewBox="0 0 140 140" role="img" aria-label={`${pct}% matched`} className="h-40 w-40">
      <circle cx="70" cy="70" r={r} fill="none" stroke="#eceef0" strokeWidth="16" />
      {total > 0 &&
        segments.map((s, i) => {
          if (s.value === 0) return null;
          const len = (s.value / total) * c;
          const el = (
            <circle
              key={i}
              cx="70"
              cy="70"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth="16"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 70 70)"
            />
          );
          offset += len;
          return el;
        })}
      <text x="70" y="68" textAnchor="middle" fontSize="22" fontWeight="600" fill="#1b1e24">
        {pct}%
      </text>
      <text x="70" y="86" textAnchor="middle" fontSize="10" fill="#6b7684">
        Matched
      </text>
    </svg>
  );
}
