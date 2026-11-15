// The one "first number in a text" reader: the series gradient's "Number in
// legend" order (lib/seriesRampImpl.ts) and the worksheet's order-by-parameter
// (lib/userParams.ts) both read it, so the same value ("300K", "S1 300 K")
// orders curves the same way in both. Pure.

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i;

/** The first number anywhere in `text` ("300K" -> 300, "S1 300 K" -> 1), or
 *  null when there is none. */
export function firstNumber(text: string): number | null {
  const m = NUMBER.exec(text);
  const v = m ? Number(m[0]) : NaN;
  return Number.isFinite(v) ? v : null;
}
