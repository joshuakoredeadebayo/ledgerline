/** One CSV cell: quoted when it contains a comma, quote or line break; objects are written as JSON. */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  // Text beginning with = + - or @ can be run as a formula by Excel; a leading apostrophe neutralises it.
  // Real numbers are written as numbers, so a negative amount like -500 is left alone.
  const safe = typeof value === "string" && /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The whole file: a UTF-8 byte-order mark (so Excel reads accents correctly), then header and rows. */
export function toCsv(header: string[], rows: unknown[][]): string {
  return "\uFEFF" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** A download response for a CSV string. */
export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
