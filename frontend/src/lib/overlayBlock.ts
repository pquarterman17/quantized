// Fit / baseline / peak / derivative overlays are built at the source's row
// count n, but a per-series-X plot (lib/perSeriesX.ts) is `blocks x n` rows
// with each Y only inside its own block. The overlay belongs to the primary
// Y, so it is scattered into THAT Y's block (row b*n + r) with null (a gap)
// everywhere else. A length that is not n is left alone: alignOverlayY then
// refuses it, never mis-drawing it.

import { ownXKey } from "./perSeriesX";
import type { Dataset } from "./types";

type Col = (number | null)[];

export function scatterIntoBlock(y: Col, n: number, blockCount: number, block: number): Col {
  if (y.length !== n || block < 0 || block >= blockCount) return y;
  const out: Col = new Array<number | null>(n * blockCount).fill(null);
  for (let r = 0; r < n; r++) out[block * n + r] = y[r];
  return out;
}

/** Move an overlay (and its fit band) into the block of the primary Y `yKey`.
 *  `blocks` is the view's block list. Returns null when that Y's own X is not
 *  a block of the view (its curve is not drawn): the overlay drops. */
export function blockOverlay<T extends { y: Col; band?: { y: Col }[] }>(
  o: T | null,
  ds: Dataset | null | undefined,
  xKey: number | null,
  yKey: number | undefined,
  blocks: (number | null)[] | undefined,
  n: number | undefined,
): T | null {
  if (!o || !ds || !blocks || n === undefined || yKey === undefined) return o;
  const b = blocks.indexOf(ownXKey(ds, xKey, yKey));
  if (b < 0) return null;
  const put = (c: Col) => scatterIntoBlock(c, n, blocks.length, b);
  return { ...o, y: put(o.y), ...(o.band ? { band: o.band.map((e) => ({ ...e, y: put(e.y) })) } : {}) };
}
