// Lazy half of the gapped-payload contract (lib/plotdata.ts `fetchPlot` loads
// it only when a response carries `kept`; see calc/decimate.py).

/** A gapped server payload (`kept[j]` = positions where series j has a REAL
 *  entry): everything else is filler, set to `undefined`, which uPlot's line
 *  builder skips and draws across; a real missing value stays `null`, which
 *  breaks the line (uPlot 1.6.32 `findGaps` tests `=== null`). `spanGaps`
 *  must stay off, or a genuine NaN run would be bridged. */
export function ungap(
  data: readonly ArrayLike<number | null>[],
  kept: readonly (readonly number[])[],
): (number | null | undefined)[][] {
  const fill = (col: ArrayLike<number | null>, ks: readonly number[]) => {
    const out: (number | null | undefined)[] = new Array(col.length).fill(undefined);
    for (const k of ks) out[k] = col[k];
    return out;
  };
  return [Array.from(data[0]), ...kept.map((ks, j) => fill(data[j + 1], ks))];
}
