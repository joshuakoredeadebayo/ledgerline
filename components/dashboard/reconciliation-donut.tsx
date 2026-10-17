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
    { value: matched, color: "#26b36f" },
    { value: exceptions, color: "#f59e0b" },
    { value: unmatched, color: "#9392f7" },
  ];

  let offset = 0;
  return (
    <svg viewBox="0 0 140 140" role="img" aria-label={`${pct}% matched`} className="h-40 w-40">
      <circle cx="70" cy="70" r={r} fill="none" stroke="#ececf6" strokeWidth="14" />
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
              strokeWidth="14"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 70 70)"
            />
          );
          offset += len;
          return el;
        })}
      <text x="70" y="68" textAnchor="middle" fontSize="24" fontWeight="600" fill="#000000">
        {pct}%
      </text>
      <text x="70" y="86" textAnchor="middle" fontSize="10.5" fill="#62627f">
        Matched
      </text>
    </svg>
  );
}
