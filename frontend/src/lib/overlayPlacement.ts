// Where an analysis overlay (fit / baseline / peaks / dy/dx) is drawn on a
// per-series-X view (lib/perSeriesX.ts). ONE placement, used by the canvas
// (Stage/usePerSeriesX) and the figure export (lib/figureSpecOverlays), so the
// screen and the SVG/PDF can never put a curve in different places.
//
// A per-series-X view is the source's n rows repeated once per distinct X
// (block b = rows b*n .. b*n+n-1). An overlay is built at the source's n rows
// for ONE curve, and records that curve when it is made (`OverlayBinding`:
// the Y and the X the producer actually read). It is drawn in the block whose
// X is its bound X, at rows b*n + r, with null (the overlay gap) everywhere
// else. Nothing is ever inferred from the live plot -- the primary curve, the
// draw order and the visible set all change after a fit, and a guess from
// them put R2's fit on T1 (the review of the first attempt).
//
// Fails closed: a bound Y that is not drawn (hidden, or no longer plotted), a
// bound Y that is no longer a curve on the bound X (re-designated columns, or
// the plot's X changed on a one-X sheet), a bound X with no block in this view
// (all its curves hidden -- including a multi-X sheet whose shown curves all
// sit on the plot's X, so the view collapses to that one X), or a row count
// that is not the source's is NOT drawn. An overlay with no curve -- no
// binding (an object from before bindings existed: its X is taken to be the
// plot's) or a binding to no curve (yKey < 0: the peak wizard's markers) -- is
// drawn only when the view is ONE block and that block IS its X (the plot's X
// for a legacy object, `binding.xKey` otherwise), never guessed into a block.
// On a sheet with ONE X (no curve owns another) the view is the source's rows,
// so a placed overlay is returned untouched (the same object).
//
// Cost: the layout is O(channels); a placement is O(blocks x n) once per
// (overlay object, layout) pair and cached by identity, so a rename or an
// exclusion toggle -- same overlay, same blocks -- returns the SAME placed
// object and nothing downstream recomposes.

import { curveX } from "./perSeriesX";
import type { Dataset, OverlayBinding } from "./types";

/** The block structure of one per-series-X view. */
export interface OverlayLayout {
  datasetId: string;
  /** Source rows per block. */
  n: number;
  /** Each block's X column (null = the time column), in view order. */
  blocks: readonly (number | null)[];
  /** Each channel's own X (`curveX`); undefined = not a curve. */
  own: readonly (number | null | undefined)[];
  /** The plot's X: where a channel that is not a curve is drawn (every block
   *  copies it, against the shared X). */
  xKey: number | null;
  /** More than one X is in play: the view has several blocks, or a curve of the
   *  sheet owns an X other than the plot's. False = a one-X sheet. */
  multi: boolean;
  /** The channels this view draws (`shownCurves`: plotted minus hidden). A bound
   *  Y outside it is not drawn, so neither is its overlay. */
  shown: readonly number[];
  /** Identity of the above, for the placement cache. */
  key: string;
}

/** The fields placement reads. `binding` is optional HERE only because an
 *  overlay object may predate the field; every producer sets it. */
interface Placeable {
  datasetId: string;
  binding?: OverlayBinding | null;
  y: (number | null)[];
  band?: { label: string; y: (number | null)[]; legend?: string }[];
}

const code = (x: number | null | undefined) => (x === undefined ? "u" : x === null ? "t" : String(x));

/** The layout of `ds`'s view under plot X `xKey`, with `shown` the drawn
 *  channels: `blocks` is perSeriesXData's, or null when it built no view --
 *  then the view is the plot's X alone (`multi` is still true when some curve
 *  of the sheet owns ANOTHER X: a multi-X sheet whose other curves are hidden).
 *  The one place that decides whether a sheet is multi-X. */
export function overlayLayout(
  ds: Pick<Dataset, "id" | "data" | "columnDesignations">,
  xKey: number | null,
  blocks: readonly (number | null)[] | null | undefined,
  shown: readonly number[],
): OverlayLayout {
  const own = curveX(ds, xKey);
  const multi = !!blocks || own.some((x) => x !== undefined && x !== xKey);
  const b = blocks ?? [xKey];
  const n = ds.data.time.length;
  const key = `${ds.id}|${n}|${code(xKey)}|${b.map(code).join(",")}|${own.map(code).join(",")}|${shown.join(",")}`;
  return { datasetId: ds.id, n, blocks: b, own, xKey, multi, shown, key };
}

const cache = new WeakMap<object, { key: string; out: object | null }>();

/** `o` placed into its bound block of `layout` (see the module header), or
 *  null when it is not drawn here. */
export function placeOverlay<T extends Placeable>(o: T | null | undefined, layout: OverlayLayout): T | null {
  if (!o) return null;
  if (o.datasetId !== layout.datasetId) return null; // another dataset's: never drawn here anyway
  const hit = cache.get(o);
  if (hit && hit.key === layout.key) return hit.out as T | null;
  const out = place(o, layout);
  cache.set(o, { key: layout.key, out });
  return out;
}

function place<T extends Placeable>(o: T, layout: OverlayLayout): T | null {
  const b = o.binding;
  const { n, blocks } = layout;
  // No curve: unbound (a legacy object, taken to be on the plot's X) or bound to
  // none (yKey -1: the peak wizard's markers). Drawn only on a one-block view
  // whose block IS its X -- never guessed into a block of a wider view, and
  // never onto another X's rows when the other curves are hidden.
  if (!b || b.yKey < 0) return blocks.length === 1 && blocks[0] === (b ? b.xKey : layout.xKey) ? o : null;
  if (!layout.shown.includes(b.yKey)) return null; // that Y is hidden / not plotted
  const own = layout.own[b.yKey];
  if ((own === undefined ? layout.xKey : own) !== b.xKey) return null; // that Y is not drawn on that X
  const block = blocks.indexOf(b.xKey);
  if (block < 0 || o.y.length !== n) return null;
  if (blocks.length === 1) return o; // the view IS that X's rows: unchanged
  const total = blocks.length * n;
  const spread = (y: (number | null)[]): (number | null)[] => {
    const out = new Array<number | null>(total).fill(null);
    for (let r = 0; r < n; r++) out[block * n + r] = y[r] ?? null;
    return out;
  };
  // One edge of the wrong length drops the whole band, as withFitOverlay does.
  const band = o.band?.every((e) => e.y.length === n) ? o.band.map((e) => ({ ...e, y: spread(e.y) })) : undefined;
  const { band: _band, ...rest } = o;
  return { ...rest, y: spread(o.y), ...(band ? { band } : {}) } as T;
}
