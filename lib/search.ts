/** Makes a typed phrase safe to use inside a LIKE pattern, so a "%" or "_" is searched for, not treated as a wildcard. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
