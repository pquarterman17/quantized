// Client-side preview math for the RSM box/ruler/sector tools (RSM_CUTS_PLAN
// item 5). This is the ONE place the live-drag preview computes a number —
// the sparkline, the inline N/∫I readout, and the panel's numeric preview
// (item 6/8, not built here) must all call THROUGH this module rather than
// re-deriving their own approximation of "what will the commit produce".
//
// ============================================================================
// PREVIEW ONLY — NEVER THE SOURCE OF A COMMITTED DATASET.
// A committed cut ALWAYS comes from the backend (`POST /api/rsm/box` etc.,
// `calc/boxcut.py` / `calc/sectorcut.py`). Do not "optimize" the commit path
// onto this module just because it is already loaded and fast — the backend
// is authoritative (it owns provenance metadata, the exact grid path, and the
// full-resolution cloud), this module exists ONLY so a drag frame doesn't pay
// an HTTP round-trip. See RSM_CUTS_PLAN.md, Resolved decisions rev 2, FINDING
// 2, for why a per-frame round-trip was rejected (m3learning_rsm.xrdml is
// 465,885 points x 5 cols — multi-MB JSON per request, and a drag frame would
// still pay HTTP latency jitter at ~60 Hz even with a payload cache).
// ============================================================================
//
// Mirrors, per function, the calc module it previews:
//   boxProfileLocal / boxStatsLocal  <->  calc/boxcut.py::box_cut / box_stats
//   sectorProfileLocal               <->  calc/sectorcut.py::sector_profile
//   chiProfileLocal                  <->  calc/sectorcut.py::chi_profile
//   wrapMask                         <->  calc/_rsm_grid.py::wrap_mask
//
// `boxProfileLocal` mirrors BOTH of `box_cut`'s selection paths (the exact
// angular grid-line path AND the Q/rotated/wrapped cloud mask+bin path),
// switching between them with the SAME eligibility test `box_cut` uses
// (`space === "angular" && angle === 0 && wrap == null &&` a map shape is
// known) — see Resolved decisions rev 2: "lib/roiMath.ts -- one pure TS
// module mirroring the COMMIT semantics (box grid path, box cloud path incl.
// angle + wrap, sector, chi)". `boxStatsLocal` mirrors `box_stats`, which has
// no grid path at all (it always reduces the raw scattered cloud).
//
// `cols` (the coordinate/intensity arrays every function below takes) is the
// CALLER-picked column set, mirroring `_rsm_grid.scatter_columns` — plain
// `Float64Array`s over whatever is already loaded client-side (the payload's
// own columns for "angular", or the parsed Qx/Qz columns for "q"). This
// module never touches a `DataStruct` object or does its own space/column
// selection — that responsibility (and the "which columns for which axis
// pair" decision) belongs to the caller (item 6's `useMapRoi.ts`), the same
// separation `lib/roi.ts`'s gesture math has from `components/Stage/`.
//
// PERFORMANCE (measured, not guessed — a throwaway `performance.now()`
// harness, 20-call average per function, run under Node 22/V8 against
// 465,885 synthetic Float64 points, the real m3learning_rsm.xrdml point
// count; not a committed benchmark file, this comment IS the record):
//   boxProfileLocal (cloud, 200 bins)      ~2.1 ms
//   boxProfileLocal (rotated, 200 bins)    ~2.0 ms
//   boxStatsLocal                          ~2.7 ms
//   sectorProfileLocal (100 bins)          ~13.6 ms
//   chiProfileLocal (90 bins)              ~16.0 ms
// The box/ruler functions (what a drag frame actually calls, per-rAF) are
// comfortably inside a 16 ms (60 Hz) frame budget. `atan2`/`hypot` per point
// make the true-polar sector/chi path meaningfully more expensive — close
// to a single frame at this point count. That is an acceptable cost TODAY
// because neither is drag-driven yet (the sector wedge is numeric-field- and
// panel-driven; Tier 3 item 12 explicitly defers a draggable wedge until
// "numeric + live preview prove insufficient") — but a future draggable
// sector/annulus should re-measure before assuming 60 Hz headroom, not
// inherit this note's box-path numbers.
// The grid path is even cheaper than any of the above (bounded by
// map_shape's row/col counts, not point count). Every function does exactly
// ONE pass over the input columns — no intermediate N-length array
// allocation; mask/rotate/bin happen inline per point, accumulating straight
// into small `bins`-length typed arrays — so allocation pressure stays
// O(bins), not O(N), across a 60 Hz drag.
//
// OUTPUT SIZE: every profile function clamps its bin count to <=200
// (`MAX_PREVIEW_BINS`) regardless of what a caller requests — the sparkline
// never needs more resolution than that, and it bounds the accumulator
// arrays' size independent of the caller.
//
// DOCUMENTED DEVIATION (the honest, tested kind the RSM_CUTS_PLAN item 5
// asks for, not a silent approximation): the cloud path's bin assignment
// uses a direct formulaic index (`floor((coord - edgeLo) / binWidth)`,
// matching the UNIFORM spacing `np.linspace` produces) rather than
// replicating `scipy.stats.binned_statistic`'s internal edge search. For a
// point whose coordinate lands within float64 epsilon of a bin boundary, the
// two approaches can disagree by at most one bin. This has never been
// observed against the frozen parity fixture (`roiMath.golden.json`,
// generated from continuous/random synthetic data) at rtol 1e-9 — stated
// here in case a future fixture with exact-boundary points ever needs a
// looser, explicitly-commented tolerance instead of a silently-loosened one.

