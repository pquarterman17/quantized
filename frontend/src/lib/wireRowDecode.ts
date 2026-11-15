// One persisted row's sentinel-cell decode, for the report figure-spec reader.
// Bundle diet (origin gap audit 3 #15's funding): moved verbatim out of
// lib/nonFiniteCells.ts, whose other exports run at startup; only lazy modules
// call this half, so it no longer ships in the startup chunk. Imported by
// path; lib/nonFiniteCells.ts does not re-export it.

import { decodeCell } from "./nonFiniteCells";

/** Check-and-decode `v` in a SINGLE pass over its cells, rather than the
 *  two-pass {@link isWireCellArray} + {@link decodeCells} composition above
 *  (kept separately for its existing callers, e.g. `lib/report.ts`'s
 *  P3.6 report-figure-spec decode, which walks a report figure's embedded
 *  `time`/`values` rows independently of its `labels`/`units`/`metadata` and
 *  needs to know per-row whether THAT row decoded cleanly). Bails out the
 *  MOMENT a cell fails to decode, returning `v` itself UNCHANGED (`ok:
 *  false`, `changed: false`) — never a partially-decoded array — since
 *  decoding only the cells before a bad one would silently commit to a guess
 *  about the rest. (A legacy `null` is read as NaN one layer up, by
 *  `lib/legacyNullCells.ts`'s `decodeLegacyWireRow`.) `value` is `v` itself when nothing needed
 *  decoding, so an already-clean row round-trips with no new allocation. */
export function decodeWireRow(v: unknown): { value: unknown; changed: boolean; ok: boolean } {
  if (!Array.isArray(v)) return { value: v, changed: false, ok: false };
  const out: number[] = [];
  let changed = false;
  for (const cell of v) {
    if (typeof cell === "number") {
      out.push(cell);
      continue;
    }
    const decoded = decodeCell(cell);
    if (decoded === undefined) return { value: v, changed: false, ok: false };
    out.push(decoded);
    changed = true;
  }
  return { value: changed ? out : v, changed, ok: true };
}
