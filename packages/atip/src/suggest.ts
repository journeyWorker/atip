/**
 * Near names for a refusal's `suggestions` (spec 7.1): the candidates a mistyped word most likely meant, nearest first.
 * The parser suggests commands and options with it, `schema` commands and codes, `skills show` guides.
 */

/** Levenshtein distance, for suggestions. */
export const distance = (a: string, b: string): number => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j] ?? 0;
      row[j] = Math.min(
        current + 1,
        (row[j - 1] ?? 0) + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[b.length] ?? 0;
};

/**
 * Candidates within distance 2 (or sharing a prefix of 3+ characters), nearest first; a destructive command only
 * within 1, so a typo is not steered to an act.
 */
export const suggest = (
  received: string,
  candidates: ReadonlyArray<string>,
  destructive: ReadonlySet<string> = new Set(),
): ReadonlyArray<string> =>
  candidates
    .map((candidate) => ({ candidate, d: distance(received, candidate) }))
    .filter(
      ({ candidate, d }) =>
        (destructive.has(candidate) ? d <= 1 : d <= 2) ||
        (received.length >= 3 && candidate.startsWith(received)),
    )
    .toSorted((a, b) => a.d - b.d)
    .map(({ candidate }) => candidate);