import type { RoiRect } from "./roi";

// ── Shared types ─────────────────────────────────────────────────────────

/** Flat coordinate/intensity columns for the box tools, ALREADY selected for
 *  the ROI's axis pair (2Theta/<axis1> for "angular", Qx/Qz for "q") — the
 *  caller does that selection, mirroring `_rsm_grid.scatter_columns`.
 *  `mapShape` is `dataset.metadata.map_shape` verbatim (`[nRows, nCols]`,
 *  row-major flat layout: `x[row * nCols + col]` — the SAME layout
 *  `io/xrdml.py`/`fixtures/synthetic_rsm.py` write via `grid.ravel()`).
 *  `null`/`undefined` when the dataset has no regular grid (or the caller
 *  hasn't bothered to look it up for a "q" rect, which never uses it) —
 *  `boxProfileLocal` then always takes the cloud path, matching `box_cut`'s
 *  own `map_shape` fallback. */
export interface BoxCols {
  x: Float64Array;
  y: Float64Array;
  intensity: Float64Array;
  mapShape?: readonly [number, number] | null;
}

/** Flat Qx/Qz/Intensity columns for the true-polar tools — mirrors
 *  `_rsm_grid.scatter_columns(ds, "q")` before `sectorcut.py`'s own
 *  hypot/atan2 transform (done inside `sectorProfileLocal`/`chiProfileLocal`,
 *  same as `_polar_columns`). */
export interface PolarCols {
  qx: Float64Array;
  qz: Float64Array;
  intensity: Float64Array;
}

export type BoxCollapse = "x" | "y";
export type BoxReduce = "sum" | "mean" | "max";
export type SectorMode = "sum" | "mean";
export type WrapAxis = "x" | "y" | null;

export interface BoxProfileOptions {
  collapse?: BoxCollapse;
  reduce?: BoxReduce;
  nBins?: number;
  angle?: number;
  wrap?: WrapAxis;
}

export interface BoxStatsOptions {
  angle?: number;
  wrap?: WrapAxis;
}

export interface SectorOptions {
  qMin: number;
  qMax: number;
  phiMin?: number;
  phiMax?: number;
  nBins?: number;
  mode?: SectorMode;
}

/** A binned 1-D preview profile — x centres + reduced intensity + per-bin
 *  point count (mirrors `_rsm_grid.cut_result`'s two-column
 *  `["Intensity", "N points"]` shape, split into named arrays instead of a
 *  DataStruct — this module never builds one, see the header). `null` when
 *  the ROI selects nothing at all (mirrors `box_cut`/`sector_profile`'s
 *  "selects no data" `ValueError` — a preview during a drag legitimately
 *  passes through this state, so it is a normal return value here, not an
 *  exception). */
export interface RoiProfile {
  x: Float64Array;
  intensity: Float64Array;
  counts: Float64Array;
}

