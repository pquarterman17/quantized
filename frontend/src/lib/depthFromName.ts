// The depth ("temperature", "field", ...) a curve's NAME encodes, for placing
// curves along the third axis of a 3-D waterfall. Not `firstNumber`: that reader
// is for ordering and reads a hyphen as a minus ("sample-50K" -> -50) and
// "S1 300 K" as 1.
//
// Rules: a `-` is a SIGN only when it does not follow a letter, digit or `_`
// ("sample-50K" and "2026-11-15" use it as a separator; "T = -5 K" and "-20C"
// are negative). Of all the numbers in the name, one directly followed by a unit
// (K, Oe, T, mT, deg, V, ...) wins -- the LAST such one; with no unit, the last
// number. So "S1_10K" -> 10, "2026-11-15_300K" -> 300, "sample-50K" -> 50.
// Pure.

const NUMBER = /(\d+\.?\d*|\.\d+)(?:e([-+]?\d+))?/gi;
const UNIT = /^\s*(?:K|°C|degC|C|Oe|kOe|mT|T|G|deg|°|V|mV|A|mA|Hz|kHz|MHz|GHz|nm|um|µm|mm|cm|s|ms|min|h)(?![A-Za-z])/;

export function depthFromName(name: string): number | null {
  let withUnit: number | null = null;
  let last: number | null = null;
  for (const m of name.matchAll(NUMBER)) {
    const at = m.index ?? 0;
    const sep = at >= 2 ? name[at - 2] : "";
    const negative = at >= 1 && name[at - 1] === "-" && !/[A-Za-z0-9_]/.test(sep);
    const v = Number(m[0]) * (negative ? -1 : 1);
    if (!Number.isFinite(v)) continue;
    last = v;
    if (UNIT.test(name.slice(at + m[0].length))) withUnit = v;
  }
  return withUnit ?? last;
}
