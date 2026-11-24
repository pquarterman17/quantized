// "Open in Frequency count" (OPEN_ITEMS row 12, reopen gaps lane): the recorded
// settings of a Frequency count output, read back strictly. FAIL CLOSED: null
// unless EVERY setting is present and of the right type (a partial record is
// never seeded). The counted column is proved by `extra.picks`
// (lib/reductionsReopenSeed.ts: position AND name). Lazy: imported by the
// frequency-count run and the lazy opener (store/toolReopenPicks.ts) only.

import type { ReopenSeed } from "./committedOutputReopen";

export interface FrequencyCountSeed {
  /** The counted channel index; -1 is the worksheet's own X. */
  column: number;
  bins: number | null;
  width: number | null;
  min: number | null;
  max: number | null;
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const optional = (value: unknown): value is number | null => value === null || isNumber(value);

export function frequencyCountSeed(s: ReopenSeed | null | undefined): FrequencyCountSeed | null {
  if (!s) return null;
  const { column, bins, width, min, max } = s;
  if (!isNumber(column) || !Number.isInteger(column) || column < -1 || !optional(bins) || !optional(width) || !optional(min) || !optional(max)) return null;
  return { column, bins, width, min, max };
}