/** Mirrors `boxcut.box_stats`'s dict verbatim (snake_case field names on
 *  purpose — this is the same shape the inline bar will echo after a REAL
 *  Stats commit, so the live preview and the committed readout share one
 *  vocabulary). `null` when the ROI selects nothing. */
export interface RoiBoxStats {
  n_points: number;
  integrated_intensity: number;
  mean_intensity: number;
  max_intensity: number;
  peak_x: number;
  peak_y: number;
  centroid_x: number;
  centroid_y: number;
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
  space: RoiRect["space"];
  angle: number;
  wrap: WrapAxis;
}

// ── Shared numeric helpers ──────────────────────────────────────────────

const MAX_PREVIEW_BINS = 200;
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Python's `%` (always non-negative for a positive divisor) — JS's `%` keeps
 *  the dividend's sign, so a raw `x % 360` on a negative angle would NOT
 *  match `_rsm_grid.wrap_mask`'s rebase. */
function pymod(x: number, n: number): number {
  const r = x % n;
  return r < 0 ? r + n : r;
}

function clampBins(nBins: number | undefined, fallback: number): number {
  const requested = nBins ?? fallback;
  return Math.min(MAX_PREVIEW_BINS, Math.max(2, Math.round(requested)));
}

/** Ascending-x stable sort over a profile's three parallel arrays — mirrors
 *  `_rsm_grid.cut_result`'s `np.argsort(x, kind="stable")`. Every profile
 *  below is already ascending by construction (linspace'd bin edges, or a
 *  mesh whose own axes increase with index), so this is a defensive no-op in
 *  practice — kept anyway so the CONTRACT matches `cut_result`'s exactly,
 *  the same way the backend re-sorts unconditionally rather than trusting
 *  its callers' axis direction. */
function sortByX(x: Float64Array, intensity: Float64Array, counts: Float64Array): RoiProfile {
  const n = x.length;
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => x[a]! - x[b]!); // Array#sort is stable (ES2019+)
  const xs = new Float64Array(n);
  const is_ = new Float64Array(n);
  const cs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = order[i]!;
    xs[i] = x[j]!;
    is_[i] = intensity[j]!;
    cs[i] = counts[j]!;
  }
  return { x: xs, intensity: is_, counts: cs };
}

/** Rotate `(x, y)` about `(cx, cy)` by `-angleDeg` degrees — the cut-ruler
 *  backend (mirrors `boxcut._rotate`): a box rotated by `angle` in the
 *  ORIGINAL frame is axis-aligned in a frame rotated by `-angle`, so
 *  rotating the DATA (not the box) lets a plain axis-aligned mask apply
 *  verbatim afterward. */
function rotatePoint(
  x: number,
  y: number,
  cx: number,
  cy: number,
  cosA: number,
  sinA: number,
): [number, number] {
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * cosA - dy * sinA, cy + dx * sinA + dy * cosA];
}

/** Rebase-then-mask a periodic (mod-360) angular selection — the exact
 *  formula `_rsm_grid.wrap_mask` uses, correct for full-circle, non-wrapping,
 *  and seam-wrapping sectors alike:
 *
 *      span    = ((hi - lo) mod 360) or 360
 *      rebased = (angle - lo) mod 360      -- in [0, 360)
 *      mask    = rebased < span
 *
 *  Exported standalone (not just inlined into the box/sector paths below) so
 *  it is independently unit-testable against the same truth table
 *  `test_calc_sectorcut.py::test_wrap_mask_matches_matlab_branches` uses. */
export function wrapMask(
  anglesDeg: Float64Array,
  lo: number,
  hi: number,
): { mask: Uint8Array; span: number; rebased: Float64Array } {
  const span = pymod(hi - lo, 360) || 360;
  const n = anglesDeg.length;
  const rebased = new Float64Array(n);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const rb = pymod(anglesDeg[i]! - lo, 360);
    rebased[i] = rb;
    mask[i] = rb < span ? 1 : 0;
  }
  return { mask, span, rebased };
}

// ── Box: grid path (exact, angular, unrotated, unwrapped) ──────────────────

