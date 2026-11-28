// Where pure code reads the project's named ranges when it is not handed them: the freshness of a saved result that
// recorded a named range (lib/namedRangeResultFreshness.ts) is judged by a dozen callers (the result panel, report
// links, the figure and table actions, Go to Source), so one registered reader keeps every one of them failing closed
// instead of each being threaded the list. Tiny and eager on purpose (the store registers it); the default reads none,
// which is exactly "no range moved" for a caller outside the store (a worker, a unit test).

import type { NamedRange } from "./namedRanges";

let source: () => readonly NamedRange[] = () => [];

/** The project's named ranges now. */
export const currentNamedRanges = (): readonly NamedRange[] => source();

/** Register the reader (the store does, once). Returns the one it replaces, so a test can put it back. */
export function setNamedRangeSource(read: () => readonly NamedRange[]): () => readonly NamedRange[] {
  const previous = source;
  source = read;
  return previous;
}
