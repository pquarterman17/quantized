// A value and its standard error as display strings, for every peak table
// (the Peak analyzer's results, its batch table, the Peaks workshop's
// published table) -- by the SAME rule Curve Fit's "Value ± SE" uses
// (./fitValueFormat: the error to its PDG significant figures, the value to
// the same decimal place, a shared ×10ⁿ), so the analysis panels never
// disagree on one number (UX audit 8 #5). Without a usable error (none, 0,
// non-finite) the numbers follow the user's Numbers preferences (`fmtNum`),
// as every other bare value does.

import { fmtValueErr, roundToError, timesTen } from "./fitValueFormat";
import { fmtNum } from "./format";

export interface ValueErrCells {
  /** The value line ("21.8", "5.94×10⁻⁴"). */
  value: string;
  /** The error without its "± " ("3.1", "0.30×10⁻⁴"), or null when none was reported. */
  error: string | null;
  /** One-line "21.8 ± 3.1" / "(5.94 ± 0.30)×10⁻⁴" when rounded together, else null. */
  inline: string | null;
}

export function valueErrCells(value: number | null | undefined, err: number | null | undefined): ValueErrCells {
  const e = typeof err === "number" && Number.isFinite(err) ? err : null;
  const v = typeof value === "number" && Number.isFinite(value) ? value : null;
  const r = v !== null && e !== null ? roundToError(v, e) : null;
  if (!r) return { value: fmtNum(v), error: e === null ? null : fmtNum(e), inline: null };
  const t = r.mag === 0 ? "" : timesTen(r.mag);
  return { value: r.value + t, error: r.error + t, inline: fmtValueErr(v, e) };
}