/** Exact grid-path box selection — mirrors `boxcut._grid_box`. Reshapes the
 *  flat `x`/`y` columns back to their `(nRows, nCols)` grid via `mapShape`
 *  (row-major: `v[row * nCols + col]`), takes the per-row/per-column mean
 *  (constant along its axis on a real mesh, so this recovers the grid's own
 *  coordinate exactly) as the selection axis, boolean-masks whole rows/
 *  columns, and reduces the selected submatrix with `nansum`/`nanmean`/
 *  `nanmax` semantics (a cell only counts toward `counts` when finite —
 *  matches `boxcut._reduce_lines`). Returns `null` when either mask is empty
 *  ("box selects no data"). */
function gridBoxProfile(
  cols: BoxCols,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  collapse: BoxCollapse,
  reduce: BoxReduce,
): RoiProfile | null {
  const [nRows, nCols] = cols.mapShape!;
  const { x: xs, y: ys, intensity } = cols;

  const selX = new Float64Array(nCols);
  for (let c = 0; c < nCols; c++) {
    let s = 0;
    for (let r = 0; r < nRows; r++) s += xs[r * nCols + c]!;
    selX[c] = s / nRows;
  }
  const selY = new Float64Array(nRows);
  for (let r = 0; r < nRows; r++) {
    let s = 0;
    for (let c = 0; c < nCols; c++) s += ys[r * nCols + c]!;
    selY[r] = s / nCols;
  }

  const rowSel: number[] = [];
  for (let r = 0; r < nRows; r++) if (selY[r]! >= yMin && selY[r]! <= yMax) rowSel.push(r);
  const colSel: number[] = [];
  for (let c = 0; c < nCols; c++) if (selX[c]! >= xMin && selX[c]! <= xMax) colSel.push(c);
  if (rowSel.length === 0 || colSel.length === 0) return null;

  const nOut = collapse === "x" ? colSel.length : rowSel.length;
  const xOut = new Float64Array(nOut);
  const profile = new Float64Array(nOut);
  const counts = new Float64Array(nOut);

  if (collapse === "x") {
    for (let oi = 0; oi < colSel.length; oi++) {
      const c = colSel[oi]!;
      xOut[oi] = selX[c]!;
      let sum = 0;
      let cnt = 0;
      let max = -Infinity;
      for (const r of rowSel) {
        const v = intensity[r * nCols + c]!;
        if (Number.isFinite(v)) {
          sum += v;
          cnt += 1;
          if (v > max) max = v;
        }
      }
      counts[oi] = cnt;
      profile[oi] = reduce === "sum" ? sum : cnt > 0 ? (reduce === "mean" ? sum / cnt : max) : NaN;
    }
  } else {
    for (let oi = 0; oi < rowSel.length; oi++) {
      const r = rowSel[oi]!;
      xOut[oi] = selY[r]!;
      let sum = 0;
      let cnt = 0;
      let max = -Infinity;
      for (const c of colSel) {
        const v = intensity[r * nCols + c]!;
        if (Number.isFinite(v)) {
          sum += v;
          cnt += 1;
          if (v > max) max = v;
        }
      }
      counts[oi] = cnt;
      profile[oi] = reduce === "sum" ? sum : cnt > 0 ? (reduce === "mean" ? sum / cnt : max) : NaN;
    }
  }
  return sortByX(xOut, profile, counts);
}

// ── Box: cloud path (mask + bin, angular-without-grid / q / rotated / wrapped) ─

/** Mask + bin the scattered cloud — mirrors `boxcut._cloud_box`. A single
 *  pass over every point: optionally rotate it about the ROI centre, test
 *  both axes' bounds (periodic rebase when `wrap` names that axis), and — if
 *  selected — accumulate straight into the `bins`-length output arrays (no
 *  per-point allocation, no intermediate N-length mask/coordinate array; see
 *  the module header's performance note). `reduce="sum"` empty bin -> 0;
 *  `"mean"`/`"max"` empty bin -> NaN (matches `boxcut`'s documented
 *  empty-bin convention exactly). */
