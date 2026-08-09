// Pure aspect-ratio maths for the 2-D map viewer (RSM_CUTS_PLAN item 17).
// `mapRender.ts::plotRect` stretches the data grid to fill its available
// pane by default -- correct when the two displayed axes are different
// physical quantities (2Theta vs Omega: a degree of detector rotation and a
// degree of sample rotation are not the same displacement), but WRONG when
// they share a unit that means the same thing on both axes (Qx/Qz, both
// Ang^-1 components of the same momentum-transfer vector) -- there, an
// unequal-scale render distorts peak shape, substrate/film separation, and
// any visual read of tilt or relaxation. Kept out of `mapRender.ts` (and
// free of canvas/DOM) so the aspect decision is unit-testable without a
// canvas backend, same purity split as `lib/mapcuts.ts`.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Angular units where a one-unit step does NOT represent the same physical
 *  displacement on both axes of a map -- 2Theta and Omega are both measured
 *  in "deg", yet one rotates the detector and the other the sample, which is
 *  exactly why their combined mesh is a curved fan in reciprocal space (see
 *  `io/xrdml.py`). Equal-aspect is only a meaningful concept when a unit
 *  step DOES mean the same thing on both axes -- true for reciprocal-space /
 *  length units (Ang^-1, nm, ...), never for angle. This is the one place
 *  the "same unit" rule needs a physical carve-out; it is a unit-shaped
 *  exclusion (not a label check), so it still generalizes to any future
 *  same-unit pair the way a bare string-equality test would. */
const ANGULAR_UNITS = new Set(["deg", "degree", "degrees", "rad", "radian", "radians", "°"]);

/** True when both displayed axes share a unit for which equal aspect is
 *  physically meaningful -- the ONLY input is `DataStruct.units` (via
 *  `MapPayload.xUnit`/`yUnit`), never an axis label, so a future same-unit
 *  pair (e.g. two length channels plotted against each other) locks
 *  automatically without a new special case. Empty units (`""`, an
 *  unlabelled generic channel) never match -- "no known unit" is not "the
 *  same unit". */
export function shouldLockAspect(xUnit: string, yUnit: string): boolean {
  const u = xUnit.trim();
  if (!u || u !== yUnit.trim()) return false;
  return !ANGULAR_UNITS.has(u.toLowerCase());
}

/** Fit `avail` to the data's own aspect ratio (`xSpan`/`ySpan`), letterboxed
 *  (centred, slack on whichever axis is not the limiting one). A degenerate
 *  span (zero, or non-finite -- a single-value axis, or a map with no data)
 *  has no aspect ratio to preserve, so it falls back to filling `avail`
 *  exactly, matching the stretch-to-fill path rather than producing a
 *  zero-size or NaN rect. */
export function fitAspectRect(avail: Rect, xSpan: number, ySpan: number): Rect {
  if (!(xSpan > 0) || !(ySpan > 0)) return avail;
  const dataAspect = xSpan / ySpan;
  const availAspect = avail.w / avail.h;
  let w = avail.w;
  let h = avail.h;
  if (dataAspect > availAspect) {
    // Data is relatively WIDER than the pane -> width-limited; letterbox top/bottom.
    h = avail.w / dataAspect;
  } else {
    // Data is relatively TALLER than (or equal to) the pane -> height-limited;
    // letterbox left/right. Also the `dataAspect === availAspect` case (no
    // slack on either axis, w/h come out equal to avail.w/avail.h).
    w = avail.h * dataAspect;
  }
  return {
    x: avail.x + (avail.w - w) / 2,
    y: avail.y + (avail.h - h) / 2,
    w,
    h,
  };
}
