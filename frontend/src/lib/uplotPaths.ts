// Shared uPlot path builders, made once. They live in their own module (not
// uplotOpts.ts) because constructing them needs the uPlot *runtime* — the
// options builder keeps a type-only import so headless tests never pull in
// uPlot's matchMedia init. Stages pass these into buildOpts.
import uPlot from "uplot";

/** Step-after ("post") builder — the "Step" default-trace preference AND
 *  the Graph Builder "step" mark's default alignment (GAP_PLOTTYPES). uPlot's
 *  `align: 1` holds a point's Y value until the NEXT x, then jumps — see
 *  `types.ts`'s `StepMode` doc for why "post" is the right default. */
export const STEPPED_PATHS = uPlot.paths?.stepped?.({ align: 1 });

/** Step-before ("pre") builder — the GAP_PLOTTYPES "step" mark's `stepMode:
 *  "pre"` (uPlot `align: -1`): the jump happens immediately at each point's
 *  OWN x, then holds until the next. Sibling of `STEPPED_PATHS`, same reason
 *  for living here (needs the uPlot runtime). */
export const STEPPED_PATHS_PRE = uPlot.paths?.stepped?.({ align: -1 });

/** Step-mid builder — the GAP_PLOTTYPES "step" mark's `stepMode: "mid"`
 *  (matplotlib's `steps-mid`): the jump happens at the x-MIDPOINT between two
 *  consecutive points. uPlot's own `paths.stepped` only supports `align: 1 |
 *  -1` (post/pre) — there is no built-in mid, so this is a small hand-rolled
 *  builder using uPlot's PUBLIC pixel-mapping API (`u.valToPos`) rather than
 *  the internal `orient`/gap-clipping helpers `paths.stepped` uses (those
 *  aren't exported). A deliberate simplification that matches this app's
 *  charts, which are always plain x-horizontal/y-vertical (never a flipped/
 *  oriented axis) and don't need the internal helpers' dir-reversal support
 *  (`fullLine`'s wrap in uplotOpts.ts makes the same simplifying assumption).
 *  A null x/y breaks the segment (pen-up) — the same visible effect as
 *  uPlot's own gap handling, just without a dedicated gaps-clip Path2D; a
 *  fill under/between a mid-stepped series is consequently not supported
 *  (the `fill` Path2D is always null here) — an accepted gap for this rare
 *  style combination. */
export const STEPPED_MID_PATHS: uPlot.Series.PathBuilder = (u, seriesIdx, idx0, idx1) => {
  const scaleKey = u.series[seriesIdx].scale ?? "y";
  const dataX = u.data[0] as (number | null)[];
  const dataY = u.data[seriesIdx] as unknown as (number | null)[];
  const stroke = new Path2D();
  let pen = false;
  let prevX = 0;
  let prevY = 0;
  for (let i = idx0; i <= idx1; i++) {
    const xv = dataX[i];
    const yv = dataY[i];
    if (xv == null || yv == null || !Number.isFinite(xv) || !Number.isFinite(yv)) {
      pen = false;
      continue;
    }
    const px = u.valToPos(xv, "x", true);
    const py = u.valToPos(yv, scaleKey, true);
    if (pen) {
      const midX = (prevX + px) / 2;
      stroke.lineTo(midX, prevY);
      stroke.lineTo(midX, py);
      stroke.lineTo(px, py);
    } else {
      stroke.moveTo(px, py);
    }
    prevX = px;
    prevY = py;
    pen = true;
  }
  return { stroke, fill: null, clip: null, band: null };
};

/** Plain linear builder — wrapped by buildOpts to draw non-monotonic-x data
 *  (hysteresis loops) over the full acquisition order. */
export const LINEAR_PATHS = uPlot.paths?.linear?.();

/** Built-in circle marker builder — same non-monotonic-x purpose, for points. */
export const POINTS_PATHS = uPlot.paths?.points?.();