function cloudBoxProfile(
  cols: BoxCols,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  collapse: BoxCollapse,
  reduce: BoxReduce,
  nBins: number,
  angleDeg: number,
  wrap: WrapAxis,
): RoiProfile | null {
  const { x: xs, y: ys, intensity } = cols;
  const n = xs.length;

  const doRotate = angleDeg !== 0;
  const cx = (xMin + xMax) / 2;
  const cy = (yMin + yMax) / 2;
  const rad = -angleDeg * DEG2RAD;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  const wrapX = wrap === "x";
  const wrapY = wrap === "y";
  const xSpan = wrapX ? pymod(xMax - xMin, 360) || 360 : xMax - xMin;
  const ySpan = wrapY ? pymod(yMax - yMin, 360) || 360 : yMax - yMin;

  const collapseX = collapse === "x";
  const edgeLo = collapseX ? (wrapX ? 0 : xMin) : wrapY ? 0 : yMin;
  const edgeHi = collapseX ? (wrapX ? xSpan : xMax) : wrapY ? ySpan : yMax;
  const offset = collapseX ? (wrapX ? xMin : 0) : wrapY ? yMin : 0;
  const binWidth = (edgeHi - edgeLo) / nBins;

  const sums = new Float64Array(nBins);
  const counts = new Float64Array(nBins);
  const maxes = reduce === "max" ? new Float64Array(nBins).fill(-Infinity) : null;
  let anySelected = false;

  for (let i = 0; i < n; i++) {
    const iv = intensity[i]!;
    if (!Number.isFinite(iv)) continue;
    let xv = xs[i]!;
    let yv = ys[i]!;
    if (doRotate) [xv, yv] = rotatePoint(xv, yv, cx, cy, cosA, sinA);

    let xOk: boolean;
    let xCoord: number;
    if (wrapX) {
      xCoord = pymod(xv - xMin, 360);
      xOk = xCoord < xSpan;
    } else {
      xCoord = xv;
      xOk = xv >= xMin && xv <= xMax;
    }
    if (!xOk) continue;

    let yOk: boolean;
    let yCoord: number;
    if (wrapY) {
      yCoord = pymod(yv - yMin, 360);
      yOk = yCoord < ySpan;
    } else {
      yCoord = yv;
      yOk = yv >= yMin && yv <= yMax;
    }
    if (!yOk) continue;

    anySelected = true;
    const coord = collapseX ? xCoord : yCoord;
    let idx = Math.floor((coord - edgeLo) / binWidth);
    if (idx >= nBins) idx = nBins - 1;
    else if (idx < 0) idx = 0;
    sums[idx]! += iv;
    counts[idx]! += 1;
    if (maxes && iv > maxes[idx]!) maxes[idx] = iv;
  }
  if (!anySelected) return null;

  const xOut = new Float64Array(nBins);
  const profile = new Float64Array(nBins);
  for (let b = 0; b < nBins; b++) {
    xOut[b] = offset + edgeLo + (b + 0.5) * binWidth;
    const cnt = counts[b]!;
    profile[b] =
      reduce === "sum" ? sums[b]! : cnt > 0 ? (reduce === "mean" ? sums[b]! / cnt : maxes![b]!) : NaN;
  }
  return { x: xOut, intensity: profile, counts };
}

// ── Box: public entry points ────────────────────────────────────────────

/** Bounded rectangular integration, collapsed onto one axis — the preview
 *  mirror of `boxcut.box_cut`. Takes the SAME grid-vs-cloud branch `box_cut`
 *  does: the exact grid path when `rect.space === "angular"`, `angle === 0`,
 *  `wrap` is unset, AND `cols.mapShape` is known; the mask+bin cloud path
 *  otherwise (Q-space, a rotated ruler, a periodic pole-figure axis, or an
 *  angular dataset with no known grid shape). `nBins` is clamped to
 *  `[2, 200]` regardless of what is requested (see the module header).
 *  Returns `null` when the ROI selects no data — a normal state mid-drag,
 *  not an error (mirrors `box_cut`'s `"box selects no data"` `ValueError`,
 *  translated to a quiet empty preview instead of a thrown exception). */
export function boxProfileLocal(
  cols: BoxCols,
  rect: RoiRect,
  opts: BoxProfileOptions = {},
): RoiProfile | null {
  const collapse = opts.collapse ?? "x";
  const reduce = opts.reduce ?? "sum";
  const angle = opts.angle ?? 0;
  const wrap = opts.wrap ?? null;
  const nBins = clampBins(opts.nBins, 200);

  const useGrid = rect.space === "angular" && angle === 0 && wrap == null && !!cols.mapShape;
  if (useGrid) {
    return gridBoxProfile(cols, rect.x0, rect.x1, rect.y0, rect.y1, collapse, reduce);
  }
  return cloudBoxProfile(cols, rect.x0, rect.x1, rect.y0, rect.y1, collapse, reduce, nBins, angle, wrap);
}

/** Scalar summary over a rectangular ROI ("the paper numbers") — the preview
 *  mirror of `boxcut.box_stats`. ALWAYS reduces the raw scattered cloud
 *  (`box_stats` has no grid path — see its docstring), so `cols.mapShape` is
 *  never consulted here. `centroid_x`/`centroid_y` are intensity-weighted
 *  using the RAW intensity values as weights, falling back to the unweighted
 *  mean position when the selected weight sum is exactly zero — same
 *  fallback `box_stats` uses. Returns `null` when the ROI selects no data. */
export function boxStatsLocal(
  cols: BoxCols,
  rect: RoiRect,
  opts: BoxStatsOptions = {},
): RoiBoxStats | null {
  const angle = opts.angle ?? 0;
  const wrap = opts.wrap ?? null;
  const { x: xs, y: ys, intensity } = cols;
  const n = xs.length;

  const doRotate = angle !== 0;
  const cx = (rect.x0 + rect.x1) / 2;
  const cy = (rect.y0 + rect.y1) / 2;
  const rad = -angle * DEG2RAD;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  const wrapX = wrap === "x";
  const wrapY = wrap === "y";
  const xSpan = wrapX ? pymod(rect.x1 - rect.x0, 360) || 360 : rect.x1 - rect.x0;
  const ySpan = wrapY ? pymod(rect.y1 - rect.y0, 360) || 360 : rect.y1 - rect.y0;

  let nSel = 0;
  let sumI = 0;
  let sumXI = 0;
  let sumYI = 0;
  let sumXUnweighted = 0;
  let sumYUnweighted = 0;
  let maxI = -Infinity;
  let peakX = NaN;
  let peakY = NaN;

  for (let i = 0; i < n; i++) {
    const iv = intensity[i]!;
    if (!Number.isFinite(iv)) continue;
    let xv = xs[i]!;
    let yv = ys[i]!;
    if (doRotate) [xv, yv] = rotatePoint(xv, yv, cx, cy, cosA, sinA);

    const xOk = wrapX ? pymod(xv - rect.x0, 360) < xSpan : xv >= rect.x0 && xv <= rect.x1;
    if (!xOk) continue;
    const yOk = wrapY ? pymod(yv - rect.y0, 360) < ySpan : yv >= rect.y0 && yv <= rect.y1;
    if (!yOk) continue;

    nSel += 1;
    sumI += iv;
    sumXI += xv * iv;
    sumYI += yv * iv;
    sumXUnweighted += xv;
    sumYUnweighted += yv;
    if (iv > maxI) {
      maxI = iv;
      peakX = xv;
      peakY = yv;
    }
  }
  if (nSel === 0) return null;

  const meanI = sumI / nSel;
  const centroidX = sumI !== 0 ? sumXI / sumI : sumXUnweighted / nSel;
  const centroidY = sumI !== 0 ? sumYI / sumI : sumYUnweighted / nSel;

  return {
    n_points: nSel,
    integrated_intensity: sumI,
    mean_intensity: meanI,
    max_intensity: maxI,
    peak_x: peakX,
    peak_y: peakY,
    centroid_x: centroidX,
    centroid_y: centroidY,
    x_min: rect.x0,
    x_max: rect.x1,
    y_min: rect.y0,
    y_max: rect.y1,
    space: rect.space,
    angle,
    wrap,
  };
}

// ── True-polar: sector / chi ────────────────────────────────────────────

/** Shared sector-mask-then-bin loop for `sectorProfileLocal`/`chiProfileLocal`
 *  — both mask the same way (`_polar_columns` + `wrap_mask`'s sector test +
 *  the |Q| annulus) and differ only in which rebased coordinate they bin and
 *  where the bin edges sit, so the loop itself lives here once. `axis`
 *  picks the binning coordinate: `"q"` bins `qrad` over `[qMin, qMax]`
 *  (`sector_profile`); `"phi"` bins the REBASED azimuth over `[0, span]`
 *  (`chi_profile`, so a wrapping sector's x axis stays monotonic across the
 *  +-180 seam — see `chi_profile`'s docstring). */
function polarBinned(
  cols: PolarCols,
  qMin: number,
  qMax: number,
  phiMin: number,
  phiMax: number,
  nBins: number,
  mode: SectorMode,
  axis: "q" | "phi",
): RoiProfile | null {
  const { qx, qz, intensity } = cols;
  const n = qx.length;
  const span = pymod(phiMax - phiMin, 360) || 360;
  const edgeLo = axis === "q" ? qMin : 0;
  const edgeHi = axis === "q" ? qMax : span;
  const binWidth = (edgeHi - edgeLo) / nBins;

  const sums = new Float64Array(nBins);
  const counts = new Float64Array(nBins);
  let anySelected = false;

  for (let i = 0; i < n; i++) {
    const iv = intensity[i]!;
    if (!Number.isFinite(iv)) continue;
    const qxi = qx[i]!;
    const qzi = qz[i]!;
    const qrad = Math.hypot(qxi, qzi);
    if (qrad < qMin || qrad > qMax) continue;
    const phi = Math.atan2(qzi, qxi) * RAD2DEG;
    const rebased = pymod(phi - phiMin, 360);
    if (!(rebased < span)) continue;

    anySelected = true;
    const coord = axis === "q" ? qrad : rebased;
    let idx = Math.floor((coord - edgeLo) / binWidth);
    if (idx >= nBins) idx = nBins - 1;
    else if (idx < 0) idx = 0;
    sums[idx]! += iv;
    counts[idx]! += 1;
  }
  if (!anySelected) return null;

  const xOut = new Float64Array(nBins);
  const profile = new Float64Array(nBins);
  const xBase = axis === "q" ? qMin : phiMin;
  for (let b = 0; b < nBins; b++) {
    xOut[b] = xBase + (b + 0.5) * binWidth;
    const cnt = counts[b]!;
    profile[b] = mode === "sum" ? sums[b]! : cnt > 0 ? sums[b]! / cnt : NaN;
  }
  return { x: xOut, intensity: profile, counts };
}

/** Radial |Q| profile within an azimuthal sector — the preview mirror of
 *  `sectorcut.sector_profile`. `mode="sum"` (the backend's own default)
 *  totals per-bin intensity; `"mean"` divides by the per-bin point count,
 *  NaN where a bin is empty (matches `sector_profile`'s documented
 *  empty-bin behaviour). Full circle by default (`phiMin=-180, phiMax=180`),
 *  same as the backend. Returns `null` when nothing falls in
 *  `[qMin, qMax]` and the sector — mirrors `sector_profile`'s "no data
 *  points" `ValueError`. */
export function sectorProfileLocal(cols: PolarCols, opts: SectorOptions): RoiProfile | null {
  const phiMin = opts.phiMin ?? -180;
  const phiMax = opts.phiMax ?? 180;
  const nBins = clampBins(opts.nBins, 100);
  const mode = opts.mode ?? "sum";
  return polarBinned(cols, opts.qMin, opts.qMax, phiMin, phiMax, nBins, mode, "q");
}

/** Azimuthal ("chi") profile within a |Q| annulus — the preview mirror of
 *  `sectorcut.chi_profile`. `mode="mean"` (the backend's own default here,
 *  unlike `sector_profile`'s `"sum"`) divides by the per-bin point count.
 *  x is reported as `phiMin + bin centre`, so for a wrapping sector it
 *  legitimately runs past +-180 deg — intentional, see `chi_profile`'s
 *  docstring. Returns `null` when nothing falls in the annulus/sector. */
export function chiProfileLocal(cols: PolarCols, opts: SectorOptions): RoiProfile | null {
  const phiMin = opts.phiMin ?? -180;
  const phiMax = opts.phiMax ?? 180;
  const nBins = clampBins(opts.nBins, 90);
  const mode = opts.mode ?? "mean";
  return polarBinned(cols, opts.qMin, opts.qMax, phiMin, phiMax, nBins, mode, "phi");
}
